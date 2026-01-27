import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '../stores'
import { getPasskeyWallet, getStoredCredentialId } from '../services/passkeyWallet'

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'

/**
 * Lookup passkey wallet address from backend by credential ID
 */
async function lookupPasskeyWalletFromBackend(credentialId: string): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/passkey/wallet/${encodeURIComponent(credentialId)}`)
    if (response.ok) {
      const data = await response.json()
      if (data.success && data.data?.walletAddress) {
        return data.data.walletAddress
      }
    }
  } catch (error) {
    console.warn('[useManagedWallet] Failed to lookup passkey wallet from backend:', error)
  }
  return null
}

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
 * Checks passkey wallet first (Touch ID users), then falls back to API
 */
export function useManagedWallet(): ManagedWalletData & { isManagedMode: boolean } {
  // Access token, user, and mode directly for proper reactivity
  const { token, user, mode } = useAuthStore()

  // Check passkey wallet first - this is the primary source for Touch ID users
  const passkeyWallet = getPasskeyWallet()
  const hasPasskeyWallet = !!passkeyWallet?.address
  const hasStoredCredential = !!getStoredCredentialId()

  // User is in "managed mode" if they have a passkey wallet, stored credential, or are authenticated via managed mode
  const isManagedMode = hasPasskeyWallet || hasStoredCredential || (mode === 'managed' && !!token && !!user)

  // Initialize address from passkey wallet if available
  const [address, setAddress] = useState<string | null>(() => passkeyWallet?.address || null)
  const [balances, setBalances] = useState<ManagedWalletBalance[]>([])
  // Initialize loading to true if we might need to fetch (have credential but no address, or managed mode)
  const [loading, setLoading] = useState(() => {
    if (passkeyWallet?.address) return false // Already have address from passkey
    if (hasStoredCredential) return true // Need to fetch from backend
    const state = useAuthStore.getState()
    return state.mode === 'managed' && !!state.token && !!state.user
  })
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    // First, check if there's a passkey wallet in localStorage (Touch ID users)
    const passkeyWallet = getPasskeyWallet()
    if (passkeyWallet?.address) {
      console.log('[useManagedWallet] Found passkey wallet in localStorage:', passkeyWallet.address)
      setAddress(passkeyWallet.address)
      setBalances([])
      setLoading(false)
      setError(null)
      return
    }

    // If we have a stored credential ID but no wallet, try backend lookup
    const credentialId = getStoredCredentialId()
    if (credentialId) {
      console.log('[useManagedWallet] Trying backend lookup for credential:', credentialId)
      setLoading(true)
      const backendAddress = await lookupPasskeyWalletFromBackend(credentialId)
      if (backendAddress) {
        console.log('[useManagedWallet] Got address from backend:', backendAddress)
        setAddress(backendAddress)
        setBalances([])
        setLoading(false)
        setError(null)
        return
      }
    }

    // Check managed mode using direct values (for email/OTP authenticated users)
    if (mode !== 'managed' || !token || !user) {
      setAddress(null)
      setBalances([])
      setLoading(false)
      console.log('[useManagedWallet] Skipping fetch - not in managed mode', { mode, hasToken: !!token, hasUser: !!user })
      return
    }

    console.log('[useManagedWallet] Fetching wallet address for managed mode user')
    setLoading(true)
    setError(null)

    try {
      // Fetch address and balances in parallel
      const [addressData, balanceData] = await Promise.all([
        apiRequest<{ address: string }>('/wallet/address', token),
        apiRequest<{ address: string; balances: ManagedWalletBalance[] }>('/wallet/balances', token),
      ])

      console.log('[useManagedWallet] Got address:', addressData.address)
      setAddress(addressData.address)
      setBalances(balanceData.balances)
    } catch (err) {
      console.error('[useManagedWallet] Failed to fetch managed wallet data:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch wallet data')
    } finally {
      setLoading(false)
    }
  }, [token, user, mode])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { address, balances, loading, error, refetch: fetchData, isManagedMode }
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
 * Also checks for passkey wallet (Touch ID users) or stored credential
 */
export function useIsManagedMode(): boolean {
  const { mode, token, user } = useAuthStore()
  const passkeyWallet = getPasskeyWallet()
  const hasStoredCredential = !!getStoredCredentialId()
  return !!passkeyWallet?.address || hasStoredCredential || (mode === 'managed' && !!token && !!user)
}
