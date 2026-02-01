/**
 * useAccountLinking Hook
 *
 * Detects when a user has multiple auth methods (wallet + passkey) with different
 * addresses and provides functionality to link them for shared identity.
 */

import { useState, useEffect, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { useAuthStore } from '../stores'
import { useManagedWallet } from './useManagedWallet'
import { getPasskeyWallet } from '../services/passkeyWallet'
import { getWalletSession } from '../services/siwe'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

// ============================================================================
// Types
// ============================================================================

export interface LinkedAddress {
  id: string
  primaryAddress: string
  linkedAddress: string
  linkType: 'manual' | 'smart_account' | 'passkey' | 'wallet'
  createdAt: string
}

export interface LinkCheckResult {
  address: string
  canBeLinkTarget: boolean
  canBeLinkTargetReason?: string
  canBePrimary: boolean
  canBePrimaryReason?: string
}

export interface AccountLinkingState {
  // Detection
  hasMultipleAuthMethods: boolean
  connectedWalletAddress: string | null
  managedAccountAddress: string | null

  // Linking status
  isLinked: boolean
  primaryAddress: string | null
  linkedAddresses: LinkedAddress[]

  // Actions
  canLink: boolean
  linkReason: string | null
  loading: boolean
  error: string | null

  // Functions
  linkAccounts: () => Promise<boolean>
  unlinkAccount: (address: string) => Promise<boolean>
  checkLinkStatus: () => Promise<void>
  refreshLinkedAddresses: () => Promise<void>
}

// ============================================================================
// API Functions
// ============================================================================

async function getApiHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const { token } = useAuthStore.getState()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const walletSession = getWalletSession()
  if (walletSession?.token) {
    headers['X-Wallet-Session'] = walletSession.token
  }

  return headers
}

async function fetchLinkedAddresses(): Promise<{
  primaryAddress: string
  linkedAddresses: LinkedAddress[]
  currentAddressIsPrimary: boolean
} | null> {
  try {
    const headers = await getApiHeaders()
    const res = await fetch(`${API_BASE_URL}/identity/linked`, { headers })
    if (!res.ok) return null

    const data = await res.json()
    if (!data.success) return null

    return data.data
  } catch {
    return null
  }
}

async function checkCanLink(address: string): Promise<LinkCheckResult | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/identity/link/check/${address}`)
    if (!res.ok) return null

    const data = await res.json()
    if (!data.success) return null

    return data.data
  } catch {
    return null
  }
}

async function linkAddressApi(
  linkedAddress: string,
  linkType: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const headers = await getApiHeaders()
    const res = await fetch(`${API_BASE_URL}/identity/link`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ linkedAddress, linkType }),
    })

    const data = await res.json()
    return { success: data.success, error: data.error }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to link' }
  }
}

async function unlinkAddressApi(address: string): Promise<boolean> {
  try {
    const headers = await getApiHeaders()
    const res = await fetch(`${API_BASE_URL}/identity/link/${address}`, {
      method: 'DELETE',
      headers,
    })

    const data = await res.json()
    return data.success
  } catch {
    return false
  }
}

// ============================================================================
// Hook
// ============================================================================

export function useAccountLinking(): AccountLinkingState {
  const { address: walletAddress, isConnected: isWalletConnected } = useAccount()
  const { token: authToken, isAuthenticated } = useAuthStore()
  const { address: managedAddress, isManagedMode } = useManagedWallet()

  const [isLinked, setIsLinked] = useState(false)
  const [primaryAddress, setPrimaryAddress] = useState<string | null>(null)
  const [linkedAddresses, setLinkedAddresses] = useState<LinkedAddress[]>([])
  const [canLink, setCanLink] = useState(false)
  const [linkReason, setLinkReason] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Detect if user has multiple auth methods
  const connectedWalletAddress = isWalletConnected ? (walletAddress ?? null) : null
  const managedAccountAddress = isManagedMode ? (managedAddress ?? null) : null

  const hasMultipleAuthMethods =
    !!connectedWalletAddress &&
    !!managedAccountAddress &&
    connectedWalletAddress.toLowerCase() !== managedAccountAddress.toLowerCase()

  // Check link status
  const checkLinkStatus = useCallback(async () => {
    if (!hasMultipleAuthMethods) {
      setCanLink(false)
      setLinkReason(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Check if already linked
      const linkData = await fetchLinkedAddresses()
      if (linkData) {
        setIsLinked(linkData.linkedAddresses.length > 0)
        setPrimaryAddress(linkData.primaryAddress)
        setLinkedAddresses(linkData.linkedAddresses)

        // If already linked, can't link again
        if (linkData.linkedAddresses.length > 0) {
          setCanLink(false)
          setLinkReason('Accounts are already linked')
          setLoading(false)
          return
        }
      }

      // Check if the other address can be linked
      // The "other" address is the one that's not currently the primary
      const primaryIsManaged = managedAccountAddress
      const targetAddress = connectedWalletAddress

      if (targetAddress) {
        const checkResult = await checkCanLink(targetAddress)
        if (checkResult) {
          setCanLink(checkResult.canBeLinkTarget)
          setLinkReason(checkResult.canBeLinkTargetReason ?? null)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check link status')
    } finally {
      setLoading(false)
    }
  }, [hasMultipleAuthMethods, connectedWalletAddress, managedAccountAddress])

  // Refresh linked addresses
  const refreshLinkedAddresses = useCallback(async () => {
    const linkData = await fetchLinkedAddresses()
    if (linkData) {
      setIsLinked(linkData.linkedAddresses.length > 0)
      setPrimaryAddress(linkData.primaryAddress)
      setLinkedAddresses(linkData.linkedAddresses)
    }
  }, [])

  // Link accounts (managed account becomes primary, wallet becomes linked)
  const linkAccounts = useCallback(async (): Promise<boolean> => {
    if (!connectedWalletAddress || !managedAccountAddress) {
      setError('Missing address for linking')
      return false
    }

    setLoading(true)
    setError(null)

    try {
      // Link the connected wallet to the managed account
      const result = await linkAddressApi(connectedWalletAddress, 'wallet')

      if (!result.success) {
        setError(result.error ?? 'Failed to link accounts')
        return false
      }

      // Refresh state
      await refreshLinkedAddresses()
      setCanLink(false)
      setLinkReason('Accounts are now linked')

      // Dispatch event so other components can update
      window.dispatchEvent(
        new CustomEvent('juice:accounts-linked', {
          detail: { primaryAddress: managedAccountAddress, linkedAddress: connectedWalletAddress },
        })
      )

      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link accounts')
      return false
    } finally {
      setLoading(false)
    }
  }, [connectedWalletAddress, managedAccountAddress, refreshLinkedAddresses])

  // Unlink an account
  const unlinkAccount = useCallback(
    async (address: string): Promise<boolean> => {
      setLoading(true)
      setError(null)

      try {
        const success = await unlinkAddressApi(address)
        if (!success) {
          setError('Failed to unlink account')
          return false
        }

        await refreshLinkedAddresses()

        // Dispatch event
        window.dispatchEvent(new CustomEvent('juice:account-unlinked', { detail: { address } }))

        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to unlink account')
        return false
      } finally {
        setLoading(false)
      }
    },
    [refreshLinkedAddresses]
  )

  // Check status when auth state changes
  useEffect(() => {
    if (hasMultipleAuthMethods) {
      checkLinkStatus()
    } else {
      setIsLinked(false)
      setPrimaryAddress(null)
      setLinkedAddresses([])
      setCanLink(false)
      setLinkReason(null)
    }
  }, [hasMultipleAuthMethods, checkLinkStatus])

  return {
    hasMultipleAuthMethods,
    connectedWalletAddress,
    managedAccountAddress,
    isLinked,
    primaryAddress,
    linkedAddresses,
    canLink,
    linkReason,
    loading,
    error,
    linkAccounts,
    unlinkAccount,
    checkLinkStatus,
    refreshLinkedAddresses,
  }
}
