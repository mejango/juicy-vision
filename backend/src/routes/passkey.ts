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

export { passkeyRouter };
