import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import type { BundleTransactionStatus, PaymentOption } from '../../services/relayr'
import type { BundleState, BundleStatus, ChainState, UseRelayrBundleReturn } from './types'
import { useTransactionStore } from '../../stores/transactionStore'

const INITIAL_STATE: BundleState = {
  bundleId: null,
  status: 'idle',
  chainStates: [],
  paymentOptions: [],
  selectedPaymentChain: null,
  paymentTxHash: null,
  error: null,
  expiresAt: undefined,
}

/**
 * Hook for managing bundle lifecycle state.
 * Handles status transitions and chain-level transaction tracking.
 *
 * @example
 * const { bundleState, reset, setPaymentChain, updateFromStatus } = useRelayrBundle()
 */
export function useRelayrBundle(): UseRelayrBundleReturn {
  const [bundleState, setBundleState] = useState<BundleState>(INITIAL_STATE)
  const bundleIdRef = useRef<string | null>(null)

  const updateBundleActivity = useCallback((bundleId: string, updates: Parameters<ReturnType<typeof useTransactionStore.getState>['updateTransaction']>[1]) => {
    const store = useTransactionStore.getState()
    const activity = store.transactions.find(transaction => transaction.bundleUuid === bundleId)
    if (activity) store.updateTransaction(activity.id, updates)
  }, [])

  const reset = useCallback(() => {
    bundleIdRef.current = null
    setBundleState(INITIAL_STATE)
  }, [])

  const setPaymentChain = useCallback((chainId: number) => {
    setBundleState(prev => ({
      ...prev,
      selectedPaymentChain: chainId,
    }))
  }, [])

  /**
   * Initialize bundle state from creation response
   */
  const initializeBundle = useCallback((
    bundleId: string,
    chainIds: number[],
    projectIds: Record<number, number>,
    paymentOptions: PaymentOption[],
    synchronizedStartTime?: number,
    expiresAt?: number
  ) => {
    bundleIdRef.current = bundleId
    const store = useTransactionStore.getState()
    const existing = store.transactions.find(transaction => transaction.bundleUuid === bundleId)
    const chainStates = chainIds.map(chainId => ({
      chainId,
      status: 'pending' as const,
    }))
    if (existing) {
      store.updateTransaction(existing.id, {
        status: 'relayr-pending',
        chainStates,
        error: undefined,
      })
    } else {
      store.addTransaction({
        type: 'relayr',
        chainId: chainIds[0] ?? 1,
        label: chainIds.length > 1 ? `Relayr bundle · ${chainIds.length} chains` : 'Relayr transaction',
        bundleUuid: bundleId,
        status: 'relayr-pending',
        chainStates,
      })
    }
    setBundleState({
      bundleId,
      status: 'awaiting_payment',
      chainStates: chainIds.map(chainId => ({
        chainId,
        projectId: projectIds[chainId],
        status: 'pending',
      })),
      paymentOptions,
      selectedPaymentChain: paymentOptions.length > 0 ? paymentOptions[0].chainId : null,
      paymentTxHash: null,
      error: null,
      synchronizedStartTime,
      expiresAt,
    })
  }, [])

  /**
   * Set bundle to creating state
   */
  const setCreating = useCallback(() => {
    setBundleState(prev => ({
      ...prev,
      status: 'creating',
      error: null,
    }))
  }, [])

  /**
   * Set bundle to processing state (payment submitted)
   */
  const setProcessing = useCallback((paymentTxHash: string) => {
    setBundleState(prev => ({
      ...prev,
      status: 'processing',
      paymentTxHash,
      processingStartedAt: prev.processingStartedAt ?? Date.now(),
    }))
  }, [])

  /**
   * Complete a single-chain operation that was submitted directly instead of
   * through Relayr. The synthetic ID keeps existing completion/persistence
   * consumers working without registering a fake Relayr activity.
   */
  const setDirectCompleted = useCallback((
    chainId: number,
    projectId: number,
    txHash: string,
  ) => {
    const directId = `direct:${chainId}:${txHash}`
    bundleIdRef.current = directId
    setBundleState({
      bundleId: directId,
      status: 'completed',
      chainStates: [{
        chainId,
        projectId,
        status: 'confirmed',
        txHash,
      }],
      paymentOptions: [],
      selectedPaymentChain: null,
      paymentTxHash: txHash,
      error: null,
    })
  }, [])

  /**
   * Set error state
   */
  const setError = useCallback((error: string) => {
    const bundleId = bundleIdRef.current
    if (bundleId) updateBundleActivity(bundleId, { status: 'failed', error })
    setBundleState(prev => ({
      ...prev,
      status: 'failed',
      error,
    }))
  }, [updateBundleActivity])

  /**
   * Set expired state (quote timed out before payment)
   */
  const setExpired = useCallback(() => {
    const bundleId = bundleIdRef.current
    if (bundleId) {
      updateBundleActivity(bundleId, {
        status: 'failed',
        error: 'Relayr quote expired before payment. No destination transaction was submitted.',
      })
    }
    setBundleState(prev => ({
      ...prev,
      status: 'expired',
      error: 'Payment quote expired. Please create a new transaction.',
    }))
  }, [updateBundleActivity])

  // Track mounted state to avoid setting state after unmount
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Check for expiration periodically when awaiting payment
  useEffect(() => {
    if (bundleState.status !== 'awaiting_payment' || !bundleState.expiresAt) {
      return
    }

    const checkExpiration = () => {
      if (!isMountedRef.current) return

      const now = Date.now()
      const expiresAtMs = bundleState.expiresAt! * 1000 // Convert from Unix seconds to ms
      const timeRemaining = expiresAtMs - now

      if (timeRemaining <= 0) {
        setExpired()
      }
    }

    // Check immediately
    checkExpiration()

    // Then check every second
    const intervalId = setInterval(checkExpiration, 1000)

    return () => clearInterval(intervalId)
  }, [bundleState.status, bundleState.expiresAt, setExpired])

  /**
   * Update state from status polling response
   */
  const updateFromStatus = useCallback((statusResponse: {
    status: string
    transactions: BundleTransactionStatus[]
    paymentReceived: boolean
  }) => {
    setBundleState(prev => {
      // Map API status to our status type
      let status: BundleStatus = prev.status
      switch (statusResponse.status) {
        case 'pending':
          status = statusResponse.paymentReceived ? 'processing' : 'awaiting_payment'
          break
        case 'processing':
          status = 'processing'
          break
        case 'completed':
          status = 'completed'
          break
        case 'partial':
          status = 'partial'
          break
        case 'failed':
          status = 'failed'
          break
      }

      // Update chain states from transaction statuses
      const chainStates: ChainState[] = prev.chainStates.map(cs => {
        const txStatus = statusResponse.transactions.find(t => t.chain_id === cs.chainId)
        if (txStatus) {
          return {
            ...cs,
            status: txStatus.status,
            txHash: txStatus.tx_hash,
            error: txStatus.error,
            gasUsed: txStatus.gas_used,
          }
        }
        return cs
      })

      return {
        ...prev,
        status,
        chainStates,
        error: status === 'partial'
          ? 'Relayr completed only some destination transactions. Review each chain before retrying.'
          : status === 'failed'
            ? 'Relayr bundle failed. Review each destination chain before retrying.'
            : status === 'completed'
              ? null
              : prev.error,
        processingStartedAt: status === 'processing' && !prev.processingStartedAt
          ? Date.now()
          : prev.processingStartedAt,
      }
    })

    const bundleId = bundleIdRef.current
    if (bundleId) {
      const failed = statusResponse.status === 'failed' || statusResponse.status === 'partial'
      updateBundleActivity(bundleId, {
        status: statusResponse.status === 'completed'
          ? 'confirmed'
          : failed
            ? 'failed'
            : 'relayr-pending',
        chainStates: statusResponse.transactions.map(transaction => ({
          chainId: transaction.chain_id,
          status: transaction.status,
          txHash: transaction.tx_hash,
          error: transaction.error,
        })),
        confirmedAt: statusResponse.status === 'completed' ? Date.now() : undefined,
        ...(failed && {
          error: statusResponse.status === 'partial'
            ? 'Relayr completed only some destination transactions. Review each chain.'
            : 'Relayr bundle failed. Review each destination chain.',
        }),
      })
    }
  }, [updateBundleActivity])

  // Derived state
  const isCreating = bundleState.status === 'creating'
  const isProcessing = bundleState.status === 'processing' || bundleState.status === 'awaiting_payment'
  const isComplete = bundleState.status === 'completed'
  const isExpired = bundleState.status === 'expired'
  const hasError = bundleState.status === 'failed' || bundleState.status === 'partial' || bundleState.status === 'expired'

  // Calculate time remaining until expiration (in seconds)
  const timeRemainingSeconds = useMemo(() => {
    if (!bundleState.expiresAt || bundleState.status !== 'awaiting_payment') {
      return null
    }
    const now = Math.floor(Date.now() / 1000)
    const remaining = bundleState.expiresAt - now
    return remaining > 0 ? remaining : 0
  }, [bundleState.expiresAt, bundleState.status])

  return useMemo(() => ({
    bundleState,
    isCreating,
    isProcessing,
    isComplete,
    isExpired,
    hasError,
    timeRemainingSeconds,
    reset,
    setPaymentChain,
    updateFromStatus,
    // Internal state setters (exposed for useOmnichainTransaction)
    _initializeBundle: initializeBundle,
    _setCreating: setCreating,
    _setProcessing: setProcessing,
    _setDirectCompleted: setDirectCompleted,
    _setError: setError,
    _setExpired: setExpired,
  }), [
    bundleState,
    isCreating,
    isProcessing,
    isComplete,
    isExpired,
    hasError,
    timeRemainingSeconds,
    reset,
    setPaymentChain,
    updateFromStatus,
    initializeBundle,
    setCreating,
    setProcessing,
    setDirectCompleted,
    setError,
    setExpired,
  ]) as UseRelayrBundleReturn & {
    _initializeBundle: typeof initializeBundle
    _setCreating: typeof setCreating
    _setProcessing: typeof setProcessing
    _setDirectCompleted: typeof setDirectCompleted
    _setError: typeof setError
    _setExpired: typeof setExpired
  }
}
