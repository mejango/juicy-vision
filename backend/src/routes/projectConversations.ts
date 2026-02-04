/**
 * Project Conversations API Routes
 *
 * Enables messaging between project owners and their supporters.
 *
 * Routes:
 * - GET  /project-conversations/owner        - Get conversations for project owner
 * - GET  /project-conversations/supporter    - Get conversations for supporter
 * - GET  /project-conversations/:id          - Get single conversation
 * - POST /project-conversations              - Create/get conversation (requires payment verification)
 * - POST /project-conversations/:id/archive  - Archive conversation
 * - GET  /projects/:projectId/:chainId/supporters - Get supporters for a project
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.ts'
import {
  getOrCreateConversation,
  getConversationsForOwner,
  getConversationsForSupporter,
  getConversationById,
  getConversationByProjectAndSupporter,
  setConversationArchived,
  checkConversationAccess,
  getSupportersForProject,
  getChatIdForConversation,
} from '../services/projectConversations.ts'
import { getChatMessages, sendMessage } from '../services/chat.ts'
import { hasAddressPaidProject, isProjectOwner } from '../services/bendystraw.ts'
import { getOrCreateSmartAccount } from '../services/smartAccounts.ts'
import { getConfig } from '../utils/config.ts'
import { getPrimaryChainId } from '@shared/chains.ts'

const projectConversations = new Hono()

/**
 * Helper to get wallet address from authenticated user context
 */
async function getAddressFromContext(c: any): Promise<string | null> {
  const user = c.get('user')
  if (!user) return null
  try {
    const config = getConfig()
    const smartAccount = await getOrCreateSmartAccount(user.id, getPrimaryChainId(config.isTestnet))
    return smartAccount.address
  } catch {
    return null
  }
}

function getUserIdFromContext(c: any): string | undefined {
  const user = c.get('user')
  return user?.id
}

// ============================================================================
// Schemas
// ============================================================================

const createConversationSchema = z.object({
  projectId: z.number().int().positive(),
  chainId: z.number().int().positive(),
  supporterAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  ownerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  projectName: z.string().optional(),
})

const archiveSchema = z.object({
  archived: z.boolean(),
})

const sendMessageSchema = z.object({
  content: z.string().min(1).max(10000),
})

// ============================================================================
// Routes
// ============================================================================

/**
 * Get conversations for project owner
 * Returns all conversations across all projects they own
 */
projectConversations.get(
  '/owner',
  requireAuth,
  async (c) => {
    const address = await getAddressFromContext(c)
    if (!address) {
      return c.json({ success: false, error: 'Address required' }, 401)
    }

    const projectId = c.req.query('projectId')
    const chainId = c.req.query('chainId')
    const includeArchived = c.req.query('includeArchived') === 'true'
    const limit = parseInt(c.req.query('limit') || '50')
    const offset = parseInt(c.req.query('offset') || '0')

    try {
      const result = await getConversationsForOwner(address, {
        projectId: projectId ? parseInt(projectId) : undefined,
        chainId: chainId ? parseInt(chainId) : undefined,
        includeArchived,
        limit,
        offset,
      })

      return c.json({
        success: true,
        data: result,
      })
    } catch (error) {
      console.error('Error fetching owner conversations:', error)
      return c.json({ success: false, error: 'Failed to fetch conversations' }, 500)
    }
  }
)

/**
 * Get conversations for supporter
 * Returns all projects they've messaged (paid to)
 */
projectConversations.get(
  '/supporter',
  requireAuth,
  async (c) => {
    const address = await getAddressFromContext(c)
    if (!address) {
      return c.json({ success: false, error: 'Address required' }, 401)
    }

    const includeArchived = c.req.query('includeArchived') === 'true'
    const limit = parseInt(c.req.query('limit') || '50')
    const offset = parseInt(c.req.query('offset') || '0')

    try {
      const result = await getConversationsForSupporter(address, {
        includeArchived,
        limit,
        offset,
      })

      return c.json({
        success: true,
        data: result,
      })
    } catch (error) {
      console.error('Error fetching supporter conversations:', error)
      return c.json({ success: false, error: 'Failed to fetch conversations' }, 500)
    }
  }
)

/**
 * Get single conversation by ID
 */
projectConversations.get(
  '/:id',
  requireAuth,
  async (c) => {
    const address = await getAddressFromContext(c)
    const conversationId = c.req.param('id')

    if (!address) {
      return c.json({ success: false, error: 'Address required' }, 401)
    }

    try {
      // Check access
      const role = await checkConversationAccess(conversationId, address)
      if (!role) {
        return c.json({ success: false, error: 'Access denied' }, 403)
      }

      const conversation = await getConversationById(conversationId)
      if (!conversation) {
        return c.json({ success: false, error: 'Conversation not found' }, 404)
      }

      return c.json({
        success: true,
        data: {
          ...conversation,
          role, // Tell the client if they're owner or supporter
        },
      })
    } catch (error) {
      console.error('Error fetching conversation:', error)
      return c.json({ success: false, error: 'Failed to fetch conversation' }, 500)
    }
  }
)

/**
 * Get messages for a conversation
 */
projectConversations.get(
  '/:id/messages',
  requireAuth,
  async (c) => {
    const address = await getAddressFromContext(c)
    const conversationId = c.req.param('id')
    const limit = parseInt(c.req.query('limit') || '100')
    const beforeId = c.req.query('beforeId')

    if (!address) {
      return c.json({ success: false, error: 'Address required' }, 401)
    }

    try {
      // Check access
      const role = await checkConversationAccess(conversationId, address)
      if (!role) {
        return c.json({ success: false, error: 'Access denied' }, 403)
      }

      // Get the underlying chat ID
      const chatId = await getChatIdForConversation(conversationId)
      if (!chatId) {
        return c.json({ success: false, error: 'Conversation not found' }, 404)
      }

      // Use existing chat messages API
      const messages = await getChatMessages(chatId, limit, beforeId)

      return c.json({
        success: true,
        data: messages,
      })
    } catch (error) {
      console.error('Error fetching messages:', error)
      return c.json({ success: false, error: 'Failed to fetch messages' }, 500)
    }
  }
)

/**
 * Send message in a conversation
 */
projectConversations.post(
  '/:id/messages',
  requireAuth,
  zValidator('json', sendMessageSchema),
  async (c) => {
    const address = await getAddressFromContext(c)
    const userId = getUserIdFromContext(c)
    const conversationId = c.req.param('id')
    const { content } = c.req.valid('json')

    if (!address) {
      return c.json({ success: false, error: 'Address required' }, 401)
    }

    try {
      // Check access
      const role = await checkConversationAccess(conversationId, address)
      if (!role) {
        return c.json({ success: false, error: 'Access denied' }, 403)
      }

      // Get the underlying chat ID
      const chatId = await getChatIdForConversation(conversationId)
      if (!chatId) {
        return c.json({ success: false, error: 'Conversation not found' }, 404)
      }

      // Send message using existing chat service
      const message = await sendMessage({
        chatId,
        senderAddress: address!,
        senderUserId: userId,
        content,
      })

      return c.json({
        success: true,
        data: message,
      })
    } catch (error) {
      console.error('Error sending message:', error)
      return c.json({ success: false, error: 'Failed to send message' }, 500)
    }
  }
)

/**
 * Create or get a conversation
 * The caller must be either the owner or the supporter
 */
projectConversations.post(
  '/',
  requireAuth,
  zValidator('json', createConversationSchema),
  async (c) => {
    const address = await getAddressFromContext(c)
    const body = c.req.valid('json')

    if (!address) {
      return c.json({ success: false, error: 'Address required' }, 401)
    }

    // Verify the caller is either the owner or the supporter
    const isOwner = address.toLowerCase() === body.ownerAddress.toLowerCase()
    const isSupporter = address.toLowerCase() === body.supporterAddress.toLowerCase()

    if (!isOwner && !isSupporter) {
      return c.json({
        success: false,
        error: 'You must be the project owner or the supporter to create this conversation',
      }, 403)
    }

    // Verify the caller has the right to create this conversation
    // - Owners can create conversations with any supporter
    // - Supporters must have paid the project
    if (isSupporter) {
      const hasPaid = await hasAddressPaidProject(
        body.projectId,
        body.chainId,
        body.supporterAddress
      )
      if (!hasPaid) {
        return c.json({
          success: false,
          error: 'You must pay the project before starting a conversation',
        }, 403)
      }
    } else if (isOwner) {
      // Verify they actually own the project
      const ownsProject = await isProjectOwner(body.projectId, body.chainId, body.ownerAddress)
      if (!ownsProject) {
        return c.json({
          success: false,
          error: 'You do not own this project',
        }, 403)
      }
    }

    try {
      const conversation = await getOrCreateConversation(body)

      return c.json({
        success: true,
        data: conversation,
      })
    } catch (error) {
      console.error('Error creating conversation:', error)
      return c.json({ success: false, error: 'Failed to create conversation' }, 500)
    }
  }
)

/**
 * Archive/unarchive a conversation
 */
projectConversations.post(
  '/:id/archive',
  requireAuth,
  zValidator('json', archiveSchema),
  async (c) => {
    const address = await getAddressFromContext(c)
    const conversationId = c.req.param('id')
    const { archived } = c.req.valid('json')

    if (!address) {
      return c.json({ success: false, error: 'Address required' }, 401)
    }

    try {
      // Check access and get role
      const role = await checkConversationAccess(conversationId, address)
      if (!role) {
        return c.json({ success: false, error: 'Access denied' }, 403)
      }

      await setConversationArchived(conversationId, role, archived)

      return c.json({
        success: true,
        data: { archived },
      })
    } catch (error) {
      console.error('Error archiving conversation:', error)
      return c.json({ success: false, error: 'Failed to archive conversation' }, 500)
    }
  }
)

/**
 * Get supporters for a specific project
 * Only accessible by project owner
 */
projectConversations.get(
  '/projects/:projectId/:chainId/supporters',
  requireAuth,
  async (c) => {
    const address = await getAddressFromContext(c)
    const projectId = parseInt(c.req.param('projectId'))
    const chainId = parseInt(c.req.param('chainId'))
    const limit = parseInt(c.req.query('limit') || '50')
    const offset = parseInt(c.req.query('offset') || '0')

    if (!address) {
      return c.json({ success: false, error: 'Address required' }, 401)
    }

    // Verify the caller is the project owner
    const ownsProject = await isProjectOwner(projectId, chainId, address)
    if (!ownsProject) {
      return c.json({ success: false, error: 'Only project owners can view supporters' }, 403)
    }

    try {
      const result = await getSupportersForProject(projectId, chainId, { limit, offset })

      return c.json({
        success: true,
        data: result,
      })
    } catch (error) {
      console.error('Error fetching supporters:', error)
      return c.json({ success: false, error: 'Failed to fetch supporters' }, 500)
    }
  }
)

export default projectConversations
