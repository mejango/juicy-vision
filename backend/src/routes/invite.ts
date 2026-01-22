/**
 * Chat Invite Routes
 *
 * Create and manage shareable invite links for chats
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { optionalAuth } from '../middleware/auth.ts';
import { queryOne } from '../db/index.ts';
import {
  createInvite,
  getInviteByCode,
  getInvitesForChat,
  isInviteValid,
  useInvite,
  revokeInvite,
  createChatEvent,
} from '../services/invite.ts';
import {
  getChatById,
  getMember,
  addMemberViaInvite,
  checkPermission,
} from '../services/chat.ts';
import { broadcastToChat } from '../services/websocket.ts';

export const inviteRouter = new Hono();

// ============================================================================
// Middleware
// ============================================================================

interface WalletSession {
  address: string;
  userId?: string;
  sessionId?: string;
  isAnonymous?: boolean;
}

declare module 'hono' {
  interface ContextVariableMap {
    walletSession?: WalletSession;
  }
}

async function extractWalletSession(
  authHeader: string | undefined,
  sessionToken: string | undefined
): Promise<WalletSession | null> {
  const token = sessionToken || authHeader?.replace('Bearer ', '');
  if (!token) return null;

  const session = await queryOne<{
    wallet_address: string;
    expires_at: Date;
  }>(
    `SELECT wallet_address, expires_at FROM wallet_sessions
     WHERE session_token = $1 AND expires_at > NOW()`,
    [token]
  );

  if (session) {
    const user = await queryOne<{ id: string }>(
      `SELECT u.id FROM users u
       JOIN multi_chat_members mcm ON mcm.member_user_id = u.id
       WHERE mcm.member_address = $1
       LIMIT 1`,
      [session.wallet_address]
    );

    return {
      address: session.wallet_address,
      userId: user?.id,
    };
  }

  return null;
}

async function requireWalletOrAuth(c: any, next: any) {
  const authHeader = c.req.header('Authorization');
  const user = c.get('user');

  if (user) {
    const { getCustodialAddress } = await import('../services/wallet.ts');
    const address = await getCustodialAddress(user.custodialAddressIndex ?? 0);
    c.set('walletSession', { address, userId: user.id } as WalletSession);
    return next();
  }

  const sessionToken = c.req.query('session') || c.req.header('X-Wallet-Session');
  const walletSession = await extractWalletSession(authHeader, sessionToken);

  if (walletSession) {
    c.set('walletSession', walletSession);
    return next();
  }

  // Try anonymous session (X-Session-ID header)
  const sessionId = c.req.header('X-Session-ID');
  if (sessionId && sessionId.startsWith('ses_')) {
    // Create a pseudo-address from the session ID for anonymous users
    const pseudoAddress = `0x${sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40).padStart(40, '0')}`;
    c.set('walletSession', {
      address: pseudoAddress,
      sessionId,
      isAnonymous: true,
    } as WalletSession);
    return next();
  }

  return c.json({ success: false, error: 'Authentication required' }, 401);
}

// ============================================================================
// Invite Routes
// ============================================================================

const CreateInviteSchema = z.object({
  canSendMessages: z.boolean().default(true),
  canInviteOthers: z.boolean().default(false),
  canPassOnRoles: z.boolean().default(false),
});

/**
 * POST /chat/:chatId/invites - Create an invite link
 */
inviteRouter.post(
  '/:chatId/invites',
  optionalAuth,
  requireWalletOrAuth,
  zValidator('json', CreateInviteSchema),
  async (c) => {
    const chatId = c.req.param('chatId');
    const walletSession = c.get('walletSession')!;
    const body = c.req.valid('json');

    // Check chat exists
    const chat = await getChatById(chatId);
    if (!chat) {
      return c.json({ success: false, error: 'Chat not found' }, 404);
    }

    // Check user has invite permission
    const member = await getMember(chatId, walletSession.address);
    if (!member) {
      return c.json({ success: false, error: 'Not a member of this chat' }, 403);
    }

    // Only founders and admins can create invites, or members with canInviteOthers
    const canInvite =
      member.role === 'founder' ||
      member.role === 'admin' ||
      member.canInviteOthers;

    if (!canInvite) {
      return c.json({ success: false, error: 'No permission to create invites' }, 403);
    }

    // Can't grant canPassOnRoles if you don't have that permission (unless founder/admin)
    if (body.canPassOnRoles && member.role !== 'founder' && member.role !== 'admin' && !member.canPassOnRoles) {
      return c.json({ success: false, error: 'Cannot grant role assignment permission' }, 403);
    }

    try {
      const invite = await createInvite({
        chatId,
        createdBy: walletSession.userId || walletSession.address,
        canSendMessages: body.canSendMessages,
        canInviteOthers: body.canInviteOthers,
        canPassOnRoles: body.canPassOnRoles,
        maxUses: body.maxUses ?? null,
      });

      // Create system event
      const event = await createChatEvent(
        chatId,
        'invite_created',
        walletSession.userId || walletSession.address,
        undefined,
        {
          inviteCode: invite.code,
          canSendMessages: invite.canSendMessages,
          canInviteOthers: invite.canInviteOthers,
          canPassOnRoles: invite.canPassOnRoles,
        }
      );

      // Broadcast event to chat
      broadcastToChat(chatId, {
        type: 'system_event',
        chatId,
        data: {
          id: event.id,
          eventType: event.eventType,
          actorId: event.actorId,
          metadata: event.metadata,
          createdAt: event.createdAt,
        },
      });

      // Generate full invite URL (using hash router format)
      const baseUrl = c.req.header('origin') || 'https://juicyvision.app';
      const inviteUrl = `${baseUrl}/#/join/${invite.code}`;

      return c.json({
        success: true,
        data: {
          ...invite,
          inviteUrl,
        },
      });
    } catch (error) {
      console.error('[Invite] Failed to create:', error);
      return c.json({ success: false, error: 'Failed to create invite' }, 500);
    }
  }
);

/**
 * GET /chat/:chatId/invites - List invites for a chat
 */
inviteRouter.get(
  '/:chatId/invites',
  optionalAuth,
  requireWalletOrAuth,
  async (c) => {
    const chatId = c.req.param('chatId');
    const walletSession = c.get('walletSession')!;

    // Check member has admin/founder role
    const member = await getMember(chatId, walletSession.address);
    if (!member || (member.role !== 'founder' && member.role !== 'admin')) {
      return c.json({ success: false, error: 'Admin access required' }, 403);
    }

    const invites = await getInvitesForChat(chatId);
    return c.json({ success: true, data: invites });
  }
);

/**
 * DELETE /chat/:chatId/invites/:inviteId - Revoke an invite
 */
inviteRouter.delete(
  '/:chatId/invites/:inviteId',
  optionalAuth,
  requireWalletOrAuth,
  async (c) => {
    const chatId = c.req.param('chatId');
    const inviteId = c.req.param('inviteId');
    const walletSession = c.get('walletSession')!;

    // Check member has admin/founder role
    const member = await getMember(chatId, walletSession.address);
    if (!member || (member.role !== 'founder' && member.role !== 'admin')) {
      return c.json({ success: false, error: 'Admin access required' }, 403);
    }

    await revokeInvite(inviteId);
    return c.json({ success: true });
  }
);

/**
 * GET /invite/:code - Get invite info (public endpoint)
 */
inviteRouter.get('/invite/:code', async (c) => {
  const code = c.req.param('code');
  const invite = await getInviteByCode(code);

  if (!invite) {
    return c.json({ success: false, error: 'Invite not found' }, 404);
  }

  if (!isInviteValid(invite)) {
    return c.json({ success: false, error: 'Invite has expired or reached max uses' }, 410);
  }

  // Get chat info
  const chat = await getChatById(invite.chatId);
  if (!chat) {
    return c.json({ success: false, error: 'Chat no longer exists' }, 404);
  }

  return c.json({
    success: true,
    data: {
      chatId: chat.id,
      chatName: chat.name,
      chatDescription: chat.description,
      canSendMessages: invite.canSendMessages,
      canInviteOthers: invite.canInviteOthers,
      canPassOnRoles: invite.canPassOnRoles,
    },
  });
});

/**
 * POST /invite/:code/join - Join a chat via invite
 */
inviteRouter.post(
  '/invite/:code/join',
  optionalAuth,
  requireWalletOrAuth,
  async (c) => {
    const code = c.req.param('code');
    const walletSession = c.get('walletSession')!;

    const invite = await getInviteByCode(code);
    if (!invite) {
      return c.json({ success: false, error: 'Invite not found' }, 404);
    }

    if (!isInviteValid(invite)) {
      return c.json({ success: false, error: 'Invite has expired or reached max uses' }, 410);
    }

    // Check if already a member - if so, just take them to the chat
    const existingMember = await getMember(invite.chatId, walletSession.address);
    if (existingMember) {
      const chat = await getChatById(invite.chatId);
      return c.json({
        success: true,
        data: {
          chatId: invite.chatId,
          chatName: chat?.name,
          alreadyMember: true,
        },
      });
    }

    try {
      // Add member with invite permissions
      await addMemberViaInvite(invite.chatId, {
        address: walletSession.address,
        userId: walletSession.userId,
        role: 'member',
        canSendMessages: invite.canSendMessages,
        canInviteOthers: invite.canInviteOthers,
      });

      // Increment invite uses
      await useInvite(invite.id);

      // Create system event for join
      const event = await createChatEvent(
        invite.chatId,
        'user_joined',
        walletSession.userId || walletSession.address,
        undefined,
        {
          viaInvite: true,
          inviteCode: code,
        }
      );

      // Broadcast join event
      broadcastToChat(invite.chatId, {
        type: 'system_event',
        chatId: invite.chatId,
        data: {
          id: event.id,
          eventType: event.eventType,
          actorId: event.actorId,
          actorAddress: walletSession.address,
          metadata: event.metadata,
          createdAt: event.createdAt,
        },
      });

      // Also broadcast member_joined for UI updates
      broadcastToChat(invite.chatId, {
        type: 'member_joined',
        chatId: invite.chatId,
        data: {
          address: walletSession.address,
          canPassOnRoles: invite.canPassOnRoles,
          joinedAt: new Date().toISOString(),
        },
      });

      const chat = await getChatById(invite.chatId);

      return c.json({
        success: true,
        data: {
          chatId: invite.chatId,
          chatName: chat?.name,
          canPassOnRoles: invite.canPassOnRoles,
        },
      });
    } catch (error: any) {
      // Handle duplicate key error (race condition - user already joined)
      if (error?.code === '23505' || error?.message?.includes('Already a member') || error?.message?.includes('duplicate key')) {
        const chat = await getChatById(invite.chatId);
        return c.json({
          success: true,
          data: {
            chatId: invite.chatId,
            chatName: chat?.name,
            alreadyMember: true,
          },
        });
      }
      console.error('[Invite] Failed to join:', error);
      return c.json({ success: false, error: 'Failed to join chat' }, 500);
    }
  }
);

/**
 * GET /chat/:chatId/events - Get system events for chat
 */
inviteRouter.get(
  '/:chatId/events',
  optionalAuth,
  async (c) => {
    const chatId = c.req.param('chatId');
    const limit = parseInt(c.req.query('limit') || '50', 10);

    const chat = await getChatById(chatId);
    if (!chat) {
      return c.json({ success: false, error: 'Chat not found' }, 404);
    }

    // Check read permission for private chats
    const walletSession = c.get('walletSession');
    if (!chat.isPublic && walletSession) {
      const canRead = await checkPermission(chatId, walletSession.address, 'read');
      if (!canRead) {
        return c.json({ success: false, error: 'Access denied' }, 403);
      }
    }

    const { getChatEvents } = await import('../services/invite.ts');
    const events = await getChatEvents(chatId, limit);

    return c.json({ success: true, data: events });
  }
);
