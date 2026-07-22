/**
 * Chat API Routes
 *
 * Supports both:
 * - Authenticated users (JWT token) with managed wallets
 * - External wallets (SIWE session) for self-custody users
 */

import { type Context, Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { optionalAuth } from '../middleware/auth.ts';
import {
  optionalWalletSession,
  requireWalletOrAuth,
  type WalletSession,
} from '../middleware/walletSession.ts';
import {
  addMember,
  addMemberViaInvite,
  type Chat,
  type ChatMember,
  type ChatMessage,
  checkPermission,
  createChat,
  createFolder,
  deleteChat,
  deleteFolder,
  deleteMessage,
  getChatById,
  getChatMembers,
  getChatMessages,
  getChatsForAddress,
  getFolder,
  getFoldersForUser,
  getMember,
  getPublicChats,
  type JuicyRating,
  moveChatToFolder,
  pinChat,
  pinFolder,
  removeMember,
  reorderPinnedChats,
  reorderPinnedFolders,
  reportChat,
  sendMessage,
  submitFeedback,
  toggleChatAiEnabled,
  unpinChat,
  unpinFolder,
  updateChatName,
  updateFolder,
  updateMemberPermissions,
  updateUserEmoji,
} from '../services/chat.ts';
import {
  AI_PRICING,
  canInvokeAi,
  confirmPayment,
  encodePayCalldata,
  generateSqueezePayment,
  getAiBalanceStatus,
  getBillingHistory,
  getSqueezePromptMessage,
  SUPPORTED_CHAINS,
} from '../services/aiBilling.ts';
import { archiveChat, fetchArchivedChat, getLatestArchiveCid } from '../services/ipfs.ts';
import { invokeAiForChat } from '../services/aiInvocation.ts';
import { getOrCreateSmartAccount } from '../services/smartAccounts.ts';
import { getOnlineMembers } from '../services/websocket.ts';
import { execute, query, queryOne } from '../db/index.ts';
import { getConfig } from '../utils/config.ts';
import {
  getPseudoAddress,
  isTimestampValid,
  parseSessionMergeMessage,
  verifyWalletSignature,
} from '../utils/crypto.ts';
import { rateLimitByWallet } from '../services/rateLimit.ts';
import { parseEther } from 'viem';
import {
  type ComponentState,
  getComponentState,
  getMessageComponentStates,
  setComponentState,
} from '../services/componentState.ts';
// Rate limiting removed - AI is free for everyone

// ============================================================================
// Middleware - Wallet Session Auth (shared implementation)
// ============================================================================

type ChatEnv = {
  Variables: {
    user?: { id: string };
    walletSession?: WalletSession;
  };
};

const chatRouter = new Hono<ChatEnv>();

// ============================================================================
// Chat CRUD Routes
// ============================================================================

const CreateChatSchema = z.object({
  name: z.string().max(255).optional(),
  description: z.string().max(2000).optional(),
  isPublic: z.boolean().default(true),
  isPrivate: z.boolean().default(false), // When true, chat won't be stored for study/improvement
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
  rateLimitByWallet('chatCreate'),
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
        isPrivate: body.isPrivate,
        encrypted: body.encrypted,
        tokenGate: body.tokenGate
          ? {
            chainId: body.tokenGate.chainId,
            tokenAddress: body.tokenGate.tokenAddress,
            projectId: body.tokenGate.projectId,
            minBalance: BigInt(body.tokenGate.minBalance),
          }
          : undefined,
      });

      return c.json({ success: true, data: serializeChat(chat) });
    } catch (error) {
      return errorResponse(c, error, 'Failed to create chat');
    }
  },
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

    const options: {
      folderId?: string | null;
      pinnedOnly?: boolean;
      limit?: number;
      offset?: number;
    } = {};
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

    const { chats, total } = await getChatsForAddress(
      walletSession.address,
      Object.keys(options).length > 0 ? options : undefined,
    );
    return c.json({ success: true, data: chats.map(serializeChat), total });
  },
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
  },
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
        walletSession.userId,
      );
      return c.json({ success: true, data: folder });
    } catch (error) {
      return errorResponse(c, error, 'Failed to create folder');
    }
  },
);

// GET /chat/folders/:folderId - Get folder details
chatRouter.get(
  '/folders/:folderId',
  optionalAuth,
  requireWalletOrAuth,
  async (c) => {
    const folderId = c.req.param('folderId');
    const walletSession = c.get('walletSession')!;

    const owned = await loadOwnedFolder(c, folderId, walletSession.address);
    if (owned.error) return owned.error;

    return c.json({ success: true, data: owned.folder });
  },
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

    const owned = await loadOwnedFolder(c, folderId, walletSession.address);
    if (owned.error) return owned.error;

    try {
      const updated = await updateFolder(folderId, {
        name: body.name,
        parentFolderId: body.parentFolderId === null ? undefined : body.parentFolderId,
        isPinned: body.isPinned,
        pinOrder: body.pinOrder,
      });
      return c.json({ success: true, data: updated });
    } catch (error) {
      return errorResponse(c, error, 'Failed to update folder');
    }
  },
);

// DELETE /chat/folders/:folderId - Delete folder
chatRouter.delete(
  '/folders/:folderId',
  optionalAuth,
  requireWalletOrAuth,
  async (c) => {
    const folderId = c.req.param('folderId');
    const walletSession = c.get('walletSession')!;

    const owned = await loadOwnedFolder(c, folderId, walletSession.address);
    if (owned.error) return owned.error;

    try {
      await deleteFolder(folderId);
      return c.json({ success: true });
    } catch (error) {
      return errorResponse(c, error, 'Failed to delete folder');
    }
  },
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

    const owned = await loadOwnedFolder(c, folderId, walletSession.address);
    if (owned.error) return owned.error;

    try {
      if (body.isPinned) {
        await pinFolder(folderId, body.pinOrder);
      } else {
        await unpinFolder(folderId);
      }
      const updated = await getFolder(folderId);
      return c.json({ success: true, data: updated });
    } catch (error) {
      return errorResponse(c, error, 'Failed to update pin status');
    }
  },
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
      return errorResponse(c, error, 'Failed to reorder folders');
    }
  },
);

// Debug log (console only, no filesystem writes for security)
function debugLog(msg: string) {
  if (Deno.env.get('DENO_ENV') !== 'production') {
    console.log(`[Chat Debug] ${msg}`);
  }
}

/**
 * Shared error response for route catch blocks: uses the error's message when
 * available, otherwise the route-specific fallback, with the route's status code.
 */
function errorResponse(
  c: Context,
  error: unknown,
  fallback: string,
  status: 400 | 401 | 403 | 404 | 500 = 400,
) {
  const message = error instanceof Error ? error.message : fallback;
  return c.json({ success: false, error: message }, status);
}

/**
 * Check a chat permission for an address, falling back to the anonymous
 * session's pseudo-address when the primary address is not authorized.
 * Handles users who joined via invite with a session ID but now have a
 * different wallet connected.
 */
async function checkChatAccess(
  chatId: string,
  address: string,
  sessionId: string | undefined,
  action: 'read' | 'write',
): Promise<boolean> {
  if (await checkPermission(chatId, address, action)) {
    return true;
  }
  if (sessionId && sessionId.startsWith('ses_')) {
    const pseudoAddress = await getPseudoAddress(sessionId);
    if (pseudoAddress !== address) {
      return await checkPermission(chatId, pseudoAddress, action);
    }
  }
  return false;
}

/**
 * Load a folder and verify it belongs to the given address.
 * Returns either the folder or an error response to return directly.
 */
async function loadOwnedFolder(
  c: Context,
  folderId: string,
  address: string,
): Promise<
  { folder: NonNullable<Awaited<ReturnType<typeof getFolder>>>; error?: never } | {
    folder?: never;
    error: Response;
  }
> {
  const folder = await getFolder(folderId);
  if (!folder) {
    return { error: c.json({ success: false, error: 'Folder not found' }, 404) };
  }
  // Check ownership
  if (folder.userAddress !== address) {
    return { error: c.json({ success: false, error: 'Access denied' }, 403) };
  }
  return { folder };
}

// GET /chat/:chatId - Get chat details
chatRouter.get('/:chatId', optionalAuth, optionalWalletSession, async (c) => {
  const chatId = c.req.param('chatId');
  const sessionId = c.req.header('X-Session-ID');
  const chat = await getChatById(chatId);

  debugLog(`[Fetch Chat] Chat ID: ${chatId}`);
  debugLog(`[Fetch Chat] Session ID: ${sessionId}`);

  if (!chat) {
    return c.json({ success: false, error: 'Chat not found' }, 404);
  }

  const walletSession = c.get('walletSession');
  debugLog(`[Fetch Chat] Has wallet session: ${!!walletSession}`);
  debugLog(`[Fetch Chat] Wallet address: ${walletSession?.address}`);
  debugLog(`[Fetch Chat] Is anonymous: ${walletSession?.isAnonymous}`);
  debugLog(`[Fetch Chat] Chat is public: ${chat?.isPublic}`);

  // Check read permission for private chats
  if (!chat.isPublic) {
    if (!walletSession) {
      debugLog('[Fetch Chat] DENIED: No wallet session for private chat');
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    const canRead = await checkChatAccess(chatId, walletSession.address, sessionId, 'read');
    if (!canRead) {
      debugLog(`[Fetch Chat] DENIED: No read permission for address ${walletSession.address}`);
      return c.json({ success: false, error: 'Access denied' }, 403);
    }
  }

  const members = await getChatMembers(chatId);
  const onlineMembers = getOnlineMembers(chatId);

  debugLog(`[Fetch Chat] Chat ${chatId} returning ${members.length} members`);

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
      const status = message.includes('not found')
        ? 404
        : message.includes('Only the founder')
        ? 403
        : 400;
      return c.json({ success: false, error: message }, status);
    }
  },
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
    const sessionId = c.req.header('X-Session-ID');

    // Check read permission for private chats
    if (!chat.isPublic) {
      const canRead = walletSession &&
        (await checkChatAccess(chatId, walletSession.address, sessionId, 'read'));
      if (!canRead) {
        return c.json({ success: false, error: 'Access denied' }, 403);
      }
    }

    const members = await getChatMembers(chatId);
    debugLog(`[Members Endpoint] Chat ${chatId} returning ${members.length} members`);
    return c.json({ success: true, data: members.map(serializeMember) });
  },
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
        body.role,
      );
      return c.json({ success: true, data: serializeMember(member) });
    } catch (error) {
      return errorResponse(c, error, 'Failed to add member');
    }
  },
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
      return errorResponse(c, error, 'Failed to remove member');
    }
  },
);

// PATCH /chat/:chatId/members/:address - Update member permissions
const UpdatePermissionsSchema = z.object({
  role: z.enum(['admin', 'member']).optional(),
  canInvite: z.boolean().optional(),
  canInvokeAi: z.boolean().optional(),
  canManageMembers: z.boolean().optional(),
  canPauseAi: z.boolean().optional(),
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
        body,
      );
      return c.json({ success: true, data: serializeMember(member) });
    } catch (error) {
      return errorResponse(c, error, 'Failed to update permissions');
    }
  },
);

// PATCH /chat/me/emoji - Update current user's emoji across all chats
const UpdateEmojiSchema = z.object({
  customEmoji: z.string().max(10).nullable(),
});

chatRouter.patch(
  '/me/emoji',
  optionalAuth,
  requireWalletOrAuth,
  zValidator('json', UpdateEmojiSchema),
  async (c) => {
    const walletSession = c.get('walletSession')!;
    const body = c.req.valid('json');

    try {
      await updateUserEmoji(walletSession.address, body.customEmoji);

      // Broadcast the emoji change to all chats the user is in
      const { broadcastMemberUpdate } = await import('../services/websocket.ts');
      broadcastMemberUpdate(walletSession.address, { customEmoji: body.customEmoji });

      return c.json({ success: true });
    } catch (error) {
      return errorResponse(c, error, 'Failed to update emoji');
    }
  },
);

// ============================================================================
// Message Routes
// ============================================================================

const AttachmentSchema = z.object({
  type: z.enum(['image', 'document']),
  name: z.string().max(255),
  mimeType: z.string().max(100),
  data: z.string(), // base64 encoded
});

const SendMessageSchema = z.object({
  content: z.string().max(10000),
  signature: z.string().optional(), // Required for external wallets
  replyToId: z.string().uuid().optional(),
  attachments: z.array(AttachmentSchema).max(5).optional(),
}).refine(
  (data) => data.content.length > 0 || (data.attachments && data.attachments.length > 0),
  { message: 'Message must have content or attachments' },
);

// POST /chat/:chatId/messages - Send message
chatRouter.post(
  '/:chatId/messages',
  optionalAuth,
  requireWalletOrAuth,
  rateLimitByWallet('chatMessage'),
  zValidator('json', SendMessageSchema),
  async (c) => {
    const chatId = c.req.param('chatId');
    const walletSession = c.get('walletSession')!;
    const sessionId = c.req.header('X-Session-ID');
    const body = c.req.valid('json');

    // Determine which address to use for sending
    // First try the wallet session address, then fall back to pseudo-address from session ID
    let senderAddress = walletSession.address;
    let canWrite = await checkPermission(chatId, senderAddress, 'write');

    if (!canWrite && sessionId && sessionId.startsWith('ses_')) {
      const pseudoAddress = await getPseudoAddress(sessionId);
      if (pseudoAddress !== walletSession.address) {
        const pseudoCanWrite = await checkPermission(chatId, pseudoAddress, 'write');
        if (pseudoCanWrite) {
          // User joined via session but now has a wallet connected
          // Upgrade: add their wallet as a member so they can use their real identity
          const pseudoMember = await getMember(chatId, pseudoAddress);
          if (pseudoMember && !walletSession.isAnonymous) {
            try {
              // Add wallet address as member with same role/permissions
              await addMemberViaInvite(chatId, {
                address: walletSession.address,
                userId: walletSession.userId,
                role: pseudoMember.role,
                canSendMessages: pseudoMember.canSendMessages,
                canInviteOthers: pseudoMember.canInviteOthers,
              });
              // Deactivate the pseudo-address member to avoid duplicates
              await execute(
                `UPDATE multi_chat_members SET is_active = FALSE, left_at = NOW() WHERE chat_id = $1 AND member_address = $2`,
                [chatId, pseudoAddress],
              );
              // Now use wallet address for sending
              senderAddress = walletSession.address;
              canWrite = true;
            } catch {
              // If adding fails (e.g., already exists), fall back to pseudo-address
              senderAddress = pseudoAddress;
              canWrite = true;
            }
          } else {
            senderAddress = pseudoAddress;
            canWrite = true;
          }
        }
      }
    }

    if (!canWrite) {
      return c.json({ success: false, error: 'Not authorized to send messages' }, 403);
    }

    try {
      // Pin attachments to IPFS before saving the message
      // Failed attachments are skipped so they don't fail the message
      let attachmentMetadata:
        | Array<{ type: 'image' | 'document'; name: string; mimeType: string; cid: string }>
        | undefined;
      if (body.attachments && body.attachments.length > 0) {
        const { pinAttachments } = await import('../services/ipfs.ts');
        attachmentMetadata = (await pinAttachments(body.attachments))
          .filter((p): p is typeof p & { cid: string } => p.cid !== null)
          .map((p) => ({
            type: p.att.type,
            name: p.att.name,
            mimeType: p.att.mimeType,
            cid: p.cid,
          }));
        if (attachmentMetadata.length === 0) attachmentMetadata = undefined;
      }

      const message = await sendMessage({
        chatId,
        senderAddress,
        senderUserId: walletSession.userId,
        content: body.content,
        signature: body.signature,
        replyToId: body.replyToId,
        attachments: attachmentMetadata,
      });
      return c.json({ success: true, data: serializeMessage(message) });
    } catch (error) {
      return errorResponse(c, error, 'Failed to send message');
    }
  },
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
  const sessionId = c.req.header('X-Session-ID');

  if (!chat.isPublic) {
    const canRead = walletSession &&
      (await checkChatAccess(chatId, walletSession.address, sessionId, 'read'));
    if (!canRead) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }
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
      return errorResponse(c, error, 'Failed to delete message');
    }
  },
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
  },
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
        balance: result.balance
          ? {
            ...result.balance,
            balanceWei: result.balance.balanceWei.toString(),
            totalSpentWei: result.balance.totalSpentWei.toString(),
          }
          : undefined,
      },
    });
  },
);

// GET /chat/:chatId/ai/squeeze - Get payment data for "squeezing" the bot
const SqueezeSchema = z.object({
  chainId: z.coerce.number(),
  amount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/).optional(), // Amount in ETH
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

    const amountWei = amount ? parseEther(amount) : AI_PRICING.recommendedDeposit;

    const payment = await generateSqueezePayment(
      chatId,
      chainId,
      amountWei,
      walletSession.address as `0x${string}`,
    );

    const calldata = await encodePayCalldata(payment);

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
          maxDeposit: AI_PRICING.maxDeposit.toString(),
          estimatedRequests: Number(amountWei / AI_PRICING.costPerRequest),
        },
      },
    });
  },
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
        projectId: getConfig().aiBillingProjectId,
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
      return errorResponse(c, error, 'Failed to confirm payment');
    }
  },
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
  },
);

// PATCH /chat/:chatId/ai/toggle - Toggle AI enabled state for the chat
const ToggleAiSchema = z.object({
  enabled: z.boolean(),
});

chatRouter.patch(
  '/:chatId/ai/toggle',
  optionalAuth,
  requireWalletOrAuth,
  zValidator('json', ToggleAiSchema),
  async (c) => {
    const chatId = c.req.param('chatId');
    const walletSession = c.get('walletSession')!;
    const body = c.req.valid('json');

    try {
      const updatedChat = await toggleChatAiEnabled(chatId, walletSession.address, body.enabled);
      if (!updatedChat) {
        return c.json({ success: false, error: 'Chat not found' }, 404);
      }

      // Broadcast the change to all connected clients
      const { broadcastChatUpdate } = await import('../services/websocket.ts');
      broadcastChatUpdate(chatId, { aiEnabled: body.enabled });

      return c.json({ success: true, data: serializeChat(updatedChat) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to toggle AI';
      const status = message.includes('permission') ? 403 : 400;
      return c.json({ success: false, error: message }, status);
    }
  },
);

// POST /chat/:chatId/ai/invoke - Invoke AI to respond to the chat (streaming)
const InvokeAiSchema = z.object({
  prompt: z.string().max(10000),
  attachments: z.array(AttachmentSchema).max(5).optional(),
  apiKey: z.string().optional(), // User-provided Claude API key (BYOK)
  savePrompt: z.boolean().optional(), // Save prompt to DB for future AI context (hidden messages)
}).refine(
  (data) => data.prompt.length > 0 || (data.attachments && data.attachments.length > 0),
  { message: 'Message must have prompt or attachments' },
);

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
      // Check if AI is enabled for this chat (global toggle)
      const chat = await getChatById(chatId);
      if (!chat) {
        return c.json({ success: false, error: 'Chat not found' }, 404);
      }
      if (!chat.aiEnabled) {
        return c.json({ success: false, error: 'AI is currently disabled for this chat' }, 403);
      }

      // Check if user can invoke AI
      const canInvokePermission = await checkPermission(chatId, walletSession.address, 'invoke_ai');
      if (!canInvokePermission) {
        return c.json({
          success: false,
          error: 'You do not have permission to invoke AI in this chat',
        }, 403);
      }

      // AI is free for everyone - no rate limiting

      const aiMessage = await invokeAiForChat({
        chatId,
        walletAddress: walletSession.address,
        userId: walletSession.userId,
        prompt: body.prompt,
        attachments: body.attachments,
        apiKey: body.apiKey,
        savePrompt: body.savePrompt,
      });

      return c.json({ success: true, data: serializeMessage(aiMessage) });
    } catch (error) {
      return errorResponse(c, error, 'Failed to invoke AI', 500);
    }
  },
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
      return errorResponse(c, error, 'Failed to archive', 500);
    }
  },
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
    return errorResponse(c, error, 'Failed to fetch archive', 500);
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
        body.customFeedback,
      );
      return c.json({ success: true });
    } catch (error) {
      return errorResponse(c, error, 'Failed to submit feedback');
    }
  },
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
      return errorResponse(c, error, 'Failed to update pin status');
    }
  },
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
      return errorResponse(c, error, 'Failed to move chat');
    }
  },
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
      return errorResponse(c, error, 'Failed to rename chat');
    }
  },
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
      return errorResponse(c, error, 'Failed to reorder chats');
    }
  },
);

// ============================================================================
// WebSocket Route - Handled at server level in main.ts for clean upgrade
// See main.ts handleRequest() for WebSocket implementation
// ============================================================================

// ============================================================================
// Report Chat
// ============================================================================

// Report a chat for review
chatRouter.post(
  '/:chatId/report',
  optionalAuth,
  optionalWalletSession,
  zValidator(
    'json',
    z.object({
      reason: z.string().optional(),
    }).optional(),
  ),
  async (c) => {
    const chatId = c.req.param('chatId');
    const body = c.req.valid('json') || {};
    const wallet = c.get('walletSession');

    // Get reporter address from wallet session or user
    const reporterAddress = wallet?.address;
    if (!reporterAddress) {
      return c.json({ success: false, error: 'Authentication required' }, 401);
    }

    try {
      const report = await reportChat(chatId, reporterAddress, body.reason);
      return c.json({
        success: true,
        report: {
          id: report.id,
          chatId: report.chatId,
          status: report.status,
          createdAt: report.createdAt,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to report chat';
      // Return 200 with error for duplicate reports (user already reported)
      if (message.includes('unique') || message.includes('duplicate')) {
        return c.json({
          success: true,
          message: 'Report already submitted',
        });
      }
      return c.json({ success: false, error: message }, 400);
    }
  },
);

// ============================================================================
// Session Merge - Associate anonymous session chats with authenticated account
// ============================================================================

/**
 * POST /chat/merge-session - Merge anonymous session memberships to authenticated address
 *
 * When a user connects their wallet or passkey, this endpoint:
 * 1. Verifies the user owns the new address via JWT token, SIWE session, or wallet signature
 * 2. Finds all chats where the session's pseudo-address is a member
 * 3. For each chat, updates the member record and messages to use the authenticated address
 * 4. Returns the list of merged chat IDs
 *
 * Security: Requires one of:
 * - Valid JWT token (passkey wallet) - address derived from token
 * - Valid SIWE session (self-custody wallet) - address from session
 * - Signed message proving ownership of newAddress (fallback)
 */
const MergeSessionSchema = z.object({
  newAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/).optional(),
  message: z.string().optional(),
});

chatRouter.post(
  '/merge-session',
  optionalAuth,
  zValidator('json', MergeSessionSchema),
  async (c) => {
    const sessionId = c.req.header('X-Session-ID');
    const authHeader = c.req.header('Authorization');
    const body = c.req.valid('json');
    const user = c.get('user');

    if (!sessionId || !sessionId.startsWith('ses_')) {
      return c.json({ success: false, error: 'Session ID required' }, 400);
    }

    const newAddress = body.newAddress.toLowerCase();
    let isAuthorized = false;
    let authorizedAddress: string | null = null;

    // Method 1: JWT token (passkey wallet) - user is already authenticated
    // Use smart account address (ERC-4337) for the user
    if (user) {
      try {
        // Get user's smart account on a default chain (e.g., Base)
        // The address is the same across all chains due to CREATE2
        const smartAccount = await getOrCreateSmartAccount(user.id, 8453);
        authorizedAddress = smartAccount.address;
        if (authorizedAddress.toLowerCase() === newAddress) {
          isAuthorized = true;
        }
      } catch (error) {
        // If smart account creation fails, log but continue to other auth methods
        console.error('[merge-session] Failed to get smart account for user:', error);
      }
    }

    // Method 2: SIWE session (self-custody wallet)
    if (!isAuthorized && authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const siweSession = await queryOne<{ wallet_address: string }>(
        `SELECT wallet_address FROM wallet_sessions WHERE session_token = $1 AND expires_at > NOW()`,
        [token],
      );
      if (siweSession && siweSession.wallet_address.toLowerCase() === newAddress) {
        isAuthorized = true;
        authorizedAddress = siweSession.wallet_address;
      }
    }

    // Method 3: Signed message (fallback for when no existing session)
    if (!isAuthorized && body.signature && body.message) {
      const parsed = parseSessionMergeMessage(body.message);
      if (parsed && parsed.address === newAddress && isTimestampValid(parsed.timestamp)) {
        const isValidSignature = await verifyWalletSignature(
          body.message,
          body.signature,
          newAddress,
        );
        if (isValidSignature) {
          isAuthorized = true;
          authorizedAddress = newAddress;
        }
      }
    }

    if (!isAuthorized) {
      return c.json({ success: false, error: 'Not authorized to merge to this address' }, 401);
    }

    // Generate pseudo-address using HMAC (same logic as middleware)
    const pseudoAddress = await getPseudoAddress(sessionId);

    if (pseudoAddress.toLowerCase() === newAddress) {
      // Same address, nothing to merge
      return c.json({
        success: true,
        data: { mergedChatIds: [], message: 'Addresses match, no merge needed' },
      });
    }

    try {
      // Find all chats where pseudo-address is a member
      const memberRecords = await query<
        {
          chat_id: string;
          role: string;
          can_send_messages: boolean;
          can_invite: boolean;
          can_invoke_ai: boolean;
        }
      >(
        `SELECT chat_id, role, can_send_messages, can_invite, can_invoke_ai
         FROM multi_chat_members
         WHERE member_address = $1 AND is_active = TRUE`,
        [pseudoAddress],
      );

      const mergedChatIds: string[] = [];

      for (const record of memberRecords) {
        // Check if new address is already a member of this chat
        const existingMember = await queryOne<{ id: string }>(
          `SELECT id FROM multi_chat_members WHERE chat_id = $1 AND member_address = $2`,
          [record.chat_id, newAddress],
        );

        if (existingMember) {
          // New address already has membership, just deactivate the pseudo-address member
          await execute(
            `UPDATE multi_chat_members SET is_active = FALSE, left_at = NOW() WHERE chat_id = $1 AND member_address = $2`,
            [record.chat_id, pseudoAddress],
          );
        } else {
          // Transfer membership: update the pseudo-address record to use new address
          await execute(
            `UPDATE multi_chat_members SET member_address = $1 WHERE chat_id = $2 AND member_address = $3`,
            [newAddress, record.chat_id, pseudoAddress],
          );
        }

        // Update all messages sent by the pseudo-address to use the new address
        // This ensures message history is associated with the user's real identity
        await execute(
          `UPDATE multi_chat_messages SET sender_address = $1 WHERE chat_id = $2 AND sender_address = $3`,
          [newAddress, record.chat_id, pseudoAddress],
        );

        mergedChatIds.push(record.chat_id);
      }

      return c.json({
        success: true,
        data: {
          mergedChatIds,
          message: `Merged ${mergedChatIds.length} chat(s) to new address`,
        },
      });
    } catch (error) {
      console.error('[Merge Session] Error:', error);
      return c.json({ success: false, error: 'Failed to merge session' }, 500);
    }
  },
);

// ============================================================================
// Component state routes
// ============================================================================

// Schema for component state updates
const ComponentStateSchema = z.object({
  state: z.object({
    status: z.enum(['pending', 'in_progress', 'completed', 'failed']),
  }).passthrough(), // Allow additional fields
});

// GET /chat/messages/:messageId/components - Get all component states for a message
chatRouter.get(
  '/messages/:messageId/components',
  optionalAuth,
  optionalWalletSession,
  async (c) => {
    const messageId = c.req.param('messageId');

    try {
      const states = await getMessageComponentStates(messageId);
      return c.json({ success: true, data: states });
    } catch (error) {
      return errorResponse(c, error, 'Failed to get component states', 500);
    }
  },
);

// GET /chat/messages/:messageId/components/:componentKey - Get specific component state
chatRouter.get(
  '/messages/:messageId/components/:componentKey',
  optionalAuth,
  optionalWalletSession,
  async (c) => {
    const messageId = c.req.param('messageId');
    const componentKey = c.req.param('componentKey');

    try {
      const state = await getComponentState(messageId, componentKey);
      return c.json({ success: true, data: state });
    } catch (error) {
      return errorResponse(c, error, 'Failed to get component state', 500);
    }
  },
);

// PUT /chat/messages/:messageId/components/:componentKey - Set component state
chatRouter.put(
  '/messages/:messageId/components/:componentKey',
  optionalAuth,
  optionalWalletSession,
  zValidator('json', ComponentStateSchema),
  async (c) => {
    const messageId = c.req.param('messageId');
    const componentKey = c.req.param('componentKey');
    const { state } = c.req.valid('json');

    try {
      const savedState = await setComponentState(messageId, componentKey, state as ComponentState);
      return c.json({ success: true, data: savedState });
    } catch (error) {
      return errorResponse(c, error, 'Failed to set component state', 500);
    }
  },
);

// ============================================================================
// Serializers (convert BigInt to strings for JSON)
// ============================================================================

function serializeChat(chat: Chat) {
  return {
    ...chat,
    aiBalanceWei: chat.aiBalanceWei?.toString(),
    aiTotalSpentWei: chat.aiTotalSpentWei?.toString(),
    tokenGate: chat.tokenGate
      ? {
        ...chat.tokenGate,
        minBalance: chat.tokenGate.minBalance?.toString(),
      }
      : undefined,
    // AI toggle
    aiEnabled: chat.aiEnabled ?? true,
    // Organization fields (already serializable)
    isPinned: chat.isPinned,
    pinOrder: chat.pinOrder,
    folderId: chat.folderId,
    autoGeneratedTitle: chat.autoGeneratedTitle,
  };
}

function serializeMember(member: ChatMember) {
  return {
    address: member.memberAddress,
    userId: member.memberUserId,
    role: member.role,
    displayName: member.displayName,
    customEmoji: member.customEmoji,
    joinedAt: member.joinedAt,
    canSendMessages: member.canSendMessages,
    canInvite: member.canInvite,
    canInvokeAi: member.canInvokeAi,
    canManageMembers: member.canManageMembers,
    canPauseAi: member.canPauseAi ?? false,
  };
}

function serializeMessage(message: ChatMessage) {
  return {
    ...message,
    aiCostWei: message.aiCostWei?.toString(),
  };
}

export { chatRouter };
