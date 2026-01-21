import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Types matching backend API
export interface ChatMember {
  address: string
  userId?: string
  role: 'founder' | 'admin' | 'member'
  displayName?: string
  joinedAt: string
  canInvite?: boolean
  canInvokeAi?: boolean
  canManageMembers?: boolean
}

export interface ChatMessage {
  id: string
  chatId: string
  senderAddress: string
  senderUserId?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  isEncrypted: boolean
  replyToId?: string
  createdAt: string
  isStreaming?: boolean
}

export interface Chat {
  id: string
  founderAddress: string
  founderUserId?: string
  name: string
  description?: string
  isPublic: boolean
  aiBalanceWei: string
  aiTotalSpentWei: string
  encrypted: boolean
  encryptionVersion: number
  tokenGateEnabled?: boolean
  tokenGateChainId?: number
  tokenGateTokenAddress?: string
  tokenGateMinBalance?: string
  archivedCid?: string
  createdAt: string
  updatedAt: string
  // Local state
  members?: ChatMember[]
  messages?: ChatMessage[]
  unreadCount?: number
}

export interface CreateChatParams {
  name: string
  description?: string
  isPublic?: boolean
  encrypted?: boolean
  tokenGate?: {
    chainId: number
    tokenAddress: string
    minBalance: string
  }
}

interface ChatState {
  // State
  chats: Chat[]
  activeChatId: string | null
  isLoading: boolean
  isConnected: boolean
  error: string | null

  // Actions
  setChats: (chats: Chat[]) => void
  addChat: (chat: Chat) => void
  updateChat: (chatId: string, updates: Partial<Chat>) => void
  removeChat: (chatId: string) => void
  setActiveChat: (chatId: string | null) => void
  getActiveChat: () => Chat | undefined

  // Message actions
  addMessage: (chatId: string, message: ChatMessage) => void
  updateMessage: (chatId: string, messageId: string, updates: Partial<Pick<ChatMessage, 'content' | 'isStreaming'>>) => void
  setMessages: (chatId: string, messages: ChatMessage[]) => void

  // Member actions
  setMembers: (chatId: string, members: ChatMember[]) => void
  addMember: (chatId: string, member: ChatMember) => void
  removeMember: (chatId: string, address: string) => void

  // UI state
  setLoading: (loading: boolean) => void
  setConnected: (connected: boolean) => void
  setError: (error: string | null) => void
  clearUnread: (chatId: string) => void
  incrementUnread: (chatId: string) => void
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      chats: [],
      activeChatId: null,
      isLoading: false,
      isConnected: false,
      error: null,

      setChats: (chats) => set({ chats }),

      addChat: (chat) =>
        set((state) => ({
          chats: [chat, ...state.chats.filter((c) => c.id !== chat.id)],
        })),

      updateChat: (chatId, updates) =>
        set((state) => ({
          chats: state.chats.map((c) =>
            c.id === chatId ? { ...c, ...updates } : c
          ),
        })),

      removeChat: (chatId) =>
        set((state) => ({
          chats: state.chats.filter((c) => c.id !== chatId),
          activeChatId:
            state.activeChatId === chatId ? null : state.activeChatId,
        })),

      setActiveChat: (chatId) => set({ activeChatId: chatId }),

      getActiveChat: () => {
        const state = get()
        return state.chats.find((c) => c.id === state.activeChatId)
      },

      // Messages
      addMessage: (chatId, message) =>
        set((state) => ({
          chats: state.chats.map((c) => {
            if (c.id !== chatId) return c
            const messages = c.messages || []
            // Avoid duplicates
            if (messages.some((m) => m.id === message.id)) return c
            return { ...c, messages: [...messages, message] }
          }),
        })),

      updateMessage: (chatId, messageId, updates) =>
        set((state) => ({
          chats: state.chats.map((c) => {
            if (c.id !== chatId) return c
            return {
              ...c,
              messages: (c.messages || []).map((m) =>
                m.id === messageId ? { ...m, ...updates } : m
              ),
            }
          }),
        })),

      setMessages: (chatId, messages) =>
        set((state) => ({
          chats: state.chats.map((c) =>
            c.id === chatId ? { ...c, messages } : c
          ),
        })),

      // Members
      setMembers: (chatId, members) =>
        set((state) => ({
          chats: state.chats.map((c) =>
            c.id === chatId ? { ...c, members } : c
          ),
        })),

      addMember: (chatId, member) =>
        set((state) => ({
          chats: state.chats.map((c) => {
            if (c.id !== chatId) return c
            const members = c.members || []
            if (members.some((m) => m.address === member.address)) return c
            return { ...c, members: [...members, member] }
          }),
        })),

      removeMember: (chatId, address) =>
        set((state) => ({
          chats: state.chats.map((c) => {
            if (c.id !== chatId) return c
            return {
              ...c,
              members: (c.members || []).filter((m) => m.address !== address),
            }
          }),
        })),

      // UI state
      setLoading: (isLoading) => set({ isLoading }),
      setConnected: (isConnected) => set({ isConnected }),
      setError: (error) => set({ error }),

      clearUnread: (chatId) =>
        set((state) => ({
          chats: state.chats.map((c) =>
            c.id === chatId ? { ...c, unreadCount: 0 } : c
          ),
        })),

      incrementUnread: (chatId) =>
        set((state) => ({
          chats: state.chats.map((c) =>
            c.id === chatId
              ? { ...c, unreadCount: (c.unreadCount || 0) + 1 }
              : c
          ),
        })),
    }),
    {
      name: 'juice-chat',
      partialize: (state) => ({
        // Only persist chats and activeChatId, not loading/error states
        chats: state.chats,
        activeChatId: state.activeChatId,
      }),
    }
  )
)

// Display types for UI components
export interface Attachment {
  id: string
  type: 'image'
  name: string
  mimeType: string
  data: string  // base64
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp?: number
  isStreaming?: boolean
  attachments?: Attachment[]
  senderName?: string
  senderAddress?: string
  createdAt?: string
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

