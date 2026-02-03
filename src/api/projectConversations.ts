/**
 * Project Conversations API Service
 *
 * Handles messaging between project owners and supporters.
 */

import { useAuthStore } from '../stores/authStore'
import { getSessionId } from '../services/session'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

// =============================================================================
// Types
// =============================================================================

export interface ProjectConversation {
  id: string
  chatId: string
  projectId: number
  chainId: number
  supporterAddress: string
  ownerAddress: string
  totalPaidWei: string
  paymentCount: number
  lastPaymentAt?: string
  isArchivedByOwner: boolean
  isArchivedBySupporter: boolean
  createdAt: string
  updatedAt: string
  // Populated fields
  role?: 'owner' | 'supporter'
  otherPartyAddress?: string
  projectName?: string
  projectLogoUri?: string
  latestMessage?: {
    content: string
    createdAt: string
  }
}

export interface ConversationMessage {
  id: string
  chatId: string
  senderAddress: string
  senderUserId?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  isEncrypted: boolean
  createdAt: string
  editedAt?: string
}

// =============================================================================
// API Client
// =============================================================================

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = useAuthStore.getState().token
  const sessionId = getSessionId()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Session-ID': sessionId,
    ...(options.headers as Record<string, string>),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  })

  const data: ApiResponse<T> = await response.json()

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Request failed')
  }

  return data.data as T
}

// =============================================================================
// Conversation Functions
// =============================================================================

/**
 * Get all conversations for a project owner
 */
export async function getOwnerConversations(options?: {
  projectId?: number
  chainId?: number
  includeArchived?: boolean
  limit?: number
  offset?: number
}): Promise<{ conversations: ProjectConversation[]; total: number }> {
  const params = new URLSearchParams()
  if (options?.projectId) params.set('projectId', String(options.projectId))
  if (options?.chainId) params.set('chainId', String(options.chainId))
  if (options?.includeArchived) params.set('includeArchived', 'true')
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.offset) params.set('offset', String(options.offset))

  const queryString = params.toString()
  return apiRequest(`/project-conversations/owner${queryString ? `?${queryString}` : ''}`)
}

/**
 * Get all conversations for a supporter (projects they've paid)
 */
export async function getSupporterConversations(options?: {
  includeArchived?: boolean
  limit?: number
  offset?: number
}): Promise<{ conversations: ProjectConversation[]; total: number }> {
  const params = new URLSearchParams()
  if (options?.includeArchived) params.set('includeArchived', 'true')
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.offset) params.set('offset', String(options.offset))

  const queryString = params.toString()
  return apiRequest(`/project-conversations/supporter${queryString ? `?${queryString}` : ''}`)
}

/**
 * Get a single conversation by ID
 */
export async function getConversation(conversationId: string): Promise<ProjectConversation> {
  return apiRequest(`/project-conversations/${conversationId}`)
}

/**
 * Get messages for a conversation
 */
export async function getConversationMessages(
  conversationId: string,
  options?: { limit?: number; beforeId?: string }
): Promise<ConversationMessage[]> {
  const params = new URLSearchParams()
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.beforeId) params.set('beforeId', options.beforeId)

  const queryString = params.toString()
  return apiRequest(`/project-conversations/${conversationId}/messages${queryString ? `?${queryString}` : ''}`)
}

/**
 * Send a message in a conversation
 */
export async function sendConversationMessage(
  conversationId: string,
  content: string
): Promise<ConversationMessage> {
  return apiRequest(`/project-conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  })
}

/**
 * Create or get a conversation between a project and supporter
 */
export async function createOrGetConversation(params: {
  projectId: number
  chainId: number
  supporterAddress: string
  ownerAddress: string
  projectName?: string
}): Promise<ProjectConversation> {
  return apiRequest('/project-conversations', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

/**
 * Archive or unarchive a conversation
 */
export async function archiveConversation(
  conversationId: string,
  archived: boolean
): Promise<{ archived: boolean }> {
  return apiRequest(`/project-conversations/${conversationId}/archive`, {
    method: 'POST',
    body: JSON.stringify({ archived }),
  })
}

/**
 * Get supporters for a specific project
 */
export async function getProjectSupporters(
  projectId: number,
  chainId: number,
  options?: { limit?: number; offset?: number }
): Promise<{ supporters: ProjectConversation[]; total: number }> {
  const params = new URLSearchParams()
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.offset) params.set('offset', String(options.offset))

  const queryString = params.toString()
  return apiRequest(`/project-conversations/projects/${projectId}/${chainId}/supporters${queryString ? `?${queryString}` : ''}`)
}
