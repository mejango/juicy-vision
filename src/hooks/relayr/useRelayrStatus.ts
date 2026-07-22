import { useState, useEffect, useCallback, useRef } from 'react'
import { getBundleStatus, transformBundleResponse, type BundleStatusResponse, type RawBundleResponse } from '../../services/relayr'
import { useIsManagedMode, getManagedBundleStatus } from '../useManagedWallet'
import type { UseRelayrStatusOptions, UseRelayrStatusReturn } from './types'

const DEFAULT_POLLING_INTERVAL = 2000 // 2 seconds

/**
 * Hook for polling Relayr bundle status with auto-stop on completion.
 *
 * @example
 * const { data, isPolling, startPolling } = useRelayrStatus({
 *   bundleId: 'abc-123',
 *   stopOnComplete: true,
 * })
 */
export function useRelayrStatus({
  bundleId,
  enabled = true,
  pollingInterval = DEFAULT_POLLING_INTERVAL,
  stopOnComplete = true,
}: UseRelayrStatusOptions): UseRelayrStatusReturn {
  const [data, setData] = useState<{
    status: string
    transactions: BundleStatusResponse['transactions']
    paymentReceived: boolean
  } | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // Check if we should use backend proxy for status polling
  const isManagedMode = useIsManagedMode()

  const intervalRef = useRef<number | null>(null)
  const isMountedRef = useRef(true)

  const fetchStatus = useCallback(async () => {
    if (!bundleId) return

    try {
      let response: BundleStatusResponse

      if (isManagedMode) {
        // Use backend proxy for managed mode - keeps API keys server-side
        const rawResponse = await getManagedBundleStatus(bundleId) as RawBundleResponse
        response = transformBundleResponse(rawResponse)
      } else {
        // Direct call for self-custody mode
        response = await getBundleStatus(bundleId)
      }

      if (!isMountedRef.current) return

      setData({
        status: response.status,
        transactions: response.transactions,
        paymentReceived: response.payment_received,
      })
      setError(null)

      // Partial is terminal too: at least one destination failed and polling
      // forever would conceal the actionable per-chain result.
      if (stopOnComplete && (response.status === 'completed' || response.status === 'failed' || response.status === 'partial')) {
        setIsPolling(false)
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }
    } catch (err) {
      if (!isMountedRef.current) return
      setError(err instanceof Error ? err : new Error('Failed to fetch bundle status'))
    }
  }, [bundleId, stopOnComplete, isManagedMode])

  const startPolling = useCallback(() => {
    if (!bundleId || isPolling) return

    setIsPolling(true)
    fetchStatus() // Immediate first fetch

    intervalRef.current = window.setInterval(fetchStatus, pollingInterval)
  }, [bundleId, isPolling, fetchStatus, pollingInterval])

  const stopPolling = useCallback(() => {
    setIsPolling(false)
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const refetch = useCallback(async () => {
    await fetchStatus()
  }, [fetchStatus])

  // Auto-start polling when bundleId is set and enabled
  useEffect(() => {
    if (!bundleId || !enabled) return

    setIsPolling(true)
    void fetchStatus()
    intervalRef.current = window.setInterval(fetchStatus, pollingInterval)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [bundleId, enabled, fetchStatus, pollingInterval])

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [])

  // Reset when bundleId changes
  useEffect(() => {
    if (!bundleId) {
      setData(null)
      setError(null)
      stopPolling()
    }
  }, [bundleId, stopPolling])

  return {
    data,
    isPolling,
    error,
    startPolling,
    stopPolling,
    refetch,
  }
}
