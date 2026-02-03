import { useCallback, useMemo } from 'react'
import { useOmnichainTransaction } from './useOmnichainTransaction'
import type { UseOmnichainTransactionOptions, UseOmnichainTransactionReturn } from './types'

export type DistributeType = 'payouts' | 'reserves'

export interface OmnichainDistributeParams {
  chainIds: number[]
  projectIds: Record<number, number>  // chainId -> projectId
  type: DistributeType
}

export interface UseOmnichainDistributeReturn extends Omit<UseOmnichainTransactionReturn, 'execute'> {
  distribute: (params: OmnichainDistributeParams) => Promise<void>
}

/**
 * Hook for distributing payouts or reserved tokens across multiple chains with Relayr.
 * User pays gas on ONE chain, Relayr executes on ALL chains.
 *
 * @example
 * // Distribute payouts on all chains
 * const { distribute, bundleState, isExecuting } = useOmnichainDistribute({
 *   onSuccess: (bundleId, txHashes) => console.log('Distributed on all chains'),
 * })
 *
 * // IMPORTANT: Omnichain projects have DIFFERENT projectIds per chain!
 * await distribute({
 *   chainIds: [1, 10, 8453],
 *   projectIds: { 1: 123, 10: 456, 8453: 789 },  // Different IDs per chain!
 *   type: 'payouts',
 * })
 *
 * @example
 * // Distribute reserved tokens on all chains
 * // IMPORTANT: Omnichain projects have DIFFERENT projectIds per chain!
 * await distribute({
 *   chainIds: [1, 10, 8453],
 *   projectIds: { 1: 123, 10: 456, 8453: 789 },  // Different IDs per chain!
 *   type: 'reserves',
 * })
 */
export function useOmnichainDistribute(
  options: UseOmnichainTransactionOptions = {}
): UseOmnichainDistributeReturn {
  const transaction = useOmnichainTransaction(options)

  const distribute = useCallback(async (params: OmnichainDistributeParams) => {
    const { chainIds, projectIds, type } = params

    await transaction.execute({
      chainIds,
      projectIds,
      distributeConfig: {
        type,
      },
    })
  }, [transaction])

  return useMemo(() => ({
    distribute,
    bundleState: transaction.bundleState,
    isExecuting: transaction.isExecuting,
    isComplete: transaction.isComplete,
    isExpired: transaction.isExpired,
    hasError: transaction.hasError,
    reset: transaction.reset,
    setPaymentChain: transaction.setPaymentChain,
    submitPayment: transaction.submitPayment,
  }), [transaction, distribute])
}
