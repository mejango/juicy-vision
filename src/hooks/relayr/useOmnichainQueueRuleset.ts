import { useCallback, useMemo } from 'react'
import { useOmnichainTransaction } from './useOmnichainTransaction'
import type { JBRulesetConfig } from '../../services/relayr'
import type { UseOmnichainTransactionOptions, UseOmnichainTransactionReturn } from './types'

export interface OmnichainQueueParams {
  chainIds: number[]
  projectIds: Record<number, number>  // chainId -> projectId
  rulesetConfigurations: JBRulesetConfig[]
  memo: string
  mustStartAtOrAfter?: number
}

export interface UseOmnichainQueueRulesetReturn extends Omit<UseOmnichainTransactionReturn, 'execute'> {
  queue: (params: OmnichainQueueParams) => Promise<void>
  synchronizedStartTime: number | undefined
}

/**
 * Hook for queueing rulesets across multiple chains with Relayr.
 * User pays gas on ONE chain, Relayr executes on ALL chains.
 *
 * @example
 * const { queue, bundleState, isExecuting } = useOmnichainQueueRuleset({
 *   onSuccess: (bundleId, txHashes) => console.log('Rulesets queued on all chains'),
 * })
 *
 * await queue({
 *   chainIds: [1, 10, 8453, 42161],
 *   projectIds: { 1: 100, 10: 100, 8453: 100, 42161: 100 },
 *   rulesetConfigurations: [{ ... }],
 *   memo: 'Queue new ruleset',
 * })
 */
export function useOmnichainQueueRuleset(
  options: UseOmnichainTransactionOptions = {}
): UseOmnichainQueueRulesetReturn {
  const transaction = useOmnichainTransaction(options)

  const queue = useCallback(async (params: OmnichainQueueParams) => {
    const { chainIds, projectIds, rulesetConfigurations, memo, mustStartAtOrAfter } = params

    await transaction.execute({
      chainIds,
      projectIds,
      rulesetConfig: {
        rulesetConfigurations,
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
    hasError: transaction.hasError,
    reset: transaction.reset,
    setPaymentChain: transaction.setPaymentChain,
    submitPayment: transaction.submitPayment,
    synchronizedStartTime: transaction.bundleState.synchronizedStartTime,
  }), [transaction, queue])
}
