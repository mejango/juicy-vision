/**
 * Juicy Identity API Routes
 *
 * Endpoints for managing and resolving username[emoji] identities
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { optionalAuth, requireAuth } from '../middleware/auth.ts';
import { requireWalletAuth, requireWalletOrAuth } from '../middleware/walletSession.ts';
import { getOrCreateSmartAccount } from '../services/smartAccounts.ts';
import { getConfig } from '../utils/config.ts';
import { getPrimaryChainId } from '@shared/chains.ts';
import {
  getIdentityByAddress,
  getIdentityByAddressResolved,
  setIdentity,
  deleteIdentity,
  resolveIdentity,
  searchIdentities,
  getIdentityHistory,
  parseIdentityString,
  isIdentityAvailable,
  VALID_EMOJIS,
} from '../services/identity.ts';
import {
  linkAddress,
  unlinkAddress,
  getLinkedAddresses,
  getPrimaryAddress,
  canBeLinkTarget,
  canBePrimary,
  getAllUserAddresses,
  getLinkHistory,
  type LinkedAddress,
} from '../services/linkedAddresses.ts';

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

// GET /identity/me - Get current user's identity (resolves linked addresses)
identityRouter.get('/me', optionalAuth, requireWalletOrAuth, async (c) => {
  const walletSession = c.get('walletSession')!;
  // Use resolved lookup to get identity from linked primary if applicable
  const identity = await getIdentityByAddressResolved(walletSession.address);

  // Also get linked address info
  const primaryAddress = await getPrimaryAddress(walletSession.address);

  return c.json({
    success: true,
    data: serializeIdentity(identity),
    meta: {
      // If this address is linked to a primary, include that info
      isLinked: !!primaryAddress,
      primaryAddress: primaryAddress || undefined,
    },
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
  requireWalletAuth, // Accepts JWT (managed) or SIWE wallet session, but NOT anonymous
  zValidator('json', SetIdentitySchema),
  async (c) => {
    const walletSession = c.get('walletSession')!;
    const body = c.req.valid('json');

    try {
      // Use wallet address directly - works for both managed wallets and SIWE
      const identity = await setIdentity(walletSession.address, body.emoji, body.username);
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
// Accepts JWT (managed) or SIWE wallet session
identityRouter.delete('/me', requireWalletAuth, async (c) => {
  const walletSession = c.get('walletSession')!;

  try {
    await deleteIdentity(walletSession.address);
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
    const config = getConfig();
    const smartAccount = await getOrCreateSmartAccount(user.id, getPrimaryChainId(config.isTestnet));
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

// GET /identity/address/:address - Get identity for an address (resolves links)
identityRouter.get('/address/:address', async (c) => {
  const address = c.req.param('address');
  // Use resolved lookup to get identity from linked primary if applicable
  const identity = await getIdentityByAddressResolved(address);

  // Include link info
  const primaryAddress = await getPrimaryAddress(address);

  return c.json({
    success: true,
    data: serializeIdentity(identity),
    meta: {
      isLinked: !!primaryAddress,
      primaryAddress: primaryAddress || undefined,
    },
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

// ============================================================================
// Account Linking Routes
// ============================================================================

function serializeLinkedAddress(link: LinkedAddress) {
  return {
    id: link.id,
    primaryAddress: link.primaryAddress,
    linkedAddress: link.linkedAddress,
    linkType: link.linkType,
    createdAt: link.createdAt.toISOString(),
  };
}

// GET /identity/linked - Get all linked addresses for current user
identityRouter.get('/linked', requireWalletAuth, async (c) => {
  const walletSession = c.get('walletSession')!;

  const { primaryAddress, linkedAddresses } = await getAllUserAddresses(walletSession.address);
  const primaryIdentity = await getIdentityByAddress(primaryAddress);

  return c.json({
    success: true,
    data: {
      primaryAddress,
      primaryIdentity: serializeIdentity(primaryIdentity),
      linkedAddresses: linkedAddresses.map(serializeLinkedAddress),
      // Is the current address the primary or a linked one?
      currentAddressIsPrimary: walletSession.address.toLowerCase() === primaryAddress.toLowerCase(),
    },
  });
});

// POST /identity/link - Link another address to current user's identity
const LinkAddressSchema = z.object({
  linkedAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  linkType: z.enum(['manual', 'smart_account', 'passkey', 'wallet']).optional().default('manual'),
});

identityRouter.post('/link', requireWalletAuth, zValidator('json', LinkAddressSchema), async (c) => {
  const walletSession = c.get('walletSession')!;
  const body = c.req.valid('json');

  // Current user's address becomes the primary
  const result = await linkAddress(
    walletSession.address, // primary
    body.linkedAddress, // linked
    body.linkType,
    walletSession.address // performed by
  );

  if (!result.success) {
    return c.json({ success: false, error: result.error }, 400);
  }

  return c.json({
    success: true,
    data: serializeLinkedAddress(result.link!),
  });
});

// DELETE /identity/link/:address - Unlink an address
identityRouter.delete('/link/:address', requireWalletAuth, async (c) => {
  const walletSession = c.get('walletSession')!;
  const addressToUnlink = c.req.param('address');

  const success = await unlinkAddress(addressToUnlink, walletSession.address);

  if (!success) {
    return c.json(
      { success: false, error: 'Unable to unlink. Address not found or unauthorized.' },
      400
    );
  }

  return c.json({ success: true });
});

// GET /identity/link/check/:address - Check if an address can be linked
identityRouter.get('/link/check/:address', async (c) => {
  const address = c.req.param('address');

  const canLink = await canBeLinkTarget(address);
  const canPrimary = await canBePrimary(address);

  return c.json({
    success: true,
    data: {
      address,
      canBeLinkTarget: canLink.canLink,
      canBeLinkTargetReason: canLink.reason,
      canBePrimary: canPrimary.canBePrimary,
      canBePrimaryReason: canPrimary.reason,
    },
  });
});

// GET /identity/link/history - Get link history for current user
identityRouter.get('/link/history', requireWalletAuth, async (c) => {
  const walletSession = c.get('walletSession')!;

  const history = await getLinkHistory(walletSession.address);

  return c.json({
    success: true,
    data: history.map((h) => ({
      id: h.id,
      primaryAddress: h.primaryAddress,
      linkedAddress: h.linkedAddress,
      linkType: h.linkType,
      action: h.action,
      performedAt: h.performedAt.toISOString(),
      performedBy: h.performedBy,
    })),
  });
});
