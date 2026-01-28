/**
 * Wallet Session Middleware
 *
 * Extracts wallet session from JWT, SIWE, or anonymous session ID
 * Shared across routes that need wallet/address authentication
 */

import { Context, Next } from 'hono';
import { query, queryOne } from '../db/index.ts';
import { getPseudoAddress } from '../utils/crypto.ts';

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
  const { getOrCreateSmartAccount } = await import('../services/smartAccounts.ts');

  const jwtResult = await validateSession(token);
  if (jwtResult) {
    const smartAccount = await getOrCreateSmartAccount(jwtResult.user.id, 1);
    return {
      address: smartAccount.address,
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
 * Middleware that strictly requires wallet authentication (SIWE session)
 * Does NOT accept anonymous sessions - for wallet-specific operations
 */
export async function requireWalletAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  const sessionToken = c.req.query('session') || c.req.header('X-Wallet-Session');
  const walletSession = await extractWalletSession(authHeader, sessionToken);

  if (walletSession && !walletSession.isAnonymous) {
    c.set('walletSession', walletSession);
    return next();
  }

  return c.json({ success: false, error: 'Wallet authentication required' }, 401);
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
    // User authenticated - get their smart account address
    const { getOrCreateSmartAccount } = await import('../services/smartAccounts.ts');
    const smartAccount = await getOrCreateSmartAccount(user.id, 1);
    c.set('walletSession', { address: smartAccount.address, userId: user.id } as WalletSession);
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
    // Uses HMAC-SHA256 for consistent address generation across the system
    const pseudoAddress = await getPseudoAddress(sessionId);
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
    const { getOrCreateSmartAccount } = await import('../services/smartAccounts.ts');
    const smartAccount = await getOrCreateSmartAccount(user.id, 1);
    c.set('walletSession', { address: smartAccount.address, userId: user.id } as WalletSession);
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
    // Uses HMAC-SHA256 for consistent address generation across the system
    const pseudoAddress = await getPseudoAddress(sessionId);
    c.set('walletSession', {
      address: pseudoAddress,
      sessionId,
      isAnonymous: true,
    } as WalletSession);
  }

  return next();
}
