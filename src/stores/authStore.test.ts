import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { useAuthStore, PRIVACY_MODES, type PrivacyMode } from './authStore'

// Mock the passkey service
vi.mock('../services/passkey', () => ({
  isPasskeySupported: vi.fn(() => true),
  loginWithPasskey: vi.fn(),
  signupWithPasskey: vi.fn(),
  registerPasskey: vi.fn(),
  listPasskeys: vi.fn(() => Promise.resolve([])),
  deletePasskey: vi.fn(),
  renamePasskey: vi.fn(),
}))

// Mock fetch for API requests
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('authStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAuthStore.setState({
      mode: 'self_custody',
      privacyMode: 'open_book',
      user: null,
      token: null,
      isLoading: false,
      error: null,
      currentSessionId: null,
      passkeys: [],
    })
    localStorage.clear()
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('defaults to self_custody mode', () => {
      const { mode } = useAuthStore.getState()
      expect(mode).toBe('self_custody')
    })

    it('defaults to open_book privacy', () => {
      const { privacyMode } = useAuthStore.getState()
      expect(privacyMode).toBe('open_book')
    })

    it('has no user by default', () => {
      const { user, token } = useAuthStore.getState()
      expect(user).toBeNull()
      expect(token).toBeNull()
    })

    it('is not loading by default', () => {
      const { isLoading, error } = useAuthStore.getState()
      expect(isLoading).toBe(false)
      expect(error).toBeNull()
    })
  })

  describe('PRIVACY_MODES', () => {
    it('defines all four privacy modes', () => {
      expect(Object.keys(PRIVACY_MODES)).toHaveLength(4)
      expect(PRIVACY_MODES.open_book).toBeDefined()
      expect(PRIVACY_MODES.anonymous).toBeDefined()
      expect(PRIVACY_MODES.private).toBeDefined()
      expect(PRIVACY_MODES.ghost).toBeDefined()
    })

    it('open_book stores everything', () => {
      expect(PRIVACY_MODES.open_book.storeChat).toBe(true)
      expect(PRIVACY_MODES.open_book.storeAnalytics).toBe(true)
      expect(PRIVACY_MODES.open_book.includeInTraining).toBe(true)
    })

    it('anonymous stores chat but strips identity', () => {
      expect(PRIVACY_MODES.anonymous.storeChat).toBe(true)
      expect(PRIVACY_MODES.anonymous.includeInTraining).toBe(true)
    })

    it('private does not store chat', () => {
      expect(PRIVACY_MODES.private.storeChat).toBe(false)
      expect(PRIVACY_MODES.private.storeAnalytics).toBe(true)
      expect(PRIVACY_MODES.private.includeInTraining).toBe(false)
    })

    it('ghost stores nothing', () => {
      expect(PRIVACY_MODES.ghost.storeChat).toBe(false)
      expect(PRIVACY_MODES.ghost.storeAnalytics).toBe(false)
      expect(PRIVACY_MODES.ghost.includeInTraining).toBe(false)
      expect(PRIVACY_MODES.ghost.requiresSelfCustody).toBe(true)
    })
  })

  describe('setMode', () => {
    it('changes from self_custody to managed', () => {
      const store = useAuthStore.getState()
      store.setMode('managed')
      expect(useAuthStore.getState().mode).toBe('managed')
    })

    it('changes from managed to self_custody', () => {
      useAuthStore.setState({ mode: 'managed' })
      const store = useAuthStore.getState()
      store.setMode('self_custody')
      expect(useAuthStore.getState().mode).toBe('self_custody')
    })

    it('downgrades ghost privacy when switching to managed mode', () => {
      // Ghost mode requires self_custody
      useAuthStore.setState({ mode: 'self_custody', privacyMode: 'ghost' })

      const store = useAuthStore.getState()
      store.setMode('managed')

      const state = useAuthStore.getState()
      expect(state.mode).toBe('managed')
      expect(state.privacyMode).toBe('private') // Downgraded from ghost
    })
  })

  describe('setPrivacyMode', () => {
    it('changes privacy mode', () => {
      const store = useAuthStore.getState()
      store.setPrivacyMode('anonymous')
      expect(useAuthStore.getState().privacyMode).toBe('anonymous')
    })

    it('switches to self_custody when selecting ghost mode from managed', () => {
      useAuthStore.setState({ mode: 'managed', privacyMode: 'open_book' })

      const store = useAuthStore.getState()
      store.setPrivacyMode('ghost')

      const state = useAuthStore.getState()
      expect(state.privacyMode).toBe('ghost')
      expect(state.mode).toBe('self_custody') // Auto-switched
    })

    it('allows any privacy mode in self_custody', () => {
      const modes: PrivacyMode[] = ['open_book', 'anonymous', 'private', 'ghost']

      for (const mode of modes) {
        useAuthStore.setState({ mode: 'self_custody', privacyMode: 'open_book' })
        const store = useAuthStore.getState()
        store.setPrivacyMode(mode)
        expect(useAuthStore.getState().privacyMode).toBe(mode)
      }
    })
  })

  describe('computed functions', () => {
    describe('isAuthenticated', () => {
      it('returns false when no user and no token', () => {
        const store = useAuthStore.getState()
        expect(store.isAuthenticated()).toBe(false)
      })

      it('returns false when user but no token', () => {
        useAuthStore.setState({
          user: { id: '1', email: 'test@example.com', privacyMode: 'open_book', hasCustodialWallet: false },
          token: null,
        })
        const store = useAuthStore.getState()
        expect(store.isAuthenticated()).toBe(false)
      })

      it('returns true when user, token, and managed mode present', () => {
        useAuthStore.setState({
          user: { id: '1', email: 'test@example.com', privacyMode: 'open_book', hasCustodialWallet: false },
          token: 'valid-token',
          mode: 'managed',
        })
        const store = useAuthStore.getState()
        expect(store.isAuthenticated()).toBe(true)
      })

      it('returns false when in self_custody mode even with user and token', () => {
        useAuthStore.setState({
          user: { id: '1', email: 'test@example.com', privacyMode: 'open_book', hasCustodialWallet: false },
          token: 'valid-token',
          mode: 'self_custody',
        })
        const store = useAuthStore.getState()
        expect(store.isAuthenticated()).toBe(false)
      })
    })

    describe('isManagedMode', () => {
      it('returns true when mode is managed', () => {
        useAuthStore.setState({ mode: 'managed' })
        const store = useAuthStore.getState()
        expect(store.isManagedMode()).toBe(true)
      })

      it('returns false when mode is self_custody', () => {
        useAuthStore.setState({ mode: 'self_custody' })
        const store = useAuthStore.getState()
        expect(store.isManagedMode()).toBe(false)
      })
    })

    describe('isSelfCustodyMode', () => {
      it('returns true when mode is self_custody', () => {
        useAuthStore.setState({ mode: 'self_custody' })
        const store = useAuthStore.getState()
        expect(store.isSelfCustodyMode()).toBe(true)
      })

      it('returns false when mode is managed', () => {
        useAuthStore.setState({ mode: 'managed' })
        const store = useAuthStore.getState()
        expect(store.isSelfCustodyMode()).toBe(false)
      })
    })

    describe('canUseGhostMode', () => {
      it('returns true in self_custody mode', () => {
        useAuthStore.setState({ mode: 'self_custody' })
        const store = useAuthStore.getState()
        expect(store.canUseGhostMode()).toBe(true)
      })

      it('returns false in managed mode', () => {
        useAuthStore.setState({ mode: 'managed' })
        const store = useAuthStore.getState()
        expect(store.canUseGhostMode()).toBe(false)
      })
    })
  })

  describe('OTP login flow', () => {
    it('requestOtp sets loading state', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { expiresIn: 300 } }),
      })

      const store = useAuthStore.getState()
      const promise = store.requestOtp('test@example.com')

      // Should be loading while request in flight
      expect(useAuthStore.getState().isLoading).toBe(true)

      await promise

      expect(useAuthStore.getState().isLoading).toBe(false)
    })

    it('login sets user and token on success', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        privacyMode: 'open_book',
        hasCustodialWallet: false,
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { user: mockUser, token: 'jwt-token-123' },
        }),
      })

      const store = useAuthStore.getState()
      await store.login('test@example.com', '123456')

      const state = useAuthStore.getState()
      expect(state.user).toEqual(mockUser)
      expect(state.token).toBe('jwt-token-123')
      expect(state.mode).toBe('managed')
      expect(state.isLoading).toBe(false)
    })

    it('login sets error on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ success: false, error: 'Invalid code' }),
      })

      const store = useAuthStore.getState()
      await expect(store.login('test@example.com', 'wrong')).rejects.toThrow('Invalid code')

      const state = useAuthStore.getState()
      expect(state.user).toBeNull()
      expect(state.token).toBeNull()
      expect(state.error).toBe('Invalid code')
    })
  })

  describe('logout', () => {
    it('clears user and token on logout', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      useAuthStore.setState({
        user: { id: '1', email: 'test@example.com', privacyMode: 'open_book', hasCustodialWallet: false },
        token: 'valid-token',
        mode: 'managed',
      })

      const store = useAuthStore.getState()
      await store.logout()

      const state = useAuthStore.getState()
      expect(state.user).toBeNull()
      expect(state.token).toBeNull()
      expect(state.mode).toBe('self_custody')
      expect(state.passkeys).toEqual([])
    })
  })

  describe('passkey support', () => {
    it('isPasskeyAvailable returns support status', () => {
      const store = useAuthStore.getState()
      expect(store.isPasskeyAvailable()).toBe(true) // Mocked to return true
    })
  })

  describe('refreshUser', () => {
    it('does nothing when no token', async () => {
      const store = useAuthStore.getState()
      await store.refreshUser()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('updates user on success', async () => {
      const updatedUser = {
        id: 'user-123',
        email: 'test@example.com',
        privacyMode: 'private',
        hasCustodialWallet: true,
      }

      useAuthStore.setState({
        token: 'valid-token',
        user: { id: 'user-123', email: 'test@example.com', privacyMode: 'open_book', hasCustodialWallet: false },
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: updatedUser }),
      })

      const store = useAuthStore.getState()
      await store.refreshUser()

      const state = useAuthStore.getState()
      expect(state.user?.privacyMode).toBe('private')
      expect(state.privacyMode).toBe('private')
    })

    it('logs out on invalid token', async () => {
      useAuthStore.setState({
        token: 'invalid-token',
        user: { id: 'user-123', email: 'test@example.com', privacyMode: 'open_book', hasCustodialWallet: false },
        mode: 'managed',
      })

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ success: false, error: 'Invalid token' }),
      })

      const store = useAuthStore.getState()
      await store.refreshUser()

      const state = useAuthStore.getState()
      expect(state.user).toBeNull()
      expect(state.token).toBeNull()
      expect(state.mode).toBe('self_custody')
    })
  })

  describe('loginWithPasskey', () => {
    it('sets user and token on success', async () => {
      const { loginWithPasskey } = await import('../services/passkey')
      ;(loginWithPasskey as Mock).mockResolvedValueOnce({
        user: {
          id: 'user-pk-123',
          email: 'passkey@example.com',
          privacyMode: 'anonymous',
          emailVerified: true,
          passkeyEnabled: true,
        },
        token: 'passkey-jwt-token',
      })

      // Mock smart account fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { address: '0x123' } }),
      })

      const store = useAuthStore.getState()
      await store.loginWithPasskey()

      const state = useAuthStore.getState()
      expect(state.user?.id).toBe('user-pk-123')
      expect(state.token).toBe('passkey-jwt-token')
      expect(state.mode).toBe('managed')
      expect(state.isLoading).toBe(false)
    })

    it('sets error on failure', async () => {
      const { loginWithPasskey } = await import('../services/passkey')
      ;(loginWithPasskey as Mock).mockRejectedValueOnce(new Error('Passkey cancelled'))

      const store = useAuthStore.getState()
      await expect(store.loginWithPasskey()).rejects.toThrow('Passkey cancelled')

      const state = useAuthStore.getState()
      expect(state.error).toBe('Passkey cancelled')
      expect(state.isLoading).toBe(false)
    })

    it('passes email when provided', async () => {
      const { loginWithPasskey } = await import('../services/passkey')
      ;(loginWithPasskey as Mock).mockResolvedValueOnce({
        user: { id: 'user-123', email: 'test@example.com', privacyMode: 'open_book', passkeyEnabled: true },
        token: 'token',
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { address: '0x123' } }),
      })

      const store = useAuthStore.getState()
      await store.loginWithPasskey('test@example.com')

      expect(loginWithPasskey).toHaveBeenCalledWith('test@example.com')
    })
  })

  describe('signupWithPasskey', () => {
    it('sets user and token on success', async () => {
      const { signupWithPasskey } = await import('../services/passkey')
      const mockSignup = vi.fn().mockResolvedValueOnce({
        user: {
          id: 'new-user-123',
          email: null,
          privacyMode: 'open_book',
          passkeyEnabled: true,
        },
        token: 'signup-jwt-token',
      })
      vi.mocked(signupWithPasskey).mockImplementation(mockSignup)

      // Mock smart account fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { address: '0xabc' } }),
      })

      const store = useAuthStore.getState()
      await store.signupWithPasskey()

      const state = useAuthStore.getState()
      expect(state.user?.id).toBe('new-user-123')
      expect(state.token).toBe('signup-jwt-token')
      expect(state.mode).toBe('managed')
    })

    it('sets error on failure', async () => {
      const { signupWithPasskey } = await import('../services/passkey')
      vi.mocked(signupWithPasskey).mockRejectedValueOnce(new Error('Signup cancelled'))

      const store = useAuthStore.getState()
      await expect(store.signupWithPasskey()).rejects.toThrow('Signup cancelled')

      const state = useAuthStore.getState()
      expect(state.error).toBe('Signup cancelled')
    })
  })

  describe('registerPasskey', () => {
    it('throws when not logged in', async () => {
      const store = useAuthStore.getState()
      await expect(store.registerPasskey()).rejects.toThrow('Must be logged in')
    })

    it('registers passkey and updates list on success', async () => {
      const { registerPasskey, listPasskeys } = await import('../services/passkey')
      ;(registerPasskey as Mock).mockResolvedValueOnce({
        id: 'pk-new',
        displayName: 'My Laptop',
        deviceType: 'platform',
        createdAt: '2024-01-01',
        lastUsedAt: null,
      })
      ;(listPasskeys as Mock).mockResolvedValueOnce([
        { id: 'pk-new', displayName: 'My Laptop', deviceType: 'platform', createdAt: '2024-01-01', lastUsedAt: null },
      ])

      useAuthStore.setState({
        token: 'valid-token',
        user: { id: 'user-123', email: 'test@example.com', privacyMode: 'open_book', hasCustodialWallet: false },
      })

      const store = useAuthStore.getState()
      const result = await store.registerPasskey('My Laptop')

      expect(result.displayName).toBe('My Laptop')
      expect(useAuthStore.getState().passkeys).toHaveLength(1)
      expect(useAuthStore.getState().user?.passkeyEnabled).toBe(true)
    })

    it('sets error on failure', async () => {
      const { registerPasskey } = await import('../services/passkey')
      ;(registerPasskey as Mock).mockRejectedValueOnce(new Error('Registration failed'))

      useAuthStore.setState({
        token: 'valid-token',
        user: { id: 'user-123', email: 'test@example.com', privacyMode: 'open_book', hasCustodialWallet: false },
      })

      const store = useAuthStore.getState()
      await expect(store.registerPasskey()).rejects.toThrow('Registration failed')

      expect(useAuthStore.getState().error).toBe('Registration failed')
    })
  })

  describe('loadPasskeys', () => {
    it('does nothing when no token', async () => {
      const { listPasskeys } = await import('../services/passkey')
      const store = useAuthStore.getState()
      await store.loadPasskeys()
      expect(listPasskeys).not.toHaveBeenCalled()
    })

    it('loads passkeys on success', async () => {
      const { listPasskeys } = await import('../services/passkey')
      ;(listPasskeys as Mock).mockResolvedValueOnce([
        { id: 'pk-1', displayName: 'Device 1', deviceType: 'platform', createdAt: '2024-01-01', lastUsedAt: null },
        { id: 'pk-2', displayName: 'Device 2', deviceType: 'cross-platform', createdAt: '2024-01-02', lastUsedAt: null },
      ])

      useAuthStore.setState({ token: 'valid-token' })

      const store = useAuthStore.getState()
      await store.loadPasskeys()

      expect(useAuthStore.getState().passkeys).toHaveLength(2)
    })
  })

  describe('deletePasskey', () => {
    it('does nothing when no token', async () => {
      const { deletePasskey } = await import('../services/passkey')
      const store = useAuthStore.getState()
      await store.deletePasskey('pk-1')
      expect(deletePasskey).not.toHaveBeenCalled()
    })

    it('removes passkey from list', async () => {
      const { deletePasskey } = await import('../services/passkey')
      ;(deletePasskey as Mock).mockResolvedValueOnce(undefined)

      useAuthStore.setState({
        token: 'valid-token',
        user: { id: 'user-123', email: 'test@example.com', privacyMode: 'open_book', hasCustodialWallet: false, passkeyEnabled: true },
        passkeys: [
          { id: 'pk-1', displayName: 'Device 1', deviceType: 'platform', createdAt: '2024-01-01', lastUsedAt: null },
          { id: 'pk-2', displayName: 'Device 2', deviceType: 'platform', createdAt: '2024-01-02', lastUsedAt: null },
        ],
      })

      const store = useAuthStore.getState()
      await store.deletePasskey('pk-1')

      const state = useAuthStore.getState()
      expect(state.passkeys).toHaveLength(1)
      expect(state.passkeys[0].id).toBe('pk-2')
    })

    it('disables passkeyEnabled when deleting last passkey', async () => {
      const { deletePasskey } = await import('../services/passkey')
      ;(deletePasskey as Mock).mockResolvedValueOnce(undefined)

      useAuthStore.setState({
        token: 'valid-token',
        user: { id: 'user-123', email: 'test@example.com', privacyMode: 'open_book', hasCustodialWallet: false, passkeyEnabled: true },
        passkeys: [
          { id: 'pk-1', displayName: 'Device 1', deviceType: 'platform', createdAt: '2024-01-01', lastUsedAt: null },
        ],
      })

      const store = useAuthStore.getState()
      await store.deletePasskey('pk-1')

      expect(useAuthStore.getState().user?.passkeyEnabled).toBe(false)
    })
  })

  describe('renamePasskey', () => {
    it('does nothing when no token', async () => {
      const { renamePasskey } = await import('../services/passkey')
      const store = useAuthStore.getState()
      await store.renamePasskey('pk-1', 'New Name')
      expect(renamePasskey).not.toHaveBeenCalled()
    })

    it('updates passkey name in list', async () => {
      const { renamePasskey } = await import('../services/passkey')
      ;(renamePasskey as Mock).mockResolvedValueOnce(undefined)

      useAuthStore.setState({
        token: 'valid-token',
        passkeys: [
          { id: 'pk-1', displayName: 'Old Name', deviceType: 'platform', createdAt: '2024-01-01', lastUsedAt: null },
        ],
      })

      const store = useAuthStore.getState()
      await store.renamePasskey('pk-1', 'New Name')

      expect(useAuthStore.getState().passkeys[0].displayName).toBe('New Name')
    })
  })

  describe('startSession', () => {
    it('creates local session in ghost mode', async () => {
      useAuthStore.setState({ privacyMode: 'ghost' })

      const store = useAuthStore.getState()
      const sessionId = await store.startSession()

      expect(sessionId).toBeDefined()
      expect(useAuthStore.getState().currentSessionId).toBe(sessionId)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('creates server session on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { sessionId: 'srv-session-123' } }),
      })

      const store = useAuthStore.getState()
      const sessionId = await store.startSession('chat')

      expect(sessionId).toBe('srv-session-123')
      expect(useAuthStore.getState().currentSessionId).toBe('srv-session-123')
    })

    it('falls back to local session on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const store = useAuthStore.getState()
      const sessionId = await store.startSession()

      expect(sessionId).toBeDefined()
      expect(useAuthStore.getState().currentSessionId).toBe(sessionId)
    })
  })

  describe('endSession', () => {
    it('clears session immediately in ghost mode', async () => {
      useAuthStore.setState({ privacyMode: 'ghost', currentSessionId: 'local-123' })

      const store = useAuthStore.getState()
      await store.endSession()

      expect(useAuthStore.getState().currentSessionId).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('does nothing when no current session', async () => {
      useAuthStore.setState({ currentSessionId: null })

      const store = useAuthStore.getState()
      await store.endSession()

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('ends server session with rating and feedback', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      useAuthStore.setState({ currentSessionId: 'srv-session-123', privacyMode: 'open_book' })

      const store = useAuthStore.getState()
      await store.endSession(5, 'Great experience!')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/events/sessions/srv-session-123/end'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ rating: 5, feedback: 'Great experience!' }),
        })
      )
      expect(useAuthStore.getState().currentSessionId).toBeNull()
    })
  })

  describe('logEvent', () => {
    it('does nothing in ghost mode', async () => {
      useAuthStore.setState({ privacyMode: 'ghost' })

      const { logEvent } = await import('./authStore')
      await logEvent('test_event', { data: 'test' })

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('strips data in private mode', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      useAuthStore.setState({ privacyMode: 'private', currentSessionId: 'session-123' })

      const { logEvent } = await import('./authStore')
      await logEvent('test_event', { sensitiveData: 'should-be-stripped' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/events/stream'),
        expect.objectContaining({
          body: expect.stringContaining('"eventData":{"type":"test_event"}'),
        })
      )
    })

    it('sends full data in open_book mode', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      useAuthStore.setState({ privacyMode: 'open_book', currentSessionId: 'session-123' })

      const { logEvent } = await import('./authStore')
      await logEvent('chat_message', { message: 'Hello world' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/events/stream'),
        expect.objectContaining({
          body: expect.stringContaining('"message":"Hello world"'),
        })
      )
    })
  })

  describe('setPrivacyMode with authenticated user', () => {
    it('updates backend when authenticated', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      useAuthStore.setState({
        token: 'valid-token',
        user: { id: 'user-123', email: 'test@example.com', privacyMode: 'open_book', hasCustodialWallet: false },
        mode: 'managed',
      })

      const store = useAuthStore.getState()
      store.setPrivacyMode('private')

      // Wait for async backend call
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/privacy'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ privacyMode: 'private' }),
        })
      )
    })
  })
})
