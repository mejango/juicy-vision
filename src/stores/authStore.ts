import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  isPasskeySupported,
  loginWithPasskey as passkeyLogin,
  registerPasskey as passkeyRegister,
  listPasskeys,
  deletePasskey as passkeyDelete,
  renamePasskey as passkeyRename,
  signupWithPasskey as passkeySignup,
  type DeviceHint,
} from '../services/passkey'
import { forgetPasskeyWallet } from '../services/passkeyWallet'
import { clearWalletSession } from '../services/siwe'

// ============================================================================
// Types
// ============================================================================

export type UserMode = 'self_custody' | 'managed'
export type PrivacyMode = 'open_book' | 'anonymous' | 'private' | 'ghost'

export interface PrivacyModeConfig {
  name: string
  description: string
  storeChat: boolean
  storeAnalytics: boolean
  includeInTraining: boolean
  requiresSelfCustody: boolean
}

export const PRIVACY_MODES: Record<PrivacyMode, PrivacyModeConfig> = {
  open_book: {
    name: 'Open Book',
    description: 'Conversations improve the app. Fully attributed.',
    storeChat: true,
    storeAnalytics: true,
    includeInTraining: true,
    requiresSelfCustody: false,
  },
  anonymous: {
    name: 'Anonymous',
    description: 'Conversations improve the app. Identity stripped.',
    storeChat: true,
    storeAnalytics: true,
    includeInTraining: true,
    requiresSelfCustody: false,
  },
  private: {
    name: 'Private',
    description: 'Conversations not stored. Basic usage analytics only.',
    storeChat: false,
    storeAnalytics: true,
    includeInTraining: false,
    requiresSelfCustody: false,
  },
  ghost: {
    name: 'Ghost',
    description: 'Nothing collected. Requires self-custody mode.',
    storeChat: false,
    storeAnalytics: false,
    includeInTraining: false,
    requiresSelfCustody: true,
  },
}

export interface ManagedUser {
  id: string
  email: string
  privacyMode: PrivacyMode
  hasCustodialWallet: boolean
  passkeyEnabled?: boolean
  isAdmin?: boolean
}

export interface PasskeyInfo {
  id: string
  displayName: string | null
  deviceType: string | null
  createdAt: string
  lastUsedAt: string | null
}

// ============================================================================
// API Client
// ============================================================================

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = useAuthStore.getState().token

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  })

  const data = await response.json()

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Request failed')
  }

  return data.data as T
}

// ============================================================================
// Store
// ============================================================================

interface AuthState {
  // Mode
  mode: UserMode
  privacyMode: PrivacyMode

  // Managed mode auth
  user: ManagedUser | null
  token: string | null
  isLoading: boolean
  error: string | null

  // Chat session (for analytics)
  currentSessionId: string | null

  // Actions
  setMode: (mode: UserMode) => void
  setPrivacyMode: (privacyMode: PrivacyMode) => void

  // Managed mode actions (OTP-based)
  requestOtp: (email: string) => Promise<{ code?: string; expiresIn: number }>
  login: (email: string, code: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>

  // Passkey actions
  passkeys: PasskeyInfo[]
  loginWithPasskey: (email?: string, deviceHint?: DeviceHint) => Promise<void>
  signupWithPasskey: (deviceHint?: DeviceHint) => Promise<void>
  registerPasskey: (displayName?: string) => Promise<PasskeyInfo>
  loadPasskeys: () => Promise<void>
  deletePasskey: (id: string) => Promise<void>
  renamePasskey: (id: string, displayName: string) => Promise<void>
  isPasskeyAvailable: () => boolean

  // Session management
  startSession: (entryPoint?: string) => Promise<string>
  endSession: (rating?: number, feedback?: string) => Promise<void>

  // Computed
  isAuthenticated: () => boolean
  isManagedMode: () => boolean
  isSelfCustodyMode: () => boolean
  canUseGhostMode: () => boolean

  // Hydration
  _hasHydrated: boolean
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      mode: 'self_custody',
      privacyMode: 'open_book',
      user: null,
      token: null,
      isLoading: false,
      error: null,
      currentSessionId: null,
      _hasHydrated: false,
      passkeys: [],

      // Mode setters
      setMode: (mode) => {
        // Ghost mode requires self-custody
        const state = get()
        if (mode === 'managed' && state.privacyMode === 'ghost') {
          set({ mode, privacyMode: 'private' })
        } else {
          set({ mode })
        }
      },

      setPrivacyMode: (privacyMode) => {
        const state = get()
        const config = PRIVACY_MODES[privacyMode]

        // Ghost mode requires self-custody
        if (config.requiresSelfCustody && state.mode === 'managed') {
          set({ privacyMode, mode: 'self_custody' })
        } else {
          set({ privacyMode })
        }

        // Update backend if authenticated
        if (state.token && state.user) {
          apiRequest('/auth/privacy', {
            method: 'PATCH',
            body: JSON.stringify({ privacyMode }),
          }).catch(console.error)
        }
      },

      // Auth actions (OTP-based)
      requestOtp: async (email: string) => {
        set({ isLoading: true, error: null })
        try {
          const data = await apiRequest<{ code?: string; expiresIn: number }>(
            '/auth/request-code',
            {
              method: 'POST',
              body: JSON.stringify({ email }),
            }
          )
          set({ isLoading: false })
          return data
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to send code',
            isLoading: false,
          })
          throw error
        }
      },

      login: async (email: string, code: string) => {
        set({ isLoading: true, error: null })
        try {
          const data = await apiRequest<{ user: ManagedUser; token: string }>(
            '/auth/verify-code',
            {
              method: 'POST',
              body: JSON.stringify({ email, code }),
            }
          )
          set({
            user: data.user,
            token: data.token,
            mode: 'managed',
            privacyMode: data.user.privacyMode,
            isLoading: false,
          })
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Verification failed',
            isLoading: false,
          })
          throw error
        }
      },

      logout: async () => {
        const state = get()
        if (state.token) {
          try {
            await apiRequest('/auth/logout', { method: 'POST' })
          } catch {
            // Ignore logout errors
          }
        }
        // Clear ALL auth state - passkey wallet, SIWE session, and cached data
        // This ensures signing out truly signs out of everything
        forgetPasskeyWallet() // Clears juice-passkey-wallet AND juice-passkey-credential
        clearWalletSession() // Clears SIWE session
        localStorage.removeItem('juice-smart-account-address')
        localStorage.removeItem('juicy-identity')
        set({
          user: null,
          token: null,
          mode: 'self_custody',
          currentSessionId: null,
          passkeys: [],
        })
        // Dispatch event so UI components can update
        window.dispatchEvent(new CustomEvent('juice:passkey-disconnected'))
      },

      refreshUser: async () => {
        const state = get()
        if (!state.token) return

        try {
          const data = await apiRequest<ManagedUser>('/auth/me')
          set({ user: data, privacyMode: data.privacyMode })
        } catch {
          // Token invalid, logout
          set({ user: null, token: null, mode: 'self_custody' })
        }
      },

      // Passkey actions
      loginWithPasskey: async (email?: string, deviceHint?: DeviceHint) => {
        set({ isLoading: true, error: null })
        try {
          const result = await passkeyLogin(email, deviceHint)
          set({
            user: {
              id: result.user.id,
              email: result.user.email,
              privacyMode: result.user.privacyMode as PrivacyMode,
              hasCustodialWallet: false,
              passkeyEnabled: result.user.passkeyEnabled,
              isAdmin: result.user.isAdmin,
            },
            token: result.token,
            mode: 'managed',
            privacyMode: result.user.privacyMode as PrivacyMode,
            isLoading: false,
          })

          // Fetch and cache smart account address immediately after login
          // This ensures we have the address cached for offline/expired token scenarios
          try {
            const API_BASE_URL = import.meta.env.VITE_API_URL || ''
            const response = await fetch(`${API_BASE_URL}/wallet/address`, {
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${result.token}`,
              },
            })
            const data = await response.json()
            if (data.success && data.data?.address) {
              localStorage.setItem('juice-smart-account-address', data.data.address)
              // Dispatch event so ChatContainer can merge session
              window.dispatchEvent(new CustomEvent('juice:managed-auth-success', {
                detail: { address: data.data.address }
              }))
            }
          } catch {
            // Non-critical, will be fetched later by useManagedWallet
          }
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Passkey login failed',
            isLoading: false,
          })
          throw error
        }
      },

      signupWithPasskey: async (deviceHint?: DeviceHint) => {
        set({ isLoading: true, error: null })
        // Clear any stale identity cache from previous account
        localStorage.removeItem('juicy-identity')
        try {
          const result = await passkeySignup(deviceHint)
          set({
            user: {
              id: result.user.id,
              email: result.user.email,
              privacyMode: result.user.privacyMode as PrivacyMode,
              hasCustodialWallet: false,
              passkeyEnabled: result.user.passkeyEnabled,
              isAdmin: result.user.isAdmin,
            },
            token: result.token,
            mode: 'managed',
            privacyMode: result.user.privacyMode as PrivacyMode,
            isLoading: false,
          })

          // Fetch and cache smart account address immediately after signup
          try {
            const API_BASE_URL = import.meta.env.VITE_API_URL || ''
            const response = await fetch(`${API_BASE_URL}/wallet/address`, {
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${result.token}`,
              },
            })
            const data = await response.json()
            if (data.success && data.data?.address) {
              localStorage.setItem('juice-smart-account-address', data.data.address)
              // Dispatch event so ChatContainer can merge session
              window.dispatchEvent(new CustomEvent('juice:managed-auth-success', {
                detail: { address: data.data.address }
              }))
            }
          } catch {
            // Non-critical, will be fetched later by useManagedWallet
          }
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Passkey signup failed',
            isLoading: false,
          })
          throw error
        }
      },

      registerPasskey: async (displayName?: string) => {
        const state = get()
        if (!state.token) {
          throw new Error('Must be logged in to register a passkey')
        }

        set({ isLoading: true, error: null })
        try {
          const passkey = await passkeyRegister(state.token, displayName)
          // Refresh passkeys list
          const passkeys = await listPasskeys(state.token)
          set({
            passkeys,
            isLoading: false,
            user: state.user ? { ...state.user, passkeyEnabled: true } : null,
          })
          return passkey
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Passkey registration failed',
            isLoading: false,
          })
          throw error
        }
      },

      loadPasskeys: async () => {
        const state = get()
        if (!state.token) return

        try {
          const passkeys = await listPasskeys(state.token)
          set({ passkeys })
        } catch {
          // Ignore errors
        }
      },

      deletePasskey: async (id: string) => {
        const state = get()
        if (!state.token) return

        try {
          await passkeyDelete(state.token, id)
          set({ passkeys: state.passkeys.filter((p) => p.id !== id) })
          // Check if user still has passkeys
          if (state.passkeys.length <= 1 && state.user) {
            set({ user: { ...state.user, passkeyEnabled: false } })
          }
        } catch (error) {
          throw error
        }
      },

      renamePasskey: async (id: string, displayName: string) => {
        const state = get()
        if (!state.token) return

        try {
          await passkeyRename(state.token, id, displayName)
          set({
            passkeys: state.passkeys.map((p) =>
              p.id === id ? { ...p, displayName } : p
            ),
          })
        } catch (error) {
          throw error
        }
      },

      isPasskeyAvailable: () => isPasskeySupported(),

      // Session management
      startSession: async (entryPoint) => {
        const state = get()

        // Ghost mode - don't create server session
        if (state.privacyMode === 'ghost') {
          const localId = crypto.randomUUID()
          set({ currentSessionId: localId })
          return localId
        }

        try {
          const data = await apiRequest<{ sessionId: string }>('/events/sessions', {
            method: 'POST',
            body: JSON.stringify({
              privacyMode: state.privacyMode,
              mode: state.mode,
              entryPoint,
            }),
          })
          set({ currentSessionId: data.sessionId })
          return data.sessionId
        } catch {
          // Fallback to local session
          const localId = crypto.randomUUID()
          set({ currentSessionId: localId })
          return localId
        }
      },

      endSession: async (rating, feedback) => {
        const state = get()
        if (!state.currentSessionId || state.privacyMode === 'ghost') {
          set({ currentSessionId: null })
          return
        }

        try {
          await apiRequest(`/events/sessions/${state.currentSessionId}/end`, {
            method: 'POST',
            body: JSON.stringify({ rating, feedback }),
          })
        } catch {
          // Ignore errors
        }

        set({ currentSessionId: null })
      },

      // Computed helpers
      isAuthenticated: () => {
        const state = get()
        return state.mode === 'managed' && !!state.token && !!state.user
      },

      isManagedMode: () => get().mode === 'managed',
      isSelfCustodyMode: () => get().mode === 'self_custody',

      canUseGhostMode: () => {
        const state = get()
        return state.mode === 'self_custody'
      },
    }),
    {
      name: 'juice-auth',
      version: 1,
      partialize: (state) => ({
        mode: state.mode,
        privacyMode: state.privacyMode,
        user: state.user,
        token: state.token,
      }),
      onRehydrateStorage: () => () => {
        useAuthStore.setState({ _hasHydrated: true })
      },
    }
  )
)

// ============================================================================
// Cross-tab Sync
// ============================================================================

// Listen for storage changes from other tabs to keep auth state in sync
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'juice-auth' && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue)
        if (parsed.state) {
          // Update store with state from other tab
          useAuthStore.setState({
            mode: parsed.state.mode,
            privacyMode: parsed.state.privacyMode,
            user: parsed.state.user,
            token: parsed.state.token,
          })
        }
      } catch {
        // Ignore parse errors
      }
    }
  })
}

// ============================================================================
// Event Logging Helper
// ============================================================================

export async function logEvent(
  eventType: string,
  eventData: Record<string, unknown>
): Promise<void> {
  const state = useAuthStore.getState()

  // Ghost mode - don't log
  if (state.privacyMode === 'ghost') return

  // Private mode - only log basic analytics
  if (state.privacyMode === 'private') {
    // Strip any potentially identifying data
    eventData = { type: eventType }
  }

  try {
    await apiRequest('/events/stream', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: state.currentSessionId,
        eventType,
        eventData,
        privacyMode: state.privacyMode,
      }),
    })
  } catch {
    // Ignore errors - analytics should not break the app
  }
}
