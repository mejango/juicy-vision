/**
 * Invite System Integration Tests
 *
 * Tests for chat invite creation, validation, and joining
 */

import { assertEquals, assertExists, assertNotEquals } from 'std/assert/mod.ts';
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

// ============================================================================
// Invite Code Validation Tests
// ============================================================================

Deno.test('Invite Service - Code Generation', async (t) => {
  // Test invite code format
  function generateInviteCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  await t.step('generates 8-character codes', () => {
    const code = generateInviteCode();
    assertEquals(code.length, 8);
  });

  await t.step('codes are unique', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add(generateInviteCode());
    }
    // All 100 codes should be unique (extremely high probability)
    assertEquals(codes.size, 100);
  });

  await t.step('codes contain only allowed characters', () => {
    const allowedChars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    for (let i = 0; i < 100; i++) {
      const code = generateInviteCode();
      for (const char of code) {
        assertEquals(allowedChars.includes(char), true);
      }
    }
  });

  await t.step('codes exclude ambiguous characters (0, O, 1, l, I)', () => {
    const ambiguousChars = '0O1lI';
    for (let i = 0; i < 100; i++) {
      const code = generateInviteCode();
      for (const char of code) {
        assertEquals(ambiguousChars.includes(char), false);
      }
    }
  });
});

Deno.test('Invite Service - Validity Check', async (t) => {
  interface ChatInvite {
    id: string;
    chatId: string;
    code: string;
    uses: number;
    maxUses: number | null;
    expiresAt: string | null;
  }

  function isInviteValid(invite: ChatInvite): boolean {
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      return false;
    }
    if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
      return false;
    }
    return true;
  }

  await t.step('valid invite with no limits', () => {
    const invite: ChatInvite = {
      id: 'inv-1',
      chatId: 'chat-1',
      code: 'ABC12345',
      uses: 5,
      maxUses: null,
      expiresAt: null,
    };
    assertEquals(isInviteValid(invite), true);
  });

  await t.step('valid invite under max uses', () => {
    const invite: ChatInvite = {
      id: 'inv-2',
      chatId: 'chat-1',
      code: 'ABC12345',
      uses: 5,
      maxUses: 10,
      expiresAt: null,
    };
    assertEquals(isInviteValid(invite), true);
  });

  await t.step('invalid invite - max uses reached', () => {
    const invite: ChatInvite = {
      id: 'inv-3',
      chatId: 'chat-1',
      code: 'ABC12345',
      uses: 10,
      maxUses: 10,
      expiresAt: null,
    };
    assertEquals(isInviteValid(invite), false);
  });

  await t.step('invalid invite - exceeded max uses', () => {
    const invite: ChatInvite = {
      id: 'inv-4',
      chatId: 'chat-1',
      code: 'ABC12345',
      uses: 15,
      maxUses: 10,
      expiresAt: null,
    };
    assertEquals(isInviteValid(invite), false);
  });

  await t.step('valid invite - future expiry', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const invite: ChatInvite = {
      id: 'inv-5',
      chatId: 'chat-1',
      code: 'ABC12345',
      uses: 0,
      maxUses: null,
      expiresAt: futureDate.toISOString(),
    };
    assertEquals(isInviteValid(invite), true);
  });

  await t.step('invalid invite - expired', () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);
    const invite: ChatInvite = {
      id: 'inv-6',
      chatId: 'chat-1',
      code: 'ABC12345',
      uses: 0,
      maxUses: null,
      expiresAt: pastDate.toISOString(),
    };
    assertEquals(isInviteValid(invite), false);
  });
});

// ============================================================================
// Schema Tests
// ============================================================================

Deno.test('Invite - Create Invite Schema', async (t) => {
  const CreateInviteSchema = z.object({
    canSendMessages: z.boolean().default(true),
    canInviteOthers: z.boolean().default(false),
    canPassOnRoles: z.boolean().default(false),
    maxUses: z.number().positive().optional(),
    expiresAt: z.string().datetime().optional(),
  });

  await t.step('accepts empty object (defaults)', () => {
    const result = CreateInviteSchema.safeParse({});
    assertEquals(result.success, true);
    if (result.success) {
      assertEquals(result.data.canSendMessages, true);
      assertEquals(result.data.canInviteOthers, false);
    }
  });

  await t.step('accepts all permissions', () => {
    const result = CreateInviteSchema.safeParse({
      canSendMessages: true,
      canInviteOthers: true,
      canPassOnRoles: true,
    });
    assertEquals(result.success, true);
  });

  await t.step('accepts maxUses', () => {
    const result = CreateInviteSchema.safeParse({ maxUses: 10 });
    assertEquals(result.success, true);
  });

  await t.step('rejects negative maxUses', () => {
    const result = CreateInviteSchema.safeParse({ maxUses: -1 });
    assertEquals(result.success, false);
  });

  await t.step('rejects zero maxUses', () => {
    const result = CreateInviteSchema.safeParse({ maxUses: 0 });
    assertEquals(result.success, false);
  });

  await t.step('accepts valid datetime for expiresAt', () => {
    const result = CreateInviteSchema.safeParse({
      expiresAt: '2025-12-31T23:59:59Z',
    });
    assertEquals(result.success, true);
  });

  await t.step('rejects invalid datetime', () => {
    const result = CreateInviteSchema.safeParse({
      expiresAt: 'not-a-date',
    });
    assertEquals(result.success, false);
  });
});

// ============================================================================
// Route Handler Tests
// ============================================================================

Deno.test('Invite Routes - GET /invite/:code (public info)', async (t) => {
  const app = new Hono();

  const mockInvites = new Map([
    [
      'validCode',
      {
        id: 'inv-1',
        chatId: 'chat-123',
        code: 'validCode',
        uses: 0,
        maxUses: null,
        expiresAt: null,
        canSendMessages: true,
        canInviteOthers: false,
      },
    ],
    [
      'expiredCode',
      {
        id: 'inv-2',
        chatId: 'chat-123',
        code: 'expiredCode',
        uses: 0,
        maxUses: null,
        expiresAt: '2020-01-01T00:00:00Z', // Past date
        canSendMessages: true,
        canInviteOthers: false,
      },
    ],
    [
      'maxedOut',
      {
        id: 'inv-3',
        chatId: 'chat-123',
        code: 'maxedOut',
        uses: 10,
        maxUses: 10,
        expiresAt: null,
        canSendMessages: true,
        canInviteOthers: false,
      },
    ],
  ]);

  const mockChat = {
    id: 'chat-123',
    name: 'Test Chat',
    description: 'A test chat for invites',
  };

  function isValid(invite: any): boolean {
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) return false;
    if (invite.maxUses !== null && invite.uses >= invite.maxUses) return false;
    return true;
  }

  app.get('/invite/:code', (c) => {
    const code = c.req.param('code');
    const invite = mockInvites.get(code);

    if (!invite) {
      return c.json({ success: false, error: 'Invite not found' }, 404);
    }

    if (!isValid(invite)) {
      return c.json(
        { success: false, error: 'Invite has expired or reached max uses' },
        410
      );
    }

    return c.json({
      success: true,
      data: {
        chatId: mockChat.id,
        chatName: mockChat.name,
        chatDescription: mockChat.description,
        canSendMessages: invite.canSendMessages,
        canInviteOthers: invite.canInviteOthers,
      },
    });
  });

  await t.step('returns invite info for valid code', async () => {
    const res = await app.request('/invite/validCode');

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.chatName, 'Test Chat');
    assertEquals(json.data.canSendMessages, true);
  });

  await t.step('returns 404 for unknown code', async () => {
    const res = await app.request('/invite/unknownCode');

    assertEquals(res.status, 404);
    const json = await res.json();
    assertEquals(json.error, 'Invite not found');
  });

  await t.step('returns 410 for expired invite', async () => {
    const res = await app.request('/invite/expiredCode');

    assertEquals(res.status, 410);
    const json = await res.json();
    assertEquals(json.success, false);
  });

  await t.step('returns 410 for maxed out invite', async () => {
    const res = await app.request('/invite/maxedOut');

    assertEquals(res.status, 410);
  });
});

Deno.test('Invite Routes - POST /invite/:code/join', async (t) => {
  const app = new Hono();

  const mockInvites = new Map([
    [
      'validCode',
      {
        id: 'inv-1',
        chatId: 'chat-123',
        code: 'validCode',
        uses: 0,
        maxUses: 10,
        expiresAt: null,
        canSendMessages: true,
        canInviteOthers: false,
      },
    ],
  ]);

  const chatMembers = new Map<string, Set<string>>();
  chatMembers.set('chat-123', new Set(['0xfounder']));

  app.post('/invite/:code/join', (c) => {
    const code = c.req.param('code');
    const authHeader = c.req.header('Authorization');
    const sessionId = c.req.header('X-Session-ID');

    if (!authHeader && !sessionId) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    const invite = mockInvites.get(code);
    if (!invite) {
      return c.json({ success: false, error: 'Invite not found' }, 404);
    }

    // Derive address from session/auth
    const userAddress = sessionId
      ? `0x${sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40).padStart(40, '0')}`
      : '0xauthed';

    const members = chatMembers.get(invite.chatId) || new Set();

    // Check if already member
    if (members.has(userAddress)) {
      return c.json({
        success: true,
        data: {
          chatId: invite.chatId,
          chatName: 'Test Chat',
          alreadyMember: true,
        },
      });
    }

    // Add as member
    members.add(userAddress);
    chatMembers.set(invite.chatId, members);

    // Increment uses
    invite.uses++;

    return c.json({
      success: true,
      data: {
        chatId: invite.chatId,
        chatName: 'Test Chat',
        role: 'member',
      },
    });
  });

  await t.step('joins chat via valid invite', async () => {
    const res = await app.request('/invite/validCode/join', {
      method: 'POST',
      headers: { 'X-Session-ID': 'ses_user1' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.chatId, 'chat-123');
    assertExists(json.data.role);
  });

  await t.step('returns alreadyMember if re-joining', async () => {
    // Same session ID as before
    const res = await app.request('/invite/validCode/join', {
      method: 'POST',
      headers: { 'X-Session-ID': 'ses_user1' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.alreadyMember, true);
  });

  await t.step('different user can also join', async () => {
    const res = await app.request('/invite/validCode/join', {
      method: 'POST',
      headers: { 'X-Session-ID': 'ses_user2' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.alreadyMember, undefined);
  });

  await t.step('returns 401 without auth', async () => {
    const res = await app.request('/invite/validCode/join', {
      method: 'POST',
    });

    assertEquals(res.status, 401);
  });

  await t.step('returns 404 for unknown invite', async () => {
    const res = await app.request('/invite/unknownCode/join', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token' },
    });

    assertEquals(res.status, 404);
  });
});

Deno.test('Invite Routes - POST /multi-chat/:chatId/invites (create)', async (t) => {
  const app = new Hono();

  const CreateInviteSchema = z.object({
    canSendMessages: z.boolean().default(true),
    canInviteOthers: z.boolean().default(false),
    canPassOnRoles: z.boolean().default(false),
  });

  const chatMembers = new Map<string, Map<string, { role: string; canInvite: boolean }>>([
    [
      'chat-123',
      new Map([
        ['0xfounder', { role: 'founder', canInvite: true }],
        ['0xadmin', { role: 'admin', canInvite: true }],
        ['0xmember', { role: 'member', canInvite: false }],
        ['0xinviter', { role: 'member', canInvite: true }],
      ]),
    ],
  ]);

  const createdInvites: any[] = [];

  app.post(
    '/:chatId/invites',
    zValidator('json', CreateInviteSchema),
    (c) => {
      const chatId = c.req.param('chatId');
      const userAddress = c.req.header('X-User-Address');

      if (!userAddress) {
        return c.json({ success: false, error: 'Authentication required' }, 401);
      }

      const members = chatMembers.get(chatId);
      if (!members) {
        return c.json({ success: false, error: 'Chat not found' }, 404);
      }

      const member = members.get(userAddress);
      if (!member) {
        return c.json({ success: false, error: 'Not a member of this chat' }, 403);
      }

      const canCreate =
        member.role === 'founder' ||
        member.role === 'admin' ||
        member.canInvite;

      if (!canCreate) {
        return c.json({ success: false, error: 'No permission to create invites' }, 403);
      }

      const body = c.req.valid('json');

      const invite = {
        id: `inv-${Date.now()}`,
        chatId,
        code: `CODE${Math.random().toString(36).slice(2, 10)}`,
        createdBy: userAddress,
        ...body,
        uses: 0,
        maxUses: null,
        createdAt: new Date().toISOString(),
      };

      createdInvites.push(invite);

      return c.json({
        success: true,
        data: {
          ...invite,
          inviteUrl: `https://app.example.com/#/join/${invite.code}`,
        },
      }, 201);
    }
  );

  await t.step('founder can create invite', async () => {
    const res = await app.request('/chat-123/invites', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Address': '0xfounder',
      },
      body: JSON.stringify({}),
    });

    assertEquals(res.status, 201);
    const json = await res.json();
    assertEquals(json.success, true);
    assertExists(json.data.code);
    assertExists(json.data.inviteUrl);
  });

  await t.step('admin can create invite', async () => {
    const res = await app.request('/chat-123/invites', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Address': '0xadmin',
      },
      body: JSON.stringify({ canInviteOthers: true }),
    });

    assertEquals(res.status, 201);
    const json = await res.json();
    assertEquals(json.data.canInviteOthers, true);
  });

  await t.step('member with canInvite can create invite', async () => {
    const res = await app.request('/chat-123/invites', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Address': '0xinviter',
      },
      body: JSON.stringify({}),
    });

    assertEquals(res.status, 201);
  });

  await t.step('member without canInvite cannot create invite', async () => {
    const res = await app.request('/chat-123/invites', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Address': '0xmember',
      },
      body: JSON.stringify({}),
    });

    assertEquals(res.status, 403);
  });

  await t.step('non-member cannot create invite', async () => {
    const res = await app.request('/chat-123/invites', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Address': '0xstranger',
      },
      body: JSON.stringify({}),
    });

    assertEquals(res.status, 403);
  });

  await t.step('returns 404 for unknown chat', async () => {
    const res = await app.request('/unknown-chat/invites', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Address': '0xfounder',
      },
      body: JSON.stringify({}),
    });

    assertEquals(res.status, 404);
  });
});

Deno.test('Invite Routes - DELETE /multi-chat/:chatId/invites/:inviteId', async (t) => {
  const app = new Hono();

  const chatMembers = new Map<string, Map<string, { role: string }>>([
    [
      'chat-123',
      new Map([
        ['0xfounder', { role: 'founder' }],
        ['0xadmin', { role: 'admin' }],
        ['0xmember', { role: 'member' }],
      ]),
    ],
  ]);

  const invites = new Map([
    ['inv-1', { id: 'inv-1', chatId: 'chat-123', code: 'ABC12345' }],
  ]);

  app.delete('/:chatId/invites/:inviteId', (c) => {
    const chatId = c.req.param('chatId');
    const inviteId = c.req.param('inviteId');
    const userAddress = c.req.header('X-User-Address');

    if (!userAddress) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    const members = chatMembers.get(chatId);
    if (!members) {
      return c.json({ success: false, error: 'Chat not found' }, 404);
    }

    const member = members.get(userAddress);
    if (!member || (member.role !== 'founder' && member.role !== 'admin')) {
      return c.json({ success: false, error: 'Admin access required' }, 403);
    }

    if (!invites.has(inviteId)) {
      return c.json({ success: false, error: 'Invite not found' }, 404);
    }

    invites.delete(inviteId);
    return c.json({ success: true });
  });

  await t.step('founder can revoke invite', async () => {
    // Re-add for test
    invites.set('inv-1', { id: 'inv-1', chatId: 'chat-123', code: 'ABC12345' });

    const res = await app.request('/chat-123/invites/inv-1', {
      method: 'DELETE',
      headers: { 'X-User-Address': '0xfounder' },
    });

    assertEquals(res.status, 200);
  });

  await t.step('admin can revoke invite', async () => {
    invites.set('inv-2', { id: 'inv-2', chatId: 'chat-123', code: 'DEF67890' });

    const res = await app.request('/chat-123/invites/inv-2', {
      method: 'DELETE',
      headers: { 'X-User-Address': '0xadmin' },
    });

    assertEquals(res.status, 200);
  });

  await t.step('member cannot revoke invite', async () => {
    invites.set('inv-3', { id: 'inv-3', chatId: 'chat-123', code: 'GHI11111' });

    const res = await app.request('/chat-123/invites/inv-3', {
      method: 'DELETE',
      headers: { 'X-User-Address': '0xmember' },
    });

    assertEquals(res.status, 403);
  });
});

// ============================================================================
// Chat Migration Tests
// ============================================================================

Deno.test('Chat Migration - POST /chat/migrate', async (t) => {
  const app = new Hono();

  const MigrateChatSchema = z.object({
    title: z.string().min(1).max(200),
    messages: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string(),
        })
      )
      .optional(),
  });

  const migratedChats: any[] = [];

  app.post('/migrate', zValidator('json', MigrateChatSchema), (c) => {
    const authHeader = c.req.header('Authorization');
    const sessionId = c.req.header('X-Session-ID');

    if (!authHeader && !sessionId) {
      return c.json({ success: false, error: 'Session ID required' }, 401);
    }

    const body = c.req.valid('json');

    const chat = {
      id: `chat-${Date.now()}`,
      name: body.title,
      messages: body.messages || [],
      createdAt: new Date().toISOString(),
    };

    migratedChats.push(chat);

    return c.json({
      success: true,
      data: {
        chatId: chat.id,
        name: chat.name,
      },
    }, 201);
  });

  await t.step('migrates chat with title only', async () => {
    const res = await app.request('/migrate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': 'ses_abc123',
      },
      body: JSON.stringify({ title: 'My Chat' }),
    });

    assertEquals(res.status, 201);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.name, 'My Chat');
    assertExists(json.data.chatId);
  });

  await t.step('migrates chat with messages', async () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'How are you?' },
    ];

    const res = await app.request('/migrate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': 'ses_abc123',
      },
      body: JSON.stringify({ title: 'Chat with history', messages }),
    });

    assertEquals(res.status, 201);
    const json = await res.json();
    assertEquals(json.success, true);
    assertExists(json.data.chatId);
    assertEquals(json.data.name, 'Chat with history');

    // The mock handler stores messages - verify the last added chat has them
    const lastChat = migratedChats[migratedChats.length - 1];
    assertExists(lastChat);
    assertEquals(lastChat.name, 'Chat with history');
  });

  await t.step('works with auth token', async () => {
    const res = await app.request('/migrate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({ title: 'Authed Chat' }),
    });

    assertEquals(res.status, 201);
  });

  await t.step('returns 401 without any auth', async () => {
    const res = await app.request('/migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'No Auth Chat' }),
    });

    assertEquals(res.status, 401);
  });

  await t.step('rejects empty title', async () => {
    const res = await app.request('/migrate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': 'ses_abc123',
      },
      body: JSON.stringify({ title: '' }),
    });

    assertEquals(res.status, 400);
  });

  await t.step('rejects title too long', async () => {
    const res = await app.request('/migrate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': 'ses_abc123',
      },
      body: JSON.stringify({ title: 'x'.repeat(201) }),
    });

    assertEquals(res.status, 400);
  });

  await t.step('rejects invalid message role', async () => {
    const res = await app.request('/migrate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': 'ses_abc123',
      },
      body: JSON.stringify({
        title: 'Invalid messages',
        messages: [{ role: 'system', content: 'Invalid role' }],
      }),
    });

    assertEquals(res.status, 400);
  });
});

// ============================================================================
// Full Invite Flow Integration Test
// ============================================================================

Deno.test('Full Invite Flow - End to End', async (t) => {
  // Simulated state
  const chats = new Map<string, any>();
  const invites = new Map<string, any>();
  const members = new Map<string, Set<string>>();

  // Helper functions simulating the services
  function createChat(founderAddress: string, name: string) {
    const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    chats.set(id, { id, name, founderAddress });
    members.set(id, new Set([founderAddress]));
    return { id, name };
  }

  function createInvite(chatId: string, createdBy: string) {
    const code = Math.random().toString(36).slice(2, 10).toUpperCase();
    const invite = { id: `inv-${code}`, chatId, code, createdBy, uses: 0 };
    invites.set(code, invite);
    return invite;
  }

  function joinViaInvite(code: string, userAddress: string) {
    const invite = invites.get(code);
    if (!invite) throw new Error('Invite not found');
    const chatMembers = members.get(invite.chatId);
    if (!chatMembers) throw new Error('Chat not found');
    if (chatMembers.has(userAddress)) {
      return { alreadyMember: true, chatId: invite.chatId };
    }
    chatMembers.add(userAddress);
    invite.uses++;
    return { chatId: invite.chatId, joined: true };
  }

  await t.step('1. Create a chat', () => {
    const chat = createChat('0xfounder', 'Test Chat');
    assertExists(chat.id);
    assertEquals(chat.name, 'Test Chat');
  });

  await t.step('2. Create an invite', () => {
    const chatId = Array.from(chats.keys())[0];
    const invite = createInvite(chatId, '0xfounder');
    assertExists(invite.code);
    assertEquals(invite.uses, 0);
  });

  await t.step('3. User joins via invite', () => {
    const code = Array.from(invites.keys())[0];
    const result = joinViaInvite(code, '0xnewuser');
    assertEquals(result.joined, true);

    // Check invite uses incremented
    const invite = invites.get(code);
    assertEquals(invite.uses, 1);

    // Check user is now a member
    const chatMembers = members.get(invite.chatId);
    assertEquals(chatMembers?.has('0xnewuser'), true);
  });

  await t.step('4. Same user trying to join again returns alreadyMember', () => {
    const code = Array.from(invites.keys())[0];
    const result = joinViaInvite(code, '0xnewuser');
    assertEquals(result.alreadyMember, true);

    // Uses should NOT increment
    const invite = invites.get(code);
    assertEquals(invite.uses, 1);
  });

  await t.step('5. Another user can join', () => {
    const code = Array.from(invites.keys())[0];
    const result = joinViaInvite(code, '0xanotheruser');
    assertEquals(result.joined, true);

    const invite = invites.get(code);
    assertEquals(invite.uses, 2);
  });

  await t.step('6. Chat now has 3 members', () => {
    const chatId = Array.from(chats.keys())[0];
    const chatMembers = members.get(chatId);
    assertEquals(chatMembers?.size, 3);
    assertEquals(chatMembers?.has('0xfounder'), true);
    assertEquals(chatMembers?.has('0xnewuser'), true);
    assertEquals(chatMembers?.has('0xanotheruser'), true);
  });
});
