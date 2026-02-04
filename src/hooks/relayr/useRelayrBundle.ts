import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import type { BundleTransactionStatus, PaymentOption } from '../../services/relayr'
import type { BundleState, BundleStatus, ChainState, UseRelayrBundleReturn } from './types'

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

// Buffer before expiration to warn user (30 seconds)
const EXPIRATION_BUFFER_MS = 30_000

/**
 * Hook for managing bundle lifecycle state.
 * Handles status transitions and chain-level transaction tracking.
 *
 * @example
 * const { bundleState, reset, setPaymentChain, updateFromStatus } = useRelayrBundle()
 */
export function useRelayrBundle(): UseRelayrBundleReturn {
  const [bundleState, setBundleState] = useState<BundleState>(INITIAL_STATE)

  const reset = useCallback(() => {
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
   * Set error state
   */
  const setError = useCallback((error: string) => {
    setBundleState(prev => ({
      ...prev,
      status: 'failed',
      error,
    }))
  }, [])

  /**
   * Set expired state (quote timed out before payment)
   */
  const setExpired = useCallback(() => {
    setBundleState(prev => ({
      ...prev,
      status: 'expired',
      error: 'Payment quote expired. Please create a new transaction.',
    }))
  }, [])

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
        processingStartedAt: status === 'processing' && !prev.processingStartedAt
          ? Date.now()
          : prev.processingStartedAt,
      }
    })
  }, [])

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
    setError,
    setExpired,
  ]) as UseRelayrBundleReturn & {
    _initializeBundle: typeof initializeBundle
    _setCreating: typeof setCreating
    _setProcessing: typeof setProcessing
    _setError: typeof setError
    _setExpired: typeof setExpired
  }
}
