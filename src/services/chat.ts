/**
 * Chat API Service
 *
 * Communicates with the backend chat endpoints
 */

import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { getSessionId } from './session'
import { getWalletSessionToken } from './siwe'
import { WS_CONFIG } from '../constants'
import type {
  Chat,
  ChatMessage,
  ChatMember,
  CreateChatParams,
  ChatFolder,
} from '../stores/chatStore'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

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
  const siweToken = getWalletSessionToken()
  const sessionId = getSessionId()

  // Debug logging
  console.log('[apiRequest] endpoint:', endpoint)
  console.log('[apiRequest] sessionId:', sessionId)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Session-ID': sessionId, // Always include session ID
    ...(options.headers as Record<string, string>),
  }

  // Include auth token if available (managed wallets or SIWE self-custody wallets)
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  } else if (siweToken) {
    headers['Authorization'] = `Bearer ${siweToken}`
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
  const siweToken = getWalletSessionToken()
  const sessionId = getSessionId()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Session-ID': sessionId,
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  } else if (siweToken) {
    headers['Authorization'] = `Bearer ${siweToken}`
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

export async function reportChat(chatId: string, reason?: string): Promise<{ success: boolean; message?: string }> {
  return apiRequest<{ success: boolean; message?: string }>(`/chat/${chatId}/report`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
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
  replyToId?: string,
  attachments?: Array<{ type: string; name: string; mimeType: string; data: string }>
): Promise<ChatMessage> {
  return apiRequest<ChatMessage>(`/chat/${chatId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, replyToId, attachments }),
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

export interface UpdateMemberPermissionsParams {
  role?: 'admin' | 'member'
  canInvite?: boolean
  canInvokeAi?: boolean
  canManageMembers?: boolean
  canPauseAi?: boolean
}

export async function updateMemberPermissions(
  chatId: string,
  address: string,
  permissions: UpdateMemberPermissionsParams
): Promise<ChatMember> {
  return apiRequest<ChatMember>(
    `/chat/${chatId}/members/${address}`,
    {
      method: 'PATCH',
      body: JSON.stringify(permissions),
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
  canInvokeAi?: boolean
  canPauseAi?: boolean
  canGrantPauseAi?: boolean
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
  prompt: string,
  attachments?: Array<{ type: string; name: string; mimeType: string; data: string }>,
  savePrompt?: boolean,
): Promise<ChatMessage> {
  // Get user's API key if configured (BYOK - Bring Your Own Key)
  const { claudeApiKey } = useSettingsStore.getState()

  return apiRequest<ChatMessage>(`/chat/${chatId}/ai/invoke`, {
    method: 'POST',
    body: JSON.stringify({
      prompt,
      attachments,
      apiKey: claudeApiKey || undefined, // Only include if set
      savePrompt: savePrompt || undefined,
    }),
  })
}

/**
 * Toggle AI enabled state for a chat
 * Only members with canPauseAi permission can toggle this
 */
export async function toggleAiEnabled(chatId: string, enabled: boolean): Promise<Chat> {
  return apiRequest<Chat>(`/chat/${chatId}/ai/toggle`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
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
    | 'member_update' // Member profile updates (emoji, etc.)
    | 'chat_update' // Chat metadata updates (title, etc.)
    | 'component_interaction' // Real-time component collaboration
    | 'error'
    | 'connection_status' // Internal status messages
  chatId: string
  data: unknown
  sender?: string // Sender address for component interactions
}

export interface ComponentInteractionData {
  messageId: string
  groupId: string
  action: 'select' | 'typing' | 'hover' | 'hover_end' | 'cursor'
  value?: string
  // Cursor position (relative to component bounds, 0-1 normalized)
  x?: number
  y?: number
}

export type WsMessageHandler = (message: WsMessage) => void

/**
 * WebSocket connection manager
 * Encapsulates connection state, reconnection logic, and message handling
 * Falls back to HTTP polling when WebSocket is unavailable
 */
class WebSocketManager {
  private connection: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private currentChatId: string | null = null
  private isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
  private handlers = new Set<WsMessageHandler>()

  // Polling fallback state
  private pollingTimer: ReturnType<typeof setInterval> | null = null
  private isPolling = false
  private lastMessageId: string | null = null
  private consecutiveSuccessfulPolls = 0
  private lastPollTime: number | null = null

  constructor() {
    // Listen for online/offline events
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline)
      window.addEventListener('offline', this.handleOffline)
    }
  }

  private handleOnline = () => {
    this.isOnline = true
    console.log('[WS] Network online, attempting reconnect')
    if (this.currentChatId && this.handlers.size > 0) {
      // Stop polling and try WebSocket again
      this.stopPolling()
      this.reconnectAttempt = 0
      this.connect(this.currentChatId)
    }
  }

  private handleOffline = () => {
    this.isOnline = false
    console.log('[WS] Network offline')
    this.notifyStatus('offline')
  }

  private getRetryDelay(attempt: number): number {
    const exponentialDelay = WS_CONFIG.INITIAL_RETRY_DELAY * Math.pow(2, attempt)
    const jitter = Math.random() * WS_CONFIG.RETRY_JITTER
    return Math.min(exponentialDelay + jitter, WS_CONFIG.MAX_RETRY_DELAY)
  }

  private notifyStatus(status: 'connected' | 'disconnected' | 'reconnecting' | 'offline' | 'failed' | 'polling') {
    this.handlers.forEach((handler) => {
      handler({
        type: 'connection_status',
        chatId: this.currentChatId || '',
        data: {
          status,
          attempt: this.reconnectAttempt,
          maxAttempts: WS_CONFIG.MAX_RETRY_ATTEMPTS,
          isPolling: this.isPolling,
          lastPollTime: this.lastPollTime,
        },
      })
    })
  }

  private async pollMessages(): Promise<void> {
    if (!this.currentChatId || !this.isOnline) return

    try {
      // Fetch messages newer than our last known message
      const params = new URLSearchParams({ limit: '20' })
      if (this.lastMessageId) {
        params.set('after', this.lastMessageId)
      }

      const messages = await fetchMessages(this.currentChatId, 20)

      this.lastPollTime = Date.now()
      this.consecutiveSuccessfulPolls++

      // Deliver any new messages to handlers
      if (messages.length > 0) {
        // Update last message ID for next poll
        this.lastMessageId = messages[messages.length - 1].id

        messages.forEach((message) => {
          this.handlers.forEach((handler) => {
            handler({
              type: 'message',
              chatId: this.currentChatId || '',
              data: message,
            })
          })
        })
      }

      // After enough successful polls, try to reconnect WebSocket
      if (this.consecutiveSuccessfulPolls >= WS_CONFIG.POLLING_RECONNECT_THRESHOLD) {
        console.log('[WS] Network seems stable, attempting WebSocket reconnect')
        this.stopPolling()
        this.reconnectAttempt = 0
        this.connect(this.currentChatId)
      }
    } catch (error) {
      console.error('[WS] Polling failed:', error)
      this.consecutiveSuccessfulPolls = 0
      // Continue polling even on failure - it's our fallback
    }
  }

  private startPolling(): void {
    if (this.isPolling || !this.currentChatId) return

    this.isPolling = true
    this.consecutiveSuccessfulPolls = 0
    console.log(`[WS] Starting HTTP polling fallback (every ${WS_CONFIG.POLLING_INTERVAL / 1000}s)`)
    this.notifyStatus('polling')

    // Initial poll immediately
    this.pollMessages()

    // Set up interval
    this.pollingTimer = setInterval(() => {
      this.pollMessages()
    }, WS_CONFIG.POLLING_INTERVAL)
  }

  private stopPolling(): void {
    if (!this.isPolling) return

    this.isPolling = false
    this.consecutiveSuccessfulPolls = 0
    console.log('[WS] Stopping HTTP polling')

    if (this.pollingTimer) {
      clearInterval(this.pollingTimer)
      this.pollingTimer = null
    }
  }

  connect(chatId: string): WebSocket | null {
    // Close existing connection
    if (this.connection) {
      this.connection.close()
    }

    this.currentChatId = chatId

    // Don't attempt connection if offline
    if (!this.isOnline) {
      console.log('[WS] Offline, skipping connection attempt')
      this.notifyStatus('offline')
      return null
    }

    const token = useAuthStore.getState().token
    const siweToken = getWalletSessionToken()
    const sessionId = getSessionId()
    const wsUrl = API_BASE_URL.replace('http', 'ws')

    const params = new URLSearchParams()
    if (token) {
      params.set('session', token)
    } else if (siweToken) {
      params.set('session', siweToken)
    }
    params.set('sessionId', sessionId)
    const url = `${wsUrl}/chat/${chatId}/ws?${params.toString()}`

    this.connection = new WebSocket(url)

    this.connection.onopen = () => {
      console.log(`[WS] Connected to chat ${chatId}`)
      this.reconnectAttempt = 0
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
      }
      // Stop polling - WebSocket is now the primary connection
      this.stopPolling()
      this.notifyStatus('connected')
    }

    this.connection.onmessage = (event) => {
      try {
        const message: WsMessage = JSON.parse(event.data)
        this.handlers.forEach((handler) => handler(message))
      } catch (err) {
        console.error('[WS] Failed to parse message:', err)
      }
    }

    this.connection.onerror = (error) => {
      console.error('[WS] Error:', error)
    }

    this.connection.onclose = () => {
      console.log('[WS] Disconnected')
      this.notifyStatus('disconnected')

      if (!this.isOnline || this.handlers.size === 0) {
        return
      }

      if (this.reconnectAttempt >= WS_CONFIG.MAX_RETRY_ATTEMPTS) {
        console.error('[WS] Max reconnection attempts reached, falling back to HTTP polling')
        // Start HTTP polling as fallback instead of giving up
        this.startPolling()
        return
      }

      const delay = this.getRetryDelay(this.reconnectAttempt)
      this.reconnectAttempt++
      console.log(`[WS] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempt}/${WS_CONFIG.MAX_RETRY_ATTEMPTS})`)
      this.notifyStatus('reconnecting')

      this.reconnectTimer = setTimeout(() => {
        if (this.handlers.size > 0 && this.isOnline) {
          this.connect(chatId)
        }
      }, delay)
    }

    return this.connection
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopPolling()
    if (this.connection) {
      this.connection.close()
      this.connection = null
    }
  }

  resetReconnectAttempts(): void {
    this.reconnectAttempt = 0
  }

  getStatus(): {
    isConnected: boolean
    isOnline: boolean
    attempt: number
    isPolling: boolean
    lastPollTime: number | null
  } {
    return {
      isConnected: this.connection?.readyState === WebSocket.OPEN,
      isOnline: this.isOnline,
      attempt: this.reconnectAttempt,
      isPolling: this.isPolling,
      lastPollTime: this.lastPollTime,
    }
  }

  addHandler(handler: WsMessageHandler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  send(message: Omit<WsMessage, 'chatId'>): void {
    if (this.connection && this.connection.readyState === WebSocket.OPEN) {
      this.connection.send(JSON.stringify(message))
    }
  }
}

// Singleton instance
const wsManager = new WebSocketManager()

// Export functions that delegate to the manager for backwards compatibility
export function connectToChat(chatId: string): WebSocket | null {
  return wsManager.connect(chatId)
}

export function resetReconnectAttempts(): void {
  wsManager.resetReconnectAttempts()
}

export function getConnectionStatus(): {
  isConnected: boolean
  isOnline: boolean
  attempt: number
  isPolling: boolean
  lastPollTime: number | null
} {
  return wsManager.getStatus()
}

export function disconnectFromChat(): void {
  wsManager.disconnect()
}

export function onWsMessage(handler: WsMessageHandler): () => void {
  return wsManager.addHandler(handler)
}

export function sendWsMessage(message: Omit<WsMessage, 'chatId'>): void {
  wsManager.send(message)
}

export function sendTypingIndicator(_chatId: string, isTyping: boolean): void {
  wsManager.send({
    type: 'typing',
    data: { isTyping },
  })
}

export function sendComponentInteraction(data: ComponentInteractionData): void {
  wsManager.send({
    type: 'component_interaction',
    data,
  })
}

// ============================================================================
// Session Merging
// ============================================================================

/**
 * Merge anonymous session chats into a connected account
 * When a user connects their wallet/passkey, this moves all chats
 * from their anonymous session to the connected address
 */
export async function mergeSession(newAddress: string): Promise<{ mergedChatIds: string[]; message: string }> {
  return apiRequest<{ mergedChatIds: string[]; message: string }>('/chat/merge-session', {
    method: 'POST',
    body: JSON.stringify({ newAddress }),
  })
}
