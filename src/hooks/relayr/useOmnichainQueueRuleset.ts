import { useCallback, useMemo } from 'react'
import { useOmnichainTransaction } from './useOmnichainTransaction'
import type { JBRulesetConfig } from '../../services/relayr'
import type { UseOmnichainTransactionOptions, UseOmnichainTransactionReturn } from './types'

interface OmnichainQueueParams {
  chainIds: number[]
  projectIds: Record<number, number>  // chainId -> projectId
  rulesetConfigurations?: JBRulesetConfig[]
  rulesetConfigurationsByChain?: Record<number, JBRulesetConfig[]>
  queueTargets?: Record<number, string>
  memo: string
  mustStartAtOrAfter?: number
}

interface UseOmnichainQueueRulesetReturn extends Omit<UseOmnichainTransactionReturn, 'execute'> {
  queue: (params: OmnichainQueueParams) => Promise<void>
  synchronizedStartTime: number | undefined
}

/**
 * Hook for queueing rulesets across multiple chains with Relayr.
 * Relayr executes the reviewed calls on every selected chain for a managed account.
 *
 * @example
 * const { queue, bundleState, isExecuting } = useOmnichainQueueRuleset({
 *   onSuccess: (bundleId, txHashes) => console.log('Rulesets queued on all chains'),
 * })
 *
 * // IMPORTANT: Omnichain projects have DIFFERENT projectIds per chain!
 * await queue({
 *   chainIds: [1, 10, 8453, 42161],
 *   projectIds: { 1: 123, 10: 456, 8453: 789, 42161: 101 },  // Different IDs per chain!
 *   rulesetConfigurations: [{ ... }],
 *   memo: 'Queue new ruleset',
 * })
 */
export function useOmnichainQueueRuleset(
  options: UseOmnichainTransactionOptions = {}
): UseOmnichainQueueRulesetReturn {
  const transaction = useOmnichainTransaction(options)

  const queue = useCallback(async (params: OmnichainQueueParams) => {
    const { chainIds, projectIds, rulesetConfigurations, rulesetConfigurationsByChain, queueTargets, memo, mustStartAtOrAfter } = params

    await transaction.execute({
      chainIds,
      projectIds,
      rulesetConfig: {
        rulesetConfigurations,
        rulesetConfigurationsByChain,
        queueTargets,
        memo,
        mustStartAtOrAfter,
      },
    })
  }, [transaction])

  return useMemo(() => ({
    queue,
    bundleState: transaction.bundleState,
    isExecuting: transaction.isExecuting,
    isComplete: transaction.isComplete,
    isExpired: transaction.isExpired,
    hasError: transaction.hasError,
    reset: transaction.reset,
    synchronizedStartTime: transaction.bundleState.synchronizedStartTime,
  }), [transaction, queue])
}
