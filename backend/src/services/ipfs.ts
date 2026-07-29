/**
 * IPFS Archival Service
 *
 * Handles:
 * - Archiving chat history to IPFS
 * - Retrieving archived content
 * - CID management
 *
 * Filebase creates canonical DAG-PB CIDs and Pinata redundantly pins them.
 */

import { execute, query, queryOne } from '../db/index.ts';
import { getConfig } from '../utils/config.ts';

// ============================================================================
// Timeout Helper
// ============================================================================

const DEFAULT_TIMEOUT_MS = 15000; // 15 seconds for IPFS operations
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const FILEBASE_IPFS_API_BASE = 'https://rpc.filebase.io';
const PINATA_PIN_BY_CID_URL = 'https://api.pinata.cloud/v3/files/public/pin_by_cid';
const PINATA_UNPIN_BASE_URL = 'https://api.pinata.cloud/pinning/unpin';

function decodeBase32Cid(cid: string): Uint8Array {
  const normalized = cid.trim().toLowerCase();
  if (!normalized.startsWith('b')) throw new Error('CIDv1 must use base32 multibase');
  const output: number[] = [];
  let bits = 0;
  let buffer = 0;
  for (const char of normalized.slice(1).replace(/=+$/, '')) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`Invalid base32 character: ${char}`);
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >> (bits - 8)) & 0xff);
      bits -= 8;
      buffer &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }
  return new Uint8Array(output);
}

function readCidVarint(bytes: Uint8Array, offset: number): { value: number; offset: number } {
  let value = 0;
  let shift = 0;
  for (let index = offset; index < bytes.length; index++) {
    const byte = bytes[index];
    value += (byte & 0x7f) * (2 ** shift);
    if ((byte & 0x80) === 0) return { value, offset: index + 1 };
    shift += 7;
    if (shift > 49) throw new Error('CID varint is too large');
  }
  throw new Error('CID varint is truncated');
}

export function assertDagPbCid(cid: string): void {
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid)) return;
  const bytes = decodeBase32Cid(cid);
  const version = readCidVarint(bytes, 0);
  const codec = readCidVarint(bytes, version.offset);
  const multihashCode = readCidVarint(bytes, codec.offset);
  const multihashLength = readCidVarint(bytes, multihashCode.offset);
  if (
    version.value !== 1 || codec.value !== 0x70 || multihashCode.value !== 0x12 ||
    multihashLength.value !== 32 || multihashLength.offset + multihashLength.value !== bytes.length
  ) {
    throw new Error('Pinned metadata CID is not a DAG-PB sha2-256 file');
  }
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`IPFS request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// Types
// ============================================================================

export interface IpfsConfig {
  enabled: boolean;
  filebaseToken: string;
  pinataJwt: string;
}

export interface ArchivedChat {
  version: '1.0';
  chatId: string;
  name?: string;
  description?: string;
  founder: string;
  members: ArchivedMember[];
  messages: ArchivedMessage[];
  tokenGate?: {
    chainId: number;
    tokenAddress: string;
    projectId?: number;
    minBalance: string;
  };
  archivedAt: string;
  previousCid?: string; // Link to previous archive (for incremental)
}

export interface ArchivedMember {
  address: string;
  role: string;
  joinedAt: string;
  leftAt?: string;
}

export interface ArchivedMessage {
  id: string;
  sender: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  isEncrypted: boolean;
  replyTo?: string;
  createdAt: string;
}

export interface PinResponse {
  cid: string;
  size: number;
}

// ============================================================================
// IPFS Client
// ============================================================================

export class IpfsClient {
  private enabled: boolean;
  private filebaseToken: string;
  private pinataJwt: string;

  constructor(config: IpfsConfig) {
    this.enabled = config.enabled;
    this.filebaseToken = config.filebaseToken;
    this.pinataJwt = config.pinataJwt;
  }

  private assertConfigured(): void {
    if (!this.enabled) throw new Error('IPFS pinning is disabled');
    if (!this.filebaseToken || !this.pinataJwt) {
      throw new Error(
        'IPFS pinning requires FILEBASE_IPFS_RPC_TOKEN and PINATA_JWT',
      );
    }
  }

  /**
   * Pin JSON data to IPFS
   */
  async pinJson(data: unknown, name?: string): Promise<PinResponse> {
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    return this.pinFile(bytes, name ?? 'metadata.json', 'application/json');
  }

  /**
   * Pin a file (binary data) to IPFS
   */
  async pinFile(data: Uint8Array, name: string, mimeType: string): Promise<PinResponse> {
    this.assertConfigured();
    const formData = new FormData();
    const blob = new Blob([data.slice().buffer], { type: mimeType });
    formData.append('file', blob, name);

    const filebaseResponse = await fetchWithTimeout(
      `${FILEBASE_IPFS_API_BASE}/api/v0/add?pin=true&cid-version=0`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.filebaseToken}` },
        body: formData,
      },
      30000,
    );

    if (!filebaseResponse.ok) {
      throw new Error(`Filebase IPFS add failed: ${filebaseResponse.status}`);
    }

    const filebaseResult = await filebaseResponse.json() as {
      Hash?: unknown;
      Size?: unknown;
    };
    if (typeof filebaseResult.Hash !== 'string') {
      throw new Error('Filebase IPFS add returned no CID');
    }
    assertDagPbCid(filebaseResult.Hash);

    const pinataResponse = await fetchWithTimeout(PINATA_PIN_BY_CID_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.pinataJwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cid: filebaseResult.Hash, name }),
    });
    if (!pinataResponse.ok) {
      throw new Error(`Pinata replication failed: ${pinataResponse.status}`);
    }
    const pinataResult = await pinataResponse.json() as {
      data?: { cid?: unknown };
    };
    if (pinataResult.data?.cid !== filebaseResult.Hash) {
      throw new Error('Pinata replication returned a mismatched CID');
    }

    const reportedSize = Number(filebaseResult.Size);
    return {
      cid: filebaseResult.Hash,
      size: Number.isFinite(reportedSize) && reportedSize >= 0 ? reportedSize : data.byteLength,
    };
  }

  /**
   * Fetch content by CID
   */
  async get<T>(cid: string): Promise<T> {
    // Use IPFS gateway
    const response = await fetchWithTimeout(`https://gateway.pinata.cloud/ipfs/${cid}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch CID: ${cid}`);
    }
    return response.json() as Promise<T>;
  }

  /**
   * Unpin content (optional cleanup)
   */
  async unpin(cid: string): Promise<void> {
    this.assertConfigured();
    assertDagPbCid(cid);
    const [filebaseResponse, pinataResponse] = await Promise.all([
      fetchWithTimeout(
        `${FILEBASE_IPFS_API_BASE}/api/v0/pin/rm?arg=${encodeURIComponent(cid)}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.filebaseToken}` },
        },
      ),
      fetchWithTimeout(`${PINATA_UNPIN_BASE_URL}/${encodeURIComponent(cid)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.pinataJwt}` },
      }),
    ]);
    if (
      (!filebaseResponse.ok && filebaseResponse.status !== 404) ||
      (!pinataResponse.ok && pinataResponse.status !== 404)
    ) {
      throw new Error('IPFS unpin failed for one or more providers');
    }
  }
}

// ============================================================================
// Singleton client
// ============================================================================

let ipfsClient: IpfsClient | null = null;

export function getIpfsClient(): IpfsClient {
  if (!ipfsClient) {
    const config = getConfig();
    ipfsClient = new IpfsClient({
      enabled: config.ipfsPinningEnabled,
      filebaseToken: config.filebaseIpfsRpcToken,
      pinataJwt: config.pinataJwt,
    });
  }
  return ipfsClient;
}

// ============================================================================
// Archive Functions
// ============================================================================

/**
 * Archive a chat to IPFS
 */
export async function archiveChat(chatId: string): Promise<string> {
  // Fetch chat data
  const chat = await queryOne<{
    id: string;
    name: string | null;
    description: string | null;
    founder_address: string;
    token_gate_enabled: boolean;
    token_gate_chain_id: number | null;
    token_gate_token_address: string | null;
    token_gate_project_id: number | null;
    token_gate_min_balance: string | null;
    ipfs_cid: string | null;
  }>('SELECT * FROM multi_chats WHERE id = $1', [chatId]);

  if (!chat) {
    throw new Error('Chat not found');
  }

  // Fetch members
  const members = await query<{
    member_address: string;
    role: string;
    joined_at: Date;
    left_at: Date | null;
  }>(
    `SELECT member_address, role, joined_at, left_at
     FROM multi_chat_members WHERE chat_id = $1
     ORDER BY joined_at ASC`,
    [chatId],
  );

  // Fetch messages (non-deleted)
  const messages = await query<{
    id: string;
    sender_address: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    is_encrypted: boolean;
    reply_to_id: string | null;
    created_at: Date;
  }>(
    `SELECT id, sender_address, role, content, is_encrypted, reply_to_id, created_at
     FROM multi_chat_messages
     WHERE chat_id = $1 AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    [chatId],
  );

  // Build archive object
  const archive: ArchivedChat = {
    version: '1.0',
    chatId: chat.id,
    name: chat.name ?? undefined,
    description: chat.description ?? undefined,
    founder: chat.founder_address,
    members: members.map((m) => ({
      address: m.member_address,
      role: m.role,
      joinedAt: m.joined_at.toISOString(),
      leftAt: m.left_at?.toISOString(),
    })),
    messages: messages.map((m) => ({
      id: m.id,
      sender: m.sender_address,
      role: m.role,
      content: m.content,
      isEncrypted: m.is_encrypted,
      replyTo: m.reply_to_id ?? undefined,
      createdAt: m.created_at.toISOString(),
    })),
    archivedAt: new Date().toISOString(),
    previousCid: chat.ipfs_cid ?? undefined,
  };

  // Add token gate if enabled
  if (chat.token_gate_enabled) {
    archive.tokenGate = {
      chainId: chat.token_gate_chain_id!,
      tokenAddress: chat.token_gate_token_address!,
      projectId: chat.token_gate_project_id ?? undefined,
      minBalance: chat.token_gate_min_balance ?? '0',
    };
  }

  // Pin to IPFS
  const client = getIpfsClient();
  const result = await client.pinJson(archive, `juicy-chat-${chatId}`);

  // Update database with new CID
  await execute(
    `UPDATE multi_chats SET ipfs_cid = $1, last_archived_at = NOW() WHERE id = $2`,
    [result.cid, chatId],
  );

  console.log(`[IPFS] Archived chat ${chatId} to CID: ${result.cid}`);

  return result.cid;
}

/**
 * Fetch archived chat from IPFS
 */
export function fetchArchivedChat(cid: string): Promise<ArchivedChat> {
  const client = getIpfsClient();
  return client.get<ArchivedChat>(cid);
}

/**
 * Get the latest archive CID for a chat
 */
export async function getLatestArchiveCid(chatId: string): Promise<string | null> {
  const result = await queryOne<{ ipfs_cid: string | null }>(
    'SELECT ipfs_cid FROM multi_chats WHERE id = $1',
    [chatId],
  );
  return result?.ipfs_cid ?? null;
}

// ============================================================================
// Cleanup
// ============================================================================

// ============================================================================
// File Pinning (for user uploads)
// ============================================================================

/**
 * Pin a file to IPFS from base64 data
 * @param base64Data - Base64 encoded file data (without data URL prefix)
 * @param fileName - File name for metadata
 * @param mimeType - MIME type of the file
 * @returns IPFS CID
 */
export async function pinFileToIpfs(
  base64Data: string,
  fileName: string,
  mimeType: string,
): Promise<string> {
  const client = getIpfsClient();

  // Decode base64 to binary
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const result = await client.pinFile(bytes, fileName, mimeType);
  console.log(`[IPFS] Pinned file ${fileName} to CID: ${result.cid}`);

  return result.cid;
}

/**
 * Pin a batch of base64 attachments to IPFS in parallel.
 * Failures are logged and returned with a null cid so callers can skip them
 * without failing the whole batch.
 */
export async function pinAttachments<
  T extends { name: string; mimeType: string; data: string },
>(attachments: T[]): Promise<Array<{ att: T; cid: string | null }>> {
  const results = await Promise.allSettled(
    attachments.map((att) => pinFileToIpfs(att.data, att.name, att.mimeType)),
  );
  return attachments.map((att, i) => {
    const result = results[i];
    if (result.status === 'fulfilled') {
      return { att, cid: result.value };
    }
    console.error(`[IPFS] Failed to pin attachment ${att.name}:`, result.reason);
    return { att, cid: null };
  });
}
