import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  requestOtp,
  verifyOtpAndLogin,
  logout,
  updateUserPrivacyMode,
  emailService,
} from '../services/auth.ts';
import { requireAuth } from '../middleware/auth.ts';
import { z } from 'zod';

const authRouter = new Hono();

// POST /auth/request-code - Request OTP code via email
const RequestCodeSchema = z.object({
  email: z.string().email(),
});

authRouter.post(
  '/request-code',
  zValidator('json', RequestCodeSchema),
  async (c) => {
    const { email } = c.req.valid('json');

    try {
      const { code, expiresIn } = await requestOtp(email);

      // Send email with code
      await emailService.sendOtpEmail(email, code!);

      return c.json({
        success: true,
        data: {
          message: 'Code sent to your email',
          expiresIn,
          // Include code in dev mode only
          ...(Deno.env.get('DENO_ENV') !== 'production' && { code }),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send code';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// POST /auth/verify-code - Verify OTP and login
const VerifyCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
});

authRouter.post(
  '/verify-code',
  zValidator('json', VerifyCodeSchema),
  async (c) => {
    const { email, code } = c.req.valid('json');

    try {
      const { user, token } = await verifyOtpAndLogin(email, code);

      return c.json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            privacyMode: user.privacyMode,
            emailVerified: user.emailVerified,
          },
          token,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Verification failed';
      return c.json({ success: false, error: message }, 401);
    }
  }
);

// POST /auth/logout
authRouter.post('/logout', requireAuth, async (c) => {
  const session = c.get('session');
  await logout(session.id);
  return c.json({ success: true });
});

// GET /auth/me
authRouter.get('/me', requireAuth, (c) => {
  const user = c.get('user');
  return c.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      privacyMode: user.privacyMode,
      emailVerified: user.emailVerified,
      hasCustodialWallet: user.custodialAddressIndex !== undefined,
      isAdmin: user.isAdmin,
    },
  });
});

// PATCH /auth/privacy
const UpdatePrivacySchema = z.object({
  privacyMode: z.enum(['open_book', 'anonymous', 'private', 'ghost']),
});

authRouter.patch(
  '/privacy',
  requireAuth,
  zValidator('json', UpdatePrivacySchema),
  async (c) => {
    const user = c.get('user');
    const { privacyMode } = c.req.valid('json');

    await updateUserPrivacyMode(user.id, privacyMode);

    return c.json({
      success: true,
      data: { privacyMode },
    });
  }
);

// GET /auth/session-address - Get the pseudo-address for the current session
// This is needed because the frontend can't compute HMAC addresses (no access to secret)
authRouter.get('/session-address', async (c) => {
  const sessionId = c.req.header('X-Session-ID');

  if (!sessionId || !sessionId.startsWith('ses_')) {
    return c.json({ success: false, error: 'No valid session ID' }, 400);
  }

  const { getPseudoAddress } = await import('../utils/crypto.ts');
  const address = await getPseudoAddress(sessionId);

  return c.json({
    success: true,
    data: { address, sessionId },
  });
});

export { authRouter };
