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

describe('chat service', () => {
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
      const { fetchMyChats } = await import('./chat')
      await fetchMyChats()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/chat'),
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

      const { fetchMyChats } = await import('./chat')
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

      const { fetchMyChats } = await import('./chat')

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
        json: () => Promise.resolve({ success: true, data: mockChats, total: 2 }),
      })

      const { fetchMyChats } = await import('./chat')
      const result = await fetchMyChats()

      expect(result).toEqual({ chats: mockChats, total: 2 })
    })
  })

  describe('fetchChat', () => {
    it('fetches single chat by ID', async () => {
      const mockChat = { id: 'chat-123', name: 'Test Chat' }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockChat }),
      })

      const { fetchChat } = await import('./chat')
      const chat = await fetchChat('chat-123')

      expect(chat).toEqual(mockChat)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/chat/chat-123'),
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

      const { createChat } = await import('./chat')
      const chat = await createChat({ name: 'New Chat', isPublic: true })

      expect(chat).toEqual(mockChat)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/chat'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'New Chat', isPublic: true }),
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

      const { fetchMessages } = await import('./chat')
      const messages = await fetchMessages('chat-123')

      expect(messages).toEqual(mockMessages)
    })

    it('passes pagination parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] }),
      })

      const { fetchMessages } = await import('./chat')
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

      const { sendMessage } = await import('./chat')
      const message = await sendMessage('chat-123', 'Hello!')

      expect(message).toEqual(mockMessage)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/chat/chat-123/messages'),
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

      const { sendMessage } = await import('./chat')
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

        const { createInvite } = await import('./chat')
        const invite = await createInvite('chat-123')

        expect(invite).toEqual(mockInvite)
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/chat/chat-123/invites'),
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

        const { createInvite } = await import('./chat')
        await createInvite('chat-123', { canInviteOthers: true, canSendMessages: true })

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: JSON.stringify({ canInviteOthers: true, canSendMessages: true }),
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

        const { fetchMembers } = await import('./chat')
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

        const { addMember } = await import('./chat')
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

        const { removeMember } = await import('./chat')
        await removeMember('chat-123', '0x456')

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/chat/chat-123/members/0x456'),
          expect.objectContaining({
            method: 'DELETE',
          })
        )
      })
    })
  })

})
