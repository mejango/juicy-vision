import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Address, Hex } from 'viem'
import { useAuthStore } from '../../stores'
import { useManagedWallet, createManagedRelayrBundle } from '../useManagedWallet'
import { assertTransactionAccountUnchanged } from '../useReviewedTransactionAccount'
import {
  buildOmnichainQueueRulesetTransactions,
  buildOmnichainDistributeTransactions,
  buildOmnichainDeployERC20Transactions,
  type JBOmnichainQueueRequest,
  type JBOmnichainDistributeRequest,
  type JBOmnichainDeployERC20Request,
  type JBRulesetConfig,
} from '../../services/relayr'
import { useRelayrBundle } from './useRelayrBundle'
import { useRelayrStatus } from './useRelayrStatus'
import { getProjectController } from '../../utils/paymentTerminal'
import { getSafetyPublicClient } from '../../utils/transactionSafety'
import { resolveRulesetQueueRoute } from '../../utils/projectTrust'
import type {
  OmnichainExecuteParams,
  UseOmnichainTransactionOptions,
  UseOmnichainTransactionReturn,
} from './types'

type BuiltControllerTransaction = {
  chainId: number
  target: string
  data: string
  value: string
}

export function submitManagedControllerBundle(
  transactions: BuiltControllerTransaction[],
  activeAddress: string,
  managedAddress: string,
  submit?: typeof createManagedRelayrBundle,
): Promise<{ bundleId: string }> {
  if (submit) return submit(transactions, activeAddress, managedAddress)
  return createManagedRelayrBundle(transactions, activeAddress, managedAddress)
}

export async function preflightControllerTransactions(params: {
  transactions: BuiltControllerTransaction[]
  chainIds: number[]
  projectIds: Record<number, number>
  account: Address
  operation?: 'controller' | 'rulesetQueue'
}): Promise<void> {
  const expectedChains = new Set(params.chainIds)
  if (
    params.transactions.length !== expectedChains.size ||
    params.transactions.some(tx => !expectedChains.has(tx.chainId)) ||
    new Set(params.transactions.map(tx => tx.chainId)).size !== expectedChains.size
  ) {
    throw new Error('The omnichain transaction set does not match the reviewed chains')
  }

  await Promise.all(params.transactions.map(async transaction => {
    const projectId = params.projectIds[transaction.chainId]
    if (!projectId) throw new Error(`No project ID found for chain ${transaction.chainId}`)

    const client = getSafetyPublicClient(transaction.chainId)
    const expectedTarget = params.operation === 'rulesetQueue'
      ? (await resolveRulesetQueueRoute({ client, projectId: BigInt(projectId) })).target
      : await getProjectController(client, BigInt(projectId))
    if (expectedTarget.toLowerCase() !== transaction.target.toLowerCase()) {
      throw new Error(`The project transaction route changed on chain ${transaction.chainId}`)
    }

    await client.call({
      account: params.account,
      to: expectedTarget,
      data: transaction.data as Hex,
      value: BigInt(transaction.value),
    })
  }))
}

/**
 * High-level hook for omnichain transaction execution.
 * Sponsored execution is available only to authenticated managed accounts.
 *
 * @example
 * const { execute, bundleState, isExecuting } = useOmnichainTransaction({
 *   onSuccess: (bundleId, txHashes) => console.log('All chains confirmed'),
 * })
 *
 * // Queue rulesets across chains
 * // IMPORTANT: Omnichain projects have DIFFERENT projectIds per chain!
 * await execute({
 *   chainIds: [1, 10, 8453],
 *   projectIds: { 1: 123, 10: 456, 8453: 789 },  // Different IDs per chain!
 *   rulesetConfig: { rulesetConfigurations: [...], memo: 'Queue' },
 * })
 */
export function useOmnichainTransaction(
  options: UseOmnichainTransactionOptions = {}
): UseOmnichainTransactionReturn {
  const { onSuccess, onError } = options

  // Use refs for callbacks to avoid infinite loops when callbacks change
  const onSuccessRef = useRef(onSuccess)
  const onErrorRef = useRef(onError)

  // Keep refs updated
  useEffect(() => {
    onSuccessRef.current = onSuccess
    onErrorRef.current = onError
  })

  // Auth state
  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()

  const { address: managedAddress } = useManagedWallet()
  const latestManagedAddress = useRef(managedAddress)
  latestManagedAddress.current = managedAddress

  // Bundle state management
  const bundle = useRelayrBundle() as ReturnType<typeof useRelayrBundle> & {
    _initializeBundle: (
      bundleId: string,
      chainIds: number[],
      projectIds: Record<number, number>,
      paymentOptions: Array<{ chainId: number; token: string; amount: string; estimatedGas: string }>,
      synchronizedStartTime?: number,
      expiresAt?: number
    ) => void
    _setCreating: () => void
    _setProcessing: (txHash: string) => void
    _setError: (error: string) => void
    _setExpired: () => void
  }
  const { bundleState, reset, updateFromStatus } = bundle

  // Status polling
  const { data: statusData } = useRelayrStatus({
    bundleId: bundleState.bundleId,
    enabled: bundleState.status === 'processing',
    stopOnComplete: true,
  })

  // Update bundle state from polling
  useEffect(() => {
    if (statusData) {
      updateFromStatus(statusData)
    }
  }, [statusData, updateFromStatus])

  // Call onSuccess when complete (use ref to avoid infinite loops)
  const hasCalledSuccessRef = useRef(false)
  useEffect(() => {
    if (bundleState.status === 'completed' && bundleState.bundleId && !hasCalledSuccessRef.current) {
      hasCalledSuccessRef.current = true
      const txHashes: Record<number, string> = {}
      bundleState.chainStates.forEach(cs => {
        if (cs.txHash) {
          txHashes[cs.chainId] = cs.txHash
        }
      })
      onSuccessRef.current?.(bundleState.bundleId, txHashes)
    }
    // Reset flag when bundle resets
    if (bundleState.status === 'idle') {
      hasCalledSuccessRef.current = false
    }
  }, [bundleState.status, bundleState.bundleId, bundleState.chainStates])

  // Call onError when failed or expired (use ref to avoid infinite loops)
  const hasCalledErrorRef = useRef(false)
  useEffect(() => {
    if ((bundleState.status === 'failed' || bundleState.status === 'expired') && bundleState.error && !hasCalledErrorRef.current) {
      hasCalledErrorRef.current = true
      onErrorRef.current?.(new Error(bundleState.error))
    }
    // Reset flag when bundle resets
    if (bundleState.status === 'idle') {
      hasCalledErrorRef.current = false
    }
  }, [bundleState.status, bundleState.error])

  /**
   * Execute omnichain transactions.
   * Creates a sponsored bundle for an authenticated managed account.
   */
  const execute = useCallback(async (params: OmnichainExecuteParams) => {
    const { chainIds, projectIds, rulesetConfig, distributeConfig, deployERC20Config } = params

    // Validate wallet
    if (!isManagedMode || !managedAddress) {
      bundle._setError('Omnichain execution requires an active managed account')
      return
    }
    const activeAddress = managedAddress

    try {
      // Transactions are wrapped through SmartAccount.execute() so that
      // _msgSender() inside the target contract = smart account = project owner.
      let transactions: BuiltControllerTransaction[]
      let synchronizedStartTime: number | undefined

      if (rulesetConfig) {
        const omnichainRequest: JBOmnichainQueueRequest = {
            chainIds,
            projectIds,
            rulesetConfigurations: rulesetConfig.rulesetConfigurations as JBRulesetConfig[] | undefined,
            rulesetConfigurationsByChain: rulesetConfig.rulesetConfigurationsByChain as Record<number, JBRulesetConfig[]> | undefined,
            queueTargets: rulesetConfig.queueTargets,
            memo: rulesetConfig.memo,
            mustStartAtOrAfter: rulesetConfig.mustStartAtOrAfter,
        }
        const response = await buildOmnichainQueueRulesetTransactions(omnichainRequest)
        transactions = response.transactions.map(tx => ({
          chainId: tx.txData.chainId,
          target: tx.txData.to,
          data: tx.txData.data,
          value: tx.txData.value,
        }))
        synchronizedStartTime = response.synchronizedStartTime
      } else if (distributeConfig) {
        const distributeRequest: JBOmnichainDistributeRequest = {
          chainIds,
          projectIds,
          type: distributeConfig.type,
          controllerAddresses: distributeConfig.controllerAddresses,
        }
        const response = await buildOmnichainDistributeTransactions(distributeRequest)
        transactions = response.transactions.map(tx => ({
          chainId: tx.txData.chainId,
          target: tx.txData.to,
          data: tx.txData.data,
          value: tx.txData.value,
        }))
      } else if (deployERC20Config) {
        const deployRequest: JBOmnichainDeployERC20Request = {
          chainIds,
          projectIds,
          tokenName: deployERC20Config.tokenName,
          tokenSymbol: deployERC20Config.tokenSymbol,
          salt: deployERC20Config.salt,
          controllerAddresses: deployERC20Config.controllerAddresses,
        }
        const response = await buildOmnichainDeployERC20Transactions(deployRequest)
        transactions = response.transactions.map(tx => ({
          chainId: tx.txData.chainId,
          target: tx.txData.to,
          data: tx.txData.data,
          value: tx.txData.value,
        }))
      } else {
        throw new Error('One of rulesetConfig, distributeConfig, or deployERC20Config is required')
      }

      await preflightControllerTransactions({
        transactions,
        chainIds,
        projectIds,
        account: activeAddress as Address,
        operation: rulesetConfig ? 'rulesetQueue' : 'controller',
      })

      assertTransactionAccountUnchanged(activeAddress, latestManagedAddress.current)
      bundle._setCreating()

      console.log('=== SERVER SIGNING MODE (omnichain transaction) ===')
      console.log(`Smart account routing: ${managedAddress}`)

      assertTransactionAccountUnchanged(activeAddress, latestManagedAddress.current)
      const result = await submitManagedControllerBundle(
        transactions,
        activeAddress,
        managedAddress
      )

      bundle._initializeBundle(
        result.bundleId,
        chainIds,
        projectIds,
        [],
        synchronizedStartTime
      )
      bundle._setProcessing('sponsored')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create bundle'
      bundle._setError(errorMessage)
      onErrorRef.current?.(err instanceof Error ? err : new Error(errorMessage))
    }
  }, [
    isManagedMode,
    managedAddress,
    bundle,
  ])

  const isExecuting = bundleState.status === 'creating' ||
    bundleState.status === 'awaiting_payment' ||
    bundleState.status === 'processing'

  return useMemo(() => ({
    execute,
    bundleState,
    isExecuting,
    isComplete: bundleState.status === 'completed',
    isExpired: bundleState.status === 'expired',
    hasError: bundleState.status === 'failed' || bundleState.status === 'partial' || bundleState.status === 'expired',
    reset,
  }), [
    execute,
    bundleState,
    isExecuting,
    reset,
  ])
}
