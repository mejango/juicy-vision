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
import { requireAuth, optionalAuth } from '../middleware/auth.ts';
import {
  createChat,
  getChatById,
  getChatsForAddress,
  getPublicChats,
  getChatMembers,
  getMember,
  addMember,
  addMemberViaInvite,
  removeMember,
  updateMemberPermissions,
  updateMemberProfile,
  updateUserEmoji,
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
  reportChat,
  toggleChatAiEnabled,
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
import { getOrCreateSmartAccount } from '../services/smartAccounts.ts';
import {
  getOnlineMembers,
} from '../services/websocket.ts';
import { query, queryOne, execute } from '../db/index.ts';
import { getConfig } from '../utils/config.ts';
import { getPrimaryChainId } from '@shared/chains.ts';
import { getPseudoAddress, verifyWalletSignature, parseSessionMergeMessage, isTimestampValid } from '../utils/crypto.ts';
import { rateLimitMiddleware, rateLimitByWallet } from '../services/rateLimit.ts';
import { parseConfidence } from '../services/claude.ts';
import { createEscalation, updateMessageConfidence } from '../services/escalation.ts';
import {
  getComponentState,
  setComponentState,
  getMessageComponentStates,
  type ComponentState,
} from '../services/componentState.ts';
// Rate limiting removed - AI is free for everyone

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
  const { getOrCreateSmartAccount } = await import('../services/smartAccounts.ts');

  const jwtResult = await validateSession(token);
  if (jwtResult) {
    const config = getConfig();
    const smartAccount = await getOrCreateSmartAccount(jwtResult.user.id, getPrimaryChainId(config.isTestnet));
    return {
      address: smartAccount.address,
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
    // User authenticated - get their smart account address
    const { getOrCreateSmartAccount } = await import('../services/smartAccounts.ts');
    const config = getConfig();
    const smartAccount = await getOrCreateSmartAccount(user.id, getPrimaryChainId(config.isTestnet));
    c.set('walletSession', { address: smartAccount.address, userId: user.id } as WalletSession);
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
    // Create a pseudo-address using HMAC-SHA256 for anonymous users
    // This allows them to own chats and create invites
    const pseudoAddress = await getPseudoAddress(sessionId);
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
    // User authenticated - get their smart account address
    const { getOrCreateSmartAccount } = await import('../services/smartAccounts.ts');
    const config = getConfig();
    const smartAccount = await getOrCreateSmartAccount(user.id, getPrimaryChainId(config.isTestnet));
    c.set('walletSession', { address: smartAccount.address, userId: user.id } as WalletSession);
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
    const pseudoAddress = await getPseudoAddress(sessionId);
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

// Debug log (console only, no filesystem writes for security)
function debugLog(msg: string) {
  if (Deno.env.get('DENO_ENV') !== 'production') {
    console.log(`[Chat Debug] ${msg}`);
  }
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

    let canRead = await checkPermission(chatId, walletSession.address, 'read');
    debugLog(`[Fetch Chat] Can read with primary address: ${canRead}`);

    // If primary auth failed, try anonymous session ID as fallback
    // This handles cases where user joined via invite with session ID but has a different wallet connected
    if (!canRead && sessionId && sessionId.startsWith('ses_')) {
      const pseudoAddress = await getPseudoAddress(sessionId);
      if (pseudoAddress !== walletSession.address) {
        debugLog(`[Fetch Chat] Trying fallback pseudo-address: ${pseudoAddress}`);
        canRead = await checkPermission(chatId, pseudoAddress, 'read');
        debugLog(`[Fetch Chat] Can read with pseudo-address: ${canRead}`);
      }
    }

    if (!canRead) {
      debugLog(`[Fetch Chat] DENIED: No read permission for address ${walletSession.address}`);
      return c.json({ success: false, error: 'Access denied' }, 403);
    }
  }

  const members = await getChatMembers(chatId);
  const onlineMembers = getOnlineMembers(chatId);

  console.log(`[FetchChat] Chat ${chatId} returning ${members.length} members:`, members.map(m => ({ address: m.memberAddress, role: m.role })));

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
    const sessionId = c.req.header('X-Session-ID');

    // Check read permission for private chats
    if (!chat.isPublic && walletSession) {
      let canRead = await checkPermission(chatId, walletSession.address, 'read');

      // If primary auth failed, try anonymous session ID as fallback
      if (!canRead && sessionId && sessionId.startsWith('ses_')) {
        const pseudoAddress = await getPseudoAddress(sessionId);
        if (pseudoAddress !== walletSession.address) {
          canRead = await checkPermission(chatId, pseudoAddress, 'read');
        }
      }

      if (!canRead) {
        return c.json({ success: false, error: 'Access denied' }, 403);
      }
    } else if (!chat.isPublic) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }

    const members = await getChatMembers(chatId);
    console.log(`[Members Endpoint] Chat ${chatId} returning ${members.length} members:`, members.map(m => ({ address: m.memberAddress, role: m.role })));
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
        body
      );
      return c.json({ success: true, data: serializeMember(member) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update permissions';
      return c.json({ success: false, error: message }, 400);
    }
  }
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
      const message = error instanceof Error ? error.message : 'Failed to update emoji';
      return c.json({ success: false, error: message }, 400);
    }
  }
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
  { message: 'Message must have content or attachments' }
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
                [chatId, pseudoAddress]
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
      let attachmentMetadata: Array<{ type: 'image' | 'document'; name: string; mimeType: string; cid: string }> | undefined;
      if (body.attachments && body.attachments.length > 0) {
        const { pinFileToIpfs } = await import('../services/ipfs.ts');
        attachmentMetadata = [];
        for (const att of body.attachments) {
          try {
            const cid = await pinFileToIpfs(att.data, att.name, att.mimeType);
            attachmentMetadata.push({ type: att.type, name: att.name, mimeType: att.mimeType, cid });
          } catch (err) {
            console.error(`[IPFS] Failed to pin attachment ${att.name}:`, err);
            // Skip failed attachments, don't fail the message
          }
        }
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
  const sessionId = c.req.header('X-Session-ID');

  if (!chat.isPublic && walletSession) {
    let canRead = await checkPermission(chatId, walletSession.address, 'read');

    // If primary auth failed, try anonymous session ID as fallback
    if (!canRead && sessionId && sessionId.startsWith('ses_')) {
      const pseudoAddress = await getPseudoAddress(sessionId);
      if (pseudoAddress !== walletSession.address) {
        canRead = await checkPermission(chatId, pseudoAddress, 'read');
      }
    }

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
  }
);

// POST /chat/:chatId/ai/invoke - Invoke AI to respond to the chat (streaming)
const InvokeAiSchema = z.object({
  prompt: z.string().max(10000),
  attachments: z.array(AttachmentSchema).max(5).optional(),
  apiKey: z.string().optional(), // User-provided Claude API key (BYOK)
  savePrompt: z.boolean().optional(), // Save prompt to DB for future AI context (hidden messages)
}).refine(
  (data) => data.prompt.length > 0 || (data.attachments && data.attachments.length > 0),
  { message: 'Message must have prompt or attachments' }
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
        return c.json({ success: false, error: 'You do not have permission to invoke AI in this chat' }, 403);
      }

      // AI is free for everyone - no rate limiting

      // Build optimized context with summaries, state, and token budgeting
      const { buildOptimizedContext, formatContextForClaude, logContextUsage } = await import('../services/contextManager.ts');
      const { buildEnhancedPrompt } = await import('../services/aiProvider.ts');
      const { logIntentDetection, createMetricsEntryFromResult } = await import('../services/intentMetrics.ts');

      const optimizedContext = await buildOptimizedContext(chatId, walletSession.userId);
      const chatHistory = formatContextForClaude(optimizedContext);

      // Build enhanced system prompt with transaction state and user context
      // Phase 1: Enable sub-modules for token efficiency
      // Phase 2: Enable semantic detection when embeddings are available
      const { systemPrompt: enhancedSystem, intents, semanticResult } = await buildEnhancedPrompt({
        chatId,
        userId: walletSession.userId,
        includeOmnichain: true,
        useSubModules: true,  // Phase 1: Granular sub-module loading
        useSemanticDetection: false,  // Phase 2: Enable when embeddings are seeded
      });

      // Log intent detection metrics for optimization
      let metricsId = '';
      if (semanticResult) {
        const metricsEntry = createMetricsEntryFromResult(semanticResult, chatId);
        metricsId = await logIntentDetection(metricsEntry);
      } else if (intents) {
        // Log keyword-only detection
        metricsId = await logIntentDetection({
          chatId,
          detectedIntents: [
            intents.needsDataQuery ? 'dataQuery' : '',
            intents.needsHookDeveloper ? 'hookDeveloper' : '',
            intents.needsTransaction ? 'transaction' : '',
          ].filter(Boolean),
          subModulesLoaded: intents.transactionSubModules || [],
          detectionMethod: 'keyword',
          detectionTimeMs: 0,
        });
      }

      // Build multimodal content blocks for the new prompt
      const contentBlocks: Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } } | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }> = [];

      // Pin image attachments to IPFS first so we can include URIs in the prompt
      const ipfsUris: Record<string, string> = {};
      if (body.attachments && body.attachments.length > 0) {
        const { pinFileToIpfs } = await import('../services/ipfs.ts');
        for (const attachment of body.attachments) {
          if (attachment.type === 'image') {
            try {
              const cid = await pinFileToIpfs(
                attachment.data,
                attachment.name || `image.${attachment.mimeType.split('/')[1] || 'png'}`,
                attachment.mimeType
              );
              // Extract field ID from attachment name (format: fieldId.ext)
              const fieldId = attachment.name?.split('.')[0] || 'image';
              ipfsUris[fieldId] = `ipfs://${cid}`;
              console.log(`[IPFS] Pinned attachment ${fieldId} to ${ipfsUris[fieldId]}`);
            } catch (err) {
              console.error('Failed to pin image to IPFS:', err);
            }
          }
        }
      }

      // Build prompt text, including IPFS URIs for any pinned images
      let promptText = body.prompt || '';
      if (Object.keys(ipfsUris).length > 0) {
        const uriList = Object.entries(ipfsUris)
          .map(([fieldId, uri]) => `- ${fieldId}: ${uri}`)
          .join('\n');
        promptText += `\n\n[Uploaded images pinned to IPFS - use these URIs in transaction parameters:\n${uriList}]`;
      }

      // Add text content if present
      if (promptText.length > 0) {
        contentBlocks.push({ type: 'text', text: promptText });
      }

      // Add attachments as content blocks (for Claude to see the image)
      if (body.attachments && body.attachments.length > 0) {
        for (const attachment of body.attachments) {
          if (attachment.type === 'image') {
            contentBlocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: attachment.mimeType,
                data: attachment.data,
              },
            });
          } else if (attachment.type === 'document') {
            contentBlocks.push({
              type: 'document',
              source: {
                type: 'base64',
                media_type: attachment.mimeType,
                data: attachment.data,
              },
            });
          }
        }
      }

      // Add the new prompt to history (use string if no attachments, blocks otherwise)
      const hasAttachments = body.attachments && body.attachments.length > 0;
      if (hasAttachments) {
        chatHistory.push({ role: 'user', content: contentBlocks });
      } else {
        chatHistory.push({ role: 'user', content: body.prompt });
      }

      // Import services
      const { streamMessageWithTools } = await import('../services/aiProvider.ts');
      const { importMessage } = await import('../services/chat.ts');
      const { streamAiToken, broadcastChatMessage } = await import('../services/websocket.ts');

      // When savePrompt is true, persist the hidden prompt to the database so it's
      // available in future AI context. importMessage doesn't broadcast to the UI.
      // This is critical for system messages (e.g. per-chain projectIds after deployment)
      // that need to be in conversation history for subsequent operations like setUriOf.
      if (body.savePrompt) {
        await importMessage({
          chatId,
          senderAddress: walletSession.address,
          role: 'user',
          content: body.prompt,
        });
      }

      // Generate a message ID upfront for streaming
      const messageId = crypto.randomUUID();
      const assistantAddress = '0x0000000000000000000000000000000000000000';

      // Extract user's API key if provided (BYOK)
      const userApiKey = body.apiKey;

      // Stream Claude response with automatic tool execution
      let fullContent = '';
      let streamingStarted = false;
      let transactionPreviewCount = 0;
      let duplicatePreviewDetected = false;
      let firstPreviewComplete = false; // Track when first preview is complete

      try {
        for await (const event of streamMessageWithTools(chatId, { messages: chatHistory, system: enhancedSystem }, userApiKey)) {
          streamingStarted = true;
          if (event.type === 'text') {
            const token = event.data as string;
            const testContent = fullContent + token;

            // AGGRESSIVE DUPLICATE PREVENTION:
            // Once we have a complete transaction-preview, stop accepting any more content
            // that could start another one
            if (firstPreviewComplete) {
              // Check if new content tries to start another transaction-preview
              const afterFirstPreview = testContent.substring(fullContent.lastIndexOf('/>') + 2);
              if (afterFirstPreview.includes('<juice-component') ||
                  afterFirstPreview.includes('type="transaction-preview"') ||
                  afterFirstPreview.includes("type='transaction-preview'")) {
                console.warn(`[AI] ${chatId}: Detected attempt to start second transaction-preview after first was complete, stopping stream`);
                duplicatePreviewDetected = true;
                break;
              }
            }

            // Check for complete transaction-preview (ends with />)
            const completePreviewRegex = /<juice-component[^>]*type=["']transaction-preview["'][^>]*\/>/g;
            const completeMatches = [...testContent.matchAll(completePreviewRegex)];

            if (completeMatches.length >= 1 && !firstPreviewComplete) {
              firstPreviewComplete = true;
              console.log(`[AI] ${chatId}: First complete transaction-preview detected, will stop if second starts`);
            }

            // Also catch if a single chunk contains multiple previews
            const newCount = (testContent.match(/<juice-component[^>]*type=["']transaction-preview["']/g) || []).length;
            if (newCount > 1 && newCount > transactionPreviewCount) {
              console.warn(`[AI] ${chatId}: Detected ${newCount} transaction-previews in content - Claude violated ONE TRANSACTION-PREVIEW rule`);
              duplicatePreviewDetected = true;

              // Try to salvage: keep only up to end of first complete preview
              if (completeMatches.length > 0) {
                const firstComplete = completeMatches[0];
                const endOfFirst = (firstComplete.index || 0) + firstComplete[0].length;
                const cleanedContent = testContent.substring(0, endOfFirst);
                // Only stream what we haven't streamed yet
                const newPart = cleanedContent.substring(fullContent.length);
                if (newPart) {
                  streamAiToken(chatId, messageId, newPart, false);
                }
                fullContent = cleanedContent;
              }
              break;
            }

            transactionPreviewCount = newCount;
            fullContent = testContent;

            // Broadcast each token to connected clients
            streamAiToken(chatId, messageId, token, false);
          } else if (event.type === 'thinking') {
            // Log tool usage for debugging (not shown to user)
            console.log(`[AI] ${chatId}: ${event.data}`);
          } else if (event.type === 'tool_result') {
            // Optionally show tool results (could be verbose, so we keep it subtle)
            const result = event.data as { id: string; name: string; result?: string; error?: string };
            if (result.error) {
              const errorText = `\n\n> ⚠️ Tool error: ${result.error}\n\n`;
              fullContent += errorText;
              streamAiToken(chatId, messageId, errorText, false);
            }
          }
        }

        // If the AI produced no text (e.g., tool calls exhausted token budget, or empty
        // data from bendystraw for a freshly deployed project), surface a recovery message
        if (!fullContent.trim()) {
          console.warn(`[AI] ${chatId}: Stream completed with no text content`);
          fullContent = "Sorry, I wasn't able to process that. Could you try again?";
          streamAiToken(chatId, messageId, fullContent, false);
        }
      } catch (streamError) {
        // Parse error and provide user-friendly message
        const rawMsg = streamError instanceof Error ? streamError.message : 'Stream interrupted';
        console.error(`[AI] ${chatId}: Stream error - ${rawMsg}`);

        // Categorize the error for better UX
        // BYOK users get specific messages about their own API key
        const isUsingOwnKey = !!userApiKey;
        let userFriendlyMsg: string;

        if (rawMsg.includes('credit balance is too low') || rawMsg.includes('purchase credits')) {
          userFriendlyMsg = isUsingOwnKey
            ? "Your Anthropic API key has run out of credits. Please add credits at console.anthropic.com or remove your key to use Juicy's service."
            : "I'm temporarily unavailable due to a service limit. The team has been notified - please try again shortly!";
        } else if (rawMsg.includes('rate_limit') || rawMsg.includes('too many requests')) {
          userFriendlyMsg = isUsingOwnKey
            ? "Your API key has hit a rate limit. Please wait a moment and try again."
            : "I'm getting a lot of requests right now. Please wait a moment and try again.";
        } else if (rawMsg.includes('overloaded') || rawMsg.includes('capacity')) {
          userFriendlyMsg = "The AI service is a bit overloaded. Please try again in a few seconds.";
        } else if (rawMsg.includes('invalid_api_key') || rawMsg.includes('authentication')) {
          userFriendlyMsg = isUsingOwnKey
            ? "Your API key appears to be invalid. Please check your key in Settings."
            : "There's a configuration issue. The team has been notified.";
        } else {
          userFriendlyMsg = "Something went wrong. Please try again.";
        }

        if (streamingStarted) {
          fullContent += `\n\n*${userFriendlyMsg}*`;
          streamAiToken(chatId, messageId, `\n\n*${userFriendlyMsg}*`, false);
        }
      } finally {
        // Always signal streaming is done, even on error
        streamAiToken(chatId, messageId, '', true);
      }

      // If we detected duplicate previews, clean up the content
      // Find incomplete transaction-preview tags and remove them
      if (duplicatePreviewDetected || transactionPreviewCount > 1) {
        // Find the last complete transaction-preview (ends with />)
        const completePreviewRegex = /<juice-component[^>]*type=["']transaction-preview["'][^>]*\/>/g;
        const completeMatches = [...fullContent.matchAll(completePreviewRegex)];

        if (completeMatches.length > 0) {
          // Keep up to the end of the first complete preview
          const firstComplete = completeMatches[0];
          const endOfFirst = (firstComplete.index || 0) + firstComplete[0].length;
          fullContent = fullContent.substring(0, endOfFirst);
          console.log(`[AI] ${chatId}: Cleaned up duplicate previews, keeping first complete preview`);
        } else {
          // No complete previews - find start of first one and remove everything after it
          const previewStart = fullContent.indexOf('<juice-component');
          if (previewStart > 0) {
            fullContent = fullContent.substring(0, previewStart).trim();
            fullContent += '\n\n*Something went wrong generating the transaction. Please try again.*';
            console.log(`[AI] ${chatId}: No complete preview found, removed incomplete content`);
          }
        }
      }

      // Parse and strip confidence tag from AI response
      const { content: cleanedContent, confidence } = parseConfidence(fullContent);

      // Store the complete AI response as a message (with confidence tag stripped)
      const aiMessage = await importMessage({
        chatId,
        senderAddress: assistantAddress,
        role: 'assistant',
        content: cleanedContent,
      });

      // Store confidence metadata and create escalation if low confidence
      if (confidence) {
        updateMessageConfidence({
          messageId: aiMessage.id,
          confidenceLevel: confidence.level,
          confidenceReason: confidence.reason,
        }).catch(err => {
          console.error('Failed to update message confidence:', err);
        });

        // Update intent metrics with AI confidence level
        if (metricsId) {
          const { updateIntentMetrics } = await import('../services/intentMetrics.ts');
          updateIntentMetrics(metricsId, {
            aiConfidenceLevel: confidence.level,
          }).catch(err => {
            console.error('Failed to update intent metrics with confidence:', err);
          });
        }

        // Auto-escalate low confidence responses for admin review
        if (confidence.level === 'low') {
          createEscalation({
            chatId,
            messageId: aiMessage.id,
            userQuery: body.prompt,
            aiResponse: cleanedContent,
            confidenceLevel: confidence.level,
            confidenceReason: confidence.reason,
          }).catch(err => {
            console.error('Failed to create escalation:', err);
          });
        }
      }

      // Update fullContent for downstream processing (state extraction, etc.)
      fullContent = cleanedContent;

      // Context management: Extract transaction state and trigger summarization (async, non-blocking)
      const { extractStateFromResponse } = await import('../services/transactionState.ts');
      const { checkAndTriggerSummarization, queueAttachmentSummary } = await import('../services/summarization.ts');

      // Extract project design decisions from the response
      extractStateFromResponse(chatId, fullContent, aiMessage.id).catch(err => {
        console.error('Failed to extract transaction state:', err);
      });

      // Check if we need to summarize older messages
      checkAndTriggerSummarization(chatId).catch(err => {
        console.error('Failed to check/trigger summarization:', err);
      });

      // Log context usage for analytics
      logContextUsage(chatId, aiMessage.id, optimizedContext).catch(err => {
        console.error('Failed to log context usage:', err);
      });

      // Queue attachment summaries for the user's message if any
      if (body.attachments && body.attachments.length > 0) {
        // We need the user message ID - get the latest user message
        const userMessages = await getChatMessages(chatId, 2);
        const userMessage = userMessages.find(m => m.role === 'user');
        if (userMessage) {
          for (let i = 0; i < body.attachments.length; i++) {
            const att = body.attachments[i];
            queueAttachmentSummary(userMessage.id, chatId, i, {
              type: att.type,
              mimeType: att.mimeType,
              data: att.data,
              filename: att.name,
            });
          }
        }
      }

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
  zValidator('json', z.object({
    reason: z.string().optional(),
  }).optional()),
  async (c) => {
    const chatId = c.req.param('chatId');
    const body = c.req.valid('json') || {};
    const wallet = c.get('walletSession');
    const user = c.get('user');

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
  }
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
        [token]
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
        const isValidSignature = await verifyWalletSignature(body.message, body.signature, newAddress);
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
      return c.json({ success: true, data: { mergedChatIds: [], message: 'Addresses match, no merge needed' } });
    }

    try {
      // Find all chats where pseudo-address is a member
      const memberRecords = await query<{ chat_id: string; role: string; can_send_messages: boolean; can_invite: boolean; can_invoke_ai: boolean }>(
        `SELECT chat_id, role, can_send_messages, can_invite, can_invoke_ai
         FROM multi_chat_members
         WHERE member_address = $1 AND is_active = TRUE`,
        [pseudoAddress]
      );

      const mergedChatIds: string[] = [];

      for (const record of memberRecords) {
        // Check if new address is already a member of this chat
        const existingMember = await queryOne<{ id: string }>(
          `SELECT id FROM multi_chat_members WHERE chat_id = $1 AND member_address = $2`,
          [record.chat_id, newAddress]
        );

        if (existingMember) {
          // New address already has membership, just deactivate the pseudo-address member
          await execute(
            `UPDATE multi_chat_members SET is_active = FALSE, left_at = NOW() WHERE chat_id = $1 AND member_address = $2`,
            [record.chat_id, pseudoAddress]
          );
        } else {
          // Transfer membership: update the pseudo-address record to use new address
          await execute(
            `UPDATE multi_chat_members SET member_address = $1 WHERE chat_id = $2 AND member_address = $3`,
            [newAddress, record.chat_id, pseudoAddress]
          );
        }

        // Update all messages sent by the pseudo-address to use the new address
        // This ensures message history is associated with the user's real identity
        await execute(
          `UPDATE multi_chat_messages SET sender_address = $1 WHERE chat_id = $2 AND sender_address = $3`,
          [newAddress, record.chat_id, pseudoAddress]
        );

        mergedChatIds.push(record.chat_id);
      }

      return c.json({
        success: true,
        data: {
          mergedChatIds,
          message: `Merged ${mergedChatIds.length} chat(s) to new address`
        }
      });
    } catch (error) {
      console.error('[Merge Session] Error:', error);
      return c.json({ success: false, error: 'Failed to merge session' }, 500);
    }
  }
);

// ============================================================================
// Component State Routes (for transaction-preview, etc.)
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
      const message = error instanceof Error ? error.message : 'Failed to get component states';
      return c.json({ success: false, error: message }, 500);
    }
  }
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
      const message = error instanceof Error ? error.message : 'Failed to get component state';
      return c.json({ success: false, error: message }, 500);
    }
  }
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
      const message = error instanceof Error ? error.message : 'Failed to set component state';
      return c.json({ success: false, error: message }, 500);
    }
  }
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
    // AI toggle
    aiEnabled: chat.aiEnabled ?? true,
    // Organization fields (already serializable)
    isPinned: chat.isPinned,
    pinOrder: chat.pinOrder,
    folderId: chat.folderId,
    autoGeneratedTitle: chat.autoGeneratedTitle,
  };
}

function serializeMember(member: any) {
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

function serializeMessage(message: any) {
  return {
    ...message,
    aiCostWei: message.aiCostWei?.toString(),
  };
}

export { chatRouter };
