import { describe, it, expect, beforeEach } from 'vitest'
import { useMultiChatStore, type MultiChat, type MultiChatMessage, type MultiChatMember } from './multiChatStore'

// Helper to create a mock chat
function createMockChat(overrides: Partial<MultiChat> = {}): MultiChat {
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
function createMockMessage(chatId: string, overrides: Partial<MultiChatMessage> = {}): MultiChatMessage {
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
function createMockMember(overrides: Partial<MultiChatMember> = {}): MultiChatMember {
  return {
    address: `0x${Math.random().toString(16).slice(2, 42)}`,
    role: 'member',
    joinedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('multiChatStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useMultiChatStore.setState({
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
      const { chats } = useMultiChatStore.getState()
      expect(chats).toEqual([])
    })

    it('starts with no active chat', () => {
      const { activeChatId } = useMultiChatStore.getState()
      expect(activeChatId).toBeNull()
    })

    it('starts not loading', () => {
      const { isLoading } = useMultiChatStore.getState()
      expect(isLoading).toBe(false)
    })

    it('starts not connected', () => {
      const { isConnected } = useMultiChatStore.getState()
      expect(isConnected).toBe(false)
    })

    it('starts with no error', () => {
      const { error } = useMultiChatStore.getState()
      expect(error).toBeNull()
    })
  })

  describe('setChats', () => {
    it('sets chats array', () => {
      const chat1 = createMockChat({ name: 'Chat 1' })
      const chat2 = createMockChat({ name: 'Chat 2' })

      useMultiChatStore.getState().setChats([chat1, chat2])

      const { chats } = useMultiChatStore.getState()
      expect(chats).toHaveLength(2)
      expect(chats[0].name).toBe('Chat 1')
      expect(chats[1].name).toBe('Chat 2')
    })

    it('replaces existing chats', () => {
      const oldChat = createMockChat({ name: 'Old Chat' })
      const newChat = createMockChat({ name: 'New Chat' })

      useMultiChatStore.getState().setChats([oldChat])
      useMultiChatStore.getState().setChats([newChat])

      const { chats } = useMultiChatStore.getState()
      expect(chats).toHaveLength(1)
      expect(chats[0].name).toBe('New Chat')
    })
  })

  describe('addChat', () => {
    it('adds a new chat', () => {
      const chat = createMockChat()

      useMultiChatStore.getState().addChat(chat)

      const { chats } = useMultiChatStore.getState()
      expect(chats).toHaveLength(1)
      expect(chats[0].id).toBe(chat.id)
    })

    it('adds new chat at the beginning', () => {
      const chat1 = createMockChat({ name: 'Chat 1' })
      const chat2 = createMockChat({ name: 'Chat 2' })

      useMultiChatStore.getState().addChat(chat1)
      useMultiChatStore.getState().addChat(chat2)

      const { chats } = useMultiChatStore.getState()
      expect(chats[0].name).toBe('Chat 2')
      expect(chats[1].name).toBe('Chat 1')
    })

    it('deduplicates by id', () => {
      const chat = createMockChat({ name: 'Original' })
      const updated = { ...chat, name: 'Updated' }

      useMultiChatStore.getState().addChat(chat)
      useMultiChatStore.getState().addChat(updated)

      const { chats } = useMultiChatStore.getState()
      expect(chats).toHaveLength(1)
      expect(chats[0].name).toBe('Updated')
    })
  })

  describe('updateChat', () => {
    it('updates chat properties', () => {
      const chat = createMockChat({ name: 'Original', isPublic: true })
      useMultiChatStore.getState().setChats([chat])

      useMultiChatStore.getState().updateChat(chat.id, { name: 'Updated', isPublic: false })

      const { chats } = useMultiChatStore.getState()
      expect(chats[0].name).toBe('Updated')
      expect(chats[0].isPublic).toBe(false)
    })

    it('does not affect other chats', () => {
      const chat1 = createMockChat({ name: 'Chat 1' })
      const chat2 = createMockChat({ name: 'Chat 2' })
      useMultiChatStore.getState().setChats([chat1, chat2])

      useMultiChatStore.getState().updateChat(chat1.id, { name: 'Updated' })

      const { chats } = useMultiChatStore.getState()
      expect(chats[1].name).toBe('Chat 2')
    })

    it('handles non-existent chat gracefully', () => {
      const chat = createMockChat()
      useMultiChatStore.getState().setChats([chat])

      // Should not throw
      useMultiChatStore.getState().updateChat('non-existent', { name: 'Updated' })

      const { chats } = useMultiChatStore.getState()
      expect(chats[0].name).toBe(chat.name)
    })
  })

  describe('removeChat', () => {
    it('removes chat by id', () => {
      const chat = createMockChat()
      useMultiChatStore.getState().setChats([chat])

      useMultiChatStore.getState().removeChat(chat.id)

      const { chats } = useMultiChatStore.getState()
      expect(chats).toHaveLength(0)
    })

    it('clears activeChatId if removing active chat', () => {
      const chat = createMockChat()
      useMultiChatStore.getState().setChats([chat])
      useMultiChatStore.getState().setActiveChat(chat.id)

      useMultiChatStore.getState().removeChat(chat.id)

      const { activeChatId } = useMultiChatStore.getState()
      expect(activeChatId).toBeNull()
    })

    it('does not clear activeChatId when removing different chat', () => {
      const chat1 = createMockChat()
      const chat2 = createMockChat()
      useMultiChatStore.getState().setChats([chat1, chat2])
      useMultiChatStore.getState().setActiveChat(chat1.id)

      useMultiChatStore.getState().removeChat(chat2.id)

      const { activeChatId } = useMultiChatStore.getState()
      expect(activeChatId).toBe(chat1.id)
    })
  })

  describe('setActiveChat / getActiveChat', () => {
    it('sets and gets active chat', () => {
      const chat = createMockChat()
      useMultiChatStore.getState().setChats([chat])

      useMultiChatStore.getState().setActiveChat(chat.id)

      expect(useMultiChatStore.getState().activeChatId).toBe(chat.id)
      expect(useMultiChatStore.getState().getActiveChat()).toEqual(chat)
    })

    it('returns undefined if no active chat', () => {
      const activeChat = useMultiChatStore.getState().getActiveChat()
      expect(activeChat).toBeUndefined()
    })

    it('can clear active chat', () => {
      const chat = createMockChat()
      useMultiChatStore.getState().setChats([chat])
      useMultiChatStore.getState().setActiveChat(chat.id)

      useMultiChatStore.getState().setActiveChat(null)

      expect(useMultiChatStore.getState().activeChatId).toBeNull()
    })
  })

  describe('messages', () => {
    describe('addMessage', () => {
      it('adds message to chat', () => {
        const chat = createMockChat()
        useMultiChatStore.getState().setChats([chat])

        const message = createMockMessage(chat.id)
        useMultiChatStore.getState().addMessage(chat.id, message)

        const updatedChat = useMultiChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.messages).toHaveLength(1)
        expect(updatedChat?.messages?.[0].id).toBe(message.id)
      })

      it('avoids duplicate messages', () => {
        const chat = createMockChat()
        useMultiChatStore.getState().setChats([chat])

        const message = createMockMessage(chat.id)
        useMultiChatStore.getState().addMessage(chat.id, message)
        useMultiChatStore.getState().addMessage(chat.id, message)

        const updatedChat = useMultiChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.messages).toHaveLength(1)
      })

      it('preserves message order', () => {
        const chat = createMockChat()
        useMultiChatStore.getState().setChats([chat])

        const msg1 = createMockMessage(chat.id, { content: 'First' })
        const msg2 = createMockMessage(chat.id, { content: 'Second' })

        useMultiChatStore.getState().addMessage(chat.id, msg1)
        useMultiChatStore.getState().addMessage(chat.id, msg2)

        const updatedChat = useMultiChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.messages?.[0].content).toBe('First')
        expect(updatedChat?.messages?.[1].content).toBe('Second')
      })
    })

    describe('updateMessage', () => {
      it('updates message content', () => {
        const chat = createMockChat()
        useMultiChatStore.getState().setChats([chat])

        const message = createMockMessage(chat.id, { content: 'Original' })
        useMultiChatStore.getState().addMessage(chat.id, message)
        useMultiChatStore.getState().updateMessage(chat.id, message.id, { content: 'Updated' })

        const updatedChat = useMultiChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.messages?.[0].content).toBe('Updated')
      })
    })

    describe('setMessages', () => {
      it('replaces all messages', () => {
        const chat = createMockChat()
        useMultiChatStore.getState().setChats([chat])

        const oldMsg = createMockMessage(chat.id, { content: 'Old' })
        useMultiChatStore.getState().addMessage(chat.id, oldMsg)

        const newMessages = [
          createMockMessage(chat.id, { content: 'New 1' }),
          createMockMessage(chat.id, { content: 'New 2' }),
        ]
        useMultiChatStore.getState().setMessages(chat.id, newMessages)

        const updatedChat = useMultiChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.messages).toHaveLength(2)
        expect(updatedChat?.messages?.[0].content).toBe('New 1')
      })
    })
  })

  describe('members', () => {
    describe('setMembers', () => {
      it('sets members for chat', () => {
        const chat = createMockChat()
        useMultiChatStore.getState().setChats([chat])

        const members = [
          createMockMember({ role: 'founder' }),
          createMockMember({ role: 'member' }),
        ]
        useMultiChatStore.getState().setMembers(chat.id, members)

        const updatedChat = useMultiChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.members).toHaveLength(2)
      })
    })

    describe('addMember', () => {
      it('adds member to chat', () => {
        const chat = createMockChat()
        useMultiChatStore.getState().setChats([chat])

        const member = createMockMember()
        useMultiChatStore.getState().addMember(chat.id, member)

        const updatedChat = useMultiChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.members).toHaveLength(1)
      })

      it('avoids duplicate members', () => {
        const chat = createMockChat()
        useMultiChatStore.getState().setChats([chat])

        const member = createMockMember()
        useMultiChatStore.getState().addMember(chat.id, member)
        useMultiChatStore.getState().addMember(chat.id, member)

        const updatedChat = useMultiChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.members).toHaveLength(1)
      })
    })

    describe('removeMember', () => {
      it('removes member from chat', () => {
        const chat = createMockChat()
        useMultiChatStore.getState().setChats([chat])

        const member = createMockMember()
        useMultiChatStore.getState().addMember(chat.id, member)
        useMultiChatStore.getState().removeMember(chat.id, member.address)

        const updatedChat = useMultiChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.members).toHaveLength(0)
      })
    })
  })

  describe('UI state', () => {
    describe('setLoading', () => {
      it('sets loading state', () => {
        useMultiChatStore.getState().setLoading(true)
        expect(useMultiChatStore.getState().isLoading).toBe(true)

        useMultiChatStore.getState().setLoading(false)
        expect(useMultiChatStore.getState().isLoading).toBe(false)
      })
    })

    describe('setConnected', () => {
      it('sets connected state', () => {
        useMultiChatStore.getState().setConnected(true)
        expect(useMultiChatStore.getState().isConnected).toBe(true)
      })
    })

    describe('setError', () => {
      it('sets and clears error', () => {
        useMultiChatStore.getState().setError('Something went wrong')
        expect(useMultiChatStore.getState().error).toBe('Something went wrong')

        useMultiChatStore.getState().setError(null)
        expect(useMultiChatStore.getState().error).toBeNull()
      })
    })
  })

  describe('unread count', () => {
    describe('incrementUnread', () => {
      it('increments unread count', () => {
        const chat = createMockChat()
        useMultiChatStore.getState().setChats([chat])

        useMultiChatStore.getState().incrementUnread(chat.id)
        useMultiChatStore.getState().incrementUnread(chat.id)

        const updatedChat = useMultiChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.unreadCount).toBe(2)
      })

      it('starts from 0 if undefined', () => {
        const chat = createMockChat()
        useMultiChatStore.getState().setChats([chat])

        useMultiChatStore.getState().incrementUnread(chat.id)

        const updatedChat = useMultiChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.unreadCount).toBe(1)
      })
    })

    describe('clearUnread', () => {
      it('clears unread count', () => {
        const chat = createMockChat({ unreadCount: 5 })
        useMultiChatStore.getState().setChats([chat])

        useMultiChatStore.getState().clearUnread(chat.id)

        const updatedChat = useMultiChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.unreadCount).toBe(0)
      })
    })
  })
})
