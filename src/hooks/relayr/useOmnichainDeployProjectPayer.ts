import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Address, Hex } from 'viem'
import { useAuthStore } from '../../stores'
import { useManagedWallet, createManagedRelayrBundle } from '../useManagedWallet'
import { assertTransactionAccountUnchanged } from '../useReviewedTransactionAccount'
import { getSafetyPublicClient } from '../../utils/transactionSafety'
import { getProjectPayerDeployer, type ProjectPayerDeployCall } from '../../services/projectPayers'
import { useRelayrBundle } from './useRelayrBundle'
import { useRelayrStatus } from './useRelayrStatus'
import type { UseOmnichainTransactionOptions } from './types'

/**
 * Simulate every payer-deploy call before submitting the bundle — the Relayr
 * analogue of preflightControllerTransactions. Payer deploys don't resolve a
 * project controller, so the check instead (1) proves each call targets the
 * canonical JBProjectPayerDeployer on its chain (the route can't have drifted)
 * and (2) eth_calls the deploy so a would-be revert surfaces before the user
 * pays for the bundle.
 */
export async function preflightProjectPayerTransactions(params: {
  transactions: ProjectPayerDeployCall[]
  chainIds: number[]
  account: Address
}): Promise<void> {
  const expectedChains = new Set(params.chainIds)
  if (
    params.transactions.length !== expectedChains.size ||
    params.transactions.some(tx => !expectedChains.has(tx.chainId)) ||
    new Set(params.transactions.map(tx => tx.chainId)).size !== expectedChains.size
  ) {
    throw new Error('The omnichain payer deployment set does not match the reviewed chains')
  }

  await Promise.all(params.transactions.map(async transaction => {
    const expectedTarget = getProjectPayerDeployer(transaction.chainId)
    if (!expectedTarget) {
      throw new Error(`JBProjectPayerDeployer is not deployed on chain ${transaction.chainId}`)
    }
    if (expectedTarget.toLowerCase() !== transaction.to.toLowerCase()) {
      throw new Error(`The payer deployer route changed on chain ${transaction.chainId}`)
    }

    const client = getSafetyPublicClient(transaction.chainId)
    await client.call({
      account: params.account,
      to: expectedTarget,
      data: transaction.data as Hex,
      value: 0n,
    })
  }))
}

export interface OmnichainDeployProjectPayerParams {
  /** One JBProjectPayerDeployer.deployProjectPayer call per selected chain. */
  calls: ProjectPayerDeployCall[]
  /** chainId -> that chain's own project ID (for bundle chain-state labeling). */
  projectIds: Record<number, number>
}

export interface UseOmnichainDeployProjectPayerReturn {
  deploy: (params: OmnichainDeployProjectPayerParams) => Promise<void>
  bundleState: ReturnType<typeof useRelayrBundle>['bundleState']
  isExecuting: boolean
  isComplete: boolean
  isExpired: boolean
  hasError: boolean
  reset: () => void
}

export async function submitManagedProjectPayerBundle(
  calls: ProjectPayerDeployCall[],
  activeAddress: string,
  managedAddress: string,
  submit?: typeof createManagedRelayrBundle,
): Promise<{ bundleId: string }> {
  const transactions = calls.map(call => ({
    chainId: call.chainId,
    target: call.to,
    data: call.data,
    value: '0',
  }))
  if (submit) return submit(transactions, activeAddress, managedAddress)
  return createManagedRelayrBundle(transactions, activeAddress, managedAddress)
}

/**
 * Deploy JBProjectPayer forwarding contracts across chains as ONE Relayr bundle
 * for a managed account — the payer analogue of useOmnichainDeployERC20. Each
 * chain runs the same permissionless deployProjectPayer call with that chain's
 * own project ID, simulated per chain before submit. Self-custody deploys keep
 * using the sequential guarded runner in the caller.
 */
export function useOmnichainDeployProjectPayer(
  options: UseOmnichainTransactionOptions = {},
): UseOmnichainDeployProjectPayerReturn {
  const { onSuccess, onError } = options

  const onSuccessRef = useRef(onSuccess)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onSuccessRef.current = onSuccess
    onErrorRef.current = onError
  })

  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()

  const { address: managedAddress } = useManagedWallet()
  const latestManagedAddress = useRef(managedAddress)
  latestManagedAddress.current = managedAddress

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
  }
  const { bundleState, reset, updateFromStatus } = bundle

  const { data: statusData } = useRelayrStatus({
    bundleId: bundleState.bundleId,
    enabled: bundleState.status === 'processing',
    stopOnComplete: true,
  })

  useEffect(() => {
    if (statusData) updateFromStatus(statusData)
  }, [statusData, updateFromStatus])

  const hasCalledSuccessRef = useRef(false)
  useEffect(() => {
    if (bundleState.status === 'completed' && bundleState.bundleId && !hasCalledSuccessRef.current) {
      hasCalledSuccessRef.current = true
      const txHashes: Record<number, string> = {}
      bundleState.chainStates.forEach(cs => {
        if (cs.txHash) txHashes[cs.chainId] = cs.txHash
      })
      onSuccessRef.current?.(bundleState.bundleId, txHashes)
    }
    if (bundleState.status === 'idle') hasCalledSuccessRef.current = false
  }, [bundleState.status, bundleState.bundleId, bundleState.chainStates])

  const hasCalledErrorRef = useRef(false)
  useEffect(() => {
    if ((bundleState.status === 'failed' || bundleState.status === 'expired') && bundleState.error && !hasCalledErrorRef.current) {
      hasCalledErrorRef.current = true
      onErrorRef.current?.(new Error(bundleState.error))
    }
    if (bundleState.status === 'idle') hasCalledErrorRef.current = false
  }, [bundleState.status, bundleState.error])

  const deploy = useCallback(async (params: OmnichainDeployProjectPayerParams) => {
    const { calls, projectIds } = params

    if (!isManagedMode || !managedAddress) {
      bundle._setError('Bundled payer deployment requires an active managed account')
      return
    }
    if (!calls.length) {
      bundle._setError('Select at least one chain')
      return
    }
    const activeAddress = managedAddress
    const chainIds = calls.map(call => call.chainId)

    // Fresh run: re-arm the one-shot success/error guards so a second deploy in
    // the same mounted component still fires its callback.
    hasCalledSuccessRef.current = false
    hasCalledErrorRef.current = false

    try {
      await preflightProjectPayerTransactions({
        transactions: calls,
        chainIds,
        account: activeAddress as Address,
      })

      assertTransactionAccountUnchanged(activeAddress, latestManagedAddress.current)
      bundle._setCreating()

      const result = await submitManagedProjectPayerBundle(
        calls,
        activeAddress,
        managedAddress,
      )

      bundle._initializeBundle(result.bundleId, chainIds, projectIds, [])
      bundle._setProcessing('sponsored')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create bundle'
      bundle._setError(errorMessage)
      onErrorRef.current?.(err instanceof Error ? err : new Error(errorMessage))
    }
  }, [isManagedMode, managedAddress, bundle])

  const isExecuting = bundleState.status === 'creating' ||
    bundleState.status === 'awaiting_payment' ||
    bundleState.status === 'processing'

  return useMemo(() => ({
    deploy,
    bundleState,
    isExecuting,
    isComplete: bundleState.status === 'completed',
    isExpired: bundleState.status === 'expired',
    hasError: bundleState.status === 'failed' || bundleState.status === 'partial' || bundleState.status === 'expired',
    reset,
  }), [deploy, bundleState, isExecuting, reset])
}
