/**
 * Hook for persisting component state to the server.
 * State is stored per-message and propagates to all chat participants.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { getSessionId } from '../services/session'
import { getWalletSession } from '../services/siwe'
import { useAuthStore } from '../stores'

export interface ComponentState {
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  [key: string]: unknown
}

export interface TransactionPreviewState extends ComponentState {
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  projectIds?: Record<number, number>
  txHashes?: Record<number, string>
  bundleId?: string
  completedAt?: string
  error?: string
  // Track which follow-up messages have been sent (survives reload)
  hasShownLoadingMessage?: boolean
  hasShownProjectCard?: boolean
}

interface UseComponentStateOptions<T extends ComponentState> {
  messageId: string | undefined
  componentKey: string
  initialState?: T
}

interface UseComponentStateReturn<T extends ComponentState> {
  state: T | null
  isLoading: boolean
  error: string | null
  setState: (newState: T) => Promise<void>
  updateState: (updates: Partial<T>) => Promise<void>
}

const API_URL = import.meta.env.VITE_API_URL || ''

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const sessionId = getSessionId()
  const walletSession = getWalletSession()
  const authToken = useAuthStore.getState().token

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Session-ID': sessionId,
    ...(options.headers as Record<string, string> || {}),
  }

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }
  if (walletSession?.token) {
    headers['X-Wallet-Session'] = walletSession.token
  }

  return fetch(url, { ...options, headers })
}

/**
 * Hook to persist component state server-side.
 * State is scoped per-message and visible to all chat participants.
 */
export function useComponentState<T extends ComponentState = ComponentState>(
  options: UseComponentStateOptions<T>
): UseComponentStateReturn<T> {
  const { messageId, componentKey, initialState } = options

  const [state, setLocalState] = useState<T | null>(initialState || null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Track if initial load has happened
  const hasLoadedRef = useRef(false)

  // Load state from server on mount
  useEffect(() => {
    if (!messageId || hasLoadedRef.current) return

    const loadState = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetchWithAuth(
          `${API_URL}/chat/messages/${messageId}/components/${componentKey}`
        )

        if (response.ok) {
          const result = await response.json()
          if (result.success && result.data) {
            setLocalState(result.data as T)
          }
        }
      } catch (err) {
        console.error('[useComponentState] Failed to load component state:', err)
        setError(err instanceof Error ? err.message : 'Failed to load state')
      } finally {
        setIsLoading(false)
        hasLoadedRef.current = true
      }
    }

    loadState()
  }, [messageId, componentKey])

  // Save state to server
  const setState = useCallback(async (newState: T) => {
    if (!messageId) {
      console.warn('[useComponentState] Cannot save state: no messageId')
      setLocalState(newState)
      return
    }

    setLocalState(newState)
    setError(null)

    try {
      const response = await fetchWithAuth(
        `${API_URL}/chat/messages/${messageId}/components/${componentKey}`,
        {
          method: 'PUT',
          body: JSON.stringify({ state: newState }),
        }
      )

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to save state')
      }
    } catch (err) {
      console.error('[useComponentState] Failed to save component state:', err)
      setError(err instanceof Error ? err.message : 'Failed to save state')
    }
  }, [messageId, componentKey])

  // Update state (merge with existing)
  const updateState = useCallback(async (updates: Partial<T>) => {
    const newState = { ...(state || { status: 'pending' as const }), ...updates } as T
    await setState(newState)
  }, [state, setState])

  return {
    state,
    isLoading,
    error,
    setState,
    updateState,
  }
}

/**
 * Hook specifically for transaction-preview component state
 */
export function useTransactionPreviewState(
  messageId: string | undefined
): UseComponentStateReturn<TransactionPreviewState> {
  return useComponentState<TransactionPreviewState>({
    messageId,
    componentKey: 'transaction-preview',
    initialState: { status: 'pending' },
  })
}
