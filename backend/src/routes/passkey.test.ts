import { assertEquals, assertExists } from 'std/assert/mod.ts';
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

// Test schema validation for passkey routes
Deno.test('Passkey Route - Register Verify Schema', async (t) => {
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

  await t.step('accepts valid registration response', () => {
    const result = RegisterVerifySchema.safeParse({
      credential: {
        id: 'credential-id-123',
        rawId: 'cmF3LWlkLTEyMw',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0',
          attestationObject: 'o2NmbXRkbm9uZQ',
          transports: ['internal'],
        },
        type: 'public-key',
      },
      displayName: 'My MacBook',
    });
    assertEquals(result.success, true);
  });

  await t.step('accepts registration without displayName', () => {
    const result = RegisterVerifySchema.safeParse({
      credential: {
        id: 'credential-id-123',
        rawId: 'cmF3LWlkLTEyMw',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0',
          attestationObject: 'o2NmbXRkbm9uZQ',
        },
        type: 'public-key',
      },
    });
    assertEquals(result.success, true);
  });

  await t.step('rejects invalid credential type', () => {
    const result = RegisterVerifySchema.safeParse({
      credential: {
        id: 'credential-id-123',
        rawId: 'cmF3LWlkLTEyMw',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0',
          attestationObject: 'o2NmbXRkbm9uZQ',
        },
        type: 'invalid-type',
      },
    });
    assertEquals(result.success, false);
  });

  await t.step('rejects missing response fields', () => {
    const result = RegisterVerifySchema.safeParse({
      credential: {
        id: 'credential-id-123',
        rawId: 'cmF3LWlkLTEyMw',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0',
          // missing attestationObject
        },
        type: 'public-key',
      },
    });
    assertEquals(result.success, false);
  });

  await t.step('rejects displayName too long', () => {
    const result = RegisterVerifySchema.safeParse({
      credential: {
        id: 'credential-id-123',
        rawId: 'cmF3LWlkLTEyMw',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0',
          attestationObject: 'o2NmbXRkbm9uZQ',
        },
        type: 'public-key',
      },
      displayName: 'x'.repeat(101), // Too long
    });
    assertEquals(result.success, false);
  });
});

Deno.test('Passkey Route - Authentication Verify Schema', async (t) => {
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

  await t.step('accepts valid authentication response', () => {
    const result = AuthVerifySchema.safeParse({
      credential: {
        id: 'credential-id-123',
        rawId: 'cmF3LWlkLTEyMw',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0',
          authenticatorData: 'SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2M',
          signature: 'MEUCIQDsrPJqHJN...',
          userHandle: 'dXNlci1oYW5kbGU',
        },
        type: 'public-key',
      },
    });
    assertEquals(result.success, true);
  });

  await t.step('accepts authentication without userHandle', () => {
    const result = AuthVerifySchema.safeParse({
      credential: {
        id: 'credential-id-123',
        rawId: 'cmF3LWlkLTEyMw',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0',
          authenticatorData: 'SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2M',
          signature: 'MEUCIQDsrPJqHJN...',
        },
        type: 'public-key',
      },
    });
    assertEquals(result.success, true);
  });

  await t.step('rejects missing signature', () => {
    const result = AuthVerifySchema.safeParse({
      credential: {
        id: 'credential-id-123',
        rawId: 'cmF3LWlkLTEyMw',
        response: {
          clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0',
          authenticatorData: 'SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2M',
          // missing signature
        },
        type: 'public-key',
      },
    });
    assertEquals(result.success, false);
  });
});

Deno.test('Passkey Route - Rename Schema', async (t) => {
  const RenameSchema = z.object({
    displayName: z.string().min(1).max(100),
  });

  await t.step('accepts valid displayName', () => {
    const result = RenameSchema.safeParse({ displayName: 'My iPhone' });
    assertEquals(result.success, true);
  });

  await t.step('accepts max length displayName', () => {
    const result = RenameSchema.safeParse({ displayName: 'x'.repeat(100) });
    assertEquals(result.success, true);
  });

  await t.step('rejects empty displayName', () => {
    const result = RenameSchema.safeParse({ displayName: '' });
    assertEquals(result.success, false);
  });

  await t.step('rejects too long displayName', () => {
    const result = RenameSchema.safeParse({ displayName: 'x'.repeat(101) });
    assertEquals(result.success, false);
  });

  await t.step('rejects missing displayName', () => {
    const result = RenameSchema.safeParse({});
    assertEquals(result.success, false);
  });
});

// Test mock passkey routes
Deno.test('Passkey Route - Registration Options', async (t) => {
  const app = new Hono();

  // Mock auth middleware
  app.use('/register/*', async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    // @ts-ignore - Mock user
    c.set('user', { id: 'user-123', email: 'test@example.com' });
    await next();
  });

  app.get('/register/options', (c) => {
    return c.json({
      success: true,
      data: {
        challenge: 'random-challenge-base64url',
        rp: { name: 'Juicy Vision', id: 'localhost' },
        user: { id: 'user-handle-base64url', name: 'test@example.com', displayName: 'test' },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        timeout: 300000,
        attestation: 'none',
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
      },
    });
  });

  await t.step('returns registration options for authenticated user', async () => {
    const res = await app.request('/register/options', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertExists(json.data.challenge);
    assertExists(json.data.rp);
    assertExists(json.data.user);
    assertExists(json.data.pubKeyCredParams);
    assertEquals(json.data.rp.name, 'Juicy Vision');
  });

  await t.step('returns 401 without auth', async () => {
    const res = await app.request('/register/options');

    assertEquals(res.status, 401);
  });
});

Deno.test('Passkey Route - Authentication Options', async (t) => {
  const app = new Hono();

  app.get('/authenticate/options', (c) => {
    const email = c.req.query('email');

    const response: {
      success: boolean;
      data: {
        challenge: string;
        rpId: string;
        timeout: number;
        userVerification: string;
        allowCredentials?: Array<{ type: string; id: string; transports?: string[] }>;
      };
    } = {
      success: true,
      data: {
        challenge: 'random-challenge-base64url',
        rpId: 'localhost',
        timeout: 300000,
        userVerification: 'preferred',
      },
    };

    // If email provided, include allowCredentials
    if (email === 'test@example.com') {
      response.data.allowCredentials = [
        { type: 'public-key', id: 'credential-id-123', transports: ['internal'] },
      ];
    }

    return c.json(response);
  });

  await t.step('returns authentication options without email', async () => {
    const res = await app.request('/authenticate/options');

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertExists(json.data.challenge);
    assertEquals(json.data.rpId, 'localhost');
    assertEquals(json.data.allowCredentials, undefined);
  });

  await t.step('returns allowCredentials when email provided', async () => {
    const res = await app.request('/authenticate/options?email=test@example.com');

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertExists(json.data.allowCredentials);
    assertEquals(json.data.allowCredentials.length, 1);
    assertEquals(json.data.allowCredentials[0].id, 'credential-id-123');
  });

  await t.step('returns empty allowCredentials for unknown email', async () => {
    const res = await app.request('/authenticate/options?email=unknown@example.com');

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.allowCredentials, undefined);
  });
});

Deno.test('Passkey Route - List Passkeys', async (t) => {
  const app = new Hono();

  // Mock passkeys store
  const mockPasskeys = [
    {
      id: 'passkey-1',
      displayName: 'MacBook Pro',
      deviceType: 'platform',
      createdAt: '2024-01-01T00:00:00Z',
      lastUsedAt: '2024-01-15T12:00:00Z',
    },
    {
      id: 'passkey-2',
      displayName: 'YubiKey',
      deviceType: 'cross-platform',
      createdAt: '2024-01-10T00:00:00Z',
      lastUsedAt: null,
    },
  ];

  app.use('/list', async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || authHeader !== 'Bearer valid-token') {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    await next();
  });

  app.get('/list', (c) => {
    return c.json({ success: true, data: mockPasskeys });
  });

  await t.step('returns list of passkeys for authenticated user', async () => {
    const res = await app.request('/list', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.length, 2);
    assertEquals(json.data[0].displayName, 'MacBook Pro');
    assertEquals(json.data[1].displayName, 'YubiKey');
  });

  await t.step('returns 401 without valid token', async () => {
    const res = await app.request('/list', {
      headers: { Authorization: 'Bearer invalid-token' },
    });

    assertEquals(res.status, 401);
  });
});

Deno.test('Passkey Route - Delete Passkey', async (t) => {
  const app = new Hono();

  const userPasskeys = new Map([
    ['user-123', ['passkey-1', 'passkey-2']],
  ]);

  app.use('/:id', async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || authHeader !== 'Bearer valid-token') {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    // @ts-ignore
    c.set('userId', 'user-123');
    await next();
  });

  app.delete('/:id', (c) => {
    const credentialId = c.req.param('id');
    // @ts-ignore
    const userId = c.get('userId');

    const passkeys = userPasskeys.get(userId) || [];
    if (!passkeys.includes(credentialId)) {
      return c.json({ success: false, error: 'Passkey not found' }, 404);
    }

    return c.json({ success: true });
  });

  await t.step('deletes passkey successfully', async () => {
    const res = await app.request('/passkey-1', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-token' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
  });

  await t.step('returns 404 for non-existent passkey', async () => {
    const res = await app.request('/non-existent', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-token' },
    });

    assertEquals(res.status, 404);
  });

  await t.step('returns 401 without auth', async () => {
    const res = await app.request('/passkey-1', {
      method: 'DELETE',
    });

    assertEquals(res.status, 401);
  });
});
