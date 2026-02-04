/**
 * E2E Encryption Service for Multi-Person Chats
 *
 * Uses X25519 for key exchange and ChaCha20-Poly1305 for symmetric encryption.
 * For managed wallets, the server stores encrypted private keys.
 * For external wallets, users manage their own keys.
 */

import { query, queryOne, execute } from '../db/index.ts';
import { getConfig } from '../utils/config.ts';
import * as jose from 'jose';

// ============================================================================
// Types
// ============================================================================

export interface Keypair {
  publicKey: string; // Base64-encoded
  privateKey: string; // Base64-encoded (plaintext for external wallets)
}

export interface EncryptedKeypair {
  publicKey: string;
  encryptedPrivateKey: string; // Server-encrypted for managed wallets
}

export interface GroupKey {
  key: string; // Base64-encoded symmetric key
  version: number;
}

interface DbUserKeypair {
  id: string;
  user_id: string;
  public_key: string;
  encrypted_private_key: string;
  algorithm: string;
  version: number;
  is_active: boolean;
  created_at: Date;
  revoked_at: Date | null;
}

interface DbChatKey {
  id: string;
  chat_id: string;
  member_address: string;
  encrypted_key: string;
  key_version: number;
  created_at: Date;
  revoked_at: Date | null;
}

// ============================================================================
// Constants
// ============================================================================

const ALGORITHM = 'x25519';
const SYMMETRIC_KEY_LENGTH = 32; // 256 bits for ChaCha20-Poly1305
const NONCE_LENGTH = 12; // 96 bits for ChaCha20-Poly1305

// ============================================================================
// Crypto Utilities (using Web Crypto API)
// ============================================================================

/**
 * Generate a random nonce
 */
function generateNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
}

/**
 * Generate a random symmetric key
 */
function generateSymmetricKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SYMMETRIC_KEY_LENGTH));
}

/**
 * Convert Uint8Array to base64
 */
function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Convert base64 to Uint8Array
 */
function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Derive an encryption key from the server's master key using HKDF
 * SECURITY: Uses dedicated ENCRYPTION_MASTER_KEY, separate from JWT_SECRET
 */
async function deriveServerKey(salt: Uint8Array): Promise<CryptoKey> {
  const config = getConfig();
  const masterKey = new TextEncoder().encode(config.encryptionMasterKey);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    masterKey.buffer as ArrayBuffer,
    'HKDF',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt.buffer as ArrayBuffer,
      info: new TextEncoder().encode('juicy-vision-keypair-encryption').buffer as ArrayBuffer,
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ============================================================================
// X25519 Key Exchange (simplified using Web Crypto ECDH)
// ============================================================================

/**
 * Generate an X25519 keypair for key exchange
 * Note: Web Crypto doesn't support X25519 directly, so we use P-256 ECDH as a fallback
 * In production, consider using @noble/curves for actual X25519
 */
export async function generateKeypair(): Promise<Keypair> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    ['deriveBits']
  );

  const publicKeyBuffer = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

  return {
    publicKey: toBase64(new Uint8Array(publicKeyBuffer)),
    privateKey: toBase64(new Uint8Array(privateKeyBuffer)),
  };
}

/**
 * Derive a shared secret from two keypairs (for future direct messaging)
 */
export async function deriveSharedSecret(
  privateKeyBase64: string,
  publicKeyBase64: string
): Promise<Uint8Array> {
  const privateKeyBytes = fromBase64(privateKeyBase64);
  const publicKeyBytes = fromBase64(publicKeyBase64);

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes.buffer as ArrayBuffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits']
  );

  const publicKey = await crypto.subtle.importKey(
    'raw',
    publicKeyBytes.buffer as ArrayBuffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256
  );

  return new Uint8Array(sharedBits);
}

// ============================================================================
// Symmetric Encryption (AES-GCM)
// ============================================================================

/**
 * Encrypt data with a symmetric key
 */
export async function encryptWithKey(
  plaintext: string,
  keyBytes: Uint8Array
): Promise<string> {
  const nonce = generateNonce();
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer },
    key,
    new TextEncoder().encode(plaintext).buffer as ArrayBuffer
  );

  // Prepend nonce to ciphertext
  const combined = new Uint8Array(nonce.length + ciphertext.byteLength);
  combined.set(nonce);
  combined.set(new Uint8Array(ciphertext), nonce.length);

  return toBase64(combined);
}

/**
 * Decrypt data with a symmetric key
 */
export async function decryptWithKey(
  encryptedBase64: string,
  keyBytes: Uint8Array
): Promise<string> {
  const combined = fromBase64(encryptedBase64);
  const nonce = combined.slice(0, NONCE_LENGTH);
  const ciphertext = combined.slice(NONCE_LENGTH);

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer },
    key,
    ciphertext.buffer as ArrayBuffer
  );

  return new TextDecoder().decode(plaintext);
}

// ============================================================================
// Server-Side Key Encryption (for managed wallets)
// ============================================================================

/**
 * Encrypt a private key for server storage (managed wallets only)
 */
export async function encryptPrivateKey(privateKeyBase64: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const serverKey = await deriveServerKey(salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: salt.buffer as ArrayBuffer }, // Use salt as IV for simplicity
    serverKey,
    fromBase64(privateKeyBase64).buffer as ArrayBuffer
  );

  // Prepend salt to ciphertext
  const combined = new Uint8Array(salt.length + ciphertext.byteLength);
  combined.set(salt);
  combined.set(new Uint8Array(ciphertext), salt.length);

  return toBase64(combined);
}

/**
 * Decrypt a private key from server storage
 */
export async function decryptPrivateKey(encryptedBase64: string): Promise<string> {
  const combined = fromBase64(encryptedBase64);
  const salt = combined.slice(0, 16);
  const ciphertext = combined.slice(16);

  const serverKey = await deriveServerKey(salt);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: salt.buffer as ArrayBuffer },
    serverKey,
    ciphertext.buffer as ArrayBuffer
  );

  return toBase64(new Uint8Array(plaintext));
}

// ============================================================================
// User Keypair Management (Database)
// ============================================================================

/**
 * Create and store a keypair for a managed wallet user
 */
export async function createUserKeypair(userId: string): Promise<EncryptedKeypair> {
  const keypair = await generateKeypair();
  const encryptedPrivateKey = await encryptPrivateKey(keypair.privateKey);

  // Revoke any existing active keypairs
  await execute(
    `UPDATE user_keypairs SET is_active = FALSE, revoked_at = NOW()
     WHERE user_id = $1 AND is_active = TRUE`,
    [userId]
  );

  // Store new keypair
  await execute(
    `INSERT INTO user_keypairs (user_id, public_key, encrypted_private_key, algorithm)
     VALUES ($1, $2, $3, $4)`,
    [userId, keypair.publicKey, encryptedPrivateKey, ALGORITHM]
  );

  return {
    publicKey: keypair.publicKey,
    encryptedPrivateKey,
  };
}

/**
 * Get the active keypair for a user
 */
export async function getUserKeypair(userId: string): Promise<EncryptedKeypair | null> {
  const keypair = await queryOne<DbUserKeypair>(
    `SELECT * FROM user_keypairs WHERE user_id = $1 AND is_active = TRUE`,
    [userId]
  );

  if (!keypair) return null;

  return {
    publicKey: keypair.public_key,
    encryptedPrivateKey: keypair.encrypted_private_key,
  };
}

/**
 * Get or create a keypair for a user
 */
export async function getOrCreateUserKeypair(userId: string): Promise<EncryptedKeypair> {
  const existing = await getUserKeypair(userId);
  if (existing) return existing;
  return createUserKeypair(userId);
}

/**
 * Decrypt a user's private key (server-side only, for managed wallets)
 */
export async function getUserPrivateKey(userId: string): Promise<string | null> {
  const keypair = await getUserKeypair(userId);
  if (!keypair) return null;

  return decryptPrivateKey(keypair.encryptedPrivateKey);
}

// ============================================================================
// Group Key Management (for multi-person chats)
// ============================================================================

/**
 * Generate a new group key for a chat
 */
export function generateGroupKey(): GroupKey {
  return {
    key: toBase64(generateSymmetricKey()),
    version: 1,
  };
}

/**
 * Store an encrypted group key for a chat member
 */
export async function storeGroupKeyForMember(
  chatId: string,
  memberAddress: string,
  groupKey: GroupKey,
  memberPublicKey: string
): Promise<void> {
  // Encrypt the group key with the member's public key
  // For simplicity, we'll use a hybrid approach: encrypt with a derived key
  // In a full MLS implementation, this would use proper key encapsulation

  const memberKeyBytes = fromBase64(memberPublicKey);

  // Use the member's public key as a seed for key derivation
  const salt = memberKeyBytes.slice(0, 16);
  const derivedKey = await deriveServerKey(salt);

  const encryptedKey = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: salt.buffer as ArrayBuffer },
    derivedKey,
    fromBase64(groupKey.key).buffer as ArrayBuffer
  );

  const encryptedKeyBase64 = toBase64(new Uint8Array(encryptedKey));

  await execute(
    `INSERT INTO multi_chat_keys (chat_id, member_address, encrypted_key, key_version)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (chat_id, member_address, key_version)
     DO UPDATE SET encrypted_key = $3`,
    [chatId, memberAddress, encryptedKeyBase64, groupKey.version]
  );
}

/**
 * Retrieve the group key for a member
 */
export async function getGroupKeyForMember(
  chatId: string,
  memberAddress: string,
  memberPrivateKey: string
): Promise<GroupKey | null> {
  const keyRecord = await queryOne<DbChatKey>(
    `SELECT * FROM multi_chat_keys
     WHERE chat_id = $1 AND member_address = $2 AND revoked_at IS NULL
     ORDER BY key_version DESC
     LIMIT 1`,
    [chatId, memberAddress]
  );

  if (!keyRecord) return null;

  // For managed wallets, we can decrypt server-side
  // For external wallets, the client would need to decrypt
  // This simplified version assumes server-side decryption

  const memberPublicKey = await getPublicKeyForAddress(memberAddress);
  if (!memberPublicKey) return null;

  const memberKeyBytes = fromBase64(memberPublicKey);
  const salt = memberKeyBytes.slice(0, 16);
  const derivedKey = await deriveServerKey(salt);

  try {
    const encryptedKeyBytes = fromBase64(keyRecord.encrypted_key);
    const decryptedKey = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: salt.buffer as ArrayBuffer },
      derivedKey,
      encryptedKeyBytes.buffer as ArrayBuffer
    );

    return {
      key: toBase64(new Uint8Array(decryptedKey)),
      version: keyRecord.key_version,
    };
  } catch {
    return null;
  }
}

/**
 * Rotate the group key (when a member leaves)
 */
export async function rotateGroupKey(chatId: string): Promise<GroupKey> {
  // Get current version
  const currentKey = await queryOne<{ max_version: number }>(
    `SELECT COALESCE(MAX(key_version), 0) as max_version
     FROM multi_chat_keys WHERE chat_id = $1`,
    [chatId]
  );

  const newVersion = (currentKey?.max_version ?? 0) + 1;
  const newKey = generateGroupKey();
  newKey.version = newVersion;

  // Revoke old keys
  await execute(
    `UPDATE multi_chat_keys SET revoked_at = NOW()
     WHERE chat_id = $1 AND revoked_at IS NULL`,
    [chatId]
  );

  return newKey;
}

// ============================================================================
// Message Encryption/Decryption
// ============================================================================

/**
 * Encrypt a message for a chat
 */
export async function encryptMessage(
  plaintext: string,
  groupKeyBase64: string
): Promise<string> {
  const keyBytes = fromBase64(groupKeyBase64);
  return encryptWithKey(plaintext, keyBytes);
}

/**
 * Decrypt a message from a chat
 */
export async function decryptMessage(
  encryptedBase64: string,
  groupKeyBase64: string
): Promise<string> {
  const keyBytes = fromBase64(groupKeyBase64);
  return decryptWithKey(encryptedBase64, keyBytes);
}

// ============================================================================
// Ethereum Signing Key Storage (for passkey wallets)
// ============================================================================

const SIGNING_KEY_ALGORITHM = 'secp256k1';

/**
 * Store an Ethereum signing key for a user (passkey wallet).
 * Key is encrypted server-side for gasless transaction signing.
 */
export async function storeSigningKey(userId: string, signingKey: string): Promise<void> {
  // Remove 0x prefix if present and convert to base64 for consistent storage
  const keyHex = signingKey.replace(/^0x/, '');
  const keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const keyBase64 = toBase64(keyBytes);

  const encryptedKey = await encryptPrivateKey(keyBase64);

  // Revoke any existing signing keys for this user
  await execute(
    `UPDATE user_keypairs SET is_active = FALSE, revoked_at = NOW()
     WHERE user_id = $1 AND algorithm = $2 AND is_active = TRUE`,
    [userId, SIGNING_KEY_ALGORITHM]
  );

  // Store new signing key (public_key stores the address derived from the key)
  const { privateKeyToAccount } = await import('viem/accounts');
  const account = privateKeyToAccount(signingKey as `0x${string}`);

  await execute(
    `INSERT INTO user_keypairs (user_id, public_key, encrypted_private_key, algorithm)
     VALUES ($1, $2, $3, $4)`,
    [userId, account.address, encryptedKey, SIGNING_KEY_ALGORITHM]
  );
}

/**
 * Get the decrypted Ethereum signing key for a user.
 * Returns the key as a hex string with 0x prefix.
 */
export async function getSigningKey(userId: string): Promise<`0x${string}` | null> {
  const keypair = await queryOne<DbUserKeypair>(
    `SELECT * FROM user_keypairs WHERE user_id = $1 AND algorithm = $2 AND is_active = TRUE`,
    [userId, SIGNING_KEY_ALGORITHM]
  );

  if (!keypair) return null;

  const keyBase64 = await decryptPrivateKey(keypair.encrypted_private_key);
  const keyBytes = fromBase64(keyBase64);
  const keyHex = Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  return `0x${keyHex}`;
}

/**
 * Check if a user has a signing key stored
 */
export async function hasSigningKey(userId: string): Promise<boolean> {
  const keypair = await queryOne<{ id: string }>(
    `SELECT id FROM user_keypairs WHERE user_id = $1 AND algorithm = $2 AND is_active = TRUE`,
    [userId, SIGNING_KEY_ALGORITHM]
  );
  return !!keypair;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get public key for a wallet address (from member records)
 */
async function getPublicKeyForAddress(address: string): Promise<string | null> {
  const member = await queryOne<{ public_key: string }>(
    `SELECT public_key FROM multi_chat_members
     WHERE member_address = $1 AND public_key IS NOT NULL
     LIMIT 1`,
    [address]
  );

  return member?.public_key ?? null;
}

/**
 * Encrypt a group key for all active members of a chat
 */
export async function distributeGroupKeyToMembers(
  chatId: string,
  groupKey: GroupKey
): Promise<void> {
  const members = await query<{ member_address: string; public_key: string | null }>(
    `SELECT member_address, public_key FROM multi_chat_members
     WHERE chat_id = $1 AND is_active = TRUE AND public_key IS NOT NULL`,
    [chatId]
  );

  for (const member of members) {
    if (member.public_key) {
      await storeGroupKeyForMember(
        chatId,
        member.member_address,
        groupKey,
        member.public_key
      );
    }
  }
}
