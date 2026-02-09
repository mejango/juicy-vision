/**
 * Auth Store (Zustand)
 *
 * Manages authentication state for the mobile app.
 * Uses MMKV for fast, secure storage.
 */

import { create } from 'zustand'
import { MMKV } from 'react-native-mmkv'

const storage = new MMKV()

interface User {
  id: string
  email: string
}

interface AuthState {
  user: User | null
  token: string | null
  isLoading: boolean

  // Actions
  initialize: () => Promise<void>
  login: (email: string, code: string) => Promise<void>
  logout: () => void
  isAuthenticated: () => boolean
}

const API_BASE = 'https://api.juicyvision.app'

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isLoading: true,

  initialize: async () => {
    try {
      const token = storage.getString('token')
      const userJson = storage.getString('user')

      if (token && userJson) {
        const user = JSON.parse(userJson)
        set({ user, token, isLoading: false })

        // Verify token is still valid
        const res = await fetch(`${API_BASE}/auth/me`, {
          headers: { 'Authorization': `Bearer ${token}` },
        })

        if (!res.ok) {
          // Token expired
          get().logout()
        }
      } else {
        set({ isLoading: false })
      }
    } catch {
      set({ isLoading: false })
    }
  },

  login: async (email: string, code: string) => {
    const res = await fetch(`${API_BASE}/auth/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    })

    const data = await res.json()

    if (!data.success) {
      throw new Error(data.error || 'Login failed')
    }

    const { token, user } = data.data

    // Save to secure storage
    storage.set('token', token)
    storage.set('user', JSON.stringify(user))

    set({ user, token })
  },

  logout: () => {
    storage.delete('token')
    storage.delete('user')
    set({ user: null, token: null })
  },

  isAuthenticated: () => {
    return !!get().token
  },
}))
