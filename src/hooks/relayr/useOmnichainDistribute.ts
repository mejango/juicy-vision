import { useCallback, useMemo } from 'react'
import { useOmnichainTransaction } from './useOmnichainTransaction'
import type { UseOmnichainTransactionOptions, UseOmnichainTransactionReturn } from './types'

type DistributeType = 'reserves'

interface OmnichainDistributeParams {
  chainIds: number[]
  projectIds: Record<number, number>  // chainId -> projectId
  type: DistributeType
  controllerAddresses?: Record<number, string>
}

interface UseOmnichainDistributeReturn extends Omit<UseOmnichainTransactionReturn, 'execute'> {
  distribute: (params: OmnichainDistributeParams) => Promise<void>
}

/**
 * Hook for distributing reserved tokens across multiple chains with Relayr.
 * Relayr executes the reviewed calls on every selected chain for a managed account.
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
    const { chainIds, projectIds, type, controllerAddresses } = params

    await transaction.execute({
      chainIds,
      projectIds,
      distributeConfig: {
        type,
        controllerAddresses,
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
  }), [transaction, distribute])
}
