/**
 * Passkey/WebAuthn Routes
 * Handles biometric and hardware key authentication
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth, optionalAuth } from '../middleware/auth.ts';
import {
  createRegistrationChallenge,
  createAuthenticationChallenge,
  verifyRegistration,
  verifyAuthentication,
  getUserPasskeys,
  deletePasskey,
  renamePasskey,
  createSignupChallenge,
  verifySignupRegistration,
  type RegistrationResponse,
  type AuthenticationResponse,
} from '../services/passkey.ts';
import { createSession, findUserById } from '../services/auth.ts';

const passkeyRouter = new Hono();

// ============================================================================
// Registration (requires existing auth)
// ============================================================================

// GET /passkey/register/options - Get registration options
passkeyRouter.get('/register/options', requireAuth, async (c) => {
  const user = c.get('user');

  try {
    const options = await createRegistrationChallenge(user.id);
    return c.json({ success: true, data: options });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create challenge';
    return c.json({ success: false, error: message }, 400);
  }
});

// POST /passkey/register/verify - Verify registration
const RegisterVerifySchema = z.object({
  credential: z.object({
    id: z.string(),
    rawId: z.string(),
    response: z.object({
      clientDataJSON: z.string(),
      attestationObject: z.string(),
      transports: z.array(z.string()).optional(),
    }),
    authenticatorAttachment: z.string().optional(),
    type: z.literal('public-key'),
  }),
  displayName: z.string().max(100).optional(),
});

passkeyRouter.post(
  '/register/verify',
  requireAuth,
  zValidator('json', RegisterVerifySchema),
  async (c) => {
    const user = c.get('user');
    const { credential, displayName } = c.req.valid('json');

    try {
      const passkey = await verifyRegistration(
        user.id,
        credential as RegistrationResponse,
        displayName
      );

      return c.json({
        success: true,
        data: {
          id: passkey.id,
          displayName: passkey.displayName,
          deviceType: passkey.deviceType,
          createdAt: passkey.createdAt,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// ============================================================================
// Signup with Passkey (no auth required - creates new user)
// ============================================================================

// GET /passkey/signup/options - Get registration options for new user
passkeyRouter.get('/signup/options', async (c) => {
  try {
    const options = await createSignupChallenge();
    return c.json({ success: true, data: options });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create challenge';
    return c.json({ success: false, error: message }, 400);
  }
});

// POST /passkey/signup/verify - Verify registration and create user
const SignupVerifySchema = z.object({
  credential: z.object({
    id: z.string(),
    rawId: z.string(),
    response: z.object({
      clientDataJSON: z.string(),
      attestationObject: z.string(),
      transports: z.array(z.string()).optional(),
    }),
    authenticatorAttachment: z.string().optional(),
    type: z.literal('public-key'),
  }),
  displayName: z.string().max(100).optional(),
});

passkeyRouter.post(
  '/signup/verify',
  zValidator('json', SignupVerifySchema),
  async (c) => {
    const { credential, displayName } = c.req.valid('json');

    try {
      // Verify registration and create user
      const { userId, credential: passkey } = await verifySignupRegistration(
        credential as RegistrationResponse,
        displayName
      );

      // Get the created user
      const user = await findUserById(userId);
      if (!user) {
        throw new Error('User creation failed');
      }

      // Create session
      const session = await createSession(userId);

      return c.json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            privacyMode: user.privacyMode,
            emailVerified: user.emailVerified,
            passkeyEnabled: true,
          },
          token: session.token,
          passkey: {
            id: passkey.id,
            displayName: passkey.displayName,
            deviceType: passkey.deviceType,
            createdAt: passkey.createdAt,
          },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Signup failed';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// ============================================================================
// Authentication (no auth required)
// ============================================================================

// GET /passkey/authenticate/options - Get authentication options
const AuthOptionsSchema = z.object({
  email: z.string().email().optional(),
});

passkeyRouter.get('/authenticate/options', async (c) => {
  const email = c.req.query('email');

  try {
    const options = await createAuthenticationChallenge(email);
    return c.json({ success: true, data: options });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create challenge';
    return c.json({ success: false, error: message }, 400);
  }
});

// POST /passkey/authenticate/verify - Verify authentication and login
const AuthVerifySchema = z.object({
  credential: z.object({
    id: z.string(),
    rawId: z.string(),
    response: z.object({
      clientDataJSON: z.string(),
      authenticatorData: z.string(),
      signature: z.string(),
      userHandle: z.string().optional(),
    }),
    authenticatorAttachment: z.string().optional(),
    type: z.literal('public-key'),
  }),
});

passkeyRouter.post(
  '/authenticate/verify',
  zValidator('json', AuthVerifySchema),
  async (c) => {
    const { credential } = c.req.valid('json');

    try {
      // Verify the passkey
      const { userId } = await verifyAuthentication(credential as AuthenticationResponse);

      // Get user
      const user = await findUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Create session
      const session = await createSession(userId);

      return c.json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            privacyMode: user.privacyMode,
            emailVerified: user.emailVerified,
            passkeyEnabled: true,
          },
          token: session.token,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication failed';
      return c.json({ success: false, error: message }, 401);
    }
  }
);

// ============================================================================
// Management (requires auth)
// ============================================================================

// GET /passkey/list - List user's passkeys
passkeyRouter.get('/list', requireAuth, async (c) => {
  const user = c.get('user');

  try {
    const passkeys = await getUserPasskeys(user.id);

    return c.json({
      success: true,
      data: passkeys.map(p => ({
        id: p.id,
        displayName: p.displayName,
        deviceType: p.deviceType,
        createdAt: p.createdAt,
        lastUsedAt: p.lastUsedAt,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list passkeys';
    return c.json({ success: false, error: message }, 500);
  }
});

// DELETE /passkey/:id - Delete a passkey
passkeyRouter.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const credentialId = c.req.param('id');

  try {
    await deletePasskey(user.id, credentialId);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete passkey';
    return c.json({ success: false, error: message }, 400);
  }
});

// PATCH /passkey/:id - Rename a passkey
const RenameSchema = z.object({
  displayName: z.string().min(1).max(100),
});

passkeyRouter.patch(
  '/:id',
  requireAuth,
  zValidator('json', RenameSchema),
  async (c) => {
    const user = c.get('user');
    const credentialId = c.req.param('id');
    const { displayName } = c.req.valid('json');

    try {
      await renamePasskey(user.id, credentialId, displayName);
      return c.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rename passkey';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// ============================================================================
// PRF Wallet Mapping (for client-side derived wallets)
// ============================================================================

import { query, queryOne, execute } from '../db/index.ts';

// POST /passkey/wallet - Register a credential with its derived wallet address
const RegisterWalletSchema = z.object({
  credentialId: z.string().min(1).max(512),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  deviceName: z.string().max(100).optional(),
  deviceType: z.string().max(50).optional(),
});

passkeyRouter.post(
  '/wallet',
  zValidator('json', RegisterWalletSchema),
  async (c) => {
    const { credentialId, walletAddress, deviceName, deviceType } = c.req.valid('json');

    try {
      // Check if this credential already exists
      const existing = await queryOne<{ wallet_address: string; primary_wallet_address: string | null }>(
        'SELECT wallet_address, primary_wallet_address FROM passkey_wallets WHERE credential_id = $1',
        [credentialId]
      );

      if (existing) {
        // Credential already registered - return existing wallet
        const effectiveWallet = existing.primary_wallet_address || existing.wallet_address;

        // Update last_used_at
        await execute(
          'UPDATE passkey_wallets SET last_used_at = NOW() WHERE credential_id = $1',
          [credentialId]
        );

        return c.json({
          success: true,
          data: {
            walletAddress: effectiveWallet,
            isExisting: true,
            isPrimaryLinked: !!existing.primary_wallet_address,
          },
        });
      }

      // New credential - register it
      await execute(
        'INSERT INTO passkey_wallets (credential_id, wallet_address, device_name, device_type) VALUES ($1, $2, $3, $4)',
        [credentialId, walletAddress.toLowerCase(), deviceName || null, deviceType || null]
      );

      return c.json({
        success: true,
        data: {
          walletAddress: walletAddress.toLowerCase(),
          isExisting: false,
          isPrimaryLinked: false,
        },
      });
    } catch (error) {
      console.error('Failed to register passkey wallet:', error);
      const message = error instanceof Error ? error.message : 'Failed to register wallet';
      return c.json({ success: false, error: message }, 500);
    }
  }
);

// GET /passkey/wallet/:credentialId - Look up wallet for a credential
passkeyRouter.get('/wallet/:credentialId', async (c) => {
  const credentialId = c.req.param('credentialId');

  try {
    const result = await queryOne<{
      wallet_address: string;
      primary_wallet_address: string | null;
      device_name: string | null;
      created_at: Date;
    }>(
      'SELECT wallet_address, primary_wallet_address, device_name, created_at FROM passkey_wallets WHERE credential_id = $1',
      [credentialId]
    );

    if (!result) {
      return c.json({
        success: true,
        data: null, // Not found - client should use derived wallet
      });
    }

    // Update last_used_at
    await execute(
      'UPDATE passkey_wallets SET last_used_at = NOW() WHERE credential_id = $1',
      [credentialId]
    );

    return c.json({
      success: true,
      data: {
        walletAddress: result.primary_wallet_address || result.wallet_address,
        derivedWalletAddress: result.wallet_address,
        isPrimaryLinked: !!result.primary_wallet_address,
        deviceName: result.device_name,
        createdAt: result.created_at,
      },
    });
  } catch (error) {
    console.error('Failed to look up passkey wallet:', error);
    const message = error instanceof Error ? error.message : 'Failed to look up wallet';
    return c.json({ success: false, error: message }, 500);
  }
});

// POST /passkey/wallet/link - Link a new credential to an existing wallet (multi-device)
// Requires SIWE auth to prove ownership of the primary wallet
const LinkWalletSchema = z.object({
  credentialId: z.string().min(1).max(512),
  derivedWalletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  deviceName: z.string().max(100).optional(),
  deviceType: z.string().max(50).optional(),
});

import { requireWalletAuth } from '../middleware/walletSession.ts';

passkeyRouter.post(
  '/wallet/link',
  requireWalletAuth,
  zValidator('json', LinkWalletSchema),
  async (c) => {
    const walletSession = c.get('walletSession');
    const { credentialId, derivedWalletAddress, deviceName, deviceType } = c.req.valid('json');

    // The authenticated wallet address becomes the primary
    const primaryWalletAddress = walletSession!.address.toLowerCase();

    try {
      // Check if credential already exists
      const existing = await queryOne<{ id: string }>(
        'SELECT id FROM passkey_wallets WHERE credential_id = $1',
        [credentialId]
      );

      if (existing) {
        // Update existing to link to primary
        await execute(
          'UPDATE passkey_wallets SET primary_wallet_address = $1, last_used_at = NOW() WHERE credential_id = $2',
          [primaryWalletAddress, credentialId]
        );
      } else {
        // Insert new linked credential
        await execute(
          'INSERT INTO passkey_wallets (credential_id, wallet_address, primary_wallet_address, device_name, device_type) VALUES ($1, $2, $3, $4, $5)',
          [credentialId, derivedWalletAddress.toLowerCase(), primaryWalletAddress, deviceName || null, deviceType || null]
        );
      }

      return c.json({
        success: true,
        data: {
          primaryWalletAddress,
          derivedWalletAddress: derivedWalletAddress.toLowerCase(),
          linked: true,
        },
      });
    } catch (error) {
      console.error('Failed to link passkey wallet:', error);
      const message = error instanceof Error ? error.message : 'Failed to link wallet';
      return c.json({ success: false, error: message }, 500);
    }
  }
);

// GET /passkey/wallet/devices - List all devices linked to the authenticated wallet
passkeyRouter.get('/wallet/devices', requireWalletAuth, async (c) => {
  const walletSession = c.get('walletSession');
  const walletAddress = walletSession!.address.toLowerCase();

  try {
    const devices = await query<{
      credential_id: string;
      wallet_address: string;
      device_name: string | null;
      device_type: string | null;
      created_at: Date;
      last_used_at: Date | null;
    }>(
      'SELECT credential_id, wallet_address, device_name, device_type, created_at, last_used_at FROM passkey_wallets WHERE wallet_address = $1 OR primary_wallet_address = $1 ORDER BY created_at ASC',
      [walletAddress]
    );

    return c.json({
      success: true,
      data: {
        primaryWalletAddress: walletAddress,
        devices: devices.map(row => ({
          credentialId: row.credential_id,
          derivedWalletAddress: row.wallet_address,
          deviceName: row.device_name,
          deviceType: row.device_type,
          createdAt: row.created_at,
          lastUsedAt: row.last_used_at,
        })),
      },
    });
  } catch (error) {
    console.error('Failed to list passkey devices:', error);
    const message = error instanceof Error ? error.message : 'Failed to list devices';
    return c.json({ success: false, error: message }, 500);
  }
});

export { passkeyRouter };
