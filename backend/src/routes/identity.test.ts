/**
 * Identity Linking API Route Tests
 *
 * TDD: Tests for account linking API endpoints
 */

import { assertEquals, assertExists } from 'std/assert/mod.ts';
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

// ============================================================================
// Mock Types
// ============================================================================

interface MockWalletSession {
  address: string;
}

interface MockIdentity {
  id: string;
  address: string;
  emoji: string;
  username: string;
  formatted: string;
  createdAt: string;
  updatedAt: string;
}

interface MockLinkedAddress {
  id: string;
  primaryAddress: string;
  linkedAddress: string;
  linkType: 'manual' | 'smart_account' | 'passkey' | 'wallet';
  createdAt: string;
}

// ============================================================================
// Mock State
// ============================================================================

let mockIdentities: Map<string, MockIdentity> = new Map();
let mockLinks: Map<string, MockLinkedAddress> = new Map();

function resetMocks() {
  mockIdentities = new Map();
  mockLinks = new Map();
}

// ============================================================================
// Mock Identity Service Functions
// ============================================================================

function getIdentityByAddress(address: string): MockIdentity | null {
  return mockIdentities.get(address.toLowerCase()) ?? null;
}

function getIdentityByAddressResolved(address: string): MockIdentity | null {
  // Direct lookup first
  const direct = getIdentityByAddress(address);
  if (direct) return direct;

  // Check for link
  const link = mockLinks.get(address.toLowerCase());
  if (link) {
    return getIdentityByAddress(link.primaryAddress);
  }

  return null;
}

function getPrimaryAddress(address: string): string | null {
  const link = mockLinks.get(address.toLowerCase());
  return link?.primaryAddress ?? null;
}

function getAllUserAddresses(address: string): {
  primaryAddress: string;
  linkedAddresses: MockLinkedAddress[];
} {
  const primary = getPrimaryAddress(address);

  if (primary) {
    const linked = Array.from(mockLinks.values()).filter(
      (l) => l.primaryAddress.toLowerCase() === primary.toLowerCase()
    );
    return { primaryAddress: primary, linkedAddresses: linked };
  }

  const linked = Array.from(mockLinks.values()).filter(
    (l) => l.primaryAddress.toLowerCase() === address.toLowerCase()
  );
  return { primaryAddress: address, linkedAddresses: linked };
}

// ============================================================================
// Test App Setup
// ============================================================================

function createTestApp() {
  const app = new Hono();

  // Mock auth middleware
  app.use('*', async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const address = authHeader.slice(7); // Use token as address for testing
      c.set('walletSession', { address } as MockWalletSession);
    }
    await next();
  });

  // GET /identity/me
  app.get('/identity/me', (c) => {
    const walletSession = c.get('walletSession') as MockWalletSession | undefined;
    if (!walletSession) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const identity = getIdentityByAddressResolved(walletSession.address);
    const primaryAddress = getPrimaryAddress(walletSession.address);

    return c.json({
      success: true,
      data: identity,
      meta: {
        isLinked: !!primaryAddress,
        primaryAddress: primaryAddress || undefined,
      },
    });
  });

  // GET /identity/linked
  app.get('/identity/linked', (c) => {
    const walletSession = c.get('walletSession') as MockWalletSession | undefined;
    if (!walletSession) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const { primaryAddress, linkedAddresses } = getAllUserAddresses(walletSession.address);
    const primaryIdentity = getIdentityByAddress(primaryAddress);

    return c.json({
      success: true,
      data: {
        primaryAddress,
        primaryIdentity,
        linkedAddresses,
        currentAddressIsPrimary:
          walletSession.address.toLowerCase() === primaryAddress.toLowerCase(),
      },
    });
  });

  // POST /identity/link
  const LinkAddressSchema = z.object({
    linkedAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
    linkType: z.enum(['manual', 'smart_account', 'passkey', 'wallet']).optional().default('manual'),
  });

  app.post('/identity/link', zValidator('json', LinkAddressSchema), (c) => {
    const walletSession = c.get('walletSession') as MockWalletSession | undefined;
    if (!walletSession) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const body = c.req.valid('json');
    const primaryLower = walletSession.address.toLowerCase();
    const linkedLower = body.linkedAddress.toLowerCase();

    // Validations
    if (primaryLower === linkedLower) {
      return c.json({ success: false, error: 'Cannot link an address to itself' }, 400);
    }

    if (!mockIdentities.has(primaryLower)) {
      return c.json(
        { success: false, error: 'Primary address must have a JuicyID before linking' },
        400
      );
    }

    if (mockLinks.has(linkedLower)) {
      return c.json({ success: false, error: 'Address is already linked to another account' }, 400);
    }

    if (mockIdentities.has(linkedLower)) {
      return c.json(
        {
          success: false,
          error: 'Linked address already has a JuicyID. Must delete it before linking.',
        },
        400
      );
    }

    // Create link
    const link: MockLinkedAddress = {
      id: crypto.randomUUID(),
      primaryAddress: walletSession.address,
      linkedAddress: body.linkedAddress,
      linkType: body.linkType,
      createdAt: new Date().toISOString(),
    };

    mockLinks.set(linkedLower, link);

    return c.json({ success: true, data: link });
  });

  // DELETE /identity/link/:address
  app.delete('/identity/link/:address', (c) => {
    const walletSession = c.get('walletSession') as MockWalletSession | undefined;
    if (!walletSession) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const addressToUnlink = c.req.param('address').toLowerCase();
    const link = mockLinks.get(addressToUnlink);

    if (!link) {
      return c.json(
        { success: false, error: 'Unable to unlink. Address not found or unauthorized.' },
        400
      );
    }

    const performedByLower = walletSession.address.toLowerCase();
    if (
      performedByLower !== link.primaryAddress.toLowerCase() &&
      performedByLower !== link.linkedAddress.toLowerCase()
    ) {
      return c.json(
        { success: false, error: 'Unable to unlink. Address not found or unauthorized.' },
        400
      );
    }

    mockLinks.delete(addressToUnlink);
    return c.json({ success: true });
  });

  // GET /identity/link/check/:address
  app.get('/identity/link/check/:address', (c) => {
    const address = c.req.param('address').toLowerCase();

    let canBeLinkTarget = true;
    let canBeLinkTargetReason: string | undefined;
    let canBePrimary = true;
    let canBePrimaryReason: string | undefined;

    // Check if already linked
    if (mockLinks.has(address)) {
      canBeLinkTarget = false;
      canBeLinkTargetReason = 'Already linked to another account';
    }

    // Check if has identity
    if (mockIdentities.has(address)) {
      canBeLinkTarget = false;
      canBeLinkTargetReason = 'Has existing JuicyID - must delete to link';
    } else {
      canBePrimary = false;
      canBePrimaryReason = 'Must have a JuicyID to be primary';
    }

    return c.json({
      success: true,
      data: {
        address,
        canBeLinkTarget,
        canBeLinkTargetReason,
        canBePrimary,
        canBePrimaryReason,
      },
    });
  });

  return app;
}

// ============================================================================
// Tests: GET /identity/me with linking
// ============================================================================

Deno.test('Identity API - GET /identity/me with linked address', async (t) => {
  const app = createTestApp();

  await t.step('setup', () => {
    resetMocks();
    // Primary address has identity
    mockIdentities.set('0xprimary', {
      id: 'id-1',
      address: '0xPrimary',
      emoji: '🍌',
      username: 'jango',
      formatted: '🍌 jango',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    // Link secondary to primary
    mockLinks.set('0xsecondary', {
      id: 'link-1',
      primaryAddress: '0xPrimary',
      linkedAddress: '0xSecondary',
      linkType: 'wallet',
      createdAt: new Date().toISOString(),
    });
  });

  await t.step('returns primary identity for linked address', async () => {
    const res = await app.request('/identity/me', {
      headers: { Authorization: 'Bearer 0xSecondary' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertExists(json.data);
    assertEquals(json.data.username, 'jango');
    assertEquals(json.data.emoji, '🍌');
    assertEquals(json.meta.isLinked, true);
    assertEquals(json.meta.primaryAddress, '0xPrimary');
  });

  await t.step('returns identity directly for primary address', async () => {
    const res = await app.request('/identity/me', {
      headers: { Authorization: 'Bearer 0xPrimary' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.data.username, 'jango');
    assertEquals(json.meta.isLinked, false);
  });

  await t.step('returns null for unlinked address with no identity', async () => {
    const res = await app.request('/identity/me', {
      headers: { Authorization: 'Bearer 0xUnlinked' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.data, null);
    assertEquals(json.meta.isLinked, false);
  });
});

// ============================================================================
// Tests: GET /identity/linked
// ============================================================================

Deno.test('Identity API - GET /identity/linked', async (t) => {
  const app = createTestApp();

  await t.step('setup', () => {
    resetMocks();
    mockIdentities.set('0xprimary', {
      id: 'id-1',
      address: '0xPrimary',
      emoji: '🍌',
      username: 'jango',
      formatted: '🍌 jango',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mockLinks.set('0xwallet1', {
      id: 'link-1',
      primaryAddress: '0xPrimary',
      linkedAddress: '0xWallet1',
      linkType: 'wallet',
      createdAt: new Date().toISOString(),
    });
    mockLinks.set('0xwallet2', {
      id: 'link-2',
      primaryAddress: '0xPrimary',
      linkedAddress: '0xWallet2',
      linkType: 'passkey',
      createdAt: new Date().toISOString(),
    });
  });

  await t.step('returns all linked addresses for primary', async () => {
    const res = await app.request('/identity/linked', {
      headers: { Authorization: 'Bearer 0xPrimary' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.data.primaryAddress, '0xPrimary');
    assertExists(json.data.primaryIdentity);
    assertEquals(json.data.linkedAddresses.length, 2);
    assertEquals(json.data.currentAddressIsPrimary, true);
  });

  await t.step('returns all linked addresses when queried from linked address', async () => {
    const res = await app.request('/identity/linked', {
      headers: { Authorization: 'Bearer 0xWallet1' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.data.primaryAddress, '0xPrimary');
    assertEquals(json.data.linkedAddresses.length, 2);
    assertEquals(json.data.currentAddressIsPrimary, false);
  });

  await t.step('requires authentication', async () => {
    const res = await app.request('/identity/linked');

    assertEquals(res.status, 401);
  });
});

// ============================================================================
// Tests: POST /identity/link
// ============================================================================

Deno.test('Identity API - POST /identity/link', async (t) => {
  const app = createTestApp();

  await t.step('setup', () => {
    resetMocks();
    mockIdentities.set('0xprimary', {
      id: 'id-1',
      address: '0xPrimary',
      emoji: '🍌',
      username: 'jango',
      formatted: '🍌 jango',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  await t.step('can link a new address', async () => {
    const res = await app.request('/identity/link', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer 0xPrimary',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        linkedAddress: '0x1234567890123456789012345678901234567890',
        linkType: 'wallet',
      }),
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertExists(json.data.id);
    assertEquals(json.data.primaryAddress, '0xPrimary');
    assertEquals(json.data.linkedAddress, '0x1234567890123456789012345678901234567890');
    assertEquals(json.data.linkType, 'wallet');
  });

  await t.step('rejects invalid address format', async () => {
    const res = await app.request('/identity/link', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer 0xPrimary',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        linkedAddress: 'invalid-address',
        linkType: 'wallet',
      }),
    });

    assertEquals(res.status, 400);
  });

  await t.step('rejects self-link', async () => {
    // Use a valid Ethereum address format that matches the primary
    const primaryAddr = '0x1111111111111111111111111111111111111111';
    mockIdentities.set(primaryAddr.toLowerCase(), {
      id: 'id-2',
      address: primaryAddr,
      emoji: '🍊',
      username: 'selflink',
      formatted: '🍊 selflink',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const res = await app.request('/identity/link', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${primaryAddr}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        linkedAddress: primaryAddr,
        linkType: 'wallet',
      }),
    });

    assertEquals(res.status, 400);
    const json = await res.json();
    assertEquals(json.error, 'Cannot link an address to itself');
  });

  await t.step('rejects link if caller has no identity', async () => {
    const res = await app.request('/identity/link', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer 0xNoIdentity',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        linkedAddress: '0xABCDABCDABCDABCDABCDABCDABCDABCDABCDABCD',
        linkType: 'wallet',
      }),
    });

    assertEquals(res.status, 400);
    const json = await res.json();
    assertEquals(json.error, 'Primary address must have a JuicyID before linking');
  });

  await t.step('requires authentication', async () => {
    const res = await app.request('/identity/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        linkedAddress: '0x1234567890123456789012345678901234567890',
      }),
    });

    assertEquals(res.status, 401);
  });
});

// ============================================================================
// Tests: DELETE /identity/link/:address
// ============================================================================

Deno.test('Identity API - DELETE /identity/link/:address', async (t) => {
  const app = createTestApp();

  await t.step('setup', () => {
    resetMocks();
    mockIdentities.set('0xprimary', {
      id: 'id-1',
      address: '0xPrimary',
      emoji: '🍌',
      username: 'jango',
      formatted: '🍌 jango',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mockLinks.set('0xlinked', {
      id: 'link-1',
      primaryAddress: '0xPrimary',
      linkedAddress: '0xLinked',
      linkType: 'wallet',
      createdAt: new Date().toISOString(),
    });
  });

  await t.step('can unlink by primary address owner', async () => {
    const res = await app.request('/identity/link/0xLinked', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer 0xPrimary' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
  });

  await t.step('can unlink by linked address owner', async () => {
    // Re-create link for this test
    mockLinks.set('0xlinked2', {
      id: 'link-2',
      primaryAddress: '0xPrimary',
      linkedAddress: '0xLinked2',
      linkType: 'wallet',
      createdAt: new Date().toISOString(),
    });

    const res = await app.request('/identity/link/0xLinked2', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer 0xLinked2' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
  });

  await t.step('rejects unlink by unauthorized address', async () => {
    // Re-create link
    mockLinks.set('0xlinked3', {
      id: 'link-3',
      primaryAddress: '0xPrimary',
      linkedAddress: '0xLinked3',
      linkType: 'wallet',
      createdAt: new Date().toISOString(),
    });

    const res = await app.request('/identity/link/0xLinked3', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer 0xUnauthorized' },
    });

    assertEquals(res.status, 400);
  });

  await t.step('returns error for non-existent link', async () => {
    const res = await app.request('/identity/link/0xNotLinked', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer 0xPrimary' },
    });

    assertEquals(res.status, 400);
    const json = await res.json();
    assertEquals(json.error, 'Unable to unlink. Address not found or unauthorized.');
  });
});

// ============================================================================
// Tests: GET /identity/link/check/:address
// ============================================================================

Deno.test('Identity API - GET /identity/link/check/:address', async (t) => {
  const app = createTestApp();

  await t.step('setup', () => {
    resetMocks();
    mockIdentities.set('0xhasidentity', {
      id: 'id-1',
      address: '0xHasIdentity',
      emoji: '🍌',
      username: 'jango',
      formatted: '🍌 jango',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mockLinks.set('0xalreadylinked', {
      id: 'link-1',
      primaryAddress: '0xHasIdentity',
      linkedAddress: '0xAlreadyLinked',
      linkType: 'wallet',
      createdAt: new Date().toISOString(),
    });
  });

  await t.step('reports fresh address can be link target', async () => {
    const res = await app.request('/identity/link/check/0xFreshAddress');

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.data.canBeLinkTarget, true);
    assertEquals(json.data.canBePrimary, false);
    assertEquals(json.data.canBePrimaryReason, 'Must have a JuicyID to be primary');
  });

  await t.step('reports address with identity can be primary but not link target', async () => {
    const res = await app.request('/identity/link/check/0xHasIdentity');

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.data.canBeLinkTarget, false);
    assertEquals(json.data.canBeLinkTargetReason, 'Has existing JuicyID - must delete to link');
    assertEquals(json.data.canBePrimary, true);
  });

  await t.step('reports already linked address cannot be link target', async () => {
    const res = await app.request('/identity/link/check/0xAlreadyLinked');

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.data.canBeLinkTarget, false);
    assertEquals(json.data.canBeLinkTargetReason, 'Already linked to another account');
  });
});
