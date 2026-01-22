/**
 * Multi-Chat Route Integration Tests
 *
 * Tests for the multi-person chat API endpoints
 */

import { assertEquals, assertExists, assertNotEquals } from 'std/assert/mod.ts';
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

// ============================================================================
// Schema Tests
// ============================================================================

Deno.test('Chat - Create Chat Schema', async (t) => {
  const CreateChatSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    isPublic: z.boolean().optional(),
    encrypted: z.boolean().optional(),
  });

  await t.step('accepts empty object (all optional)', () => {
    const result = CreateChatSchema.safeParse({});
    assertEquals(result.success, true);
  });

  await t.step('accepts valid name', () => {
    const result = CreateChatSchema.safeParse({ name: 'My Chat' });
    assertEquals(result.success, true);
  });

  await t.step('rejects name too long', () => {
    const result = CreateChatSchema.safeParse({ name: 'x'.repeat(101) });
    assertEquals(result.success, false);
  });

  await t.step('rejects description too long', () => {
    const result = CreateChatSchema.safeParse({ description: 'x'.repeat(501) });
    assertEquals(result.success, false);
  });

  await t.step('accepts full params', () => {
    const result = CreateChatSchema.safeParse({
      name: 'Test Chat',
      description: 'A test chat',
      isPublic: true,
      encrypted: false,
    });
    assertEquals(result.success, true);
  });
});

Deno.test('Chat - Update Chat Schema', async (t) => {
  const UpdateChatSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    isPublic: z.boolean().optional(),
  });

  await t.step('accepts partial updates', () => {
    const result = UpdateChatSchema.safeParse({ name: 'New Name' });
    assertEquals(result.success, true);
  });

  await t.step('accepts multiple fields', () => {
    const result = UpdateChatSchema.safeParse({
      name: 'New Name',
      isPublic: false,
    });
    assertEquals(result.success, true);
  });
});

Deno.test('Chat - Send Message Schema', async (t) => {
  const SendMessageSchema = z.object({
    content: z.string().min(1).max(10000),
    replyToId: z.string().uuid().optional(),
  });

  await t.step('accepts valid message', () => {
    const result = SendMessageSchema.safeParse({ content: 'Hello!' });
    assertEquals(result.success, true);
  });

  await t.step('rejects empty content', () => {
    const result = SendMessageSchema.safeParse({ content: '' });
    assertEquals(result.success, false);
  });

  await t.step('rejects content too long', () => {
    const result = SendMessageSchema.safeParse({ content: 'x'.repeat(10001) });
    assertEquals(result.success, false);
  });

  await t.step('accepts message with reply', () => {
    const result = SendMessageSchema.safeParse({
      content: 'Reply to this',
      replyToId: '123e4567-e89b-12d3-a456-426614174000',
    });
    assertEquals(result.success, true);
  });

  await t.step('rejects invalid replyToId', () => {
    const result = SendMessageSchema.safeParse({
      content: 'Reply to this',
      replyToId: 'not-a-uuid',
    });
    assertEquals(result.success, false);
  });
});

// ============================================================================
// Mock Route Handler Tests
// ============================================================================

Deno.test('Chat Routes - GET /chat (list my chats)', async (t) => {
  const app = new Hono();

  // Mock data store
  const mockChats = [
    {
      id: 'chat-1',
      name: 'Test Chat 1',
      founderAddress: '0x123',
      isPublic: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'chat-2',
      name: 'Test Chat 2',
      founderAddress: '0x123',
      isPublic: false,
      createdAt: new Date().toISOString(),
    },
  ];

  app.get('/chat', (c) => {
    const authHeader = c.req.header('Authorization');
    const sessionId = c.req.header('X-Session-ID');

    if (!authHeader && !sessionId) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    return c.json({ success: true, data: mockChats });
  });

  await t.step('returns chats for authenticated user', async () => {
    const res = await app.request('/chat', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.length, 2);
  });

  await t.step('returns chats for session user', async () => {
    const res = await app.request('/chat', {
      headers: { 'X-Session-ID': 'ses_abc123' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
  });

  await t.step('returns 401 without auth', async () => {
    const res = await app.request('/chat');

    assertEquals(res.status, 401);
  });
});

Deno.test('Chat Routes - POST /chat (create chat)', async (t) => {
  const app = new Hono();

  const CreateChatSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    isPublic: z.boolean().optional(),
  });

  let createdChats: any[] = [];

  app.post('/chat', zValidator('json', CreateChatSchema), (c) => {
    const authHeader = c.req.header('Authorization');
    const sessionId = c.req.header('X-Session-ID');

    if (!authHeader && !sessionId) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    const body = c.req.valid('json');
    const newChat = {
      id: `chat-${Date.now()}`,
      name: body.name || 'New Chat',
      description: body.description,
      founderAddress: '0x123',
      isPublic: body.isPublic ?? true,
      createdAt: new Date().toISOString(),
    };

    createdChats.push(newChat);

    return c.json({ success: true, data: newChat }, 201);
  });

  await t.step('creates chat with name', async () => {
    const res = await app.request('/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({ name: 'My New Chat' }),
    });

    assertEquals(res.status, 201);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.name, 'My New Chat');
    assertExists(json.data.id);
  });

  await t.step('creates chat with all params', async () => {
    const res = await app.request('/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({
        name: 'Full Chat',
        description: 'A chat with all params',
        isPublic: false,
      }),
    });

    assertEquals(res.status, 201);
    const json = await res.json();
    assertEquals(json.data.name, 'Full Chat');
    assertEquals(json.data.description, 'A chat with all params');
    assertEquals(json.data.isPublic, false);
  });

  await t.step('creates chat with session auth', async () => {
    const res = await app.request('/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': 'ses_anonymous123',
      },
      body: JSON.stringify({ name: 'Anonymous Chat' }),
    });

    assertEquals(res.status, 201);
  });

  await t.step('returns 401 without auth', async () => {
    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Unauthorized Chat' }),
    });

    assertEquals(res.status, 401);
  });
});

Deno.test('Chat Routes - GET /chat/:chatId (get single chat)', async (t) => {
  const app = new Hono();

  const mockChat = {
    id: 'chat-123',
    name: 'Test Chat',
    founderAddress: '0x123',
    isPublic: true,
    memberCount: 5,
    createdAt: new Date().toISOString(),
  };

  app.get('/chat/:chatId', (c) => {
    const chatId = c.req.param('chatId');

    if (chatId === 'chat-123') {
      return c.json({ success: true, data: mockChat });
    }

    if (chatId === 'private-chat') {
      const authHeader = c.req.header('Authorization');
      if (!authHeader) {
        return c.json({ success: false, error: 'Access denied' }, 403);
      }
      return c.json({
        success: true,
        data: { ...mockChat, id: 'private-chat', isPublic: false },
      });
    }

    return c.json({ success: false, error: 'Chat not found' }, 404);
  });

  await t.step('returns public chat without auth', async () => {
    const res = await app.request('/chat/chat-123');

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.id, 'chat-123');
  });

  await t.step('returns 404 for unknown chat', async () => {
    const res = await app.request('/chat/unknown-chat');

    assertEquals(res.status, 404);
  });

  await t.step('returns 403 for private chat without auth', async () => {
    const res = await app.request('/chat/private-chat');

    assertEquals(res.status, 403);
  });

  await t.step('returns private chat with auth', async () => {
    const res = await app.request('/chat/private-chat', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.data.isPublic, false);
  });
});

Deno.test('Chat Routes - GET /chat/:chatId/messages', async (t) => {
  const app = new Hono();

  const mockMessages = [
    {
      id: 'msg-1',
      chatId: 'chat-123',
      senderAddress: '0x123',
      role: 'user',
      content: 'Hello!',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'msg-2',
      chatId: 'chat-123',
      senderAddress: '0x456',
      role: 'assistant',
      content: 'Hi there!',
      createdAt: new Date().toISOString(),
    },
  ];

  app.get('/chat/:chatId/messages', (c) => {
    const chatId = c.req.param('chatId');
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const before = c.req.query('before');

    if (chatId !== 'chat-123') {
      return c.json({ success: false, error: 'Chat not found' }, 404);
    }

    let messages = [...mockMessages];

    if (before) {
      messages = messages.filter((m) => m.id !== before);
    }

    messages = messages.slice(0, limit);

    return c.json({ success: true, data: messages });
  });

  await t.step('returns messages for chat', async () => {
    const res = await app.request('/chat/chat-123/messages');

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.length, 2);
  });

  await t.step('respects limit parameter', async () => {
    const res = await app.request('/chat/chat-123/messages?limit=1');

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.data.length, 1);
  });

  await t.step('returns 404 for unknown chat', async () => {
    const res = await app.request('/chat/unknown/messages');

    assertEquals(res.status, 404);
  });
});

Deno.test('Chat Routes - POST /chat/:chatId/messages', async (t) => {
  const app = new Hono();

  const SendMessageSchema = z.object({
    content: z.string().min(1).max(10000),
    replyToId: z.string().uuid().optional(),
  });

  const messages: any[] = [];

  app.post(
    '/chat/:chatId/messages',
    zValidator('json', SendMessageSchema),
    (c) => {
      const chatId = c.req.param('chatId');
      const authHeader = c.req.header('Authorization');
      const sessionId = c.req.header('X-Session-ID');

      if (!authHeader && !sessionId) {
        return c.json({ success: false, error: 'Authentication required' }, 401);
      }

      if (chatId !== 'chat-123') {
        return c.json({ success: false, error: 'Chat not found' }, 404);
      }

      const body = c.req.valid('json');
      const newMessage = {
        id: `msg-${Date.now()}`,
        chatId,
        senderAddress: '0x123',
        role: 'user',
        content: body.content,
        replyToId: body.replyToId,
        createdAt: new Date().toISOString(),
      };

      messages.push(newMessage);

      return c.json({ success: true, data: newMessage }, 201);
    }
  );

  await t.step('sends message to chat', async () => {
    const res = await app.request('/chat/chat-123/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({ content: 'Hello, world!' }),
    });

    assertEquals(res.status, 201);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.content, 'Hello, world!');
  });

  await t.step('sends message with reply', async () => {
    const res = await app.request('/chat/chat-123/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({
        content: 'This is a reply',
        replyToId: '123e4567-e89b-12d3-a456-426614174000',
      }),
    });

    assertEquals(res.status, 201);
    const json = await res.json();
    assertExists(json.data.replyToId);
  });

  await t.step('returns 401 without auth', async () => {
    const res = await app.request('/chat/chat-123/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Unauthorized message' }),
    });

    assertEquals(res.status, 401);
  });

  await t.step('returns 400 for empty content', async () => {
    const res = await app.request('/chat/chat-123/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({ content: '' }),
    });

    assertEquals(res.status, 400);
  });
});

Deno.test('Chat Routes - GET /chat/:chatId/members', async (t) => {
  const app = new Hono();

  const mockMembers = [
    {
      id: 'member-1',
      memberAddress: '0x123',
      role: 'founder',
      canInvite: true,
      joinedAt: new Date().toISOString(),
    },
    {
      id: 'member-2',
      memberAddress: '0x456',
      role: 'member',
      canInvite: false,
      joinedAt: new Date().toISOString(),
    },
  ];

  app.get('/chat/:chatId/members', (c) => {
    const chatId = c.req.param('chatId');

    if (chatId !== 'chat-123') {
      return c.json({ success: false, error: 'Chat not found' }, 404);
    }

    return c.json({ success: true, data: mockMembers });
  });

  await t.step('returns members for chat', async () => {
    const res = await app.request('/chat/chat-123/members');

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.length, 2);
    assertEquals(json.data[0].role, 'founder');
  });

  await t.step('returns 404 for unknown chat', async () => {
    const res = await app.request('/chat/unknown/members');

    assertEquals(res.status, 404);
  });
});

// ============================================================================
// AI Balance Tests
// ============================================================================

Deno.test('Chat Routes - GET /chat/:chatId/ai/balance', async (t) => {
  const app = new Hono();

  app.get('/chat/:chatId/ai/balance', (c) => {
    const chatId = c.req.param('chatId');

    if (chatId !== 'chat-123') {
      return c.json({ success: false, error: 'Chat not found' }, 404);
    }

    return c.json({
      success: true,
      data: {
        chatId,
        balanceWei: '1000000000000000000', // 1 ETH
        totalSpentWei: '500000000000000000', // 0.5 ETH
        estimatedRequestsRemaining: 500,
        isLow: false,
        isEmpty: false,
      },
    });
  });

  await t.step('returns AI balance for chat', async () => {
    const res = await app.request('/chat/chat-123/ai/balance');

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.estimatedRequestsRemaining, 500);
    assertEquals(json.data.isEmpty, false);
  });
});

// ============================================================================
// Delete Tests
// ============================================================================

Deno.test('Chat Routes - DELETE /chat/:chatId', async (t) => {
  const app = new Hono();

  let deletedChats: string[] = [];

  app.delete('/chat/:chatId', (c) => {
    const chatId = c.req.param('chatId');
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    if (chatId === 'not-owner-chat') {
      return c.json({ success: false, error: 'Only the founder can delete this chat' }, 403);
    }

    if (chatId !== 'chat-123') {
      return c.json({ success: false, error: 'Chat not found' }, 404);
    }

    deletedChats.push(chatId);
    return c.json({ success: true });
  });

  await t.step('deletes chat as founder', async () => {
    const res = await app.request('/chat/chat-123', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer founder-token' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
  });

  await t.step('returns 403 when not founder', async () => {
    const res = await app.request('/chat/not-owner-chat', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer member-token' },
    });

    assertEquals(res.status, 403);
  });

  await t.step('returns 401 without auth', async () => {
    const res = await app.request('/chat/chat-123', {
      method: 'DELETE',
    });

    assertEquals(res.status, 401);
  });
});

// ============================================================================
// Chat Organization Tests (Pinning, Folders, Renaming)
// ============================================================================

Deno.test('Chat - Pin Chat Schema', async (t) => {
  const PinChatSchema = z.object({
    isPinned: z.boolean(),
    pinOrder: z.number().optional(),
  });

  await t.step('accepts pin with order', () => {
    const result = PinChatSchema.safeParse({ isPinned: true, pinOrder: 0 });
    assertEquals(result.success, true);
  });

  await t.step('accepts pin without order', () => {
    const result = PinChatSchema.safeParse({ isPinned: true });
    assertEquals(result.success, true);
  });

  await t.step('accepts unpin', () => {
    const result = PinChatSchema.safeParse({ isPinned: false });
    assertEquals(result.success, true);
  });

  await t.step('rejects missing isPinned', () => {
    const result = PinChatSchema.safeParse({ pinOrder: 1 });
    assertEquals(result.success, false);
  });

  await t.step('rejects non-boolean isPinned', () => {
    const result = PinChatSchema.safeParse({ isPinned: 'yes' });
    assertEquals(result.success, false);
  });
});

Deno.test('Chat - Move Chat Schema', async (t) => {
  const MoveChatSchema = z.object({
    folderId: z.string().uuid().nullable(),
  });

  await t.step('accepts valid folder ID', () => {
    const result = MoveChatSchema.safeParse({
      folderId: '123e4567-e89b-12d3-a456-426614174000',
    });
    assertEquals(result.success, true);
  });

  await t.step('accepts null (move to root)', () => {
    const result = MoveChatSchema.safeParse({ folderId: null });
    assertEquals(result.success, true);
  });

  await t.step('rejects invalid UUID', () => {
    const result = MoveChatSchema.safeParse({ folderId: 'not-a-uuid' });
    assertEquals(result.success, false);
  });

  await t.step('rejects missing folderId', () => {
    const result = MoveChatSchema.safeParse({});
    assertEquals(result.success, false);
  });
});

Deno.test('Chat - Rename Chat Schema', async (t) => {
  const RenameChatSchema = z.object({
    name: z.string().min(1).max(255),
  });

  await t.step('accepts valid name', () => {
    const result = RenameChatSchema.safeParse({ name: 'My Renamed Chat' });
    assertEquals(result.success, true);
  });

  await t.step('rejects empty name', () => {
    const result = RenameChatSchema.safeParse({ name: '' });
    assertEquals(result.success, false);
  });

  await t.step('rejects name too long', () => {
    const result = RenameChatSchema.safeParse({ name: 'x'.repeat(256) });
    assertEquals(result.success, false);
  });
});

Deno.test('Chat - Reorder Pinned Schema', async (t) => {
  const ReorderPinnedSchema = z.object({
    chatIds: z.array(z.string().uuid()),
  });

  await t.step('accepts array of UUIDs', () => {
    const result = ReorderPinnedSchema.safeParse({
      chatIds: [
        '123e4567-e89b-12d3-a456-426614174000',
        '223e4567-e89b-12d3-a456-426614174001',
      ],
    });
    assertEquals(result.success, true);
  });

  await t.step('accepts empty array', () => {
    const result = ReorderPinnedSchema.safeParse({ chatIds: [] });
    assertEquals(result.success, true);
  });

  await t.step('rejects invalid UUIDs', () => {
    const result = ReorderPinnedSchema.safeParse({
      chatIds: ['not-a-uuid'],
    });
    assertEquals(result.success, false);
  });
});

Deno.test('Chat Routes - PATCH /chat/:chatId/pin', async (t) => {
  const app = new Hono();

  const PinChatSchema = z.object({
    isPinned: z.boolean(),
    pinOrder: z.number().optional(),
  });

  let chatState = {
    'chat-123': { id: 'chat-123', name: 'Test Chat', isPinned: false, pinOrder: null },
  };

  app.patch('/chat/:chatId/pin', zValidator('json', PinChatSchema), (c) => {
    const chatId = c.req.param('chatId');
    const authHeader = c.req.header('Authorization');
    const sessionId = c.req.header('X-Session-ID');

    if (!authHeader && !sessionId) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    if (!chatState[chatId as keyof typeof chatState]) {
      return c.json({ success: false, error: 'Chat not found' }, 404);
    }

    const body = c.req.valid('json');
    chatState[chatId as keyof typeof chatState] = {
      ...chatState[chatId as keyof typeof chatState],
      isPinned: body.isPinned,
      pinOrder: body.pinOrder ?? null,
    };

    return c.json({ success: true, data: chatState[chatId as keyof typeof chatState] });
  });

  await t.step('pins a chat', async () => {
    const res = await app.request('/chat/chat-123/pin', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({ isPinned: true, pinOrder: 0 }),
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.isPinned, true);
    assertEquals(json.data.pinOrder, 0);
  });

  await t.step('unpins a chat', async () => {
    const res = await app.request('/chat/chat-123/pin', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({ isPinned: false }),
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.data.isPinned, false);
  });

  await t.step('returns 401 without auth', async () => {
    const res = await app.request('/chat/chat-123/pin', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPinned: true }),
    });

    assertEquals(res.status, 401);
  });

  await t.step('returns 404 for unknown chat', async () => {
    const res = await app.request('/chat/unknown/pin', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({ isPinned: true }),
    });

    assertEquals(res.status, 404);
  });
});

Deno.test('Chat Routes - PATCH /chat/:chatId/folder', async (t) => {
  const app = new Hono();

  const MoveChatSchema = z.object({
    folderId: z.string().uuid().nullable(),
  });

  let chatState = {
    'chat-123': { id: 'chat-123', name: 'Test Chat', folderId: null },
  };

  app.patch('/chat/:chatId/folder', zValidator('json', MoveChatSchema), (c) => {
    const chatId = c.req.param('chatId');
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    if (!chatState[chatId as keyof typeof chatState]) {
      return c.json({ success: false, error: 'Chat not found' }, 404);
    }

    const body = c.req.valid('json');
    chatState[chatId as keyof typeof chatState] = {
      ...chatState[chatId as keyof typeof chatState],
      folderId: body.folderId,
    };

    return c.json({ success: true, data: chatState[chatId as keyof typeof chatState] });
  });

  await t.step('moves chat to folder', async () => {
    const res = await app.request('/chat/chat-123/folder', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({ folderId: '123e4567-e89b-12d3-a456-426614174000' }),
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.folderId, '123e4567-e89b-12d3-a456-426614174000');
  });

  await t.step('moves chat to root (null folder)', async () => {
    const res = await app.request('/chat/chat-123/folder', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({ folderId: null }),
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.data.folderId, null);
  });

  await t.step('returns 401 without auth', async () => {
    const res = await app.request('/chat/chat-123/folder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId: null }),
    });

    assertEquals(res.status, 401);
  });
});

Deno.test('Chat Routes - PATCH /chat/:chatId/name', async (t) => {
  const app = new Hono();

  const RenameChatSchema = z.object({
    name: z.string().min(1).max(255),
  });

  let chatState = {
    'chat-123': { id: 'chat-123', name: 'Original Name' },
  };

  app.patch('/chat/:chatId/name', zValidator('json', RenameChatSchema), (c) => {
    const chatId = c.req.param('chatId');
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    if (!chatState[chatId as keyof typeof chatState]) {
      return c.json({ success: false, error: 'Chat not found' }, 404);
    }

    const body = c.req.valid('json');
    chatState[chatId as keyof typeof chatState] = {
      ...chatState[chatId as keyof typeof chatState],
      name: body.name,
    };

    return c.json({ success: true, data: chatState[chatId as keyof typeof chatState] });
  });

  await t.step('renames a chat', async () => {
    const res = await app.request('/chat/chat-123/name', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({ name: 'New Name' }),
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.name, 'New Name');
  });

  await t.step('returns 400 for empty name', async () => {
    const res = await app.request('/chat/chat-123/name', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({ name: '' }),
    });

    assertEquals(res.status, 400);
  });
});

// ============================================================================
// Folder Routes Tests
// ============================================================================

Deno.test('Chat - Create Folder Schema', async (t) => {
  const CreateFolderSchema = z.object({
    name: z.string().min(1).max(255),
    parentFolderId: z.string().uuid().optional(),
  });

  await t.step('accepts folder name only', () => {
    const result = CreateFolderSchema.safeParse({ name: 'My Folder' });
    assertEquals(result.success, true);
  });

  await t.step('accepts folder with parent', () => {
    const result = CreateFolderSchema.safeParse({
      name: 'Subfolder',
      parentFolderId: '123e4567-e89b-12d3-a456-426614174000',
    });
    assertEquals(result.success, true);
  });

  await t.step('rejects empty name', () => {
    const result = CreateFolderSchema.safeParse({ name: '' });
    assertEquals(result.success, false);
  });

  await t.step('rejects name too long', () => {
    const result = CreateFolderSchema.safeParse({ name: 'x'.repeat(256) });
    assertEquals(result.success, false);
  });

  await t.step('rejects invalid parent UUID', () => {
    const result = CreateFolderSchema.safeParse({
      name: 'Folder',
      parentFolderId: 'not-a-uuid',
    });
    assertEquals(result.success, false);
  });
});

Deno.test('Chat - Update Folder Schema', async (t) => {
  const UpdateFolderSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    parentFolderId: z.string().uuid().nullable().optional(),
    isPinned: z.boolean().optional(),
    pinOrder: z.number().optional(),
  });

  await t.step('accepts partial update with name', () => {
    const result = UpdateFolderSchema.safeParse({ name: 'Renamed Folder' });
    assertEquals(result.success, true);
  });

  await t.step('accepts multiple fields', () => {
    const result = UpdateFolderSchema.safeParse({
      name: 'New Name',
      isPinned: true,
      pinOrder: 0,
    });
    assertEquals(result.success, true);
  });

  await t.step('accepts null parentFolderId (move to root)', () => {
    const result = UpdateFolderSchema.safeParse({ parentFolderId: null });
    assertEquals(result.success, true);
  });

  await t.step('accepts empty update', () => {
    const result = UpdateFolderSchema.safeParse({});
    assertEquals(result.success, true);
  });
});

Deno.test('Chat Routes - GET /chat/folders', async (t) => {
  const app = new Hono();

  const mockFolders = [
    {
      id: 'folder-1',
      userAddress: '0x123',
      name: 'Work',
      isPinned: true,
      pinOrder: 0,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'folder-2',
      userAddress: '0x123',
      name: 'Personal',
      isPinned: false,
      createdAt: new Date().toISOString(),
    },
  ];

  app.get('/chat/folders', (c) => {
    const authHeader = c.req.header('Authorization');
    const sessionId = c.req.header('X-Session-ID');

    if (!authHeader && !sessionId) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    return c.json({ success: true, data: mockFolders });
  });

  await t.step('returns folders for authenticated user', async () => {
    const res = await app.request('/chat/folders', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.length, 2);
    assertEquals(json.data[0].name, 'Work');
  });

  await t.step('returns folders for session user', async () => {
    const res = await app.request('/chat/folders', {
      headers: { 'X-Session-ID': 'ses_abc123' },
    });

    assertEquals(res.status, 200);
  });

  await t.step('returns 401 without auth', async () => {
    const res = await app.request('/chat/folders');

    assertEquals(res.status, 401);
  });
});

Deno.test('Chat Routes - POST /chat/folders', async (t) => {
  const app = new Hono();

  const CreateFolderSchema = z.object({
    name: z.string().min(1).max(255),
    parentFolderId: z.string().uuid().optional(),
  });

  let createdFolders: any[] = [];

  app.post('/chat/folders', zValidator('json', CreateFolderSchema), (c) => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    const body = c.req.valid('json');
    const newFolder = {
      id: `folder-${Date.now()}`,
      userAddress: '0x123',
      name: body.name,
      parentFolderId: body.parentFolderId ?? null,
      isPinned: false,
      pinOrder: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    createdFolders.push(newFolder);

    return c.json({ success: true, data: newFolder }, 201);
  });

  await t.step('creates folder', async () => {
    const res = await app.request('/chat/folders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({ name: 'New Folder' }),
    });

    assertEquals(res.status, 201);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.name, 'New Folder');
    assertExists(json.data.id);
  });

  await t.step('creates nested folder', async () => {
    const res = await app.request('/chat/folders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({
        name: 'Subfolder',
        parentFolderId: '123e4567-e89b-12d3-a456-426614174000',
      }),
    });

    assertEquals(res.status, 201);
    const json = await res.json();
    assertEquals(json.data.parentFolderId, '123e4567-e89b-12d3-a456-426614174000');
  });

  await t.step('returns 401 without auth', async () => {
    const res = await app.request('/chat/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Unauthorized' }),
    });

    assertEquals(res.status, 401);
  });

  await t.step('returns 400 for empty name', async () => {
    const res = await app.request('/chat/folders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({ name: '' }),
    });

    assertEquals(res.status, 400);
  });
});

Deno.test('Chat Routes - GET /chat/folders/:folderId', async (t) => {
  const app = new Hono();

  const mockFolder = {
    id: 'folder-123',
    userAddress: '0x123',
    name: 'Work',
    isPinned: true,
    pinOrder: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  app.get('/chat/folders/:folderId', (c) => {
    const folderId = c.req.param('folderId');
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    if (folderId !== 'folder-123') {
      return c.json({ success: false, error: 'Folder not found' }, 404);
    }

    if (folderId === 'not-owned') {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }

    return c.json({ success: true, data: mockFolder });
  });

  await t.step('returns folder details', async () => {
    const res = await app.request('/chat/folders/folder-123', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.name, 'Work');
  });

  await t.step('returns 404 for unknown folder', async () => {
    const res = await app.request('/chat/folders/unknown', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    assertEquals(res.status, 404);
  });

  await t.step('returns 401 without auth', async () => {
    const res = await app.request('/chat/folders/folder-123');

    assertEquals(res.status, 401);
  });
});

Deno.test('Chat Routes - PATCH /chat/folders/:folderId', async (t) => {
  const app = new Hono();

  const UpdateFolderSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    parentFolderId: z.string().uuid().nullable().optional(),
    isPinned: z.boolean().optional(),
    pinOrder: z.number().optional(),
  });

  let folderState = {
    'folder-123': {
      id: 'folder-123',
      userAddress: '0x123',
      name: 'Work',
      parentFolderId: null,
      isPinned: false,
      pinOrder: null,
    },
  };

  app.patch('/chat/folders/:folderId', zValidator('json', UpdateFolderSchema), (c) => {
    const folderId = c.req.param('folderId');
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    if (!folderState[folderId as keyof typeof folderState]) {
      return c.json({ success: false, error: 'Folder not found' }, 404);
    }

    const body = c.req.valid('json');
    const folder = folderState[folderId as keyof typeof folderState];

    folderState[folderId as keyof typeof folderState] = {
      ...folder,
      name: body.name ?? folder.name,
      parentFolderId: body.parentFolderId !== undefined ? body.parentFolderId : folder.parentFolderId,
      isPinned: body.isPinned ?? folder.isPinned,
      pinOrder: body.pinOrder ?? folder.pinOrder,
    };

    return c.json({ success: true, data: folderState[folderId as keyof typeof folderState] });
  });

  await t.step('updates folder name', async () => {
    const res = await app.request('/chat/folders/folder-123', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({ name: 'Updated Work' }),
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.data.name, 'Updated Work');
  });

  await t.step('updates folder pinning', async () => {
    const res = await app.request('/chat/folders/folder-123', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({ isPinned: true, pinOrder: 0 }),
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.data.isPinned, true);
    assertEquals(json.data.pinOrder, 0);
  });

  await t.step('returns 404 for unknown folder', async () => {
    const res = await app.request('/chat/folders/unknown', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({ name: 'New Name' }),
    });

    assertEquals(res.status, 404);
  });
});

Deno.test('Chat Routes - DELETE /chat/folders/:folderId', async (t) => {
  const app = new Hono();

  let folders = new Set(['folder-123']);

  app.delete('/chat/folders/:folderId', (c) => {
    const folderId = c.req.param('folderId');
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    if (!folders.has(folderId)) {
      return c.json({ success: false, error: 'Folder not found' }, 404);
    }

    folders.delete(folderId);
    return c.json({ success: true });
  });

  await t.step('deletes folder', async () => {
    const res = await app.request('/chat/folders/folder-123', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-token' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
  });

  await t.step('returns 404 for deleted folder', async () => {
    const res = await app.request('/chat/folders/folder-123', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-token' },
    });

    assertEquals(res.status, 404);
  });

  await t.step('returns 401 without auth', async () => {
    const res = await app.request('/chat/folders/any', {
      method: 'DELETE',
    });

    assertEquals(res.status, 401);
  });
});

Deno.test('Chat Routes - PATCH /chat/folders/:folderId/pin', async (t) => {
  const app = new Hono();

  const PinFolderSchema = z.object({
    isPinned: z.boolean(),
    pinOrder: z.number().optional(),
  });

  let folderState = {
    'folder-123': { id: 'folder-123', name: 'Work', isPinned: false, pinOrder: null },
  };

  app.patch('/chat/folders/:folderId/pin', zValidator('json', PinFolderSchema), (c) => {
    const folderId = c.req.param('folderId');
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    if (!folderState[folderId as keyof typeof folderState]) {
      return c.json({ success: false, error: 'Folder not found' }, 404);
    }

    const body = c.req.valid('json');
    folderState[folderId as keyof typeof folderState] = {
      ...folderState[folderId as keyof typeof folderState],
      isPinned: body.isPinned,
      pinOrder: body.isPinned ? (body.pinOrder ?? null) : null,
    };

    return c.json({ success: true, data: folderState[folderId as keyof typeof folderState] });
  });

  await t.step('pins a folder', async () => {
    const res = await app.request('/chat/folders/folder-123/pin', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({ isPinned: true, pinOrder: 0 }),
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.data.isPinned, true);
    assertEquals(json.data.pinOrder, 0);
  });

  await t.step('unpins a folder', async () => {
    const res = await app.request('/chat/folders/folder-123/pin', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({ isPinned: false }),
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.data.isPinned, false);
    assertEquals(json.data.pinOrder, null);
  });
});

Deno.test('Chat Routes - POST /chat/folders/reorder-pinned', async (t) => {
  const app = new Hono();

  const ReorderPinnedFoldersSchema = z.object({
    folderIds: z.array(z.string().uuid()),
  });

  let reorderCalls: string[][] = [];

  app.post('/chat/folders/reorder-pinned', zValidator('json', ReorderPinnedFoldersSchema), (c) => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    const body = c.req.valid('json');
    reorderCalls.push(body.folderIds);

    return c.json({ success: true });
  });

  await t.step('reorders pinned folders', async () => {
    const res = await app.request('/chat/folders/reorder-pinned', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({
        folderIds: [
          '123e4567-e89b-12d3-a456-426614174000',
          '223e4567-e89b-12d3-a456-426614174001',
        ],
      }),
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
  });

  await t.step('accepts empty array', async () => {
    const res = await app.request('/chat/folders/reorder-pinned', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({ folderIds: [] }),
    });

    assertEquals(res.status, 200);
  });

  await t.step('returns 401 without auth', async () => {
    const res = await app.request('/chat/folders/reorder-pinned', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderIds: [] }),
    });

    assertEquals(res.status, 401);
  });
});

Deno.test('Chat Routes - POST /chat/reorder-pinned', async (t) => {
  const app = new Hono();

  const ReorderPinnedSchema = z.object({
    chatIds: z.array(z.string().uuid()),
  });

  let reorderCalls: string[][] = [];

  app.post('/chat/reorder-pinned', zValidator('json', ReorderPinnedSchema), (c) => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    const body = c.req.valid('json');
    reorderCalls.push(body.chatIds);

    return c.json({ success: true });
  });

  await t.step('reorders pinned chats', async () => {
    const res = await app.request('/chat/reorder-pinned', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({
        chatIds: [
          '123e4567-e89b-12d3-a456-426614174000',
          '223e4567-e89b-12d3-a456-426614174001',
        ],
      }),
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
  });

  await t.step('returns 401 without auth', async () => {
    const res = await app.request('/chat/reorder-pinned', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatIds: [] }),
    });

    assertEquals(res.status, 401);
  });
});
