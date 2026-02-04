/**
 * IPFS Archival Service
 *
 * Handles:
 * - Archiving chat history to IPFS
 * - Retrieving archived content
 * - CID management
 *
 * Uses IPFS HTTP API (Pinata, web3.storage, or local node)
 */

import { query, queryOne, execute } from '../db/index.ts';
import { getConfig } from '../utils/config.ts';

// ============================================================================
// Timeout Helper
// ============================================================================

const DEFAULT_TIMEOUT_MS = 15000; // 15 seconds for IPFS operations

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
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
  apiUrl: string;
  apiKey?: string;
  apiSecret?: string;
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

class IpfsClient {
  private apiUrl: string;
  private headers: Record<string, string>;

  constructor(config: IpfsConfig) {
    this.apiUrl = config.apiUrl;
    this.headers = {
      'Content-Type': 'application/json',
    };

    // Pinata auth
    if (config.apiKey && config.apiSecret) {
      this.headers['pinata_api_key'] = config.apiKey;
      this.headers['pinata_secret_api_key'] = config.apiSecret;
    }
  }

  /**
   * Pin JSON data to IPFS
   */
  async pinJson(data: unknown, name?: string): Promise<PinResponse> {
    const body = {
      pinataContent: data,
      pinataMetadata: name ? { name } : undefined,
    };

    const response = await fetchWithTimeout(`${this.apiUrl}/pinning/pinJSONToIPFS`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`IPFS pin failed: ${error}`);
    }

    const result = await response.json();
    return {
      cid: result.IpfsHash,
      size: result.PinSize,
    };
  }

  /**
   * Pin a file (binary data) to IPFS
   */
  async pinFile(data: Uint8Array, name: string, mimeType: string): Promise<PinResponse> {
    const formData = new FormData();
    const blob = new Blob([data.buffer as ArrayBuffer], { type: mimeType });
    formData.append('file', blob, name);
    formData.append('pinataMetadata', JSON.stringify({ name }));

    // Don't set Content-Type - let the browser set it with boundary
    const headers: Record<string, string> = {};
    if (this.headers['pinata_api_key']) {
      headers['pinata_api_key'] = this.headers['pinata_api_key'];
      headers['pinata_secret_api_key'] = this.headers['pinata_secret_api_key'];
    }

    // File uploads may take longer, use 30 second timeout
    const response = await fetchWithTimeout(`${this.apiUrl}/pinning/pinFileToIPFS`, {
      method: 'POST',
      headers,
      body: formData,
    }, 30000);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`IPFS file pin failed: ${error}`);
    }

    const result = await response.json();
    return {
      cid: result.IpfsHash,
      size: result.PinSize,
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
    const response = await fetchWithTimeout(`${this.apiUrl}/pinning/unpin/${cid}`, {
      method: 'DELETE',
      headers: this.headers,
    });

    if (!response.ok && response.status !== 404) {
      const error = await response.text();
      throw new Error(`IPFS unpin failed: ${error}`);
    }
  }
}

// ============================================================================
// Singleton client
// ============================================================================

let ipfsClient: IpfsClient | null = null;

function getIpfsClient(): IpfsClient {
  if (!ipfsClient) {
    const config = getConfig();
    ipfsClient = new IpfsClient({
      apiUrl: config.ipfsApiUrl ?? 'https://api.pinata.cloud',
      apiKey: config.ipfsApiKey,
      apiSecret: config.ipfsApiSecret,
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
    [chatId]
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
    [chatId]
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
    [result.cid, chatId]
  );

  console.log(`[IPFS] Archived chat ${chatId} to CID: ${result.cid}`);

  return result.cid;
}

/**
 * Fetch archived chat from IPFS
 */
export async function fetchArchivedChat(cid: string): Promise<ArchivedChat> {
  const client = getIpfsClient();
  return client.get<ArchivedChat>(cid);
}

/**
 * Get the latest archive CID for a chat
 */
export async function getLatestArchiveCid(chatId: string): Promise<string | null> {
  const result = await queryOne<{ ipfs_cid: string | null }>(
    'SELECT ipfs_cid FROM multi_chats WHERE id = $1',
    [chatId]
  );
  return result?.ipfs_cid ?? null;
}

/**
 * Archive a single message (for real-time archival)
 */
export async function archiveMessage(
  chatId: string,
  messageId: string
): Promise<string> {
  const message = await queryOne<{
    id: string;
    sender_address: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    is_encrypted: boolean;
    reply_to_id: string | null;
    created_at: Date;
  }>(
    `SELECT id, sender_address, role, content, is_encrypted, reply_to_id, created_at
     FROM multi_chat_messages WHERE id = $1`,
    [messageId]
  );

  if (!message) {
    throw new Error('Message not found');
  }

  const archived: ArchivedMessage = {
    id: message.id,
    sender: message.sender_address,
    role: message.role,
    content: message.content,
    isEncrypted: message.is_encrypted,
    replyTo: message.reply_to_id ?? undefined,
    createdAt: message.created_at.toISOString(),
  };

  const client = getIpfsClient();
  const result = await client.pinJson(archived, `juicy-msg-${messageId}`);

  // Update message with CID
  await execute(
    'UPDATE multi_chat_messages SET ipfs_cid = $1 WHERE id = $2',
    [result.cid, messageId]
  );

  return result.cid;
}

/**
 * Get archive history (all previous CIDs)
 */
export async function getArchiveHistory(cid: string): Promise<ArchivedChat[]> {
  const history: ArchivedChat[] = [];
  let currentCid: string | undefined = cid;

  const client = getIpfsClient();

  while (currentCid) {
    try {
      const archive: ArchivedChat = await client.get<ArchivedChat>(currentCid);
      history.push(archive);
      currentCid = archive.previousCid;
    } catch (error) {
      console.error(`Failed to fetch archive CID ${currentCid}:`, error);
      break;
    }
  }

  return history;
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Unpin old archives (keep only last N)
 */
export async function cleanupOldArchives(
  chatId: string,
  keepCount: number = 5
): Promise<number> {
  const latestCid = await getLatestArchiveCid(chatId);
  if (!latestCid) return 0;

  const history = await getArchiveHistory(latestCid);
  if (history.length <= keepCount) return 0;

  const client = getIpfsClient();
  let unpinned = 0;

  for (let i = keepCount; i < history.length; i++) {
    try {
      const archive = history[i];
      // Don't unpin if it has a previousCid (linked list integrity)
      // Only unpin the tail
      if (!archive.previousCid) {
        await client.unpin(latestCid);
        unpinned++;
      }
    } catch (error) {
      console.error('Failed to unpin:', error);
    }
  }

  return unpinned;
}

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
  mimeType: string
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

// ============================================================================
// Scheduled Archival
// ============================================================================

/**
 * Archive all chats that haven't been archived in the last N hours
 */
export async function archiveStaleChats(hoursThreshold: number = 24): Promise<number> {
  const staleChats = await query<{ id: string }>(
    `SELECT id FROM multi_chats
     WHERE last_archived_at IS NULL
        OR last_archived_at < NOW() - INTERVAL '${hoursThreshold} hours'
     ORDER BY last_archived_at ASC NULLS FIRST
     LIMIT 10`,
    []
  );

  let archived = 0;

  for (const chat of staleChats) {
    try {
      await archiveChat(chat.id);
      archived++;
    } catch (error) {
      console.error(`Failed to archive chat ${chat.id}:`, error);
    }
  }

  return archived;
}
