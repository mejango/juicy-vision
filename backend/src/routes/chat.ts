/**
 * Chat API Routes
 *
 * Supports both:
 * - Authenticated users (JWT token) with managed wallets
 * - External wallets (SIWE session) for self-custody users
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { upgradeWebSocket } from 'hono/deno';
import { requireAuth, optionalAuth } from '../middleware/auth.ts';
import {
  createChat,
  getChatById,
  getChatsForAddress,
  getPublicChats,
  getChatMembers,
  getMember,
  addMember,
  removeMember,
  updateMemberPermissions,
  sendMessage,
  getChatMessages,
  deleteMessage,
  checkPermission,
  submitFeedback,
  pinChat,
  unpinChat,
  moveChatToFolder,
  reorderPinnedChats,
  updateChatName,
  deleteChat,
  type ChatFolder,
  createFolder,
  getFolder,
  getFoldersForUser,
  updateFolder,
  deleteFolder,
  pinFolder,
  unpinFolder,
  reorderPinnedFolders,
  type CreateChatParams,
  type JuicyRating,
} from '../services/chat.ts';
import {
  getAiBalanceStatus,
  canInvokeAi,
  generateSqueezePayment,
  encodePayCalldata,
  confirmPayment,
  getBillingHistory,
  getSqueezePromptMessage,
  AI_PRICING,
  SUPPORTED_CHAINS,
} from '../services/aiBilling.ts';
import {
  archiveChat,
  fetchArchivedChat,
  getLatestArchiveCid,
} from '../services/ipfs.ts';
import {
  registerConnection,
  removeConnection,
  handleWsMessage,
  getOnlineMembers,
  type WsClient,
} from '../services/websocket.ts';
import { queryOne, execute } from '../db/index.ts';
import { getConfig } from '../utils/config.ts';

const chatRouter = new Hono();

// ============================================================================
// Middleware - Wallet Session Auth
// ============================================================================

interface WalletSession {
  address: string;
  userId?: string; // Linked user ID if managed wallet
  sessionId?: string; // Anonymous session ID
  isAnonymous?: boolean;
}

declare module 'hono' {
  interface ContextVariableMap {
    walletSession?: WalletSession;
  }
}

/**
 * Extract wallet session from header or query param
 */
async function extractWalletSession(
  authHeader: string | undefined,
  sessionToken: string | undefined
): Promise<WalletSession | null> {
  const token = sessionToken || authHeader?.replace('Bearer ', '');
  if (!token) return null;

  // First try JWT token validation (for managed wallets)
  const { validateSession } = await import('../services/auth.ts');
  const { getCustodialAddress } = await import('../services/wallet.ts');

  const jwtResult = await validateSession(token);
  if (jwtResult) {
    const address = await getCustodialAddress(jwtResult.user.custodialAddressIndex ?? 0);
    return {
      address,
      userId: jwtResult.user.id,
    };
  }

  // Try SIWE session token (for self-custody wallets)
  const session = await queryOne<{
    wallet_address: string;
    expires_at: Date;
  }>(
    `SELECT wallet_address, expires_at FROM wallet_sessions
     WHERE session_token = $1 AND expires_at > NOW()`,
    [token]
  );

  if (session) {
    // Check if this wallet is linked to a user
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

/**
 * Middleware that requires wallet session OR user auth OR anonymous session
 * Anonymous sessions use X-Session-ID header and get a pseudo-address
 */
async function requireWalletOrAuth(c: any, next: any) {
  // First try JWT auth
  const authHeader = c.req.header('Authorization');
  const user = c.get('user');

  if (user) {
    // User authenticated - get their custodial address
    const { getCustodialAddress } = await import('../services/wallet.ts');
    const address = await getCustodialAddress(user.custodialAddressIndex ?? 0);
    c.set('walletSession', { address, userId: user.id } as WalletSession);
    return next();
  }

  // Try wallet session
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
    // This allows them to own chats and create invites
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

/**
 * Middleware that optionally extracts wallet session without requiring it
 * Used for endpoints that have different behavior for authenticated vs anonymous users
 */
async function optionalWalletSession(c: any, next: any) {
  // First check if user is already authenticated via JWT
  const user = c.get('user');
  const authHeader = c.req.header('Authorization');

  if (user) {
    // User authenticated - get their custodial address
    const { getCustodialAddress } = await import('../services/wallet.ts');
    const address = await getCustodialAddress(user.custodialAddressIndex ?? 0);
    c.set('walletSession', { address, userId: user.id } as WalletSession);
    return next();
  }

  // Try wallet session (SIWE)
  const sessionToken = c.req.query('session') || c.req.header('X-Wallet-Session');
  const walletSession = await extractWalletSession(authHeader, sessionToken);

  if (walletSession) {
    c.set('walletSession', walletSession);
    return next();
  }

  // Try anonymous session (X-Session-ID header)
  const sessionId = c.req.header('X-Session-ID');
  if (sessionId && sessionId.startsWith('ses_')) {
    const pseudoAddress = `0x${sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40).padStart(40, '0')}`;
    c.set('walletSession', {
      address: pseudoAddress,
      sessionId,
      isAnonymous: true,
    } as WalletSession);
  }

  // Continue even if no session found
  return next();
}

// ============================================================================
// Chat CRUD Routes
// ============================================================================

const CreateChatSchema = z.object({
  name: z.string().max(255).optional(),
  description: z.string().max(2000).optional(),
  isPublic: z.boolean().default(true),
  encrypted: z.boolean().default(false),
  tokenGate: z.object({
    chainId: z.number(),
    tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    projectId: z.number().optional(),
    minBalance: z.string(), // BigInt as string
  }).optional(),
});

// POST /chat - Create a new chat
chatRouter.post(
  '/',
  optionalAuth,
  requireWalletOrAuth,
  zValidator('json', CreateChatSchema),
  async (c) => {
    const walletSession = c.get('walletSession')!;
    const body = c.req.valid('json');

    try {
      const chat = await createChat({
        founderAddress: walletSession.address,
        founderUserId: walletSession.userId,
        name: body.name,
        description: body.description,
        isPublic: body.isPublic,
        encrypted: body.encrypted,
        tokenGate: body.tokenGate ? {
          chainId: body.tokenGate.chainId,
          tokenAddress: body.tokenGate.tokenAddress,
          projectId: body.tokenGate.projectId,
          minBalance: BigInt(body.tokenGate.minBalance),
        } : undefined,
      });

      return c.json({ success: true, data: serializeChat(chat) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create chat';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// GET /chat - List user's chats (optionally filtered by folder)
chatRouter.get(
  '/',
  optionalAuth,
  requireWalletOrAuth,
  async (c) => {
    const walletSession = c.get('walletSession')!;
    const folderId = c.req.query('folderId');
    const pinnedOnly = c.req.query('pinnedOnly') === 'true';
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined;
    const offset = c.req.query('offset') ? parseInt(c.req.query('offset')!, 10) : undefined;

    const options: { folderId?: string | null; pinnedOnly?: boolean; limit?: number; offset?: number } = {};
    if (folderId === 'null' || folderId === 'root') {
      options.folderId = null; // Root level (no folder)
    } else if (folderId) {
      options.folderId = folderId;
    }
    if (pinnedOnly) {
      options.pinnedOnly = true;
    }
    if (limit !== undefined) {
      options.limit = limit;
    }
    if (offset !== undefined) {
      options.offset = offset;
    }

    const { chats, total } = await getChatsForAddress(walletSession.address, Object.keys(options).length > 0 ? options : undefined);
    return c.json({ success: true, data: chats.map(serializeChat), total });
  }
);

// GET /chat/public - Discover public chats
chatRouter.get('/public', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const chats = await getPublicChats(limit, offset);
  return c.json({ success: true, data: chats.map(serializeChat) });
});

// ============================================================================
// Folder Routes (must come before /:chatId to avoid matching "folders" as chatId)
// ============================================================================

// GET /chat/folders - Get user's folders
chatRouter.get(
  '/folders',
  optionalAuth,
  requireWalletOrAuth,
  async (c) => {
    const walletSession = c.get('walletSession')!;
    const folders = await getFoldersForUser(walletSession.address);
    return c.json({ success: true, data: folders });
  }
);

// POST /chat/folders - Create a folder
const CreateFolderSchema = z.object({
  name: z.string().min(1).max(255),
  parentFolderId: z.string().uuid().optional(),
});

chatRouter.post(
  '/folders',
  optionalAuth,
  requireWalletOrAuth,
  zValidator('json', CreateFolderSchema),
  async (c) => {
    const walletSession = c.get('walletSession')!;
    const body = c.req.valid('json');

    try {
      const folder = await createFolder(
        walletSession.address,
        body.name,
        body.parentFolderId,
        walletSession.userId
      );
      return c.json({ success: true, data: folder });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create folder';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// GET /chat/folders/:folderId - Get folder details
chatRouter.get(
  '/folders/:folderId',
  optionalAuth,
  requireWalletOrAuth,
  async (c) => {
    const folderId = c.req.param('folderId');
    const walletSession = c.get('walletSession')!;

    const folder = await getFolder(folderId);
    if (!folder) {
      return c.json({ success: false, error: 'Folder not found' }, 404);
    }

    // Check ownership
    if (folder.userAddress !== walletSession.address) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }

    return c.json({ success: true, data: folder });
  }
);

// PATCH /chat/folders/:folderId - Update folder
const UpdateFolderSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  parentFolderId: z.string().uuid().nullable().optional(),
  isPinned: z.boolean().optional(),
  pinOrder: z.number().optional(),
});

chatRouter.patch(
  '/folders/:folderId',
  optionalAuth,
  requireWalletOrAuth,
  zValidator('json', UpdateFolderSchema),
  async (c) => {
    const folderId = c.req.param('folderId');
    const walletSession = c.get('walletSession')!;
    const body = c.req.valid('json');

    const folder = await getFolder(folderId);
    if (!folder) {
      return c.json({ success: false, error: 'Folder not found' }, 404);
    }

    // Check ownership
    if (folder.userAddress !== walletSession.address) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }

    try {
      const updated = await updateFolder(folderId, {
        name: body.name,
        parentFolderId: body.parentFolderId === null ? undefined : body.parentFolderId,
        isPinned: body.isPinned,
        pinOrder: body.pinOrder,
      });
      return c.json({ success: true, data: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update folder';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// DELETE /chat/folders/:folderId - Delete folder
chatRouter.delete(
  '/folders/:folderId',
  optionalAuth,
  requireWalletOrAuth,
  async (c) => {
    const folderId = c.req.param('folderId');
    const walletSession = c.get('walletSession')!;

    const folder = await getFolder(folderId);
    if (!folder) {
      return c.json({ success: false, error: 'Folder not found' }, 404);
    }

    // Check ownership
    if (folder.userAddress !== walletSession.address) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }

    try {
      await deleteFolder(folderId);
      return c.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete folder';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// PATCH /chat/folders/:folderId/pin - Pin/unpin a folder
const PinFolderSchema = z.object({
  isPinned: z.boolean(),
  pinOrder: z.number().optional(),
});

chatRouter.patch(
  '/folders/:folderId/pin',
  optionalAuth,
  requireWalletOrAuth,
  zValidator('json', PinFolderSchema),
  async (c) => {
    const folderId = c.req.param('folderId');
    const walletSession = c.get('walletSession')!;
    const body = c.req.valid('json');

    const folder = await getFolder(folderId);
    if (!folder) {
      return c.json({ success: false, error: 'Folder not found' }, 404);
    }

    // Check ownership
    if (folder.userAddress !== walletSession.address) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }

    try {
      if (body.isPinned) {
        await pinFolder(folderId, body.pinOrder);
      } else {
        await unpinFolder(folderId);
      }
      const updated = await getFolder(folderId);
      return c.json({ success: true, data: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update pin status';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// POST /chat/folders/reorder-pinned - Reorder pinned folders
const ReorderPinnedFoldersSchema = z.object({
  folderIds: z.array(z.string().uuid()),
});

chatRouter.post(
  '/folders/reorder-pinned',
  optionalAuth,
  requireWalletOrAuth,
  zValidator('json', ReorderPinnedFoldersSchema),
  async (c) => {
    const walletSession = c.get('walletSession')!;
    const body = c.req.valid('json');

    try {
      await reorderPinnedFolders(walletSession.address, body.folderIds);
      return c.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reorder folders';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// GET /chat/:chatId - Get chat details
chatRouter.get('/:chatId', optionalAuth, optionalWalletSession, async (c) => {
  const chatId = c.req.param('chatId');
  const chat = await getChatById(chatId);

  if (!chat) {
    return c.json({ success: false, error: 'Chat not found' }, 404);
  }

  const walletSession = c.get('walletSession');

  // Check read permission for private chats
  if (!chat.isPublic) {
    if (!walletSession) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }
    const canRead = await checkPermission(chatId, walletSession.address, 'read');
    if (!canRead) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }
  }

  const members = await getChatMembers(chatId);
  const onlineMembers = getOnlineMembers(chatId);

  return c.json({
    success: true,
    data: {
      ...serializeChat(chat),
      members: members.map(serializeMember),
      onlineMembers,
    },
  });
});

// DELETE /chat/:chatId - Delete a chat (founder only)
chatRouter.delete(
  '/:chatId',
  optionalAuth,
  requireWalletOrAuth,
  async (c) => {
    const chatId = c.req.param('chatId');
    const walletSession = c.get('walletSession')!;

    try {
      await deleteChat(chatId, walletSession.address);
      return c.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete chat';
      const status = message.includes('not found') ? 404 : message.includes('Only the founder') ? 403 : 400;
      return c.json({ success: false, error: message }, status);
    }
  }
);

// ============================================================================
// Member Management Routes
// ============================================================================

// GET /chat/:chatId/members - Get members
chatRouter.get(
  '/:chatId/members',
  optionalAuth,
  optionalWalletSession,
  async (c) => {
    const chatId = c.req.param('chatId');
    const chat = await getChatById(chatId);

    if (!chat) {
      return c.json({ success: false, error: 'Chat not found' }, 404);
    }

    const walletSession = c.get('walletSession');

    // Check read permission for private chats
    if (!chat.isPublic && walletSession) {
      const canRead = await checkPermission(chatId, walletSession.address, 'read');
      if (!canRead) {
        return c.json({ success: false, error: 'Access denied' }, 403);
      }
    } else if (!chat.isPublic) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }

    const members = await getChatMembers(chatId);
    return c.json({ success: true, data: members.map(serializeMember) });
  }
);

const AddMemberSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  role: z.enum(['admin', 'member']).default('member'),
});

// POST /chat/:chatId/members - Add member
chatRouter.post(
  '/:chatId/members',
  optionalAuth,
  requireWalletOrAuth,
  zValidator('json', AddMemberSchema),
  async (c) => {
    const chatId = c.req.param('chatId');
    const walletSession = c.get('walletSession')!;
    const body = c.req.valid('json');

    try {
      const member = await addMember(
        chatId,
        walletSession.address,
        body.address,
        undefined, // userId will be looked up if they register
        body.role
      );
      return c.json({ success: true, data: serializeMember(member) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add member';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// DELETE /chat/:chatId/members/:address - Remove member
chatRouter.delete(
  '/:chatId/members/:address',
  optionalAuth,
  requireWalletOrAuth,
  async (c) => {
    const chatId = c.req.param('chatId');
    const targetAddress = c.req.param('address');
    const walletSession = c.get('walletSession')!;

    try {
      await removeMember(chatId, walletSession.address, targetAddress);
      return c.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove member';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// PATCH /chat/:chatId/members/:address - Update member permissions
const UpdatePermissionsSchema = z.object({
  role: z.enum(['admin', 'member']).optional(),
  canInvite: z.boolean().optional(),
  canInvokeAi: z.boolean().optional(),
  canManageMembers: z.boolean().optional(),
});

chatRouter.patch(
  '/:chatId/members/:address',
  optionalAuth,
  requireWalletOrAuth,
  zValidator('json', UpdatePermissionsSchema),
  async (c) => {
    const chatId = c.req.param('chatId');
    const targetAddress = c.req.param('address');
    const walletSession = c.get('walletSession')!;
    const body = c.req.valid('json');

    try {
      const member = await updateMemberPermissions(
        chatId,
        walletSession.address,
        targetAddress,
        body
      );
      return c.json({ success: true, data: serializeMember(member) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update permissions';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// ============================================================================
// Message Routes
// ============================================================================

const SendMessageSchema = z.object({
  content: z.string().min(1).max(10000),
  signature: z.string().optional(), // Required for external wallets
  replyToId: z.string().uuid().optional(),
});

// POST /chat/:chatId/messages - Send message
chatRouter.post(
  '/:chatId/messages',
  optionalAuth,
  requireWalletOrAuth,
  zValidator('json', SendMessageSchema),
  async (c) => {
    const chatId = c.req.param('chatId');
    const walletSession = c.get('walletSession')!;
    const body = c.req.valid('json');

    try {
      const message = await sendMessage({
        chatId,
        senderAddress: walletSession.address,
        senderUserId: walletSession.userId,
        content: body.content,
        signature: body.signature,
        replyToId: body.replyToId,
      });
      return c.json({ success: true, data: serializeMessage(message) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send message';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// GET /chat/:chatId/messages - Get messages
chatRouter.get('/:chatId/messages', optionalAuth, optionalWalletSession, async (c) => {
  const chatId = c.req.param('chatId');
  const limit = parseInt(c.req.query('limit') || '100', 10);
  const beforeId = c.req.query('before');

  // Check permission
  const chat = await getChatById(chatId);
  if (!chat) {
    return c.json({ success: false, error: 'Chat not found' }, 404);
  }

  const walletSession = c.get('walletSession');

  if (!chat.isPublic && walletSession) {
    const canRead = await checkPermission(chatId, walletSession.address, 'read');
    if (!canRead) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }
  } else if (!chat.isPublic) {
    return c.json({ success: false, error: 'Access denied' }, 403);
  }

  const messages = await getChatMessages(chatId, limit, beforeId);
  return c.json({ success: true, data: messages.map(serializeMessage) });
});

// DELETE /chat/:chatId/messages/:messageId - Delete message
chatRouter.delete(
  '/:chatId/messages/:messageId',
  optionalAuth,
  requireWalletOrAuth,
  async (c) => {
    const messageId = c.req.param('messageId');
    const walletSession = c.get('walletSession')!;

    try {
      await deleteMessage(messageId, walletSession.address);
      return c.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete message';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// ============================================================================
// AI Billing Routes
// ============================================================================

// GET /chat/:chatId/ai/balance - Get AI balance
chatRouter.get(
  '/:chatId/ai/balance',
  optionalAuth,
  async (c) => {
    const chatId = c.req.param('chatId');
    const balance = await getAiBalanceStatus(chatId);

    if (!balance) {
      return c.json({ success: false, error: 'Chat not found' }, 404);
    }

    return c.json({
      success: true,
      data: {
        ...balance,
        balanceWei: balance.balanceWei.toString(),
        totalSpentWei: balance.totalSpentWei.toString(),
        message: getSqueezePromptMessage(balance) || undefined,
      },
    });
  }
);

// GET /chat/:chatId/ai/can-invoke - Check if AI can be invoked
chatRouter.get(
  '/:chatId/ai/can-invoke',
  optionalAuth,
  requireWalletOrAuth,
  async (c) => {
    const chatId = c.req.param('chatId');
    const walletSession = c.get('walletSession')!;

    // Check member permission
    const canInvokePermission = await checkPermission(chatId, walletSession.address, 'invoke_ai');
    if (!canInvokePermission) {
      return c.json({
        success: true,
        data: { allowed: false, reason: 'You do not have permission to invoke AI in this chat' },
      });
    }

    // Check balance
    const result = await canInvokeAi(chatId);
    return c.json({
      success: true,
      data: {
        ...result,
        balance: result.balance ? {
          ...result.balance,
          balanceWei: result.balance.balanceWei.toString(),
          totalSpentWei: result.balance.totalSpentWei.toString(),
        } : undefined,
      },
    });
  }
);

// GET /chat/:chatId/ai/squeeze - Get payment data for "squeezing" the bot
const SqueezeSchema = z.object({
  chainId: z.coerce.number(),
  amount: z.string().optional(), // Amount in ETH
});

chatRouter.get(
  '/:chatId/ai/squeeze',
  optionalAuth,
  requireWalletOrAuth,
  zValidator('query', SqueezeSchema),
  async (c) => {
    const chatId = c.req.param('chatId');
    const walletSession = c.get('walletSession')!;
    const { chainId, amount } = c.req.valid('query');

    if (!SUPPORTED_CHAINS[chainId as keyof typeof SUPPORTED_CHAINS]) {
      return c.json({ success: false, error: 'Unsupported chain' }, 400);
    }

    const amountWei = amount
      ? BigInt(Math.floor(parseFloat(amount) * 1e18))
      : AI_PRICING.recommendedDeposit;

    const payment = generateSqueezePayment(
      chatId,
      chainId,
      amountWei,
      walletSession.address as `0x${string}`
    );

    const calldata = encodePayCalldata(payment);

    return c.json({
      success: true,
      data: {
        payment: {
          ...payment,
          amountWei: payment.amountWei.toString(),
        },
        transaction: {
          to: calldata.to,
          value: calldata.value.toString(),
          data: calldata.data,
        },
        pricing: {
          costPerRequest: AI_PRICING.costPerRequest.toString(),
          minDeposit: AI_PRICING.minDeposit.toString(),
          recommendedDeposit: AI_PRICING.recommendedDeposit.toString(),
          estimatedRequests: Number(amountWei / AI_PRICING.costPerRequest),
        },
      },
    });
  }
);

// POST /chat/:chatId/ai/confirm-payment - Confirm payment
const ConfirmPaymentSchema = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  chainId: z.number(),
  amountWei: z.string(),
});

chatRouter.post(
  '/:chatId/ai/confirm-payment',
  optionalAuth,
  requireWalletOrAuth,
  zValidator('json', ConfirmPaymentSchema),
  async (c) => {
    const chatId = c.req.param('chatId');
    const walletSession = c.get('walletSession')!;
    const body = c.req.valid('json');

    try {
      await confirmPayment({
        chatId,
        txHash: body.txHash,
        chainId: body.chainId,
        amountWei: BigInt(body.amountWei),
        payerAddress: walletSession.address,
        projectId: 1, // NANA
      });

      const balance = await getAiBalanceStatus(chatId);
      return c.json({
        success: true,
        data: {
          newBalance: balance?.balanceWei.toString(),
          estimatedRequestsRemaining: balance?.estimatedRequestsRemaining,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to confirm payment';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// GET /chat/:chatId/ai/history - Get billing history
chatRouter.get(
  '/:chatId/ai/history',
  optionalAuth,
  requireWalletOrAuth,
  async (c) => {
    const chatId = c.req.param('chatId');
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const history = await getBillingHistory(chatId, limit);

    return c.json({
      success: true,
      data: history.map((r) => ({
        ...r,
        amountWei: r.amountWei.toString(),
      })),
    });
  }
);

// POST /chat/:chatId/ai/invoke - Invoke AI to respond to the chat (streaming)
const InvokeAiSchema = z.object({
  prompt: z.string().min(1).max(10000),
});

chatRouter.post(
  '/:chatId/ai/invoke',
  optionalAuth,
  requireWalletOrAuth,
  zValidator('json', InvokeAiSchema),
  async (c) => {
    const chatId = c.req.param('chatId');
    const walletSession = c.get('walletSession')!;
    const body = c.req.valid('json');

    try {
      // Check if user can invoke AI
      const canInvokePermission = await checkPermission(chatId, walletSession.address, 'invoke_ai');
      if (!canInvokePermission) {
        return c.json({ success: false, error: 'You do not have permission to invoke AI in this chat' }, 403);
      }

      // Get previous messages for context
      const previousMessages = await getChatMessages(chatId, 50);
      const chatHistory = previousMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      // Add the new prompt to history
      chatHistory.push({ role: 'user', content: body.prompt });

      // Import services
      const { streamMessage } = await import('../services/claude.ts');
      const { importMessage } = await import('../services/chat.ts');
      const { streamAiToken, broadcastChatMessage } = await import('../services/websocket.ts');

      // Generate a message ID upfront for streaming
      const messageId = crypto.randomUUID();
      const assistantAddress = '0x0000000000000000000000000000000000000000';

      // Stream Claude response and broadcast tokens via WebSocket
      let fullContent = '';

      for await (const event of streamMessage(chatId, { messages: chatHistory })) {
        if (event.type === 'text') {
          const token = event.data as string;
          fullContent += token;
          // Broadcast each token to connected clients
          streamAiToken(chatId, messageId, token, false);
        }
      }

      // Signal streaming is done
      streamAiToken(chatId, messageId, '', true);

      // Store the complete AI response as a message
      const aiMessage = await importMessage({
        chatId,
        senderAddress: assistantAddress,
        role: 'assistant',
        content: fullContent,
      });

      // Auto-generate title if the chat has a generic name
      const { isGenericName, generateChatTitle, setAutoGeneratedTitle } = await import('../services/chatCategorization.ts');
      const currentChat = await getChatById(chatId);
      if (currentChat && isGenericName(currentChat.name) && !currentChat.autoGeneratedTitle) {
        // Get messages for title generation
        const messagesForTitle = await getChatMessages(chatId, 10);
        const titleMessages = messagesForTitle.map(m => ({ role: m.role, content: m.content }));

        // Generate title asynchronously (don't block response)
        generateChatTitle(titleMessages).then(async (title) => {
          if (title) {
            await setAutoGeneratedTitle(chatId, title);
            // Broadcast the new title to connected clients
            const { broadcastChatUpdate } = await import('../services/websocket.ts');
            broadcastChatUpdate(chatId, { autoGeneratedTitle: title });
          }
        }).catch(err => {
          console.error('Failed to generate chat title:', err);
        });
      }

      return c.json({ success: true, data: serializeMessage(aiMessage) });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to invoke AI';
      return c.json({ success: false, error: errorMessage }, 500);
    }
  }
);

// ============================================================================
// IPFS Archival Routes
// ============================================================================

// POST /chat/:chatId/archive - Archive chat to IPFS
chatRouter.post(
  '/:chatId/archive',
  optionalAuth,
  requireWalletOrAuth,
  async (c) => {
    const chatId = c.req.param('chatId');
    const walletSession = c.get('walletSession')!;

    // Only admins can archive
    const canManage = await checkPermission(chatId, walletSession.address, 'manage_members');
    if (!canManage) {
      return c.json({ success: false, error: 'Only admins can archive' }, 403);
    }

    try {
      const cid = await archiveChat(chatId);
      return c.json({ success: true, data: { cid } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to archive';
      return c.json({ success: false, error: message }, 500);
    }
  }
);

// GET /chat/:chatId/archive - Get archive info
chatRouter.get('/:chatId/archive', async (c) => {
  const chatId = c.req.param('chatId');
  const cid = await getLatestArchiveCid(chatId);

  if (!cid) {
    return c.json({ success: false, error: 'No archive available' }, 404);
  }

  return c.json({
    success: true,
    data: {
      cid,
      gateway: `https://gateway.pinata.cloud/ipfs/${cid}`,
    },
  });
});

// GET /chat/archive/:cid - Fetch archived chat
chatRouter.get('/archive/:cid', async (c) => {
  const cid = c.req.param('cid');

  try {
    const archive = await fetchArchivedChat(cid);
    return c.json({ success: true, data: archive });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch archive';
    return c.json({ success: false, error: message }, 500);
  }
});

// ============================================================================
// Feedback Route
// ============================================================================

const FeedbackSchema = z.object({
  rating: z.enum(['wow', 'great', 'meh', 'bad']),
  customFeedback: z.string().max(500).optional(),
});

// POST /chat/:chatId/feedback - Submit feedback
chatRouter.post(
  '/:chatId/feedback',
  optionalAuth,
  requireWalletOrAuth,
  zValidator('json', FeedbackSchema),
  async (c) => {
    const chatId = c.req.param('chatId');
    const walletSession = c.get('walletSession')!;
    const body = c.req.valid('json');

    try {
      await submitFeedback(
        chatId,
        walletSession.address,
        walletSession.userId,
        body.rating as JuicyRating,
        body.customFeedback
      );
      return c.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit feedback';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// ============================================================================
// Chat Organization Routes (Pinning, Folders, Renaming)
// ============================================================================

// PATCH /chat/:chatId/pin - Pin/unpin a chat
const PinChatSchema = z.object({
  isPinned: z.boolean(),
  pinOrder: z.number().optional(),
});

chatRouter.patch(
  '/:chatId/pin',
  optionalAuth,
  requireWalletOrAuth,
  zValidator('json', PinChatSchema),
  async (c) => {
    const chatId = c.req.param('chatId');
    const walletSession = c.get('walletSession')!;
    const body = c.req.valid('json');

    // Check if user is a member
    const member = await getMember(chatId, walletSession.address);
    if (!member?.isActive) {
      return c.json({ success: false, error: 'Not a member of this chat' }, 403);
    }

    try {
      if (body.isPinned) {
        await pinChat(chatId, body.pinOrder);
      } else {
        await unpinChat(chatId);
      }
      const chat = await getChatById(chatId);
      return c.json({ success: true, data: serializeChat(chat!) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update pin status';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// PATCH /chat/:chatId/folder - Move chat to folder
const MoveChatSchema = z.object({
  folderId: z.string().uuid().nullable(),
});

chatRouter.patch(
  '/:chatId/folder',
  optionalAuth,
  requireWalletOrAuth,
  zValidator('json', MoveChatSchema),
  async (c) => {
    const chatId = c.req.param('chatId');
    const walletSession = c.get('walletSession')!;
    const body = c.req.valid('json');

    // Check if user is a member
    const member = await getMember(chatId, walletSession.address);
    if (!member?.isActive) {
      return c.json({ success: false, error: 'Not a member of this chat' }, 403);
    }

    try {
      await moveChatToFolder(chatId, body.folderId);
      const chat = await getChatById(chatId);
      return c.json({ success: true, data: serializeChat(chat!) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to move chat';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// PATCH /chat/:chatId/name - Rename a chat
const RenameChatSchema = z.object({
  name: z.string().min(1).max(255),
});

chatRouter.patch(
  '/:chatId/name',
  optionalAuth,
  requireWalletOrAuth,
  zValidator('json', RenameChatSchema),
  async (c) => {
    const chatId = c.req.param('chatId');
    const walletSession = c.get('walletSession')!;
    const body = c.req.valid('json');

    // Check if user is a member
    const member = await getMember(chatId, walletSession.address);
    if (!member?.isActive) {
      return c.json({ success: false, error: 'Not a member of this chat' }, 403);
    }

    try {
      const chat = await updateChatName(chatId, body.name);
      return c.json({ success: true, data: serializeChat(chat!) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rename chat';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// POST /chat/reorder-pinned - Reorder pinned chats
const ReorderPinnedSchema = z.object({
  chatIds: z.array(z.string().uuid()),
});

chatRouter.post(
  '/reorder-pinned',
  optionalAuth,
  requireWalletOrAuth,
  zValidator('json', ReorderPinnedSchema),
  async (c) => {
    const walletSession = c.get('walletSession')!;
    const body = c.req.valid('json');

    try {
      await reorderPinnedChats(walletSession.address, body.chatIds);
      return c.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reorder chats';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// ============================================================================
// WebSocket Route
// ============================================================================

// Upgrade to WebSocket for real-time messaging
chatRouter.get(
  '/:chatId/ws',
  upgradeWebSocket((c) => {
    const chatId = c.req.param('chatId');
    const sessionToken = c.req.query('session');
    const sessionId = c.req.query('sessionId');
    let client: WsClient | null = null;

    return {
      async onOpen(_event, ws) {
        // Try token-based auth first
        let walletSession = await extractWalletSession(undefined, sessionToken);

        // Fall back to anonymous session if no token auth
        if (!walletSession && sessionId && sessionId.startsWith('ses_')) {
          // Create pseudo-address from session ID (same logic as requireWalletOrAuth)
          const pseudoAddress = `0x${sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40).padStart(40, '0')}`;
          walletSession = {
            address: pseudoAddress,
            sessionId,
            isAnonymous: true,
          };
        }

        if (!walletSession) {
          ws.close(4001, 'Authentication required');
          return;
        }

        // Check permission
        const canRead = await checkPermission(chatId, walletSession.address, 'read');
        if (!canRead) {
          ws.close(4003, 'Access denied');
          return;
        }

        // Register connection
        client = {
          socket: ws.raw as WebSocket,
          address: walletSession.address,
          userId: walletSession.userId,
          chatId,
          connectedAt: new Date(),
        };

        registerConnection(client);
      },

      onMessage(event, ws) {
        if (!client) return;
        handleWsMessage(client, event.data.toString());
      },

      onClose(_event, _ws) {
        if (client) {
          removeConnection(client);
        }
      },

      onError(_event, _ws) {
        if (client) {
          removeConnection(client);
        }
      },
    };
  })
);

// ============================================================================
// Serializers (convert BigInt to strings for JSON)
// ============================================================================

function serializeChat(chat: any) {
  return {
    ...chat,
    aiBalanceWei: chat.aiBalanceWei?.toString(),
    aiTotalSpentWei: chat.aiTotalSpentWei?.toString(),
    tokenGate: chat.tokenGate ? {
      ...chat.tokenGate,
      minBalance: chat.tokenGate.minBalance?.toString(),
    } : undefined,
    // Organization fields (already serializable)
    isPinned: chat.isPinned,
    pinOrder: chat.pinOrder,
    folderId: chat.folderId,
    autoGeneratedTitle: chat.autoGeneratedTitle,
  };
}

function serializeMember(member: any) {
  return member;
}

function serializeMessage(message: any) {
  return {
    ...message,
    aiCostWei: message.aiCostWei?.toString(),
  };
}

export { chatRouter };
