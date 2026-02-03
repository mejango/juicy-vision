import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAccount, useConfig, useSignTypedData } from 'wagmi'
import { encodeFunctionData, getContract, createPublicClient, http, fallback, type Address, type Hex, type PublicClient } from 'viem'
import { useManagedWallet, createManagedRelayrBundle } from '../useManagedWallet'
import { createBalanceBundle } from '../../services/relayr'
import {
  buildOmnichainSetUriTransactions,
  type ChainProjectMapping,
} from '../../services/omnichainDeployer'
import { useRelayrBundle } from './useRelayrBundle'
import { useRelayrStatus } from './useRelayrStatus'
import type { UseOmnichainTransactionOptions, BundleState } from './types'
import {
  ERC2771_FORWARDER_ADDRESS,
  ERC2771_FORWARDER_ABI,
  FORWARD_REQUEST_TYPES,
} from '../../constants/abis'
import { getProjectController } from '../../utils/paymentTerminal'
import { RPC_ENDPOINTS, VIEM_CHAINS, type SupportedChainId } from '../../constants/chains'

// Relayr app ID for sponsored bundles
const RELAYR_APP_ID = import.meta.env.VITE_RELAYR_APP_ID || 'juicy-vision'

/**
 * Input mapping for setUri - controller will be fetched from JBDirectory
 */
export interface ChainProjectInput {
  chainId: number
  projectId: number | bigint
}

export interface OmnichainSetUriParams {
  chainProjectMappings: ChainProjectInput[]
  uri: string  // IPFS CID for new project metadata
  forceSelfCustody?: boolean  // Force wallet signing even if managed mode is available
}

export interface UseOmnichainSetUriReturn {
  setUri: (params: OmnichainSetUriParams) => Promise<void>
  bundleState: BundleState
  isUpdating: boolean
  isSigning: boolean
  signingChainId: number | null
  isComplete: boolean
  hasError: boolean
  reset: () => void
}

// 48 hours deadline for signatures
const ERC2771_DEADLINE_DURATION_SECONDS = 48 * 60 * 60

// localStorage key prefix for persisting state
const SET_URI_RESULT_PREFIX = 'juicy-vision:set-uri-result:'
const SET_URI_IN_PROGRESS_PREFIX = 'juicy-vision:set-uri-in-progress:'

interface PersistedSetUriResult {
  bundleId: string
  txHashes: Record<number, string>
  timestamp: number
}

interface PersistedInProgressSetUri {
  bundleId: string
  chainIds: number[]
  timestamp: number
}

function getResultKey(deploymentKey: string | undefined): string {
  return deploymentKey ? `${SET_URI_RESULT_PREFIX}${deploymentKey}` : `${SET_URI_RESULT_PREFIX}default`
}

function getInProgressKey(deploymentKey: string | undefined): string {
  return deploymentKey ? `${SET_URI_IN_PROGRESS_PREFIX}${deploymentKey}` : `${SET_URI_IN_PROGRESS_PREFIX}default`
}

function saveSetUriResult(result: PersistedSetUriResult, deploymentKey: string | undefined): void {
  try {
    localStorage.setItem(getResultKey(deploymentKey), JSON.stringify(result))
    localStorage.removeItem(getInProgressKey(deploymentKey))
  } catch (err) {
    console.warn('Failed to save setUri result to localStorage:', err)
  }
}

function loadSetUriResult(deploymentKey: string | undefined): PersistedSetUriResult | null {
  try {
    const stored = localStorage.getItem(getResultKey(deploymentKey))
    if (!stored) return null
    return JSON.parse(stored) as PersistedSetUriResult
  } catch {
    return null
  }
}

function clearSetUriResult(deploymentKey: string | undefined): void {
  try {
    localStorage.removeItem(getResultKey(deploymentKey))
    localStorage.removeItem(getInProgressKey(deploymentKey))
  } catch {
    // Ignore
  }
}

function saveInProgressSetUri(data: PersistedInProgressSetUri, deploymentKey: string | undefined): void {
  try {
    localStorage.setItem(getInProgressKey(deploymentKey), JSON.stringify(data))
  } catch (err) {
    console.warn('Failed to save in-progress setUri to localStorage:', err)
  }
}

function loadInProgressSetUri(deploymentKey: string | undefined): PersistedInProgressSetUri | null {
  try {
    const stored = localStorage.getItem(getInProgressKey(deploymentKey))
    if (!stored) return null
    const data = JSON.parse(stored) as PersistedInProgressSetUri
    // Expire after 1 hour
    if (Date.now() - data.timestamp > 60 * 60 * 1000) {
      localStorage.removeItem(getInProgressKey(deploymentKey))
      return null
    }
    return data
  } catch {
    return null
  }
}

/**
 * Hook for updating project metadata URI across multiple chains with Relayr.
 * All gas is sponsored by admin via balance bundle - users don't pay.
 *
 * @example
 * const { setUri, bundleState, isUpdating, isComplete } = useOmnichainSetUri({
 *   onSuccess: (bundleId, txHashes) => console.log('URI updated on all chains'),
 * })
 *
 * await setUri({
 *   chainProjectMappings: [
 *     { chainId: 1, projectId: 123 },
 *     { chainId: 10, projectId: 456 },
 *   ],
 *   uri: 'QmNewMetadataCid...',
 * })
 */
export function useOmnichainSetUri(
  options: UseOmnichainTransactionOptions = {}
): UseOmnichainSetUriReturn {
  const { onSuccess, onError, deploymentKey } = options

  // Use refs for callbacks to avoid infinite loops
  const onSuccessRef = useRef(onSuccess)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onSuccessRef.current = onSuccess
    onErrorRef.current = onError
  })

  // Get wallet address
  const { address: managedAddress, isManagedMode } = useManagedWallet()
  const { address: connectedAddress } = useAccount()
  const config = useConfig()
  const { signTypedDataAsync } = useSignTypedData()

  // Track ERC-2771 signing state
  const [isSigning, setIsSigning] = useState(false)
  const [signingChainId, setSigningChainId] = useState<number | null>(null)

  // Track persisted state
  const [persistedResult, setPersistedResult] = useState<PersistedSetUriResult | null>(() => loadSetUriResult(deploymentKey))
  const [resumedInProgress, setResumedInProgress] = useState<PersistedInProgressSetUri | null>(() => loadInProgressSetUri(deploymentKey))

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

  // Restore in-progress on mount
  const hasResumedRef = useRef(false)
  useEffect(() => {
    if (resumedInProgress && !hasResumedRef.current && bundleState.status === 'idle') {
      hasResumedRef.current = true
      console.log('Resuming in-progress setUri:', resumedInProgress.bundleId)
      const predictedIds: Record<number, number> = {}
      resumedInProgress.chainIds.forEach(chainId => {
        predictedIds[chainId] = 0
      })
      bundle._initializeBundle(
        resumedInProgress.bundleId,
        resumedInProgress.chainIds,
        predictedIds,
        []
      )
      bundle._setProcessing('resumed')
    }
  }, [resumedInProgress, bundleState.status, bundle])

  // Status polling
  const activeBundleId = bundleState.bundleId || resumedInProgress?.bundleId || null
  const { data: statusData } = useRelayrStatus({
    bundleId: activeBundleId,
    enabled: bundleState.status === 'processing' || (!!resumedInProgress && bundleState.status === 'idle'),
    stopOnComplete: true,
  })

  // Update bundle state from polling
  useEffect(() => {
    if (statusData) {
      bundle.updateFromStatus(statusData)
    }
  }, [statusData, bundle])

  // Handle completion
  const hasProcessedCompletionRef = useRef(false)
  useEffect(() => {
    if (bundleState.status === 'completed' && bundleState.bundleId && !hasProcessedCompletionRef.current) {
      hasProcessedCompletionRef.current = true
      console.log('[useOmnichainSetUri] Bundle completed')

      const txHashes: Record<number, string> = {}
      bundleState.chainStates.forEach(cs => {
        if (cs.txHash) {
          txHashes[cs.chainId] = cs.txHash
        }
      })

      // Persist result
      const persistedData: PersistedSetUriResult = {
        bundleId: bundleState.bundleId,
        txHashes,
        timestamp: Date.now(),
      }
      saveSetUriResult(persistedData, deploymentKey)
      setPersistedResult(persistedData)
      setResumedInProgress(null)

      onSuccessRef.current?.(bundleState.bundleId, txHashes)
    }
    if (bundleState.status === 'idle') {
      hasProcessedCompletionRef.current = false
    }
  }, [bundleState.status, bundleState.bundleId, bundleState.chainStates, deploymentKey])

  // Handle errors
  useEffect(() => {
    if (bundleState.status === 'failed' && bundleState.error) {
      onErrorRef.current?.(new Error(bundleState.error))
    }
  }, [bundleState.status, bundleState.error])

  /**
   * Update project URI on all specified chains.
   * Fetches the controller address from JBDirectory.controllerOf for each chain.
   */
  const setUri = useCallback(async (params: OmnichainSetUriParams) => {
    const { chainProjectMappings, uri, forceSelfCustody = false } = params

    // Clear any previous state
    clearSetUriResult(deploymentKey)
    setPersistedResult(null)

    const useServerSigning = isManagedMode && !forceSelfCustody
    const signerAddress = useServerSigning ? managedAddress : connectedAddress

    if (!signerAddress) {
      bundle._setError('No wallet address available')
      return
    }

    bundle._setCreating()

    try {
      // Fetch controller address for each chain from JBDirectory
      console.log('Fetching controller addresses for each chain...')
      const mappingsWithControllers: ChainProjectMapping[] = await Promise.all(
        chainProjectMappings.map(async ({ chainId, projectId }) => {
          const viemChain = VIEM_CHAINS[chainId as SupportedChainId]
          if (!viemChain) {
            throw new Error(`Unsupported chain ID: ${chainId}`)
          }

          const rpcUrls = RPC_ENDPOINTS[chainId]
          if (!rpcUrls || rpcUrls.length === 0) {
            throw new Error(`No RPC endpoint configured for chain ${chainId}`)
          }

          // Use fallback transport with all RPCs to handle timeouts
          const publicClient = createPublicClient({
            chain: viemChain,
            transport: fallback(rpcUrls.map(url => http(url))),
          }) as PublicClient

          const controller = await getProjectController(
            publicClient,
            BigInt(projectId)
          )

          console.log(`Chain ${chainId}: Project ${projectId} uses controller ${controller}`)

          return {
            chainId,
            projectId,
            controller,
          }
        })
      )

      // Build transactions for all chains with their respective controllers
      const txs = buildOmnichainSetUriTransactions({
        chainProjectMappings: mappingsWithControllers,
        uri,
      })

      const transactions = txs.map(tx => ({
        chain: tx.chainId,
        target: tx.to,
        data: tx.data,
        value: tx.value,
      }))

      const chainIds = chainProjectMappings.map(m => m.chainId)
      let bundleId: string

      if (useServerSigning) {
        // Server-side signing
        console.log('=== SERVER SIGNING MODE (setUri) ===')
        console.log(`Submitting ${transactions.length} transaction(s) for chains: ${chainIds.join(', ')}`)

        const serverTransactions = transactions.map(tx => ({
          chainId: tx.chain,
          target: tx.target,
          data: tx.data,
          value: tx.value,
        }))

        const result = await createManagedRelayrBundle(serverTransactions, signerAddress)
        bundleId = result.bundleId

        console.log('Server created bundle:', bundleId)
      } else {
        // Client-side ERC-2771 signing
        console.log('=== SELF-CUSTODY: Client-side ERC-2771 signing (setUri) ===')
        console.log(`Signing ${transactions.length} transaction(s) for chains: ${chainIds.join(', ')}`)

        setIsSigning(true)
        const wrappedTransactions: Array<{ chain: number; target: string; data: string; value: string }> = []

        for (const tx of transactions) {
          setSigningChainId(tx.chain)
          console.log(`Requesting signature for chain ${tx.chain}...`)

          const publicClient = config.getClient({ chainId: tx.chain })

          const forwarderContract = getContract({
            address: ERC2771_FORWARDER_ADDRESS,
            abi: ERC2771_FORWARDER_ABI,
            client: publicClient,
          })

          const nonce = await forwarderContract.read.nonces([signerAddress as Address])
          const deadline = Math.floor(Date.now() / 1000) + ERC2771_DEADLINE_DURATION_SECONDS

          const messageData = {
            from: signerAddress as Address,
            to: tx.target as Address,
            value: BigInt(tx.value || '0'),
            gas: BigInt(500000), // Conservative gas estimate for setUri
            nonce,
            deadline,
            data: tx.data as Hex,
          }

          const typedData = {
            domain: {
              name: 'Juicebox',
              chainId: tx.chain,
              verifyingContract: ERC2771_FORWARDER_ADDRESS,
              version: '1',
            },
            primaryType: 'ForwardRequest' as const,
            types: FORWARD_REQUEST_TYPES,
            message: messageData,
          }

          const signature = await signTypedDataAsync(typedData)
          console.log(`Signature obtained for chain ${tx.chain}`)

          const executeData = encodeFunctionData({
            abi: ERC2771_FORWARDER_ABI,
            functionName: 'execute',
            args: [{
              from: messageData.from,
              to: messageData.to,
              value: messageData.value,
              gas: messageData.gas,
              deadline: messageData.deadline,
              data: messageData.data,
              signature,
            }],
          })

          wrappedTransactions.push({
            chain: tx.chain,
            target: ERC2771_FORWARDER_ADDRESS,
            data: executeData,
            value: tx.value,
          })
        }

        setIsSigning(false)
        setSigningChainId(null)
        console.log('=== ERC-2771 SIGNING COMPLETE ===')

        const bundleRequest = {
          app_id: RELAYR_APP_ID,
          transactions: wrappedTransactions,
          perform_simulation: true,
          virtual_nonce_mode: 'Disabled' as const,
        }

        const bundleResponse = await createBalanceBundle(bundleRequest)
        bundleId = bundleResponse.bundle_uuid
      }

      // Save in-progress state
      saveInProgressSetUri({
        bundleId,
        chainIds,
        timestamp: Date.now(),
      }, deploymentKey)

      // Initialize bundle state
      const projectIds: Record<number, number> = {}
      chainProjectMappings.forEach(m => {
        projectIds[m.chainId] = typeof m.projectId === 'bigint' ? Number(m.projectId) : m.projectId
      })

      bundle._initializeBundle(
        bundleId,
        chainIds,
        projectIds,
        []
      )

      bundle._setProcessing('sponsored')
    } catch (err) {
      setIsSigning(false)
      setSigningChainId(null)
      const errorMessage = err instanceof Error ? err.message : 'Failed to update URI'
      bundle._setError(errorMessage)
      onErrorRef.current?.(err instanceof Error ? err : new Error(errorMessage))
    }
  }, [isManagedMode, managedAddress, connectedAddress, bundle, config, signTypedDataAsync, deploymentKey])

  const reset = useCallback(() => {
    resetBundle()
    setIsSigning(false)
    setSigningChainId(null)
    clearSetUriResult(deploymentKey)
    setPersistedResult(null)
    setResumedInProgress(null)
    hasResumedRef.current = false
  }, [resetBundle, deploymentKey])

  const isUpdating = bundleState.status === 'creating' || bundleState.status === 'processing' ||
    (resumedInProgress !== null && bundleState.status === 'idle' && !persistedResult)

  const isComplete = bundleState.status === 'completed' || (bundleState.status === 'idle' && persistedResult !== null)

  return useMemo(() => ({
    setUri,
    bundleState,
    isUpdating,
    isSigning,
    signingChainId,
    isComplete,
    hasError: bundleState.status === 'failed' || bundleState.status === 'partial',
    reset,
  }), [setUri, bundleState, isUpdating, isSigning, signingChainId, isComplete, reset])
}
