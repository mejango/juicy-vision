/**
 * Hook for fetching and managing user's Juice balance
 */

import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '../stores'

const API_BASE = import.meta.env.VITE_API_URL || ''

export interface JuiceBalance {
  balance: number
  lifetimePurchased: number
  lifetimeSpent: number
  lifetimeCashedOut: number
  expiresAt: string
}

export function useJuiceBalance() {
  const { token, isAuthenticated } = useAuthStore()
  const [balance, setBalance] = useState<JuiceBalance | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchBalance = useCallback(async () => {
    if (!isAuthenticated() || !token) {
      setBalance(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`${API_BASE}/juice/balance`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      const data = await res.json()

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch balance')
      }

      setBalance(data.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch balance')
      setBalance(null)
    } finally {
      setLoading(false)
    }
  }, [token, isAuthenticated])

  // Fetch on mount and when token changes
  useEffect(() => {
    fetchBalance()
  }, [fetchBalance])

  return {
    balance,
    loading,
    error,
    refetch: fetchBalance,
    hasBalance: (balance?.balance ?? 0) > 0,
  }
}
