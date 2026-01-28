/**
 * Juicy Identity API Routes
 *
 * Endpoints for managing and resolving username[emoji] identities
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { optionalAuth, requireAuth } from '../middleware/auth.ts';
import { requireWalletOrAuth } from '../middleware/walletSession.ts';
import { getOrCreateSmartAccount } from '../services/smartAccounts.ts';
import {
  getIdentityByAddress,
  setIdentity,
  deleteIdentity,
  resolveIdentity,
  searchIdentities,
  getIdentityHistory,
  parseIdentityString,
  isIdentityAvailable,
  VALID_EMOJIS,
} from '../services/identity.ts';

export const identityRouter = new Hono();

// ============================================================================
// Serialization
// ============================================================================

function serializeIdentity(identity: Awaited<ReturnType<typeof getIdentityByAddress>>) {
  if (!identity) return null;
  return {
    id: identity.id,
    address: identity.address,
    emoji: identity.emoji,
    username: identity.username,
    formatted: `${identity.emoji} ${identity.username}`,
    createdAt: identity.createdAt.toISOString(),
    updatedAt: identity.updatedAt.toISOString(),
  };
}

function serializeHistoryEntry(entry: Awaited<ReturnType<typeof getIdentityHistory>>[0]) {
  return {
    id: entry.id,
    emoji: entry.emoji,
    username: entry.username,
    formatted: `${entry.emoji} ${entry.username}`,
    startedAt: entry.startedAt.toISOString(),
    endedAt: entry.endedAt.toISOString(),
    changeType: entry.changeType,
  };
}

// ============================================================================
// Routes
// ============================================================================

// GET /identity/me - Get current user's identity
identityRouter.get('/me', optionalAuth, requireWalletOrAuth, async (c) => {
  const walletSession = c.get('walletSession')!;
  const identity = await getIdentityByAddress(walletSession.address);

  return c.json({
    success: true,
    data: serializeIdentity(identity),
  });
});

// PUT /identity/me - Set or update current user's identity
// Requires authentication (must be signed in, not anonymous)
const SetIdentitySchema = z.object({
  emoji: z.string().refine((e) => VALID_EMOJIS.includes(e), {
    message: 'Invalid emoji. Must be a fruit or juice emoji.',
  }),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(20, 'Username must be at most 20 characters')
    .regex(
      /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/,
      'Username must start with a letter and contain only letters, numbers, and underscores'
    ),
});

identityRouter.put(
  '/me',
  requireAuth, // Must be authenticated (not anonymous)
  zValidator('json', SetIdentitySchema),
  async (c) => {
    const user = c.get('user')!;
    const body = c.req.valid('json');

    try {
      // Get user's smart account address (use default chain for identity)
      const smartAccount = await getOrCreateSmartAccount(user.id, 1);
      const identity = await setIdentity(smartAccount.address, body.emoji, body.username);
      return c.json({
        success: true,
        data: serializeIdentity(identity),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to set identity';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// DELETE /identity/me - Delete current user's identity
// Requires authentication
identityRouter.delete('/me', requireAuth, async (c) => {
  const user = c.get('user')!;

  try {
    const smartAccount = await getOrCreateSmartAccount(user.id, 1);
    await deleteIdentity(smartAccount.address);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete identity';
    return c.json({ success: false, error: message }, 400);
  }
});

// GET /identity/me/history - Get current user's identity history
identityRouter.get('/me/history', optionalAuth, requireWalletOrAuth, async (c) => {
  const walletSession = c.get('walletSession')!;
  const history = await getIdentityHistory(walletSession.address);

  return c.json({
    success: true,
    data: history.map(serializeHistoryEntry),
  });
});

// GET /identity/check - Check if an identity is available
const CheckAvailabilitySchema = z.object({
  emoji: z.string(),
  username: z.string(),
});

identityRouter.get('/check', optionalAuth, zValidator('query', CheckAvailabilitySchema), async (c) => {
  const { emoji, username } = c.req.valid('query');

  // Get current user's address to exclude from check (so they can update their own identity)
  let excludeAddress: string | undefined;
  const user = c.get('user');
  if (user) {
    const smartAccount = await getOrCreateSmartAccount(user.id, 1);
    excludeAddress = smartAccount.address;
  }

  const available = await isIdentityAvailable(emoji, username, excludeAddress);

  return c.json({
    success: true,
    data: {
      emoji,
      username,
      formatted: `${emoji} ${username}`,
      available,
    },
  });
});

// GET /identity/resolve/:identity - Resolve identity to address
// e.g., /identity/resolve/@jango🍉 or /identity/resolve/jango🍉
identityRouter.get('/resolve/:identity', async (c) => {
  const identityStr = decodeURIComponent(c.req.param('identity'));
  const parsed = parseIdentityString(identityStr);

  if (!parsed) {
    return c.json(
      {
        success: false,
        error: 'Invalid identity format. Use @🍉 username or 🍉 username',
      },
      400
    );
  }

  const address = await resolveIdentity(parsed.emoji, parsed.username);

  if (!address) {
    return c.json(
      {
        success: false,
        error: `Identity ${parsed.emoji} ${parsed.username} not found`,
      },
      404
    );
  }

  return c.json({
    success: true,
    data: {
      emoji: parsed.emoji,
      username: parsed.username,
      formatted: `${parsed.emoji} ${parsed.username}`,
      address,
    },
  });
});

// GET /identity/address/:address - Get identity for an address
identityRouter.get('/address/:address', async (c) => {
  const address = c.req.param('address');
  const identity = await getIdentityByAddress(address);

  return c.json({
    success: true,
    data: serializeIdentity(identity),
  });
});

// GET /identity/address/:address/history - Get identity history for an address
identityRouter.get('/address/:address/history', async (c) => {
  const address = c.req.param('address');
  const history = await getIdentityHistory(address);

  return c.json({
    success: true,
    data: history.map(serializeHistoryEntry),
  });
});

// GET /identity/search - Search identities by username prefix
const SearchSchema = z.object({
  q: z.string().min(1).max(20),
  limit: z.coerce.number().min(1).max(50).optional().default(10),
});

identityRouter.get('/search', zValidator('query', SearchSchema), async (c) => {
  const { q, limit } = c.req.valid('query');
  const results = await searchIdentities(q, limit);

  return c.json({
    success: true,
    data: results.map(serializeIdentity),
  });
});

// GET /identity/emojis - Get list of valid emojis
identityRouter.get('/emojis', async (c) => {
  return c.json({
    success: true,
    data: VALID_EMOJIS,
  });
});
