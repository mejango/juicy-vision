import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock the auth store
vi.mock('../stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({
      token: 'mock-jwt-token',
    }),
  },
}))

// Mock session service
vi.mock('./session', () => ({
  getSessionId: () => 'ses_test123',
}))

describe('multiChat service', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('API request handling', () => {
    it('includes auth header when token available', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] }),
      })

      // Import dynamically to avoid hoisting issues
      const { fetchMyChats } = await import('./multiChat')
      await fetchMyChats()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/multi-chat'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-jwt-token',
          }),
        })
      )
    })

    it('includes session ID header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] }),
      })

      const { fetchMyChats } = await import('./multiChat')
      await fetchMyChats()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Session-ID': 'ses_test123',
          }),
        })
      )
    })

    it('throws on error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ success: false, error: 'Not found' }),
      })

      const { fetchMyChats } = await import('./multiChat')

      await expect(fetchMyChats()).rejects.toThrow('Not found')
    })
  })

  describe('fetchMyChats', () => {
    it('returns list of chats', async () => {
      const mockChats = [
        { id: 'chat-1', name: 'Chat 1' },
        { id: 'chat-2', name: 'Chat 2' },
      ]

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockChats }),
      })

      const { fetchMyChats } = await import('./multiChat')
      const chats = await fetchMyChats()

      expect(chats).toEqual(mockChats)
    })
  })

  describe('fetchPublicChats', () => {
    it('passes limit and offset parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] }),
      })

      const { fetchPublicChats } = await import('./multiChat')
      await fetchPublicChats(10, 20)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=10'),
        expect.any(Object)
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('offset=20'),
        expect.any(Object)
      )
    })
  })

  describe('fetchChat', () => {
    it('fetches single chat by ID', async () => {
      const mockChat = { id: 'chat-123', name: 'Test Chat' }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockChat }),
      })

      const { fetchChat } = await import('./multiChat')
      const chat = await fetchChat('chat-123')

      expect(chat).toEqual(mockChat)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/multi-chat/chat-123'),
        expect.any(Object)
      )
    })
  })

  describe('createChat', () => {
    it('creates chat with params', async () => {
      const mockChat = { id: 'new-chat', name: 'New Chat' }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockChat }),
      })

      const { createChat } = await import('./multiChat')
      const chat = await createChat({ name: 'New Chat', isPublic: true })

      expect(chat).toEqual(mockChat)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/multi-chat'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'New Chat', isPublic: true }),
        })
      )
    })
  })

  describe('migrateChat', () => {
    it('migrates chat with title only', async () => {
      const mockResult = { chatId: 'migrated-123', name: 'Migrated Chat' }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockResult }),
      })

      const { migrateChat } = await import('./multiChat')
      const result = await migrateChat('Migrated Chat')

      expect(result).toEqual(mockResult)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/chat/migrate'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ title: 'Migrated Chat' }),
        })
      )
    })

    it('migrates chat with messages', async () => {
      const mockResult = { chatId: 'migrated-123', name: 'Chat with History' }
      const messages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi there!' },
      ]

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockResult }),
      })

      const { migrateChat } = await import('./multiChat')
      const result = await migrateChat('Chat with History', messages)

      expect(result).toEqual(mockResult)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ title: 'Chat with History', messages }),
        })
      )
    })
  })

  describe('fetchMessages', () => {
    it('fetches messages for chat', async () => {
      const mockMessages = [
        { id: 'msg-1', content: 'Hello' },
        { id: 'msg-2', content: 'Hi' },
      ]

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockMessages }),
      })

      const { fetchMessages } = await import('./multiChat')
      const messages = await fetchMessages('chat-123')

      expect(messages).toEqual(mockMessages)
    })

    it('passes pagination parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] }),
      })

      const { fetchMessages } = await import('./multiChat')
      await fetchMessages('chat-123', 25, 'msg-before')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/limit=25.*before=msg-before|before=msg-before.*limit=25/),
        expect.any(Object)
      )
    })
  })

  describe('sendMessage', () => {
    it('sends message to chat', async () => {
      const mockMessage = { id: 'new-msg', content: 'Hello!' }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockMessage }),
      })

      const { sendMessage } = await import('./multiChat')
      const message = await sendMessage('chat-123', 'Hello!')

      expect(message).toEqual(mockMessage)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/multi-chat/chat-123/messages'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: 'Hello!' }),
        })
      )
    })

    it('sends reply message', async () => {
      const mockMessage = { id: 'reply-msg', content: 'Reply', replyToId: 'original-msg' }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockMessage }),
      })

      const { sendMessage } = await import('./multiChat')
      await sendMessage('chat-123', 'Reply', 'original-msg')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ content: 'Reply', replyToId: 'original-msg' }),
        })
      )
    })
  })

  describe('invite functions', () => {
    describe('createInvite', () => {
      it('creates invite with default permissions', async () => {
        const mockInvite = { id: 'inv-1', code: 'ABC12345', inviteUrl: 'http://example.com/#/join/ABC12345' }

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockInvite }),
        })

        const { createInvite } = await import('./multiChat')
        const invite = await createInvite('chat-123')

        expect(invite).toEqual(mockInvite)
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/multi-chat/chat-123/invites'),
          expect.objectContaining({
            method: 'POST',
          })
        )
      })

      it('creates invite with custom permissions', async () => {
        const mockInvite = { id: 'inv-2', code: 'XYZ99999', canInviteOthers: true }

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockInvite }),
        })

        const { createInvite } = await import('./multiChat')
        await createInvite('chat-123', { canInviteOthers: true, canSendMessages: true })

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: JSON.stringify({ canInviteOthers: true, canSendMessages: true }),
          })
        )
      })
    })

    describe('getInviteInfo', () => {
      it('fetches invite info by code', async () => {
        const mockInfo = {
          chatId: 'chat-123',
          chatName: 'Test Chat',
          canSendMessages: true,
          canInviteOthers: false,
        }

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockInfo }),
        })

        const { getInviteInfo } = await import('./multiChat')
        const info = await getInviteInfo('ABC12345')

        expect(info).toEqual(mockInfo)
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/multi-chat/invite/ABC12345'),
          expect.any(Object)
        )
      })
    })

    describe('joinViaInvite', () => {
      it('joins chat via invite code', async () => {
        const mockResult = { chatId: 'chat-123', chatName: 'Test Chat', role: 'member' }

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockResult }),
        })

        const { joinViaInvite } = await import('./multiChat')
        const result = await joinViaInvite('ABC12345')

        expect(result).toEqual(mockResult)
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/multi-chat/invite/ABC12345/join'),
          expect.objectContaining({
            method: 'POST',
          })
        )
      })
    })

    describe('revokeInvite', () => {
      it('revokes invite by ID', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })

        const { revokeInvite } = await import('./multiChat')
        await revokeInvite('chat-123', 'inv-456')

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/multi-chat/chat-123/invites/inv-456'),
          expect.objectContaining({
            method: 'DELETE',
          })
        )
      })
    })
  })

  describe('member functions', () => {
    describe('fetchMembers', () => {
      it('fetches members for chat', async () => {
        const mockMembers = [
          { address: '0x123', role: 'founder' },
          { address: '0x456', role: 'member' },
        ]

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockMembers }),
        })

        const { fetchMembers } = await import('./multiChat')
        const members = await fetchMembers('chat-123')

        expect(members).toEqual(mockMembers)
      })
    })

    describe('addMember', () => {
      it('adds member to chat', async () => {
        const mockMember = { address: '0x789', role: 'member' }

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockMember }),
        })

        const { addMember } = await import('./multiChat')
        const member = await addMember('chat-123', '0x789', 'member')

        expect(member).toEqual(mockMember)
      })
    })

    describe('removeMember', () => {
      it('removes member from chat', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })

        const { removeMember } = await import('./multiChat')
        await removeMember('chat-123', '0x456')

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/multi-chat/chat-123/members/0x456'),
          expect.objectContaining({
            method: 'DELETE',
          })
        )
      })
    })
  })

  describe('AI functions', () => {
    describe('getAiBalance', () => {
      it('fetches AI balance for chat', async () => {
        const mockBalance = {
          chatId: 'chat-123',
          balanceWei: '1000000000000000000',
          estimatedRequestsRemaining: 100,
          isLow: false,
          isEmpty: false,
        }

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockBalance }),
        })

        const { getAiBalance } = await import('./multiChat')
        const balance = await getAiBalance('chat-123')

        expect(balance).toEqual(mockBalance)
      })
    })
  })

  describe('feedback', () => {
    describe('submitFeedback', () => {
      it('submits rating feedback', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })

        const { submitFeedback } = await import('./multiChat')
        await submitFeedback('chat-123', 'great')

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/multi-chat/chat-123/feedback'),
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ rating: 'great' }),
          })
        )
      })

      it('submits rating with comment', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })

        const { submitFeedback } = await import('./multiChat')
        await submitFeedback('chat-123', 'wow', 'This was amazing!')

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: JSON.stringify({ rating: 'wow', comment: 'This was amazing!' }),
          })
        )
      })
    })
  })
})
