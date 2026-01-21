/**
 * Multi-Person Chat API Service
 *
 * Communicates with the backend chat endpoints
 */

import { useAuthStore } from '../stores/authStore'
import { getSessionId } from './session'
import type {
  MultiChat,
  MultiChatMessage,
  MultiChatMember,
  CreateChatParams,
} from '../stores/multiChatStore'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

// ============================================================================
// API Client
// ============================================================================

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
    'X-Session-ID': sessionId, // Always include session ID
    ...(options.headers as Record<string, string>),
  }

  // Include auth token if available (for authenticated users)
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

// ============================================================================
// Chat Management
// ============================================================================

export async function fetchMyChats(): Promise<MultiChat[]> {
  return apiRequest<MultiChat[]>('/chat')
}

export async function fetchPublicChats(
  limit = 20,
  offset = 0
): Promise<MultiChat[]> {
  return apiRequest<MultiChat[]>(
    `/chat/public?limit=${limit}&offset=${offset}`
  )
}

export async function fetchChat(chatId: string): Promise<MultiChat> {
  return apiRequest<MultiChat>(`/chat/${chatId}`)
}

export async function createChat(params: CreateChatParams): Promise<MultiChat> {
  return apiRequest<MultiChat>('/chat', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

interface MigrateMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Migrate a local chat to a persistent DB chat
 * This converts a localStorage-based conversation into a shareable chat
 */
export async function migrateChat(title: string, messages?: MigrateMessage[]): Promise<{ chatId: string; name: string }> {
  return apiRequest<{ chatId: string; name: string }>('/chat/migrate', {
    method: 'POST',
    body: JSON.stringify({ title, messages }),
  })
}

export async function updateChat(
  chatId: string,
  updates: Partial<Pick<MultiChat, 'name' | 'description' | 'isPublic'>>
): Promise<MultiChat> {
  return apiRequest<MultiChat>(`/chat/${chatId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

export async function deleteChat(chatId: string): Promise<void> {
  await apiRequest<void>(`/chat/${chatId}`, {
    method: 'DELETE',
  })
}

// ============================================================================
// Messages
// ============================================================================

export async function fetchMessages(
  chatId: string,
  limit = 50,
  before?: string
): Promise<MultiChatMessage[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (before) params.set('before', before)

  return apiRequest<MultiChatMessage[]>(
    `/chat/${chatId}/messages?${params}`
  )
}

export async function sendMessage(
  chatId: string,
  content: string,
  replyToId?: string
): Promise<MultiChatMessage> {
  return apiRequest<MultiChatMessage>(`/chat/${chatId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, replyToId }),
  })
}

export async function deleteMessage(
  chatId: string,
  messageId: string
): Promise<void> {
  await apiRequest<void>(`/chat/${chatId}/messages/${messageId}`, {
    method: 'DELETE',
  })
}

// ============================================================================
// Members
// ============================================================================

export async function fetchMembers(chatId: string): Promise<MultiChatMember[]> {
  return apiRequest<MultiChatMember[]>(`/chat/${chatId}/members`)
}

export async function addMember(
  chatId: string,
  address: string,
  role: 'admin' | 'member' = 'member'
): Promise<MultiChatMember> {
  return apiRequest<MultiChatMember>(`/chat/${chatId}/members`, {
    method: 'POST',
    body: JSON.stringify({ address, role }),
  })
}

export async function updateMemberRole(
  chatId: string,
  address: string,
  role: 'admin' | 'member'
): Promise<MultiChatMember> {
  return apiRequest<MultiChatMember>(
    `/chat/${chatId}/members/${address}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }
  )
}

export async function removeMember(
  chatId: string,
  address: string
): Promise<void> {
  await apiRequest<void>(`/chat/${chatId}/members/${address}`, {
    method: 'DELETE',
  })
}

// ============================================================================
// Invites
// ============================================================================

export interface ChatInvite {
  id: string
  chatId: string
  code: string
  createdBy: string
  canSendMessages: boolean
  canInviteOthers: boolean
  canPassOnRoles: boolean
  uses: number
  maxUses: number | null
  expiresAt: string | null
  createdAt: string
  inviteUrl?: string
}

export interface CreateInviteParams {
  canSendMessages?: boolean
  canInviteOthers?: boolean
  canPassOnRoles?: boolean
}

export async function createInvite(
  chatId: string,
  params: CreateInviteParams = {}
): Promise<ChatInvite> {
  return apiRequest<ChatInvite>(`/chat/${chatId}/invites`, {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function getInvites(chatId: string): Promise<ChatInvite[]> {
  return apiRequest<ChatInvite[]>(`/chat/${chatId}/invites`)
}

export async function revokeInvite(chatId: string, inviteId: string): Promise<void> {
  await apiRequest<void>(`/chat/${chatId}/invites/${inviteId}`, {
    method: 'DELETE',
  })
}

export interface InviteInfo {
  chatId: string
  chatName: string
  chatDescription?: string
  role: 'admin' | 'member'
  canSendMessages: boolean
  canInviteOthers: boolean
}

export async function getInviteInfo(code: string): Promise<InviteInfo> {
  return apiRequest<InviteInfo>(`/chat/invite/${code}`)
}

export async function joinViaInvite(code: string): Promise<{ chatId: string; chatName?: string; role: string }> {
  return apiRequest<{ chatId: string; chatName?: string; role: string }>(`/chat/invite/${code}/join`, {
    method: 'POST',
  })
}

// ============================================================================
// AI Integration
// ============================================================================

export interface AiBalanceStatus {
  chatId: string
  balanceWei: string
  totalSpentWei: string
  estimatedRequestsRemaining: number
  isLow: boolean
  isEmpty: boolean
}

export async function getAiBalance(chatId: string): Promise<AiBalanceStatus> {
  return apiRequest<AiBalanceStatus>(`/chat/${chatId}/ai/balance`)
}

export async function invokeAi(
  chatId: string,
  prompt: string
): Promise<MultiChatMessage> {
  return apiRequest<MultiChatMessage>(`/chat/${chatId}/ai/invoke`, {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  })
}

// ============================================================================
// Feedback
// ============================================================================

export type JuicyRating = 'wow' | 'great' | 'meh' | 'bad'

export async function submitFeedback(
  chatId: string,
  rating: JuicyRating,
  comment?: string
): Promise<void> {
  await apiRequest<void>(`/chat/${chatId}/feedback`, {
    method: 'POST',
    body: JSON.stringify({ rating, comment }),
  })
}

// ============================================================================
// WebSocket Connection
// ============================================================================

export interface WsMessage {
  type:
    | 'message'
    | 'typing'
    | 'presence'
    | 'ai_response'
    | 'member_joined'
    | 'member_left'
    | 'error'
  chatId: string
  data: unknown
}

export type WsMessageHandler = (message: WsMessage) => void

let wsConnection: WebSocket | null = null
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null
const wsHandlers = new Set<WsMessageHandler>()

export function connectToChat(chatId: string): WebSocket {
  // Close existing connection
  if (wsConnection) {
    wsConnection.close()
  }

  const token = useAuthStore.getState().token
  const sessionId = getSessionId()
  const wsUrl = API_BASE_URL.replace('http', 'ws').replace('/api', '')
  // Pass auth token if available, AND always include sessionId for anonymous fallback
  const params = new URLSearchParams()
  if (token) {
    params.set('session', token)
  }
  params.set('sessionId', sessionId)
  const url = `${wsUrl}/api/chat/${chatId}/ws?${params.toString()}`

  wsConnection = new WebSocket(url)

  wsConnection.onopen = () => {
    console.log(`[WS] Connected to chat ${chatId}`)
    // Clear reconnect timer
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer)
      wsReconnectTimer = null
    }
  }

  wsConnection.onmessage = (event) => {
    try {
      const message: WsMessage = JSON.parse(event.data)
      wsHandlers.forEach((handler) => handler(message))
    } catch (err) {
      console.error('[WS] Failed to parse message:', err)
    }
  }

  wsConnection.onerror = (error) => {
    console.error('[WS] Error:', error)
  }

  wsConnection.onclose = () => {
    console.log('[WS] Disconnected')
    // Attempt reconnect after 3 seconds
    wsReconnectTimer = setTimeout(() => {
      if (wsHandlers.size > 0) {
        connectToChat(chatId)
      }
    }, 3000)
  }

  return wsConnection
}

export function disconnectFromChat(): void {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer)
    wsReconnectTimer = null
  }
  if (wsConnection) {
    wsConnection.close()
    wsConnection = null
  }
}

export function onWsMessage(handler: WsMessageHandler): () => void {
  wsHandlers.add(handler)
  return () => {
    wsHandlers.delete(handler)
  }
}

export function sendWsMessage(message: Omit<WsMessage, 'chatId'>): void {
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    wsConnection.send(JSON.stringify(message))
  }
}

export function sendTypingIndicator(chatId: string, isTyping: boolean): void {
  sendWsMessage({
    type: 'typing',
    data: { isTyping },
  })
}
