import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore, type Chat, type ChatMessage, type ChatMember } from './chatStore'

// Helper to create a mock chat
function createMockChat(overrides: Partial<Chat> = {}): Chat {
  const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return {
    id,
    founderAddress: '0x123',
    name: 'Test Chat',
    isPublic: true,
    aiBalanceWei: '0',
    aiTotalSpentWei: '0',
    encrypted: false,
    encryptionVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

// Helper to create a mock message
function createMockMessage(chatId: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    chatId,
    senderAddress: '0x123',
    role: 'user',
    content: 'Test message',
    isEncrypted: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

// Helper to create a mock member
function createMockMember(overrides: Partial<ChatMember> = {}): ChatMember {
  return {
    address: `0x${Math.random().toString(16).slice(2, 42)}`,
    role: 'member',
    joinedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('chatStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useChatStore.setState({
      chats: [],
      activeChatId: null,
      isLoading: false,
      isConnected: false,
      error: null,
    })
    localStorage.clear()
  })

  describe('initial state', () => {
    it('starts with empty chats array', () => {
      const { chats } = useChatStore.getState()
      expect(chats).toEqual([])
    })

    it('starts with no active chat', () => {
      const { activeChatId } = useChatStore.getState()
      expect(activeChatId).toBeNull()
    })

    it('starts not loading', () => {
      const { isLoading } = useChatStore.getState()
      expect(isLoading).toBe(false)
    })

    it('starts not connected', () => {
      const { isConnected } = useChatStore.getState()
      expect(isConnected).toBe(false)
    })

    it('starts with no error', () => {
      const { error } = useChatStore.getState()
      expect(error).toBeNull()
    })
  })

  describe('setChats', () => {
    it('sets chats array', () => {
      const chat1 = createMockChat({ name: 'Chat 1' })
      const chat2 = createMockChat({ name: 'Chat 2' })

      useChatStore.getState().setChats([chat1, chat2])

      const { chats } = useChatStore.getState()
      expect(chats).toHaveLength(2)
      expect(chats[0].name).toBe('Chat 1')
      expect(chats[1].name).toBe('Chat 2')
    })

    it('replaces existing chats', () => {
      const oldChat = createMockChat({ name: 'Old Chat' })
      const newChat = createMockChat({ name: 'New Chat' })

      useChatStore.getState().setChats([oldChat])
      useChatStore.getState().setChats([newChat])

      const { chats } = useChatStore.getState()
      expect(chats).toHaveLength(1)
      expect(chats[0].name).toBe('New Chat')
    })
  })

  describe('addChat', () => {
    it('adds a new chat', () => {
      const chat = createMockChat()

      useChatStore.getState().addChat(chat)

      const { chats } = useChatStore.getState()
      expect(chats).toHaveLength(1)
      expect(chats[0].id).toBe(chat.id)
    })

    it('adds new chat at the beginning', () => {
      const chat1 = createMockChat({ name: 'Chat 1' })
      const chat2 = createMockChat({ name: 'Chat 2' })

      useChatStore.getState().addChat(chat1)
      useChatStore.getState().addChat(chat2)

      const { chats } = useChatStore.getState()
      expect(chats[0].name).toBe('Chat 2')
      expect(chats[1].name).toBe('Chat 1')
    })

    it('deduplicates by id', () => {
      const chat = createMockChat({ name: 'Original' })
      const updated = { ...chat, name: 'Updated' }

      useChatStore.getState().addChat(chat)
      useChatStore.getState().addChat(updated)

      const { chats } = useChatStore.getState()
      expect(chats).toHaveLength(1)
      expect(chats[0].name).toBe('Updated')
    })
  })

  describe('updateChat', () => {
    it('updates chat properties', () => {
      const chat = createMockChat({ name: 'Original', isPublic: true })
      useChatStore.getState().setChats([chat])

      useChatStore.getState().updateChat(chat.id, { name: 'Updated', isPublic: false })

      const { chats } = useChatStore.getState()
      expect(chats[0].name).toBe('Updated')
      expect(chats[0].isPublic).toBe(false)
    })

    it('does not affect other chats', () => {
      const chat1 = createMockChat({ name: 'Chat 1' })
      const chat2 = createMockChat({ name: 'Chat 2' })
      useChatStore.getState().setChats([chat1, chat2])

      useChatStore.getState().updateChat(chat1.id, { name: 'Updated' })

      const { chats } = useChatStore.getState()
      expect(chats[1].name).toBe('Chat 2')
    })

    it('handles non-existent chat gracefully', () => {
      const chat = createMockChat()
      useChatStore.getState().setChats([chat])

      // Should not throw
      useChatStore.getState().updateChat('non-existent', { name: 'Updated' })

      const { chats } = useChatStore.getState()
      expect(chats[0].name).toBe(chat.name)
    })
  })

  describe('removeChat', () => {
    it('removes chat by id', () => {
      const chat = createMockChat()
      useChatStore.getState().setChats([chat])

      useChatStore.getState().removeChat(chat.id)

      const { chats } = useChatStore.getState()
      expect(chats).toHaveLength(0)
    })

    it('clears activeChatId if removing active chat', () => {
      const chat = createMockChat()
      useChatStore.getState().setChats([chat])
      useChatStore.getState().setActiveChat(chat.id)

      useChatStore.getState().removeChat(chat.id)

      const { activeChatId } = useChatStore.getState()
      expect(activeChatId).toBeNull()
    })

    it('does not clear activeChatId when removing different chat', () => {
      const chat1 = createMockChat()
      const chat2 = createMockChat()
      useChatStore.getState().setChats([chat1, chat2])
      useChatStore.getState().setActiveChat(chat1.id)

      useChatStore.getState().removeChat(chat2.id)

      const { activeChatId } = useChatStore.getState()
      expect(activeChatId).toBe(chat1.id)
    })
  })

  describe('setActiveChat / getActiveChat', () => {
    it('sets and gets active chat', () => {
      const chat = createMockChat()
      useChatStore.getState().setChats([chat])

      useChatStore.getState().setActiveChat(chat.id)

      expect(useChatStore.getState().activeChatId).toBe(chat.id)
      expect(useChatStore.getState().getActiveChat()).toEqual(chat)
    })

    it('returns undefined if no active chat', () => {
      const activeChat = useChatStore.getState().getActiveChat()
      expect(activeChat).toBeUndefined()
    })

    it('can clear active chat', () => {
      const chat = createMockChat()
      useChatStore.getState().setChats([chat])
      useChatStore.getState().setActiveChat(chat.id)

      useChatStore.getState().setActiveChat(null)

      expect(useChatStore.getState().activeChatId).toBeNull()
    })
  })

  describe('messages', () => {
    describe('addMessage', () => {
      it('adds message to chat', () => {
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        const message = createMockMessage(chat.id)
        useChatStore.getState().addMessage(chat.id, message)

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.messages).toHaveLength(1)
        expect(updatedChat?.messages?.[0].id).toBe(message.id)
      })

      it('avoids duplicate messages', () => {
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        const message = createMockMessage(chat.id)
        useChatStore.getState().addMessage(chat.id, message)
        useChatStore.getState().addMessage(chat.id, message)

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.messages).toHaveLength(1)
      })

      it('preserves message order', () => {
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        const msg1 = createMockMessage(chat.id, { content: 'First' })
        const msg2 = createMockMessage(chat.id, { content: 'Second' })

        useChatStore.getState().addMessage(chat.id, msg1)
        useChatStore.getState().addMessage(chat.id, msg2)

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.messages?.[0].content).toBe('First')
        expect(updatedChat?.messages?.[1].content).toBe('Second')
      })
    })

    describe('updateMessage', () => {
      it('updates message content', () => {
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        const message = createMockMessage(chat.id, { content: 'Original' })
        useChatStore.getState().addMessage(chat.id, message)
        useChatStore.getState().updateMessage(chat.id, message.id, { content: 'Updated' })

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.messages?.[0].content).toBe('Updated')
      })
    })

    describe('setMessages', () => {
      it('replaces all messages', () => {
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        const oldMsg = createMockMessage(chat.id, { content: 'Old' })
        useChatStore.getState().addMessage(chat.id, oldMsg)

        const newMessages = [
          createMockMessage(chat.id, { content: 'New 1' }),
          createMockMessage(chat.id, { content: 'New 2' }),
        ]
        useChatStore.getState().setMessages(chat.id, newMessages)

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.messages).toHaveLength(2)
        expect(updatedChat?.messages?.[0].content).toBe('New 1')
      })
    })
  })

  describe('members', () => {
    describe('setMembers', () => {
      it('sets members for chat', () => {
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        const members = [
          createMockMember({ role: 'founder' }),
          createMockMember({ role: 'member' }),
        ]
        useChatStore.getState().setMembers(chat.id, members)

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.members).toHaveLength(2)
      })
    })

    describe('addMember', () => {
      it('adds member to chat', () => {
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        const member = createMockMember()
        useChatStore.getState().addMember(chat.id, member)

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.members).toHaveLength(1)
      })

      it('avoids duplicate members', () => {
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        const member = createMockMember()
        useChatStore.getState().addMember(chat.id, member)
        useChatStore.getState().addMember(chat.id, member)

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.members).toHaveLength(1)
      })
    })

    describe('removeMember', () => {
      it('removes member from chat', () => {
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        const member = createMockMember()
        useChatStore.getState().addMember(chat.id, member)
        useChatStore.getState().removeMember(chat.id, member.address)

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.members).toHaveLength(0)
      })
    })
  })

  describe('UI state', () => {
    describe('setLoading', () => {
      it('sets loading state', () => {
        useChatStore.getState().setLoading(true)
        expect(useChatStore.getState().isLoading).toBe(true)

        useChatStore.getState().setLoading(false)
        expect(useChatStore.getState().isLoading).toBe(false)
      })
    })

    describe('setConnected', () => {
      it('sets connected state', () => {
        useChatStore.getState().setConnected(true)
        expect(useChatStore.getState().isConnected).toBe(true)
      })
    })

    describe('setError', () => {
      it('sets and clears error', () => {
        useChatStore.getState().setError('Something went wrong')
        expect(useChatStore.getState().error).toBe('Something went wrong')

        useChatStore.getState().setError(null)
        expect(useChatStore.getState().error).toBeNull()
      })
    })
  })

  describe('unread count', () => {
    describe('incrementUnread', () => {
      it('increments unread count', () => {
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        useChatStore.getState().incrementUnread(chat.id)
        useChatStore.getState().incrementUnread(chat.id)

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.unreadCount).toBe(2)
      })

      it('starts from 0 if undefined', () => {
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        useChatStore.getState().incrementUnread(chat.id)

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.unreadCount).toBe(1)
      })
    })

    describe('clearUnread', () => {
      it('clears unread count', () => {
        const chat = createMockChat({ unreadCount: 5 })
        useChatStore.getState().setChats([chat])

        useChatStore.getState().clearUnread(chat.id)

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.unreadCount).toBe(0)
      })
    })
  })
})
