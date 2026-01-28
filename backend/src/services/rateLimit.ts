/**
 * PostgreSQL-based rate limiting service
 *
 * Features:
 * - Survives server restarts
 * - Works across multiple server instances
 * - Uses atomic check-and-increment for thread safety
 * - Automatic cleanup of expired entries
 */

import { execute, queryOne } from '../db/index.ts';

interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  limit: number;
  /** Time window in seconds */
  windowSeconds: number;
}

interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Number of requests remaining in the window */
  remaining: number;
  /** Unix timestamp when the rate limit resets */
  resetAt: number;
  /** Current count of requests in the window */
  current: number;
}

// Predefined rate limit configurations for different endpoints
export const RATE_LIMITS = {
  // Chat endpoints - moderate limits
  chat: { limit: 60, windowSeconds: 60 }, // 60 req/min
  chatCreate: { limit: 10, windowSeconds: 60 }, // 10 new chats/min
  chatMessage: { limit: 30, windowSeconds: 60 }, // 30 messages/min

  // Juice token operations - stricter limits
  juicePurchase: { limit: 10, windowSeconds: 3600 }, // 10 purchases/hour
  juiceSpend: { limit: 20, windowSeconds: 3600 }, // 20 spends/hour
  juiceCashOut: { limit: 5, windowSeconds: 3600 }, // 5 cash outs/hour

  // Auth endpoints
  authOtpRequest: { limit: 5, windowSeconds: 300 }, // 5 OTP requests/5 min
  authOtpVerify: { limit: 10, windowSeconds: 300 }, // 10 verify attempts/5 min

  // Passkey endpoints - strict limits to prevent brute force
  passkeyRegister: { limit: 10, windowSeconds: 3600 }, // 10 registrations/hour
  passkeyAuth: { limit: 20, windowSeconds: 300 }, // 20 auth attempts/5 min
  passkeySiwe: { limit: 20, windowSeconds: 300 }, // 20 SIWE attempts/5 min

  // Export endpoints - very strict limits (sensitive operations)
  walletExport: { limit: 5, windowSeconds: 3600 }, // 5 export requests/hour
  walletExportConfirm: { limit: 3, windowSeconds: 3600 }, // 3 confirmations/hour

  // Admin endpoints - moderate limits
  admin: { limit: 100, windowSeconds: 60 }, // 100 admin requests/min

  // Proxy endpoints
  proxyRpc: { limit: 100, windowSeconds: 60 }, // 100 RPC calls/min
  proxyGraphql: { limit: 30, windowSeconds: 60 }, // 30 GraphQL queries/min

  // AI operations
  aiInvoke: { limit: 20, windowSeconds: 60 }, // 20 AI calls/min
} as const;

export type RateLimitKey = keyof typeof RATE_LIMITS;

/**
 * Check and increment rate limit for a given identifier
 *
 * Uses atomic INSERT ... ON CONFLICT DO UPDATE to ensure thread safety.
 * The rate limit entry includes:
 * - identifier: Unique key (e.g., "chat:192.168.1.1" or "juicePurchase:0x123...")
 * - count: Current request count in the window
 * - window_start: Unix timestamp when the current window started
 *
 * @param key - The rate limit configuration key (e.g., 'chat', 'juicePurchase')
 * @param identifier - Unique identifier (IP address, wallet address, user ID, etc.)
 * @returns RateLimitResult with allowed status and metadata
 */
export async function checkRateLimit(
  key: RateLimitKey,
  identifier: string
): Promise<RateLimitResult> {
  const config = RATE_LIMITS[key];
  const fullKey = `${key}:${identifier}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % config.windowSeconds); // Align to window boundaries
  const resetAt = windowStart + config.windowSeconds;

  try {
    // Atomic upsert: insert new entry or increment existing
    // If the window has expired, reset the count
    const result = await queryOne<{ count: number; window_start: number }>(
      `INSERT INTO rate_limits (identifier, count, window_start)
       VALUES ($1, 1, $2)
       ON CONFLICT (identifier) DO UPDATE
       SET count = CASE
         WHEN rate_limits.window_start < $2 THEN 1  -- New window, reset count
         ELSE rate_limits.count + 1                  -- Same window, increment
       END,
       window_start = CASE
         WHEN rate_limits.window_start < $2 THEN $2  -- New window, update start
         ELSE rate_limits.window_start               -- Same window, keep start
       END
       RETURNING count, window_start`,
      [fullKey, windowStart]
    );

    if (!result) {
      // Should never happen with RETURNING, but handle gracefully
      return { allowed: true, remaining: config.limit - 1, resetAt, current: 1 };
    }

    const current = result.count;
    const allowed = current <= config.limit;
    const remaining = Math.max(0, config.limit - current);

    return { allowed, remaining, resetAt, current };
  } catch (error) {
    // On database error, fail open (allow the request)
    // This prevents rate limiting from breaking the app if DB is down
    console.error('[RateLimit] Database error, failing open:', error);
    return { allowed: true, remaining: config.limit, resetAt, current: 0 };
  }
}

/**
 * Hono middleware factory for rate limiting
 *
 * @param key - The rate limit configuration key
 * @param getIdentifier - Function to extract identifier from request context
 * @returns Hono middleware function
 */
export function rateLimitMiddleware(
  key: RateLimitKey,
  getIdentifier: (c: any) => string = (c) => c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || c.req.header('CF-Connecting-IP') || 'unknown'
) {
  return async (c: any, next: any) => {
    const identifier = getIdentifier(c);
    const result = await checkRateLimit(key, identifier);

    // Set rate limit headers
    c.header('X-RateLimit-Limit', RATE_LIMITS[key].limit.toString());
    c.header('X-RateLimit-Remaining', result.remaining.toString());
    c.header('X-RateLimit-Reset', result.resetAt.toString());

    if (!result.allowed) {
      return c.json(
        {
          success: false,
          error: 'Rate limit exceeded',
          retryAfter: result.resetAt - Math.floor(Date.now() / 1000),
        },
        429
      );
    }

    return next();
  };
}

/**
 * Rate limit by wallet address (for authenticated routes)
 */
export function rateLimitByWallet(key: RateLimitKey) {
  return rateLimitMiddleware(key, (c) => {
    const walletSession = c.get('walletSession');
    return walletSession?.address || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
  });
}

/**
 * Rate limit by user ID (for JWT authenticated routes)
 */
export function rateLimitByUser(key: RateLimitKey) {
  return rateLimitMiddleware(key, (c) => {
    const user = c.get('user');
    return user?.id || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
  });
}

/**
 * Cleanup expired rate limit entries
 * Should be run periodically (e.g., hourly cron job)
 */
export async function cleanupExpiredRateLimits(): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  // Delete entries where window has expired for all possible window sizes
  // Use the longest window (1 hour = 3600s) as the cutoff
  const cutoff = now - 3600;

  const deleted = await execute(
    'DELETE FROM rate_limits WHERE window_start < $1',
    [cutoff]
  );

  return deleted;
}
