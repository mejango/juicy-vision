import { useCallback, useEffect, useMemo, useState } from 'react'
import { keccak256, toBytes } from 'viem'
import { useAuthStore } from '../../stores'
import { useManagedWallet, createManagedRelayrBundle, type RelayrTransaction } from '../useManagedWallet'
import {
  buildOmnichainDeploySuckersTransactions,
  type JBDeploySuckersRequest,
  type SuckerTokenMapping,
} from '../../services/relayr'
import { useRelayrBundle } from './useRelayrBundle'
import { useRelayrStatus } from './useRelayrStatus'
import type { UseOmnichainTransactionOptions, BundleState } from './types'

// Relayr app ID for sponsored bundles
const RELAYR_APP_ID = import.meta.env.VITE_RELAYR_APP_ID || 'juicy-vision'

// Native token address used for sucker mappings
const NATIVE_TOKEN = '0x000000000000000000000000000000000000EEEe' as const

export interface OmnichainDeploySuckersParams {
  chainIds: number[]
  projectIds: Record<number, number>    // chainId -> projectId
  tokenMappings?: SuckerTokenMapping[]
  deployerOverrides?: Record<number, string>  // chainId -> deployer address
}

export interface UseOmnichainDeploySuckersReturn {
  deploySuckers: (params: OmnichainDeploySuckersParams) => Promise<void>
  bundleState: BundleState
  isDeploying: boolean
  isComplete: boolean
  hasError: boolean
  suckerAddresses: Record<number, string>
  suckerGroupId: string | null
  reset: () => void
}

/**
 * Generate a deterministic salt for sucker deployment.
 * Uses project IDs to ensure unique, linked sucker addresses.
 * IMPORTANT: Salt must be identical across all chains for CREATE2 deterministic addresses.
 */
function generateSuckerSalt(projectIds: Record<number, number>): string {
  // Sort chain IDs for consistent salt regardless of order
  const sortedEntries = Object.entries(projectIds)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([chainId, projectId]) => `${chainId}:${projectId}`)
    .join('-')
  // NO timestamp - salt must be deterministic for same address on all chains
  const saltInput = `sucker-v1-${sortedEntries}`
  return keccak256(toBytes(saltInput))
}

/**
 * Generate default token mappings for ETH bridging.
 * Creates mappings for native token between all chain pairs.
 */
function generateDefaultTokenMappings(): SuckerTokenMapping[] {
  return [{
    localToken: NATIVE_TOKEN,
    remoteToken: NATIVE_TOKEN,
    minGas: 200000,             // Reasonable default for bridge operations
    minBridgeAmount: '1000000000000000',  // 0.001 ETH minimum
  }]
}

/**
 * Hook for deploying suckers to link projects across chains.
 * Suckers enable token bridging between the same project on different chains.
 * All gas is sponsored by admin via balance bundle.
 *
 * Call this AFTER project creation to link projects on multiple chains.
 *
 * @example
 * const { deploySuckers, bundleState, suckerAddresses } = useOmnichainDeploySuckers({
 *   onSuccess: (bundleId, txHashes) => console.log('Suckers deployed'),
 * })
 *
 * await deploySuckers({
 *   chainIds: [1, 10, 8453, 42161],
 *   projectIds: { 1: 100, 10: 200, 8453: 150, 42161: 175 },
 * })
 */
export function useOmnichainDeploySuckers(
  options: UseOmnichainTransactionOptions = {}
): UseOmnichainDeploySuckersReturn {
  const { onSuccess, onError } = options

  // Auth state
  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()
  const { address: managedAddress } = useManagedWallet()

  // Track sucker deployment results
  const [suckerAddresses, setSuckerAddresses] = useState<Record<number, string>>({})
  const [suckerGroupId, setSuckerGroupId] = useState<string | null>(null)

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
      onSuccess?.(bundleState.bundleId, txHashes)
    }
  }, [bundleState.status, bundleState.bundleId, bundleState.chainStates, onSuccess])

  // Call onError when failed
  useEffect(() => {
    if (bundleState.status === 'failed' && bundleState.error) {
      onError?.(new Error(bundleState.error))
    }
  }, [bundleState.status, bundleState.error, onError])

  /**
   * Deploy suckers on all specified chains to link projects.
   * Uses balance-sponsored bundle - admin pays all gas.
   */
  const deploySuckers = useCallback(async (params: OmnichainDeploySuckersParams) => {
    const {
      chainIds,
      projectIds,
      tokenMappings,
      deployerOverrides,
    } = params

    // Validate we have project IDs for all chains
    for (const chainId of chainIds) {
      if (!projectIds[chainId]) {
        bundle._setError(`Missing project ID for chain ${chainId}`)
        return
      }
    }

    bundle._setCreating()

    try {
      // Generate deterministic salt for linked suckers
      const salt = generateSuckerSalt(projectIds)

      // Use provided token mappings or default to ETH-only
      const mappings = tokenMappings || generateDefaultTokenMappings()

      // Build sucker deployment request
      const deployRequest: JBDeploySuckersRequest = {
        chainIds,
        projectIds,
        salt,
        tokenMappings: mappings,
        deployerOverrides,
      }

      const deployResponse = await buildOmnichainDeploySuckersTransactions(deployRequest)

      // Store predicted sucker addresses and group ID
      setSuckerAddresses(deployResponse.suckerAddresses)
      setSuckerGroupId(deployResponse.suckerGroupId)

      console.log('=== SERVER SIGNING MODE (deploySuckers) ===')
      console.log(`Smart account routing: ${managedAddress}`)

      // Convert to RelayrTransaction format
      const relayrTransactions: RelayrTransaction[] = deployResponse.transactions.map(tx => ({
        chainId: tx.txData.chainId,
        target: tx.txData.to,
        data: tx.txData.data,
        value: tx.txData.value,
      }))

      // Use createManagedRelayrBundle with smart account routing
      // This ensures _msgSender() = smart account (project owner), not passkey EOA
      const result = await createManagedRelayrBundle(
        relayrTransactions,
        managedAddress ?? '',  // Project owner
        managedAddress ?? undefined  // Smart account address for routing
      )

      // Initialize bundle state
      bundle._initializeBundle(
        result.bundleId,
        chainIds,
        projectIds,
        [],  // No payment options - admin sponsored
      )

      // Start processing immediately (sponsored)
      bundle._setProcessing('sponsored')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to deploy suckers'
      bundle._setError(errorMessage)
      onError?.(err instanceof Error ? err : new Error(errorMessage))
    }
  }, [bundle, onError])

  const reset = useCallback(() => {
    resetBundle()
    setSuckerAddresses({})
    setSuckerGroupId(null)
  }, [resetBundle])

  const isDeploying = bundleState.status === 'creating' || bundleState.status === 'processing'

  return useMemo(() => ({
    deploySuckers,
    bundleState,
    isDeploying,
    isComplete: bundleState.status === 'completed',
    hasError: bundleState.status === 'failed' || bundleState.status === 'partial',
    suckerAddresses,
    suckerGroupId,
    reset,
  }), [deploySuckers, bundleState, isDeploying, suckerAddresses, suckerGroupId, reset])
}
