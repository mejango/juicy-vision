import { useCallback, useEffect, useMemo, useState } from 'react'
import { useManagedWallet } from '../useManagedWallet'
import {
  createBalanceBundle,
  buildOmnichainLaunchProjectTransactions,
  getBundleStatus,
  type JBLaunchProjectRequest,
  type JBRulesetConfig,
  type JBTerminalConfig,
  type JBSuckerDeploymentConfig,
} from '../../services/relayr'
import { buildOmnichainLaunchTransactions } from '../../services/omnichainDeployer'
import { useRelayrBundle } from './useRelayrBundle'
import { useRelayrStatus } from './useRelayrStatus'
import type { UseOmnichainTransactionOptions, BundleState } from './types'

// Relayr app ID for sponsored bundles
const RELAYR_APP_ID = import.meta.env.VITE_RELAYR_APP_ID || 'juicy-vision'

export interface OmnichainLaunchProjectParams {
  chainIds: number[]
  owner: string
  projectUri: string                    // IPFS CID for project metadata
  rulesetConfigurations: JBRulesetConfig[]
  terminalConfigurations: JBTerminalConfig[]
  memo: string
  suckerDeploymentConfiguration?: JBSuckerDeploymentConfig  // Optional: deploy suckers atomically
}

export interface UseOmnichainLaunchProjectReturn {
  launch: (params: OmnichainLaunchProjectParams) => Promise<void>
  bundleState: BundleState
  isLaunching: boolean
  isComplete: boolean
  hasError: boolean
  createdProjectIds: Record<number, number>
  reset: () => void
}

/**
 * Hook for launching new Juicebox projects across multiple chains with Relayr.
 * All gas is sponsored by admin via balance bundle - users don't pay.
 *
 * @example
 * const { launch, bundleState, isLaunching, createdProjectIds } = useOmnichainLaunchProject({
 *   onSuccess: (bundleId, txHashes) => console.log('Projects created on all chains'),
 * })
 *
 * await launch({
 *   chainIds: [1, 10, 8453, 42161],
 *   owner: '0x...',
 *   projectUri: 'QmXyz...',
 *   rulesetConfigurations: [{ ... }],
 *   terminalConfigurations: [{ ... }],
 *   memo: 'Launch my project',
 * })
 */
export function useOmnichainLaunchProject(
  options: UseOmnichainTransactionOptions = {}
): UseOmnichainLaunchProjectReturn {
  const { onSuccess, onError } = options

  // Get wallet address - works for both passkey (Touch ID) and managed mode users
  const { address: managedAddress, isManagedMode } = useManagedWallet()

  // Track predicted project IDs from launch response
  const [predictedProjectIds, setPredictedProjectIds] = useState<Record<number, number>>({})
  const [confirmedProjectIds, setConfirmedProjectIds] = useState<Record<number, number>>({})

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
  }
  const { bundleState, reset: resetBundle } = bundle

  // Status polling
  const { data: statusData } = useRelayrStatus({
    bundleId: bundleState.bundleId,
    enabled: bundleState.status === 'processing',
    stopOnComplete: true,
  })

  // Update bundle state from polling
  useEffect(() => {
    if (statusData) {
      bundle.updateFromStatus(statusData)
    }
  }, [statusData, bundle])

  // Call onSuccess when complete and update confirmed project IDs
  useEffect(() => {
    if (bundleState.status === 'completed' && bundleState.bundleId) {
      const txHashes: Record<number, string> = {}
      bundleState.chainStates.forEach(cs => {
        if (cs.txHash) {
          txHashes[cs.chainId] = cs.txHash
        }
      })
      // Use predicted project IDs as confirmed (they should match)
      setConfirmedProjectIds(predictedProjectIds)
      onSuccess?.(bundleState.bundleId, txHashes)
    }
  }, [bundleState.status, bundleState.bundleId, bundleState.chainStates, predictedProjectIds, onSuccess])

  // Call onError when failed
  useEffect(() => {
    if (bundleState.status === 'failed' && bundleState.error) {
      onError?.(new Error(bundleState.error))
    }
  }, [bundleState.status, bundleState.error, onError])

  /**
   * Launch projects on all specified chains.
   * Uses balance-sponsored bundle - admin pays all gas.
   */
  const launch = useCallback(async (params: OmnichainLaunchProjectParams) => {
    const {
      chainIds,
      owner,
      projectUri,
      rulesetConfigurations,
      terminalConfigurations,
      memo,
      suckerDeploymentConfiguration,
    } = params

    // For managed mode, use managed wallet as owner if not specified
    const projectOwner = owner || (isManagedMode ? managedAddress : undefined)
    if (!projectOwner) {
      bundle._setError('No owner address specified')
      return
    }

    bundle._setCreating()

    try {
      let transactions: Array<{ chain: number; target: string; data: string; value: string }>
      let predictedIds: Record<number, number> = {}

      if (suckerDeploymentConfiguration) {
        // Use JBOmnichainDeployer.launchProjectFor() - encode calldata locally
        // This creates projects AND deploys suckers atomically
        const txs = buildOmnichainLaunchTransactions({
          chainIds,
          owner: projectOwner as `0x${string}`,
          projectUri,
          rulesetConfigurations,
          terminalConfigurations,
          memo,
          suckerDeploymentConfiguration,
        })

        transactions = txs.map(tx => ({
          chain: tx.chainId,
          target: tx.to,
          data: tx.data,
          value: tx.value,
        }))

        // Project IDs will be determined after transactions confirm
        // For now, use placeholder - they'll be extracted from events
        chainIds.forEach(chainId => {
          predictedIds[chainId] = 0 // Will be updated from tx receipt
        })
      } else {
        // Use API endpoint for backward compatibility (JBController.launchProjectFor)
        const launchRequest: JBLaunchProjectRequest = {
          chainIds,
          owner: projectOwner,
          projectUri,
          rulesetConfigurations,
          terminalConfigurations,
          memo,
        }

        const launchResponse = await buildOmnichainLaunchProjectTransactions(launchRequest)
        predictedIds = launchResponse.predictedProjectIds

        transactions = launchResponse.transactions.map(tx => ({
          chain: tx.txData.chainId,
          target: tx.txData.to,
          data: tx.txData.data,
          value: tx.txData.value,
        }))
      }

      // Store predicted project IDs
      setPredictedProjectIds(predictedIds)

      // Debug: Log the exact request being sent to Relayr
      const bundleRequest = {
        app_id: RELAYR_APP_ID,
        transactions: transactions.map(tx => ({
          ...tx,
        })),
        perform_simulation: true,
        virtual_nonce_mode: 'Disabled',
      }
      console.log('=== RELAYR BUNDLE REQUEST ===')
      console.log('Full request:', JSON.stringify(bundleRequest, null, 2))
      console.log('Chain IDs:', chainIds)
      console.log('Predicted Project IDs:', predictedIds)
      console.log('Transactions:')
      transactions.forEach((tx, i) => {
        console.log(`  [${i}] Chain ${tx.chain}:`)
        console.log(`      Target: ${tx.target}`)
        console.log(`      Value: ${tx.value}`)
        console.log(`      Data: ${tx.data}`)
      })
      console.log('=============================')

      // Create balance-sponsored bundle (admin pays gas)
      const bundleResponse = await createBalanceBundle(bundleRequest)

      // Initialize bundle state with predicted project IDs
      bundle._initializeBundle(
        bundleResponse.bundle_uuid,
        chainIds,
        predictedIds,
        [],  // No payment options - admin sponsored
      )

      // Start processing immediately (sponsored)
      bundle._setProcessing('sponsored')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to launch project'
      bundle._setError(errorMessage)
      onError?.(err instanceof Error ? err : new Error(errorMessage))
    }
  }, [isManagedMode, managedAddress, bundle, onError])

  const reset = useCallback(() => {
    resetBundle()
    setPredictedProjectIds({})
    setConfirmedProjectIds({})
  }, [resetBundle])

  const isLaunching = bundleState.status === 'creating' || bundleState.status === 'processing'

  // Merge predicted and confirmed IDs, preferring confirmed
  const createdProjectIds = useMemo(() => ({
    ...predictedProjectIds,
    ...confirmedProjectIds,
  }), [predictedProjectIds, confirmedProjectIds])

  return useMemo(() => ({
    launch,
    bundleState,
    isLaunching,
    isComplete: bundleState.status === 'completed',
    hasError: bundleState.status === 'failed' || bundleState.status === 'partial',
    createdProjectIds,
    reset,
  }), [launch, bundleState, isLaunching, createdProjectIds, reset])
}
