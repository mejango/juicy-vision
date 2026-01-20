import { assertEquals, assertExists } from 'std/assert/mod.ts';
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

// Test schema validation independently
Deno.test('Auth Route - Request Code Schema', async (t) => {
  const RequestCodeSchema = z.object({
    email: z.string().email(),
  });

  await t.step('accepts valid email', () => {
    const result = RequestCodeSchema.safeParse({ email: 'test@example.com' });
    assertEquals(result.success, true);
  });

  await t.step('rejects invalid email', () => {
    const result = RequestCodeSchema.safeParse({ email: 'not-an-email' });
    assertEquals(result.success, false);
  });

  await t.step('rejects missing email', () => {
    const result = RequestCodeSchema.safeParse({});
    assertEquals(result.success, false);
  });

  await t.step('rejects empty email', () => {
    const result = RequestCodeSchema.safeParse({ email: '' });
    assertEquals(result.success, false);
  });
});

Deno.test('Auth Route - Verify Code Schema', async (t) => {
  const VerifyCodeSchema = z.object({
    email: z.string().email(),
    code: z.string().length(6),
  });

  await t.step('accepts valid input', () => {
    const result = VerifyCodeSchema.safeParse({
      email: 'test@example.com',
      code: '123456',
    });
    assertEquals(result.success, true);
  });

  await t.step('rejects code too short', () => {
    const result = VerifyCodeSchema.safeParse({
      email: 'test@example.com',
      code: '12345',
    });
    assertEquals(result.success, false);
  });

  await t.step('rejects code too long', () => {
    const result = VerifyCodeSchema.safeParse({
      email: 'test@example.com',
      code: '1234567',
    });
    assertEquals(result.success, false);
  });

  await t.step('rejects missing code', () => {
    const result = VerifyCodeSchema.safeParse({
      email: 'test@example.com',
    });
    assertEquals(result.success, false);
  });
});

Deno.test('Auth Route - Privacy Schema', async (t) => {
  const UpdatePrivacySchema = z.object({
    privacyMode: z.enum(['open_book', 'anonymous', 'private', 'ghost']),
  });

  await t.step('accepts open_book', () => {
    const result = UpdatePrivacySchema.safeParse({ privacyMode: 'open_book' });
    assertEquals(result.success, true);
  });

  await t.step('accepts anonymous', () => {
    const result = UpdatePrivacySchema.safeParse({ privacyMode: 'anonymous' });
    assertEquals(result.success, true);
  });

  await t.step('accepts private', () => {
    const result = UpdatePrivacySchema.safeParse({ privacyMode: 'private' });
    assertEquals(result.success, true);
  });

  await t.step('accepts ghost', () => {
    const result = UpdatePrivacySchema.safeParse({ privacyMode: 'ghost' });
    assertEquals(result.success, true);
  });

  await t.step('rejects invalid privacy mode', () => {
    const result = UpdatePrivacySchema.safeParse({ privacyMode: 'invalid' });
    assertEquals(result.success, false);
  });
});

// Test a minimal route handler
Deno.test('Auth Route - Basic Handler Test', async (t) => {
  const app = new Hono();

  // Simple mock route that mimics auth behavior
  const RequestCodeSchema = z.object({
    email: z.string().email(),
  });

  app.post('/request-code', zValidator('json', RequestCodeSchema), async (c) => {
    const { email } = c.req.valid('json');
    // Mock OTP generation
    const code = '123456';
    return c.json({
      success: true,
      data: {
        message: 'Code sent to your email',
        expiresIn: 600,
        code, // In dev mode
      },
    });
  });

  await t.step('returns success for valid request', async () => {
    const res = await app.request('/request-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com' }),
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertExists(json.data.code);
    assertExists(json.data.expiresIn);
  });

  await t.step('returns 400 for invalid email', async () => {
    const res = await app.request('/request-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invalid' }),
    });

    assertEquals(res.status, 400);
  });

  await t.step('returns 400 for missing body', async () => {
    const res = await app.request('/request-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assertEquals(res.status, 400);
  });
});

// Test verify code handler
Deno.test('Auth Route - Verify Code Handler', async (t) => {
  const app = new Hono();

  // Mock state
  const validCodes = new Map<string, string>();
  validCodes.set('test@example.com', '123456');

  const VerifyCodeSchema = z.object({
    email: z.string().email(),
    code: z.string().length(6),
  });

  app.post('/verify-code', zValidator('json', VerifyCodeSchema), async (c) => {
    const { email, code } = c.req.valid('json');

    const validCode = validCodes.get(email.toLowerCase());
    if (validCode !== code) {
      return c.json({ success: false, error: 'Invalid or expired code' }, 401);
    }

    // Mock user creation/login
    return c.json({
      success: true,
      data: {
        user: {
          id: 'mock-user-id',
          email: email.toLowerCase(),
          privacyMode: 'open_book',
          emailVerified: true,
        },
        token: 'mock-jwt-token',
      },
    });
  });

  await t.step('returns user and token for valid code', async () => {
    const res = await app.request('/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        code: '123456',
      }),
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertExists(json.data.user);
    assertExists(json.data.token);
    assertEquals(json.data.user.email, 'test@example.com');
  });

  await t.step('returns 401 for invalid code', async () => {
    const res = await app.request('/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        code: '000000',
      }),
    });

    assertEquals(res.status, 401);
    const json = await res.json();
    assertEquals(json.success, false);
    assertEquals(json.error, 'Invalid or expired code');
  });

  await t.step('returns 401 for unknown email', async () => {
    const res = await app.request('/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'unknown@example.com',
        code: '123456',
      }),
    });

    assertEquals(res.status, 401);
  });
});

// Test /me endpoint
Deno.test('Auth Route - Me Endpoint', async (t) => {
  const app = new Hono();

  // Mock auth middleware
  type AuthVariables = {
    user: {
      id: string;
      email: string;
      privacyMode: string;
      emailVerified: boolean;
      custodialAddressIndex?: number;
    };
  };

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    privacyMode: 'open_book',
    emailVerified: true,
    custodialAddressIndex: 0,
  };

  app.get('/me', (c) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const token = authHeader.slice(7);
    if (token !== 'valid-token') {
      return c.json({ success: false, error: 'Invalid token' }, 401);
    }

    return c.json({
      success: true,
      data: {
        id: mockUser.id,
        email: mockUser.email,
        privacyMode: mockUser.privacyMode,
        emailVerified: mockUser.emailVerified,
        hasCustodialWallet: mockUser.custodialAddressIndex !== undefined,
      },
    });
  });

  await t.step('returns user info for authenticated request', async () => {
    const res = await app.request('/me', {
      method: 'GET',
      headers: { Authorization: 'Bearer valid-token' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.email, 'test@example.com');
    assertEquals(json.data.hasCustodialWallet, true);
  });

  await t.step('returns 401 without auth header', async () => {
    const res = await app.request('/me', {
      method: 'GET',
    });

    assertEquals(res.status, 401);
  });

  await t.step('returns 401 with invalid token', async () => {
    const res = await app.request('/me', {
      method: 'GET',
      headers: { Authorization: 'Bearer invalid-token' },
    });

    assertEquals(res.status, 401);
  });
});
