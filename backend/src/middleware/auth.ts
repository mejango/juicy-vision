import { Context, Next } from 'hono';
import { validateSession } from '../services/auth.ts';
import type { User, Session } from '../types/index.ts';

// Extend Hono context with user info
declare module 'hono' {
  interface ContextVariableMap {
    user: User;
    session: Session;
  }
}

// Extract token from Authorization header
function extractToken(c: Context): string | null {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1];
}

// Middleware that requires authentication
export async function requireAuth(c: Context, next: Next) {
  const token = extractToken(c);
  if (!token) {
    return c.json({ success: false, error: 'Authentication required' }, 401);
  }

  const result = await validateSession(token);
  if (!result) {
    return c.json({ success: false, error: 'Invalid or expired token' }, 401);
  }

  // Store user and session in context
  c.set('user', result.user);
  c.set('session', result.session);

  await next();
}

// Middleware that optionally extracts user if token provided
export async function optionalAuth(c: Context, next: Next) {
  const token = extractToken(c);
  if (token) {
    const result = await validateSession(token);
    if (result) {
      c.set('user', result.user);
      c.set('session', result.session);
    }
  }

  await next();
}

// Middleware that checks if user has specific privacy mode
export function requirePrivacyMode(allowedModes: string[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    if (!allowedModes.includes(user.privacyMode)) {
      return c.json(
        {
          success: false,
          error: `This feature requires privacy mode to be one of: ${allowedModes.join(', ')}`,
        },
        403
      );
    }

    await next();
  };
}
