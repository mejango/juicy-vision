import { useCallback, useEffect, useMemo, useState } from 'react'
import { keccak256, toBytes } from 'viem'
import { useAuthStore } from '../../stores'
import { useManagedWallet } from '../useManagedWallet'
import {
  createBalanceBundle,
  buildOmnichainDeployRevnetTransactions,
  type JBDeployRevnetRequest,
  type REVStageConfig,
  type REVSuckerDeploymentConfig,
} from '../../services/relayr'
import { useRelayrBundle } from './useRelayrBundle'
import { useRelayrStatus } from './useRelayrStatus'
import type { UseOmnichainTransactionOptions, BundleState } from './types'

// Relayr app ID for sponsored bundles
const RELAYR_APP_ID = import.meta.env.VITE_RELAYR_APP_ID || 'juicy-vision'

export interface OmnichainDeployRevnetParams {
  chainIds: number[]
  stageConfigurations: REVStageConfig[]
  splitOperator: string                 // Address that receives operator split
  name: string
  tagline: string
  suckerDeploymentConfiguration?: REVSuckerDeploymentConfig
  initialTokenReceivers?: Array<{
    beneficiary: string
    count: number
  }>
}

export interface UseOmnichainDeployRevnetReturn {
  deploy: (params: OmnichainDeployRevnetParams) => Promise<void>
  bundleState: BundleState
  isDeploying: boolean
  isComplete: boolean
  hasError: boolean
  createdProjectIds: Record<number, number>
  predictedTokenAddress: string | null
  reset: () => void
}

/**
 * Generate a deterministic salt for revnet deployment.
 * Uses name and timestamp to ensure unique CREATE2 addresses.
 */
function generateRevnetSalt(name: string, splitOperator: string): string {
  const saltInput = `revnet-v1-${name}-${splitOperator}-${Date.now()}`
  return keccak256(toBytes(saltInput))
}

/**
 * Hook for deploying revnets across multiple chains with Relayr.
 * All gas is sponsored by admin via balance bundle - users don't pay.
 *
 * Revnets are stage-based projects with automated issuance decay,
 * deployed using the REVDeployer contract.
 *
 * @example
 * const { deploy, bundleState, isDeploying, createdProjectIds } = useOmnichainDeployRevnet({
 *   onSuccess: (bundleId, txHashes) => console.log('Revnet deployed on all chains'),
 * })
 *
 * await deploy({
 *   chainIds: [1, 10, 8453, 42161],
 *   stageConfigurations: [{
 *     startsAtOrAfter: 0,
 *     splitPercent: 200000000,  // 20% to operator
 *     initialIssuance: '1000000000000000000000000',
 *     issuanceDecayFrequency: 86400 * 7,  // Weekly
 *     issuanceDecayPercent: 50000000,     // 5% decay
 *     cashOutTaxRate: 1000,               // 10% exit tax
 *     extraMetadata: 0,
 *   }],
 *   splitOperator: '0x...',
 *   name: 'My Revnet',
 *   tagline: 'A revenue network',
 * })
 */
export function useOmnichainDeployRevnet(
  options: UseOmnichainTransactionOptions = {}
): UseOmnichainDeployRevnetReturn {
  const { onSuccess, onError } = options

  // Auth state
  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()
  const { address: managedAddress } = useManagedWallet()

  // Track predicted project IDs and token address
  const [predictedProjectIds, setPredictedProjectIds] = useState<Record<number, number>>({})
  const [confirmedProjectIds, setConfirmedProjectIds] = useState<Record<number, number>>({})
  const [predictedTokenAddress, setPredictedTokenAddress] = useState<string | null>(null)

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

  // Call onSuccess when complete
  useEffect(() => {
    if (bundleState.status === 'completed' && bundleState.bundleId) {
      const txHashes: Record<number, string> = {}
      bundleState.chainStates.forEach(cs => {
        if (cs.txHash) {
          txHashes[cs.chainId] = cs.txHash
        }
      })
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
   * Deploy revnet on all specified chains.
   * Uses balance-sponsored bundle - admin pays all gas.
   */
  const deploy = useCallback(async (params: OmnichainDeployRevnetParams) => {
    const {
      chainIds,
      stageConfigurations,
      splitOperator,
      name,
      tagline,
      suckerDeploymentConfiguration,
      initialTokenReceivers,
    } = params

    // Use managed wallet as operator if not specified in managed mode
    const operator = splitOperator || (isManagedMode ? managedAddress : undefined)
    if (!operator) {
      bundle._setError('No split operator address specified')
      return
    }

    bundle._setCreating()

    try {
      // Generate deterministic salt for CREATE2
      const salt = generateRevnetSalt(name, operator)

      // Build revnet deployment request
      const deployRequest: JBDeployRevnetRequest = {
        chainIds,
        stageConfigurations,
        splitOperator: operator,
        description: {
          name,
          tagline,
          salt,
        },
        suckerDeploymentConfiguration,
        initialTokenReceivers,
      }

      const deployResponse = await buildOmnichainDeployRevnetTransactions(deployRequest)

      // Store predicted values
      setPredictedProjectIds(deployResponse.predictedProjectIds)
      setPredictedTokenAddress(deployResponse.predictedTokenAddress)

      // Create balance-sponsored bundle (admin pays gas)
      // When using MultiChain mode, each transaction needs a virtual_nonce
      const bundleResponse = await createBalanceBundle({
        app_id: RELAYR_APP_ID,
        transactions: deployResponse.transactions.map((tx, index) => ({
          chain: tx.txData.chainId,
          target: tx.txData.to,
          data: tx.txData.data,
          value: tx.txData.value,
          virtual_nonce: index,
        })),
        perform_simulation: true,
        virtual_nonce_mode: 'MultiChain',
      })

      // Initialize bundle state
      bundle._initializeBundle(
        bundleResponse.bundle_uuid,
        chainIds,
        deployResponse.predictedProjectIds,
        [],  // No payment options - admin sponsored
      )

      // Start processing immediately (sponsored)
      bundle._setProcessing('sponsored')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to deploy revnet'
      bundle._setError(errorMessage)
      onError?.(err instanceof Error ? err : new Error(errorMessage))
    }
  }, [isManagedMode, managedAddress, bundle, onError])

  const reset = useCallback(() => {
    resetBundle()
    setPredictedProjectIds({})
    setConfirmedProjectIds({})
    setPredictedTokenAddress(null)
  }, [resetBundle])

  const isDeploying = bundleState.status === 'creating' || bundleState.status === 'processing'

  // Merge predicted and confirmed IDs
  const createdProjectIds = useMemo(() => ({
    ...predictedProjectIds,
    ...confirmedProjectIds,
  }), [predictedProjectIds, confirmedProjectIds])

  return useMemo(() => ({
    deploy,
    bundleState,
    isDeploying,
    isComplete: bundleState.status === 'completed',
    hasError: bundleState.status === 'failed' || bundleState.status === 'partial',
    createdProjectIds,
    predictedTokenAddress,
    reset,
  }), [deploy, bundleState, isDeploying, createdProjectIds, predictedTokenAddress, reset])
}
