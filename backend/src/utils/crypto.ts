/**
 * Cryptographic utilities for secure operations
 */

import { getConfig } from './config.ts';

/**
 * Generate a deterministic pseudo-address from a session ID using HMAC-SHA256.
 * This creates a consistent address for anonymous users that:
 * - Is deterministic (same session ID always yields same address)
 * - Cannot be reverse-engineered without the server secret
 * - Looks like a valid Ethereum address
 *
 * @param sessionId - The anonymous session ID (e.g., "ses_abc123...")
 * @returns A 0x-prefixed pseudo-address (40 hex chars)
 */
export async function generatePseudoAddress(sessionId: string): Promise<string> {
  const config = getConfig();
  const secret = config.jwtSecret; // Use JWT secret as HMAC key

  // Create HMAC-SHA256 of sessionId
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(`pseudo-address:${sessionId}`);

  // Import key for HMAC
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Generate HMAC
  const signature = await crypto.subtle.sign('HMAC', key, messageData);

  // Convert to hex and take first 40 chars (20 bytes) for address
  const hashArray = new Uint8Array(signature);
  const hashHex = Array.from(hashArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return `0x${hashHex.slice(0, 40)}`;
}

/**
 * Synchronous version for middleware using a cached computation approach.
 * Pre-computes addresses during request processing.
 */
const pseudoAddressCache = new Map<string, string>();
const CACHE_MAX_SIZE = 10000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  address: string;
  timestamp: number;
}

const cacheWithTTL = new Map<string, CacheEntry>();

export async function getPseudoAddress(sessionId: string): Promise<string> {
  const now = Date.now();
  const cached = cacheWithTTL.get(sessionId);

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.address;
  }

  const address = await generatePseudoAddress(sessionId);

  // Cleanup old entries if cache is too large
  if (cacheWithTTL.size >= CACHE_MAX_SIZE) {
    const cutoff = now - CACHE_TTL_MS;
    for (const [key, entry] of cacheWithTTL) {
      if (entry.timestamp < cutoff) {
        cacheWithTTL.delete(key);
      }
    }
  }

  cacheWithTTL.set(sessionId, { address, timestamp: now });
  return address;
}

/**
 * Verify a wallet signature (EIP-191 personal_sign)
 * @param message - The message that was signed
 * @param signature - The signature (0x-prefixed hex)
 * @param expectedAddress - The address that should have signed
 * @returns true if the signature is valid
 */
export async function verifyWalletSignature(
  message: string,
  signature: string,
  expectedAddress: string
): Promise<boolean> {
  try {
    const { verifyMessage } = await import('viem');
    const isValid = await verifyMessage({
      address: expectedAddress.toLowerCase() as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
    return isValid;
  } catch (error) {
    console.error('[Crypto] Signature verification failed:', error);
    return false;
  }
}

/**
 * Verify a session merge signature message format and timestamp
 * Expected format: "I am merging my anonymous session to address 0x... at timestamp 1234567890"
 */
export function parseSessionMergeMessage(message: string): { address: string; timestamp: number } | null {
  const regex = /^I am merging my anonymous session to address (0x[a-fA-F0-9]{40}) at timestamp (\d+)$/;
  const match = message.match(regex);
  if (!match) return null;

  return {
    address: match[1].toLowerCase(),
    timestamp: parseInt(match[2], 10),
  };
}

/**
 * Validate timestamp is within acceptable window (5 minutes)
 */
export function isTimestampValid(timestamp: number, windowMs: number = 5 * 60 * 1000): boolean {
  const now = Date.now();
  const messageTime = timestamp * 1000; // Convert seconds to ms
  return Math.abs(now - messageTime) <= windowMs;
}
