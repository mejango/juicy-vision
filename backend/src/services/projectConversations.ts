/**
 * Project Conversations Service
 *
 * Handles messaging between project owners and their supporters.
 * Each conversation is backed by a multi_chat for full messaging features.
 *
 * User Journeys:
 * - Project Owner: See all supporters who paid, respond to any of them
 * - Supporter: See all projects paid to, follow up on payments
 */

import { query, queryOne, execute, transaction } from '../db/index.ts'
import {
  createChat,
  addMemberViaInvite,
  getChatById,
  getChatMessages,
  sendMessage,
  type Chat,
  type ChatMessage,
  type ChatMember,
} from './chat.ts'

// ============================================================================
// Types
// ============================================================================

export interface ProjectConversation {
  id: string
  chatId: string
  projectId: number
  chainId: number
  supporterAddress: string
  ownerAddress: string
  totalPaidWei: string
  paymentCount: number
  lastPaymentAt?: Date
  isArchivedByOwner: boolean
  isArchivedBySupporter: boolean
  createdAt: Date
  updatedAt: Date
  // Populated fields
  chat?: Chat
  latestMessage?: ChatMessage
  unreadCount?: number
}

export interface ProjectConversationWithContext extends ProjectConversation {
  // Project metadata (from Bendystraw or cache)
  projectName?: string
  projectLogoUri?: string
  // Supporter identity
  supporterEns?: string
  // For UI display
  otherPartyAddress: string // The address of the person you're talking to
  otherPartyName?: string
}

// Raw database row type (snake_case)
interface ProjectConversationRow {
  id: string
  chat_id: string
  project_id: number
  chain_id: number
  supporter_address: string
  owner_address: string
  total_paid_wei: string
  payment_count: number
  last_payment_at?: Date
  is_archived_by_owner: boolean
  is_archived_by_supporter: boolean
  created_at: Date
  updated_at: Date
  latest_message_content?: string
  latest_message_at?: Date
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get or create a conversation between a project and a supporter.
 * Creates the underlying multi_chat if it doesn't exist.
 */
export async function getOrCreateConversation(params: {
  projectId: number
  chainId: number
  supporterAddress: string
  ownerAddress: string
  projectName?: string
}): Promise<ProjectConversation> {
  const { projectId, chainId, supporterAddress, ownerAddress, projectName } = params

  // Check if conversation already exists
  const existing = await queryOne<ProjectConversation>(
    `SELECT * FROM project_conversations
     WHERE project_id = $1 AND chain_id = $2 AND supporter_address = $3`,
    [projectId, chainId, supporterAddress.toLowerCase()]
  )

  if (existing) {
    return mapRowToConversation(existing)
  }

  // Create new conversation with underlying chat
  return await transaction(async (client) => {
    // Create the underlying multi_chat
    // The founder is the project owner, supporter is added as member
    const chatName = projectName
      ? `${projectName} - Support`
      : `Project #${projectId} - Support`

    const chat = await createChat({
      founderAddress: ownerAddress.toLowerCase(),
      name: chatName,
      isPrivate: true, // Don't store for training
      encrypted: false,
    })

    // Add supporter as member with messaging permissions
    await addMemberViaInvite(chat.id, {
      address: supporterAddress.toLowerCase(),
      role: 'member',
      canSendMessages: true,
      canInviteOthers: false,
      canInvokeAi: true,
      canPauseAi: false,
    })

    // Create the project conversation record
    const result = await client.queryObject<ProjectConversation>(
      `INSERT INTO project_conversations
       (chat_id, project_id, chain_id, supporter_address, owner_address)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [chat.id, projectId, chainId, supporterAddress.toLowerCase(), ownerAddress.toLowerCase()]
    )

    return mapRowToConversation(result.rows[0])
  })
}

/**
 * Get all conversations for a project owner (across all their projects).
 */
export async function getConversationsForOwner(
  ownerAddress: string,
  options: {
    projectId?: number
    chainId?: number
    includeArchived?: boolean
    limit?: number
    offset?: number
  } = {}
): Promise<{ conversations: ProjectConversationWithContext[]; total: number }> {
  const { projectId, chainId, includeArchived = false, limit = 50, offset = 0 } = options

  let whereClause = 'WHERE pc.owner_address = $1'
  const params: (string | number | boolean)[] = [ownerAddress.toLowerCase()]
  let paramIndex = 2

  if (!includeArchived) {
    whereClause += ` AND pc.is_archived_by_owner = FALSE`
  }

  if (projectId !== undefined) {
    whereClause += ` AND pc.project_id = $${paramIndex++}`
    params.push(projectId)
  }

  if (chainId !== undefined) {
    whereClause += ` AND pc.chain_id = $${paramIndex++}`
    params.push(chainId)
  }

  // Get total count
  const countResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM project_conversations pc ${whereClause}`,
    params
  )
  const total = parseInt(countResult?.count || '0')

  // Get conversations with latest message
  const rows = await query<ProjectConversationRow>(
    `SELECT pc.*,
            (SELECT content FROM multi_chat_messages m
             WHERE m.chat_id = pc.chat_id AND m.deleted_at IS NULL
             ORDER BY m.created_at DESC LIMIT 1) as latest_message_content,
            (SELECT created_at FROM multi_chat_messages m
             WHERE m.chat_id = pc.chat_id AND m.deleted_at IS NULL
             ORDER BY m.created_at DESC LIMIT 1) as latest_message_at
     FROM project_conversations pc
     ${whereClause}
     ORDER BY pc.updated_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    [...params, limit, offset]
  )

  const conversations: ProjectConversationWithContext[] = rows.map((row) => ({
    ...mapRowToConversation(row),
    otherPartyAddress: row.supporter_address,
    latestMessage: row.latest_message_content
      ? {
          id: '',
          chatId: row.chat_id,
          senderAddress: '',
          role: 'user' as const,
          content: row.latest_message_content,
          isEncrypted: false,
          createdAt: row.latest_message_at || new Date(),
        }
      : undefined,
  }))

  return { conversations, total }
}

/**
 * Get all conversations for a supporter (projects they've paid to).
 */
export async function getConversationsForSupporter(
  supporterAddress: string,
  options: {
    includeArchived?: boolean
    limit?: number
    offset?: number
  } = {}
): Promise<{ conversations: ProjectConversationWithContext[]; total: number }> {
  const { includeArchived = false, limit = 50, offset = 0 } = options

  let whereClause = 'WHERE pc.supporter_address = $1'
  const params: (string | number | boolean)[] = [supporterAddress.toLowerCase()]

  if (!includeArchived) {
    whereClause += ` AND pc.is_archived_by_supporter = FALSE`
  }

  // Get total count
  const countResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM project_conversations pc ${whereClause}`,
    params
  )
  const total = parseInt(countResult?.count || '0')

  // Get conversations with latest message
  const rows = await query<ProjectConversationRow>(
    `SELECT pc.*,
            (SELECT content FROM multi_chat_messages m
             WHERE m.chat_id = pc.chat_id AND m.deleted_at IS NULL
             ORDER BY m.created_at DESC LIMIT 1) as latest_message_content,
            (SELECT created_at FROM multi_chat_messages m
             WHERE m.chat_id = pc.chat_id AND m.deleted_at IS NULL
             ORDER BY m.created_at DESC LIMIT 1) as latest_message_at
     FROM project_conversations pc
     ${whereClause}
     ORDER BY pc.updated_at DESC
     LIMIT $2 OFFSET $3`,
    [...params, limit, offset]
  )

  const conversations: ProjectConversationWithContext[] = rows.map((row) => ({
    ...mapRowToConversation(row),
    otherPartyAddress: row.owner_address,
    latestMessage: row.latest_message_content
      ? {
          id: '',
          chatId: row.chat_id,
          senderAddress: '',
          role: 'user' as const,
          content: row.latest_message_content,
          isEncrypted: false,
          createdAt: row.latest_message_at || new Date(),
        }
      : undefined,
  }))

  return { conversations, total }
}

/**
 * Get a single conversation by ID.
 */
export async function getConversationById(
  conversationId: string
): Promise<ProjectConversation | null> {
  const row = await queryOne<ProjectConversation>(
    `SELECT * FROM project_conversations WHERE id = $1`,
    [conversationId]
  )
  return row ? mapRowToConversation(row) : null
}

/**
 * Get a conversation by project and supporter.
 */
export async function getConversationByProjectAndSupporter(
  projectId: number,
  chainId: number,
  supporterAddress: string
): Promise<ProjectConversation | null> {
  const row = await queryOne<ProjectConversation>(
    `SELECT * FROM project_conversations
     WHERE project_id = $1 AND chain_id = $2 AND supporter_address = $3`,
    [projectId, chainId, supporterAddress.toLowerCase()]
  )
  return row ? mapRowToConversation(row) : null
}

/**
 * Update payment stats for a conversation (called when payments are indexed).
 */
export async function updatePaymentStats(
  projectId: number,
  chainId: number,
  supporterAddress: string,
  stats: {
    totalPaidWei: string
    paymentCount: number
    lastPaymentAt: Date
  }
): Promise<void> {
  await execute(
    `UPDATE project_conversations
     SET total_paid_wei = $4, payment_count = $5, last_payment_at = $6
     WHERE project_id = $1 AND chain_id = $2 AND supporter_address = $3`,
    [
      projectId,
      chainId,
      supporterAddress.toLowerCase(),
      stats.totalPaidWei,
      stats.paymentCount,
      stats.lastPaymentAt,
    ]
  )
}

/**
 * Archive/unarchive a conversation.
 */
export async function setConversationArchived(
  conversationId: string,
  archivedBy: 'owner' | 'supporter',
  archived: boolean
): Promise<void> {
  const column = archivedBy === 'owner' ? 'is_archived_by_owner' : 'is_archived_by_supporter'
  await execute(
    `UPDATE project_conversations SET ${column} = $2 WHERE id = $1`,
    [conversationId, archived]
  )
}

/**
 * Get the chat ID for a conversation (used to access messages via existing chat API).
 */
export async function getChatIdForConversation(
  conversationId: string
): Promise<string | null> {
  const row = await queryOne<{ chat_id: string }>(
    `SELECT chat_id FROM project_conversations WHERE id = $1`,
    [conversationId]
  )
  return row?.chat_id || null
}

/**
 * Check if an address can participate in a project conversation.
 * Returns the role (owner/supporter) if allowed, null otherwise.
 */
export async function checkConversationAccess(
  conversationId: string,
  address: string
): Promise<'owner' | 'supporter' | null> {
  const conversation = await getConversationById(conversationId)
  if (!conversation) return null

  const lowerAddress = address.toLowerCase()
  if (conversation.ownerAddress.toLowerCase() === lowerAddress) return 'owner'
  if (conversation.supporterAddress.toLowerCase() === lowerAddress) return 'supporter'
  return null
}

/**
 * Get supporters for a project with their conversation info.
 * Used by project owners to see who has paid.
 */
export async function getSupportersForProject(
  projectId: number,
  chainId: number,
  options: { limit?: number; offset?: number } = {}
): Promise<{ supporters: ProjectConversation[]; total: number }> {
  const { limit = 50, offset = 0 } = options

  const countResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM project_conversations
     WHERE project_id = $1 AND chain_id = $2`,
    [projectId, chainId]
  )
  const total = parseInt(countResult?.count || '0')

  const rows = await query<ProjectConversation>(
    `SELECT * FROM project_conversations
     WHERE project_id = $1 AND chain_id = $2
     ORDER BY updated_at DESC
     LIMIT $3 OFFSET $4`,
    [projectId, chainId, limit, offset]
  )

  return {
    supporters: rows.map(mapRowToConversation),
    total,
  }
}

// ============================================================================
// Helpers
// ============================================================================

// deno-lint-ignore no-explicit-any
function mapRowToConversation(row: any): ProjectConversation {
  return {
    id: row.id,
    chatId: row.chat_id,
    projectId: row.project_id,
    chainId: row.chain_id,
    supporterAddress: row.supporter_address,
    ownerAddress: row.owner_address,
    totalPaidWei: row.total_paid_wei || '0',
    paymentCount: row.payment_count || 0,
    lastPaymentAt: row.last_payment_at ? new Date(row.last_payment_at) : undefined,
    isArchivedByOwner: row.is_archived_by_owner || false,
    isArchivedBySupporter: row.is_archived_by_supporter || false,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}
