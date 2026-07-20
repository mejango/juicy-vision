/**
 * Project Conversations API Service
 *
 * Handles messaging between project owners and supporters.
 */

import { apiRequest as sharedApiRequest } from '../services/apiClient'

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

// =============================================================================
// API Client
// =============================================================================

function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  // These endpoints historically only sent the managed auth token.
  return sharedApiRequest<T>(endpoint, options, { includeSiweAuth: false })
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

