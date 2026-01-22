/**
 * Chat API Service
 *
 * Communicates with the backend chat endpoints
 */

import { useAuthStore } from '../stores/authStore'
import { getSessionId } from './session'
import type {
  Chat,
  ChatMessage,
  ChatMember,
  CreateChatParams,
  ChatFolder,
} from '../stores/chatStore'

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

export interface FetchChatsResult {
  chats: Chat[]
  total: number
}

export async function fetchMyChats(options?: {
  folderId?: string | null
  pinnedOnly?: boolean
  limit?: number
  offset?: number
}): Promise<FetchChatsResult> {
  const params = new URLSearchParams()
  if (options?.folderId !== undefined) {
    params.set('folderId', options.folderId ?? 'root')
  }
  if (options?.pinnedOnly) {
    params.set('pinnedOnly', 'true')
  }
  if (options?.limit !== undefined) {
    params.set('limit', String(options.limit))
  }
  if (options?.offset !== undefined) {
    params.set('offset', String(options.offset))
  }
  const queryString = params.toString()

  const token = useAuthStore.getState().token
  const sessionId = getSessionId()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Session-ID': sessionId,
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE_URL}/chat${queryString ? `?${queryString}` : ''}`, {
    headers,
  })
  const result = await response.json()

  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Request failed')
  }

  return {
    chats: result.data as Chat[],
    total: result.total ?? result.data?.length ?? 0,
  }
}

export async function fetchPublicChats(
  limit = 20,
  offset = 0
): Promise<Chat[]> {
  return apiRequest<Chat[]>(
    `/chat/public?limit=${limit}&offset=${offset}`
  )
}

export async function fetchChat(chatId: string): Promise<Chat> {
  return apiRequest<Chat>(`/chat/${chatId}`)
}

export async function createChat(params: CreateChatParams): Promise<Chat> {
  return apiRequest<Chat>('/chat', {
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
  updates: Partial<Pick<Chat, 'name' | 'description' | 'isPublic'>>
): Promise<Chat> {
  return apiRequest<Chat>(`/chat/${chatId}`, {
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
// Chat Organization (Pinning, Folders, Renaming)
// ============================================================================

export async function pinChat(
  chatId: string,
  isPinned: boolean,
  pinOrder?: number
): Promise<Chat> {
  return apiRequest<Chat>(`/chat/${chatId}/pin`, {
    method: 'PATCH',
    body: JSON.stringify({ isPinned, pinOrder }),
  })
}

export async function moveChatToFolder(
  chatId: string,
  folderId: string | null
): Promise<Chat> {
  return apiRequest<Chat>(`/chat/${chatId}/folder`, {
    method: 'PATCH',
    body: JSON.stringify({ folderId }),
  })
}

export async function renameChat(chatId: string, name: string): Promise<Chat> {
  return apiRequest<Chat>(`/chat/${chatId}/name`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export async function reorderPinnedChats(chatIds: string[]): Promise<void> {
  await apiRequest<void>('/chat/reorder-pinned', {
    method: 'POST',
    body: JSON.stringify({ chatIds }),
  })
}

// ============================================================================
// Folder Management
// ============================================================================

export async function fetchFolders(): Promise<ChatFolder[]> {
  return apiRequest<ChatFolder[]>('/chat/folders')
}

export async function createFolder(
  name: string,
  parentFolderId?: string
): Promise<ChatFolder> {
  return apiRequest<ChatFolder>('/chat/folders', {
    method: 'POST',
    body: JSON.stringify({ name, parentFolderId }),
  })
}

export async function fetchFolder(folderId: string): Promise<ChatFolder> {
  return apiRequest<ChatFolder>(`/chat/folders/${folderId}`)
}

export async function updateFolderDetails(
  folderId: string,
  updates: {
    name?: string
    parentFolderId?: string | null
    isPinned?: boolean
    pinOrder?: number
  }
): Promise<ChatFolder> {
  return apiRequest<ChatFolder>(`/chat/folders/${folderId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

export async function deleteFolder(folderId: string): Promise<void> {
  await apiRequest<void>(`/chat/folders/${folderId}`, {
    method: 'DELETE',
  })
}

export async function pinFolder(
  folderId: string,
  isPinned: boolean,
  pinOrder?: number
): Promise<ChatFolder> {
  return apiRequest<ChatFolder>(`/chat/folders/${folderId}/pin`, {
    method: 'PATCH',
    body: JSON.stringify({ isPinned, pinOrder }),
  })
}

export async function reorderPinnedFolders(folderIds: string[]): Promise<void> {
  await apiRequest<void>('/chat/folders/reorder-pinned', {
    method: 'POST',
    body: JSON.stringify({ folderIds }),
  })
}

// ============================================================================
// Messages
// ============================================================================

export async function fetchMessages(
  chatId: string,
  limit = 50,
  before?: string
): Promise<ChatMessage[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (before) params.set('before', before)

  return apiRequest<ChatMessage[]>(
    `/chat/${chatId}/messages?${params}`
  )
}

export async function sendMessage(
  chatId: string,
  content: string,
  replyToId?: string
): Promise<ChatMessage> {
  return apiRequest<ChatMessage>(`/chat/${chatId}/messages`, {
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

export async function fetchMembers(chatId: string): Promise<ChatMember[]> {
  return apiRequest<ChatMember[]>(`/chat/${chatId}/members`)
}

export async function addMember(
  chatId: string,
  address: string,
  role: 'admin' | 'member' = 'member'
): Promise<ChatMember> {
  return apiRequest<ChatMember>(`/chat/${chatId}/members`, {
    method: 'POST',
    body: JSON.stringify({ address, role }),
  })
}

export async function updateMemberRole(
  chatId: string,
  address: string,
  role: 'admin' | 'member'
): Promise<ChatMember> {
  return apiRequest<ChatMember>(
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
): Promise<ChatMessage> {
  return apiRequest<ChatMessage>(`/chat/${chatId}/ai/invoke`, {
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
// WebSocket Connection with Resilience
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
    | 'connection_status' // Internal status messages
  chatId: string
  data: unknown
}

export type WsMessageHandler = (message: WsMessage) => void

let wsConnection: WebSocket | null = null
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null
let wsReconnectAttempt = 0
let wsCurrentChatId: string | null = null
let wsIsOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
const wsHandlers = new Set<WsMessageHandler>()

// Exponential backoff config
const WS_INITIAL_RETRY_DELAY = 1000 // 1 second
const WS_MAX_RETRY_DELAY = 30000 // 30 seconds max
const WS_MAX_RETRY_ATTEMPTS = 10

function getRetryDelay(attempt: number): number {
  // Exponential backoff with jitter: min(initialDelay * 2^attempt + jitter, maxDelay)
  const exponentialDelay = WS_INITIAL_RETRY_DELAY * Math.pow(2, attempt)
  const jitter = Math.random() * 1000 // 0-1 second jitter
  return Math.min(exponentialDelay + jitter, WS_MAX_RETRY_DELAY)
}

function notifyConnectionStatus(status: 'connected' | 'disconnected' | 'reconnecting' | 'offline' | 'failed') {
  wsHandlers.forEach((handler) => {
    handler({
      type: 'connection_status',
      chatId: wsCurrentChatId || '',
      data: { status, attempt: wsReconnectAttempt, maxAttempts: WS_MAX_RETRY_ATTEMPTS },
    })
  })
}

// Listen for online/offline events
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    wsIsOnline = true
    console.log('[WS] Network online, attempting reconnect')
    if (wsCurrentChatId && wsHandlers.size > 0) {
      wsReconnectAttempt = 0 // Reset attempts when coming online
      connectToChat(wsCurrentChatId)
    }
  })

  window.addEventListener('offline', () => {
    wsIsOnline = false
    console.log('[WS] Network offline')
    notifyConnectionStatus('offline')
  })
}

export function connectToChat(chatId: string): WebSocket {
  // Close existing connection
  if (wsConnection) {
    wsConnection.close()
  }

  wsCurrentChatId = chatId

  // Don't attempt connection if offline
  if (!wsIsOnline) {
    console.log('[WS] Offline, skipping connection attempt')
    notifyConnectionStatus('offline')
    // Return a dummy WebSocket-like object that will reconnect when online
    return wsConnection as unknown as WebSocket
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
    wsReconnectAttempt = 0 // Reset attempts on successful connection
    // Clear reconnect timer
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer)
      wsReconnectTimer = null
    }
    notifyConnectionStatus('connected')
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
    notifyConnectionStatus('disconnected')

    // Don't reconnect if offline or no handlers
    if (!wsIsOnline || wsHandlers.size === 0) {
      return
    }

    // Check max retry attempts
    if (wsReconnectAttempt >= WS_MAX_RETRY_ATTEMPTS) {
      console.error('[WS] Max reconnection attempts reached')
      notifyConnectionStatus('failed')
      return
    }

    // Exponential backoff reconnect
    const delay = getRetryDelay(wsReconnectAttempt)
    wsReconnectAttempt++
    console.log(`[WS] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${wsReconnectAttempt}/${WS_MAX_RETRY_ATTEMPTS})`)
    notifyConnectionStatus('reconnecting')

    wsReconnectTimer = setTimeout(() => {
      if (wsHandlers.size > 0 && wsIsOnline) {
        connectToChat(chatId)
      }
    }, delay)
  }

  return wsConnection
}

export function resetReconnectAttempts(): void {
  wsReconnectAttempt = 0
}

export function getConnectionStatus(): { isConnected: boolean; isOnline: boolean; attempt: number } {
  return {
    isConnected: wsConnection?.readyState === WebSocket.OPEN,
    isOnline: wsIsOnline,
    attempt: wsReconnectAttempt,
  }
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
