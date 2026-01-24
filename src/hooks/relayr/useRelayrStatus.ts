import { useState, useEffect, useCallback, useRef } from 'react'
import { getBundleStatus, type BundleStatusResponse } from '../../services/relayr'
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

  const intervalRef = useRef<number | null>(null)
  const isMountedRef = useRef(true)

  const fetchStatus = useCallback(async () => {
    if (!bundleId) return

    try {
      const response = await getBundleStatus(bundleId)

      if (!isMountedRef.current) return

      setData({
        status: response.status,
        transactions: response.transactions,
        paymentReceived: response.payment_received,
      })
      setError(null)

      // Stop polling if bundle is complete or failed
      if (stopOnComplete && (response.status === 'completed' || response.status === 'failed')) {
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
  }, [bundleId, stopOnComplete])

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
    if (bundleId && enabled && !isPolling) {
      startPolling()
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [bundleId, enabled]) // Don't include startPolling to avoid re-triggering

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
