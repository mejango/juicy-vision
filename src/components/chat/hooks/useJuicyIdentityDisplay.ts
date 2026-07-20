import { useEffect, useState } from 'react'
import { getSessionId } from '../../../services/session'
import { getWalletSession } from '../../../services/siwe'
import { useAuthStore } from '../../../stores'

export interface JuicyIdentity {
  emoji: string
  username: string
  formatted: string
}

interface UseJuicyIdentityDisplayOptions {
  /** Send the managed-auth Bearer token (read at fetch time) with the request. */
  includeAuthToken?: boolean
  /** Dispatch `juice:identity-changed` after a successful fetch so other components update. */
  broadcast?: boolean
  /** Cache the fetched identity to localStorage (`juicy-identity`) for instant display on remount. */
  cacheLocal?: boolean
  /** Lazy initializer for the identity state (e.g., read the localStorage cache). */
  initial?: () => JuicyIdentity | null
}

/**
 * Fetches the current user's Juicy ID from `/identity/me` (re-running when
 * `deps` change) and keeps it in sync via the `juice:identity-changed` event.
 *
 * Consolidates the identical fetch-identity effects previously copy-pasted
 * across WalletPanel, SettingsPanel, ChatContainer, ChatInput, and WalletInfo.
 */
export function useJuicyIdentityDisplay(
  deps: readonly unknown[],
  { includeAuthToken = false, broadcast = false, cacheLocal = false, initial }: UseJuicyIdentityDisplayOptions = {}
) {
  const [identity, setIdentity] = useState<JuicyIdentity | null>(initial ?? null)

  // Fetch identity (Juicy ID)
  useEffect(() => {
    const fetchIdentity = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || ''
        const sessionId = getSessionId()
        const walletSession = getWalletSession()
        const headers: Record<string, string> = {
          'X-Session-ID': sessionId,
        }
        if (includeAuthToken) {
          const authToken = useAuthStore.getState().token
          if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`
          }
        }
        if (walletSession?.token) {
          headers['X-Wallet-Session'] = walletSession.token
        }
        const res = await fetch(`${apiUrl}/identity/me`, { headers })
        if (res.ok) {
          const data = await res.json()
          if (data.success && data.data) {
            setIdentity(data.data)
            if (cacheLocal) {
              // Cache for instant display on remount
              try { localStorage.setItem('juicy-identity', JSON.stringify(data.data)) } catch {
                // Identity caching is best-effort.
              }
            }
            if (broadcast) {
              // Notify other components of the loaded identity
              window.dispatchEvent(new CustomEvent('juice:identity-changed', { detail: data.data }))
            }
          }
        }
      } catch {
        // Ignore identity fetch errors
      }
    }
    fetchIdentity()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  // Listen for identity changes from other components
  useEffect(() => {
    const handleIdentityChange = (e: CustomEvent<JuicyIdentity>) => {
      setIdentity(e.detail)
    }
    window.addEventListener('juice:identity-changed', handleIdentityChange as EventListener)
    return () => window.removeEventListener('juice:identity-changed', handleIdentityChange as EventListener)
  }, [])

  return [identity, setIdentity] as const
}
