import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '../stores'

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'

export interface ManagedWalletBalance {
  chainId: number
  tokenAddress: string
  tokenSymbol: string
  balance: string
  decimals: number
}

export interface ManagedWalletData {
  address: string | null
  balances: ManagedWalletBalance[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

async function apiRequest<T>(
  endpoint: string,
  token: string | null,
  options: RequestInit = {}
): Promise<T> {
  if (!token) {
    throw new Error('Not authenticated')
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...(options.headers as Record<string, string>),
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

/**
 * Hook for managed mode wallet data (address and balances)
 * Only fetches data when user is authenticated in managed mode
 */
export function useManagedWallet(): ManagedWalletData {
  const { token, isAuthenticated, mode } = useAuthStore()
  const [address, setAddress] = useState<string | null>(null)
  const [balances, setBalances] = useState<ManagedWalletBalance[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!isAuthenticated() || mode !== 'managed' || !token) {
      setAddress(null)
      setBalances([])
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Fetch address and balances in parallel
      const [addressData, balanceData] = await Promise.all([
        apiRequest<{ address: string }>('/wallet/address', token),
        apiRequest<{ address: string; balances: ManagedWalletBalance[] }>('/wallet/balances', token),
      ])

      setAddress(addressData.address)
      setBalances(balanceData.balances)
    } catch (err) {
      console.error('Failed to fetch managed wallet data:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch wallet data')
    } finally {
      setLoading(false)
    }
  }, [token, isAuthenticated, mode])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { address, balances, loading, error, refetch: fetchData }
}

/**
 * Execute a transaction via the managed wallet backend
 * Returns the transaction hash on success
 */
export async function executeManagedTransaction(
  chainId: number,
  to: string,
  data: string,
  value: string = '0'
): Promise<string> {
  const { token, isAuthenticated, mode } = useAuthStore.getState()

  if (!isAuthenticated() || mode !== 'managed' || !token) {
    throw new Error('Not authenticated in managed mode')
  }

  const result = await apiRequest<{ txHash: string }>(
    '/wallet/execute',
    token,
    {
      method: 'POST',
      body: JSON.stringify({ chainId, to, data, value }),
    }
  )

  return result.txHash
}

/**
 * Helper to check if user is in managed mode and authenticated
 */
export function useIsManagedMode(): boolean {
  const { mode, isAuthenticated } = useAuthStore()
  return mode === 'managed' && isAuthenticated()
}
