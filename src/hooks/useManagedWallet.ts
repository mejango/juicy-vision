import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '../stores'
import { getPasskeyWallet, getStoredCredentialId } from '../services/passkeyWallet'

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'
const SMART_ACCOUNT_CACHE_KEY = 'juice-smart-account-address'

// Debug logging - only log once per unique message to avoid spam
const DEBUG = import.meta.env.DEV
const loggedMessages = new Set<string>()
const log = (msg: string, data?: unknown) => {
  if (!DEBUG) return
  const key = JSON.stringify({ msg, data })
  if (loggedMessages.has(key)) return
  loggedMessages.add(key)
  console.log('[ManagedWallet]', msg, data ?? '')
}

// Cache the smart account address locally for offline/expired token scenarios
function getCachedSmartAccountAddress(): string | null {
  const cached = localStorage.getItem(SMART_ACCOUNT_CACHE_KEY)
  log('getCachedSmartAccountAddress:', cached ? `${cached.slice(0, 10)}...` : 'null')
  return cached
}

function cacheSmartAccountAddress(address: string): void {
  log('cacheSmartAccountAddress:', `${address.slice(0, 10)}...`)
  localStorage.setItem(SMART_ACCOUNT_CACHE_KEY, address)
}

export interface ManagedWalletBalance {
  chainId: number
  tokenAddress: string
  tokenSymbol: string
  balance: string
  decimals: number
}

export interface SmartAccountInfo {
  chainId: number
  address: string
  deployed: boolean
  custodyStatus: 'managed' | 'transferring' | 'self_custody'
  balances: ManagedWalletBalance[]
}

export interface ManagedWalletData {
  address: string | null
  accounts: SmartAccountInfo[]
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
 * Hook for managed mode wallet data (Smart Account address and balances)
 *
 * When user authenticates via passkey, they get a deterministic Smart Account address
 * that is the same across all chains. The system manages this account until the user
 * exports to self-custody.
 */
export function useManagedWallet(): ManagedWalletData & { isManagedMode: boolean } {
  const { token, user, mode } = useAuthStore()

  // Check passkey wallet for backwards compatibility during transition
  const passkeyWallet = getPasskeyWallet()
  const hasPasskeyWallet = !!passkeyWallet?.address
  const hasStoredCredential = !!getStoredCredentialId()

  // User is in "managed mode" if authenticated via managed mode (passkey, email, etc.)
  const isManagedMode = hasPasskeyWallet || hasStoredCredential || (mode === 'managed' && !!token && !!user)

  log('Hook state:', { mode, isManagedMode, hasPasskeyWallet, hasStoredCredential, hasToken: !!token, hasUser: !!user })

  // Use cached smart account address as initial state (NOT the passkey EOA - they're different!)
  // The smart account is the ERC-4337 wallet that works across devices
  const [address, setAddress] = useState<string | null>(() => getCachedSmartAccountAddress())
  const [accounts, setAccounts] = useState<SmartAccountInfo[]>([])
  const [balances, setBalances] = useState<ManagedWalletBalance[]>([])
  // Don't show loading if we already have a cached smart account address
  const [loading, setLoading] = useState(() => {
    const cachedAddress = getCachedSmartAccountAddress()
    if (cachedAddress) return false // Already have address cached
    const state = useAuthStore.getState()
    return state.mode === 'managed' && !!state.token && !!state.user
  })
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    log('fetchData called', { mode, hasToken: !!token, hasUser: !!user })

    // Check for cached smart account address
    const cachedAddress = getCachedSmartAccountAddress()
    if (cachedAddress) {
      log('Using cached address:', `${cachedAddress.slice(0, 10)}...`)
      setAddress(cachedAddress)
    }

    // Must be authenticated in managed mode to fetch from API
    if (mode !== 'managed' || !token || !user) {
      log('Not in managed mode or missing auth, skipping API fetch')
      // Still keep cached address if available
      if (!cachedAddress) {
        setAddress(null)
      }
      setAccounts([])
      setBalances([])
      setLoading(false)
      return
    }

    // Only show loading if we don't have a cached address
    if (!cachedAddress) {
      log('No cached address, showing loading state')
      setLoading(true)
    }
    setError(null)

    try {
      log('Fetching smart account from API...')
      // Fetch smart account address (creates deterministic address if not exists)
      // Also fetch balances across all chains
      const [addressData, balanceData] = await Promise.all([
        apiRequest<{
          address: string
          chainId: number
          deployed: boolean
          custodyStatus: 'managed' | 'transferring' | 'self_custody'
        }>('/wallet/address', token),
        apiRequest<{
          accounts: SmartAccountInfo[]
        }>('/wallet/balances', token),
      ])

      log('API success! Smart account: ' + addressData.address.slice(0, 10) + '...', { deployed: addressData.deployed })

      // Primary address (mainnet by default)
      setAddress(addressData.address)
      // Cache the smart account address for offline/expired token scenarios
      cacheSmartAccountAddress(addressData.address)

      // All accounts across chains with their balances
      setAccounts(balanceData.accounts)

      // Flatten balances for backwards compatibility
      const allBalances = balanceData.accounts.flatMap(account =>
        account.balances.map(b => ({
          ...b,
          chainId: account.chainId,
        }))
      )
      setBalances(allBalances)
      setError(null) // Clear any previous error
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch wallet data'
      log('API error: ' + errorMsg + (cachedAddress ? ' (using cached fallback)' : ' (no fallback)'))
      // Only set error if we don't have a cached fallback address
      if (!cachedAddress) {
        setError(errorMsg)
      }
      // Keep using cached smart account address as fallback
    } finally {
      setLoading(false)
    }
  }, [token, user, mode])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { address, accounts, balances, loading, error, refetch: fetchData, isManagedMode }
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
