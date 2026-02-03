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

/**
 * State for ProjectCard payment component
 */
export interface ProjectCardPaymentState extends ComponentState {
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  // Payment details
  amount?: string
  token?: 'ETH' | 'USDC' | 'PAY_CREDITS'
  memo?: string
  selectedChainId?: string
  // NFT tier selection
  selectedTierId?: number | null
  // Transaction details
  txHash?: string
  txId?: string
  // Error info
  error?: string
  // Timestamps
  submittedAt?: string
  confirmedAt?: string
}

/**
 * Hook specifically for project-card payment component state
 */
export function useProjectCardPaymentState(
  messageId: string | undefined
): UseComponentStateReturn<ProjectCardPaymentState> {
  return useComponentState<ProjectCardPaymentState>({
    messageId,
    componentKey: 'project-card-payment',
    initialState: { status: 'pending' },
  })
}

// =============================================================================
// Write-side Form Component States
// =============================================================================

/**
 * State for SendPayoutsForm component
 */
export interface SendPayoutsFormState extends ComponentState {
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  amount?: string
  selectedChainId?: number
  txHash?: string
  error?: string
  submittedAt?: string
  confirmedAt?: string
}

export function useSendPayoutsFormState(
  messageId: string | undefined
): UseComponentStateReturn<SendPayoutsFormState> {
  return useComponentState<SendPayoutsFormState>({
    messageId,
    componentKey: 'send-payouts-form',
    initialState: { status: 'pending' },
  })
}

/**
 * State for SendReservedTokensForm component
 */
export interface SendReservedTokensFormState extends ComponentState {
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  selectedChainId?: number
  txHash?: string
  error?: string
  submittedAt?: string
  confirmedAt?: string
}

export function useSendReservedTokensFormState(
  messageId: string | undefined
): UseComponentStateReturn<SendReservedTokensFormState> {
  return useComponentState<SendReservedTokensFormState>({
    messageId,
    componentKey: 'send-reserved-tokens-form',
    initialState: { status: 'pending' },
  })
}

/**
 * State for UseSurplusAllowanceForm component
 */
export interface UseSurplusAllowanceFormState extends ComponentState {
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  amount?: string
  selectedChainId?: number
  txHash?: string
  error?: string
  submittedAt?: string
  confirmedAt?: string
}

export function useUseSurplusAllowanceFormState(
  messageId: string | undefined
): UseComponentStateReturn<UseSurplusAllowanceFormState> {
  return useComponentState<UseSurplusAllowanceFormState>({
    messageId,
    componentKey: 'use-surplus-allowance-form',
    initialState: { status: 'pending' },
  })
}

/**
 * State for CashOutForm component
 */
export interface CashOutFormState extends ComponentState {
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  tokenAmount?: string
  selectedChainId?: number
  txHash?: string
  error?: string
  submittedAt?: string
  confirmedAt?: string
}

export function useCashOutFormState(
  messageId: string | undefined
): UseComponentStateReturn<CashOutFormState> {
  return useComponentState<CashOutFormState>({
    messageId,
    componentKey: 'cash-out-form',
    initialState: { status: 'pending' },
  })
}

/**
 * State for DeployERC20Form component
 */
export interface DeployERC20FormState extends ComponentState {
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  tokenName?: string
  tokenSymbol?: string
  selectedChainId?: number
  txHash?: string
  error?: string
  submittedAt?: string
  confirmedAt?: string
}

export function useDeployERC20FormState(
  messageId: string | undefined
): UseComponentStateReturn<DeployERC20FormState> {
  return useComponentState<DeployERC20FormState>({
    messageId,
    componentKey: 'deploy-erc20-form',
    initialState: { status: 'pending' },
  })
}

/**
 * State for QueueRulesetForm component
 */
export interface QueueRulesetFormState extends ComponentState {
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  // Ruleset configuration
  duration?: string
  weight?: string
  decayPercent?: string
  reservedPercent?: string
  cashOutTaxRate?: string
  selectedChains?: number[]
  // Transaction details
  txHashes?: Record<number, string>
  bundleId?: string
  error?: string
  submittedAt?: string
  confirmedAt?: string
}

export function useQueueRulesetFormState(
  messageId: string | undefined
): UseComponentStateReturn<QueueRulesetFormState> {
  return useComponentState<QueueRulesetFormState>({
    messageId,
    componentKey: 'queue-ruleset-form',
    initialState: { status: 'pending' },
  })
}

/**
 * State for ManageTiersForm component
 */
export interface ManageTiersFormState extends ComponentState {
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  // Pending changes summary
  tiersToAddCount?: number
  tierIdsToRemove?: number[]
  metadataUpdatesCount?: number
  // Transaction details
  txHash?: string
  error?: string
  submittedAt?: string
  confirmedAt?: string
}

export function useManageTiersFormState(
  messageId: string | undefined
): UseComponentStateReturn<ManageTiersFormState> {
  return useComponentState<ManageTiersFormState>({
    messageId,
    componentKey: 'manage-tiers-form',
    initialState: { status: 'pending' },
  })
}

/**
 * State for SetSplitsForm component
 */
export interface SetSplitsFormState extends ComponentState {
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  // Split changes summary
  splitType?: 'payout' | 'reserved' | 'both'
  payoutSplitsCount?: number
  reservedSplitsCount?: number
  selectedChains?: number[]
  // Transaction details
  txHashes?: Record<number, string>
  bundleId?: string
  error?: string
  submittedAt?: string
  confirmedAt?: string
}

export function useSetSplitsFormState(
  messageId: string | undefined
): UseComponentStateReturn<SetSplitsFormState> {
  return useComponentState<SetSplitsFormState>({
    messageId,
    componentKey: 'set-splits-form',
    initialState: { status: 'pending' },
  })
}

/**
 * State for SetUriForm component
 */
export interface SetUriFormState extends ComponentState {
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  // URI being set
  uri?: string
  // Chains being updated
  selectedChains?: number[]
  // Transaction details
  txHashes?: Record<number, string>
  bundleId?: string
  error?: string
  submittedAt?: string
  confirmedAt?: string
}

export function useSetUriFormState(
  messageId: string | undefined
): UseComponentStateReturn<SetUriFormState> {
  return useComponentState<SetUriFormState>({
    messageId,
    componentKey: 'set-uri-form',
    initialState: { status: 'pending' },
  })
}
