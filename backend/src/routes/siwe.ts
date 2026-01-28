/**
 * SIWE (Sign-In With Ethereum) Routes
 *
 * Handles wallet-based authentication:
 * 1. Generate nonce for signing
 * 2. Verify signature and create 30-day session
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { execute, queryOne } from '../db/index.ts';
import { verifyMessage } from 'npm:viem';
import { getPseudoAddress } from '../utils/crypto.ts';

export const siweRouter = new Hono();

// Store nonces temporarily (in production, use Redis or DB)
const nonceStore = new Map<string, { nonce: string; expiresAt: number }>();

/**
 * Generate a random nonce
 */
function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a session token
 */
function generateSessionToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// Routes
// ============================================================================

const NonceRequestSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

/**
 * POST /auth/siwe/nonce - Get a nonce for SIWE signing
 */
siweRouter.post(
  '/nonce',
  zValidator('json', NonceRequestSchema),
  async (c) => {
    const { address } = c.req.valid('json');
    const normalizedAddress = address.toLowerCase();

    // Generate nonce
    const nonce = generateNonce();

    // Store nonce with 5 minute expiry
    nonceStore.set(normalizedAddress, {
      nonce,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    // Clean up old nonces
    for (const [addr, data] of nonceStore.entries()) {
      if (data.expiresAt < Date.now()) {
        nonceStore.delete(addr);
      }
    }

    return c.json({
      success: true,
      data: { nonce },
    });
  }
);

const VerifyRequestSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  message: z.string(),
  signature: z.string(),
});

/**
 * POST /auth/siwe/verify - Verify SIWE signature and create session
 */
siweRouter.post(
  '/verify',
  zValidator('json', VerifyRequestSchema),
  async (c) => {
    const { address, message, signature } = c.req.valid('json');
    const normalizedAddress = address.toLowerCase();
    const sessionId = c.req.header('X-Session-ID');

    // Check nonce exists and is valid
    const storedNonce = nonceStore.get(normalizedAddress);
    if (!storedNonce || storedNonce.expiresAt < Date.now()) {
      return c.json({ success: false, error: 'Nonce expired or invalid' }, 400);
    }

    // Verify the nonce is in the message
    if (!message.includes(`Nonce: ${storedNonce.nonce}`)) {
      return c.json({ success: false, error: 'Invalid nonce in message' }, 400);
    }

    // Verify signature
    try {
      const isValid = await verifyMessage({
        address: address as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });

      if (!isValid) {
        return c.json({ success: false, error: 'Invalid signature' }, 401);
      }
    } catch (error) {
      console.error('[SIWE] Signature verification failed:', error);
      return c.json({ success: false, error: 'Signature verification failed' }, 401);
    }

    // Clear used nonce
    nonceStore.delete(normalizedAddress);

    // Generate session token
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    // Store session in database
    await execute(
      `INSERT INTO wallet_sessions (session_token, wallet_address, siwe_message, siwe_signature, nonce, anonymous_session_id, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (wallet_address) DO UPDATE SET
         session_token = EXCLUDED.session_token,
         siwe_message = EXCLUDED.siwe_message,
         siwe_signature = EXCLUDED.siwe_signature,
         nonce = EXCLUDED.nonce,
         anonymous_session_id = COALESCE(EXCLUDED.anonymous_session_id, wallet_sessions.anonymous_session_id),
         expires_at = EXCLUDED.expires_at`,
      [token, normalizedAddress, message, signature, storedNonce.nonce, sessionId, expiresAt]
    );

    // If there was an anonymous session, migrate its data to this wallet
    if (sessionId) {
      // Update any chats created by this anonymous session to be owned by the wallet
      // Uses HMAC-SHA256 for consistent address generation across the system
      const pseudoAddress = await getPseudoAddress(sessionId);

      await execute(
        `UPDATE multi_chat_members
         SET member_address = $1
         WHERE member_address = $2`,
        [normalizedAddress, pseudoAddress]
      );

      await execute(
        `UPDATE multi_chats
         SET founder_address = $1
         WHERE founder_address = $2`,
        [normalizedAddress, pseudoAddress]
      );
    }

    return c.json({
      success: true,
      data: {
        token,
        address: normalizedAddress,
        expiresAt: expiresAt.toISOString(),
      },
    });
  }
);

/**
 * POST /auth/siwe/logout - Invalidate wallet session
 */
siweRouter.post('/logout', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '');

  if (token) {
    await execute(
      `DELETE FROM wallet_sessions WHERE session_token = $1`,
      [token]
    );
  }

  return c.json({ success: true });
});

/**
 * GET /auth/siwe/session - Check if wallet session is valid
 */
siweRouter.get('/session', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '') || c.req.header('X-Wallet-Session');

  if (!token) {
    return c.json({ success: false, error: 'No session token' }, 401);
  }

  const session = await queryOne<{
    wallet_address: string;
    expires_at: Date;
  }>(
    `SELECT wallet_address, expires_at FROM wallet_sessions
     WHERE session_token = $1 AND expires_at > NOW()`,
    [token]
  );

  if (!session) {
    return c.json({ success: false, error: 'Session invalid or expired' }, 401);
  }

  return c.json({
    success: true,
    data: {
      address: session.wallet_address,
      expiresAt: session.expires_at,
    },
  });
});
