import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { useAuthStore, PRIVACY_MODES, type PrivacyMode } from './authStore'

// Mock the passkey service
vi.mock('../services/passkey', () => ({
  isPasskeySupported: vi.fn(() => true),
  loginWithPasskey: vi.fn(),
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
})
