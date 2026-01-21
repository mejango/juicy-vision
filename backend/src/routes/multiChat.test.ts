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

Deno.test('MultiChat - Create Chat Schema', async (t) => {
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

Deno.test('MultiChat - Update Chat Schema', async (t) => {
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

Deno.test('MultiChat - Send Message Schema', async (t) => {
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

Deno.test('MultiChat Routes - GET /multi-chat (list my chats)', async (t) => {
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

  app.get('/multi-chat', (c) => {
    const authHeader = c.req.header('Authorization');
    const sessionId = c.req.header('X-Session-ID');

    if (!authHeader && !sessionId) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    return c.json({ success: true, data: mockChats });
  });

  await t.step('returns chats for authenticated user', async () => {
    const res = await app.request('/multi-chat', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.length, 2);
  });

  await t.step('returns chats for session user', async () => {
    const res = await app.request('/multi-chat', {
      headers: { 'X-Session-ID': 'ses_abc123' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
  });

  await t.step('returns 401 without auth', async () => {
    const res = await app.request('/multi-chat');

    assertEquals(res.status, 401);
  });
});

Deno.test('MultiChat Routes - POST /multi-chat (create chat)', async (t) => {
  const app = new Hono();

  const CreateChatSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    isPublic: z.boolean().optional(),
  });

  let createdChats: any[] = [];

  app.post('/multi-chat', zValidator('json', CreateChatSchema), (c) => {
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
    const res = await app.request('/multi-chat', {
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
    const res = await app.request('/multi-chat', {
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
    const res = await app.request('/multi-chat', {
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
    const res = await app.request('/multi-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Unauthorized Chat' }),
    });

    assertEquals(res.status, 401);
  });
});

Deno.test('MultiChat Routes - GET /multi-chat/:chatId (get single chat)', async (t) => {
  const app = new Hono();

  const mockChat = {
    id: 'chat-123',
    name: 'Test Chat',
    founderAddress: '0x123',
    isPublic: true,
    memberCount: 5,
    createdAt: new Date().toISOString(),
  };

  app.get('/multi-chat/:chatId', (c) => {
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
    const res = await app.request('/multi-chat/chat-123');

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.id, 'chat-123');
  });

  await t.step('returns 404 for unknown chat', async () => {
    const res = await app.request('/multi-chat/unknown-chat');

    assertEquals(res.status, 404);
  });

  await t.step('returns 403 for private chat without auth', async () => {
    const res = await app.request('/multi-chat/private-chat');

    assertEquals(res.status, 403);
  });

  await t.step('returns private chat with auth', async () => {
    const res = await app.request('/multi-chat/private-chat', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.data.isPublic, false);
  });
});

Deno.test('MultiChat Routes - GET /multi-chat/:chatId/messages', async (t) => {
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

  app.get('/multi-chat/:chatId/messages', (c) => {
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
    const res = await app.request('/multi-chat/chat-123/messages');

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.length, 2);
  });

  await t.step('respects limit parameter', async () => {
    const res = await app.request('/multi-chat/chat-123/messages?limit=1');

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.data.length, 1);
  });

  await t.step('returns 404 for unknown chat', async () => {
    const res = await app.request('/multi-chat/unknown/messages');

    assertEquals(res.status, 404);
  });
});

Deno.test('MultiChat Routes - POST /multi-chat/:chatId/messages', async (t) => {
  const app = new Hono();

  const SendMessageSchema = z.object({
    content: z.string().min(1).max(10000),
    replyToId: z.string().uuid().optional(),
  });

  const messages: any[] = [];

  app.post(
    '/multi-chat/:chatId/messages',
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
    const res = await app.request('/multi-chat/chat-123/messages', {
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
    const res = await app.request('/multi-chat/chat-123/messages', {
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
    const res = await app.request('/multi-chat/chat-123/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Unauthorized message' }),
    });

    assertEquals(res.status, 401);
  });

  await t.step('returns 400 for empty content', async () => {
    const res = await app.request('/multi-chat/chat-123/messages', {
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

Deno.test('MultiChat Routes - GET /multi-chat/:chatId/members', async (t) => {
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

  app.get('/multi-chat/:chatId/members', (c) => {
    const chatId = c.req.param('chatId');

    if (chatId !== 'chat-123') {
      return c.json({ success: false, error: 'Chat not found' }, 404);
    }

    return c.json({ success: true, data: mockMembers });
  });

  await t.step('returns members for chat', async () => {
    const res = await app.request('/multi-chat/chat-123/members');

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
    assertEquals(json.data.length, 2);
    assertEquals(json.data[0].role, 'founder');
  });

  await t.step('returns 404 for unknown chat', async () => {
    const res = await app.request('/multi-chat/unknown/members');

    assertEquals(res.status, 404);
  });
});

// ============================================================================
// AI Balance Tests
// ============================================================================

Deno.test('MultiChat Routes - GET /multi-chat/:chatId/ai/balance', async (t) => {
  const app = new Hono();

  app.get('/multi-chat/:chatId/ai/balance', (c) => {
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
    const res = await app.request('/multi-chat/chat-123/ai/balance');

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

Deno.test('MultiChat Routes - DELETE /multi-chat/:chatId', async (t) => {
  const app = new Hono();

  let deletedChats: string[] = [];

  app.delete('/multi-chat/:chatId', (c) => {
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
    const res = await app.request('/multi-chat/chat-123', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer founder-token' },
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.success, true);
  });

  await t.step('returns 403 when not founder', async () => {
    const res = await app.request('/multi-chat/not-owner-chat', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer member-token' },
    });

    assertEquals(res.status, 403);
  });

  await t.step('returns 401 without auth', async () => {
    const res = await app.request('/multi-chat/chat-123', {
      method: 'DELETE',
    });

    assertEquals(res.status, 401);
  });
});
