import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
  timestamp: number
  isStreaming?: boolean
  attachments?: Attachment[]
  // Multi-chat sender info
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

interface ChatState {
  conversations: Conversation[]
  activeConversationId: string | null
  isStreaming: boolean

  // Actions
  createConversation: () => string
  setActiveConversation: (id: string | null) => void
  getActiveConversation: () => Conversation | undefined
  addMessage: (conversationId: string, message: Omit<Message, 'id' | 'timestamp'>, attachments?: Attachment[]) => string
  updateMessage: (conversationId: string, messageId: string, content: string) => void
  setMessageStreaming: (conversationId: string, messageId: string, isStreaming: boolean) => void
  deleteConversation: (id: string) => void
  clearAllConversations: () => void
  setIsStreaming: (streaming: boolean) => void
  updateConversationTitle: (conversationId: string, title: string) => void
}

const generateId = () => Math.random().toString(36).substring(2, 15)

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeConversationId: null,
      isStreaming: false,

      createConversation: () => {
        const id = generateId()
        const newConversation: Conversation = {
          id,
          title: 'New Chat',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        set((state) => ({
          conversations: [newConversation, ...state.conversations],
          activeConversationId: id,
        }))
        return id
      },

      setActiveConversation: (id) => set({ activeConversationId: id }),

      getActiveConversation: () => {
        const state = get()
        return state.conversations.find((c) => c.id === state.activeConversationId)
      },

      addMessage: (conversationId, message, attachments) => {
        const messageId = generateId()
        const fullMessage: Message = {
          ...message,
          id: messageId,
          timestamp: Date.now(),
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
        }

        set((state) => ({
          conversations: state.conversations.map((conv) => {
            if (conv.id !== conversationId) return conv

            // Update title from first user message
            const newTitle = conv.messages.length === 0 && message.role === 'user'
              ? message.content.slice(0, 50) + (message.content.length > 50 ? '...' : '')
              : conv.title

            return {
              ...conv,
              title: newTitle,
              messages: [...conv.messages, fullMessage],
              updatedAt: Date.now(),
            }
          }),
        }))

        return messageId
      },

      updateMessage: (conversationId, messageId, content) => {
        set((state) => ({
          conversations: state.conversations.map((conv) => {
            if (conv.id !== conversationId) return conv
            return {
              ...conv,
              messages: conv.messages.map((msg) =>
                msg.id === messageId ? { ...msg, content } : msg
              ),
              updatedAt: Date.now(),
            }
          }),
        }))
      },

      setMessageStreaming: (conversationId, messageId, isStreaming) => {
        set((state) => ({
          conversations: state.conversations.map((conv) => {
            if (conv.id !== conversationId) return conv
            return {
              ...conv,
              messages: conv.messages.map((msg) =>
                msg.id === messageId ? { ...msg, isStreaming } : msg
              ),
            }
          }),
        }))
      },

      deleteConversation: (id) => {
        set((state) => {
          const newConversations = state.conversations.filter((c) => c.id !== id)
          return {
            conversations: newConversations,
            activeConversationId:
              state.activeConversationId === id
                ? newConversations[0]?.id ?? null
                : state.activeConversationId,
          }
        })
      },

      clearAllConversations: () => set({ conversations: [], activeConversationId: null }),

      setIsStreaming: (streaming) => set({ isStreaming: streaming }),

      updateConversationTitle: (conversationId, title) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId ? { ...conv, title } : conv
          ),
        }))
      },
    }),
    {
      name: 'juice-chat',
    }
  )
)
