/**
 * Wallet Session Middleware
 *
 * Extracts wallet session from JWT, SIWE, or anonymous session ID
 * Shared across routes that need wallet/address authentication
 */

import { Context, Next } from 'hono';
import { query, queryOne } from '../db/index.ts';

export interface WalletSession {
  address: string;
  userId?: string; // Linked user ID if managed wallet
  sessionId?: string; // Anonymous session ID
  isAnonymous?: boolean;
}

declare module 'hono' {
  interface ContextVariableMap {
    walletSession?: WalletSession;
  }
}

/**
 * Extract wallet session from header or query param
 */
export async function extractWalletSession(
  authHeader: string | undefined,
  sessionToken: string | undefined
): Promise<WalletSession | null> {
  const token = sessionToken || authHeader?.replace('Bearer ', '');
  if (!token) return null;

  // First try JWT token validation (for managed wallets)
  const { validateSession } = await import('../services/auth.ts');
  const { getCustodialAddress } = await import('../services/wallet.ts');

  const jwtResult = await validateSession(token);
  if (jwtResult) {
    const address = await getCustodialAddress(jwtResult.user.custodialAddressIndex ?? 0);
    return {
      address,
      userId: jwtResult.user.id,
    };
  }

  // Try SIWE session token (for self-custody wallets)
  const session = await queryOne<{
    wallet_address: string;
    expires_at: Date;
  }>(
    `SELECT wallet_address, expires_at FROM wallet_sessions
     WHERE session_token = $1 AND expires_at > NOW()`,
    [token]
  );

  if (session) {
    // Check if this wallet is linked to a user
    const user = await queryOne<{ id: string }>(
      `SELECT u.id FROM users u
       JOIN multi_chat_members mcm ON mcm.member_user_id = u.id
       WHERE mcm.member_address = $1
       LIMIT 1`,
      [session.wallet_address]
    );

    return {
      address: session.wallet_address,
      userId: user?.id,
    };
  }

  return null;
}

/**
 * Middleware that requires wallet session OR user auth OR anonymous session
 * Anonymous sessions use X-Session-ID header and get a pseudo-address
 */
export async function requireWalletOrAuth(c: Context, next: Next) {
  // First try JWT auth
  const authHeader = c.req.header('Authorization');
  const user = c.get('user');

  if (user) {
    // User authenticated - get their custodial address
    const { getCustodialAddress } = await import('../services/wallet.ts');
    const address = await getCustodialAddress(user.custodialAddressIndex ?? 0);
    c.set('walletSession', { address, userId: user.id } as WalletSession);
    return next();
  }

  // Try wallet session
  const sessionToken = c.req.query('session') || c.req.header('X-Wallet-Session');
  const walletSession = await extractWalletSession(authHeader, sessionToken);

  if (walletSession) {
    c.set('walletSession', walletSession);
    return next();
  }

  // Try anonymous session (X-Session-ID header)
  const sessionId = c.req.header('X-Session-ID');
  if (sessionId && sessionId.startsWith('ses_')) {
    // Create a pseudo-address from the session ID for anonymous users
    // This allows them to own chats and create invites
    const pseudoAddress = `0x${sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40).padStart(40, '0')}`;
    c.set('walletSession', {
      address: pseudoAddress,
      sessionId,
      isAnonymous: true,
    } as WalletSession);
    return next();
  }

  return c.json({ success: false, error: 'Authentication required' }, 401);
}

/**
 * Middleware that optionally extracts wallet session without requiring it
 * Used for endpoints that have different behavior for authenticated vs anonymous users
 */
export async function optionalWalletSession(c: Context, next: Next) {
  // First check if user is already authenticated via JWT
  const user = c.get('user');
  const authHeader = c.req.header('Authorization');

  if (user) {
    const { getCustodialAddress } = await import('../services/wallet.ts');
    const address = await getCustodialAddress(user.custodialAddressIndex ?? 0);
    c.set('walletSession', { address, userId: user.id } as WalletSession);
    return next();
  }

  // Try wallet session
  const sessionToken = c.req.query('session') || c.req.header('X-Wallet-Session');
  const walletSession = await extractWalletSession(authHeader, sessionToken);

  if (walletSession) {
    c.set('walletSession', walletSession);
    return next();
  }

  // Try anonymous session
  const sessionId = c.req.header('X-Session-ID');
  if (sessionId && sessionId.startsWith('ses_')) {
    const pseudoAddress = `0x${sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40).padStart(40, '0')}`;
    c.set('walletSession', {
      address: pseudoAddress,
      sessionId,
      isAnonymous: true,
    } as WalletSession);
  }

  return next();
}
