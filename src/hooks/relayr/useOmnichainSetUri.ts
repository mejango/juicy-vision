import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAccount, useConfig, useSignTypedData } from 'wagmi'
import { encodeFunctionData, getContract, createPublicClient, http, fallback, type Address, type Hex, type PublicClient } from 'viem'
import { useManagedWallet, createManagedRelayrBundle } from '../useManagedWallet'
import { assertTransactionAccountUnchanged } from '../useReviewedTransactionAccount'
import { createReviewedForwarderBundle } from '../../services/relayr'
import {
  buildOmnichainSetUriTransactions,
  encodeSetUriOf,
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
import { getSafetyPublicClient } from '../../utils/transactionSafety'
import { RPC_ENDPOINTS, VIEM_CHAINS, type SupportedChainId } from '../../constants/chains'
import { isIpfsUri } from '../../utils/ipfs'
import { requireTransactionReview } from '../../utils/transactionReview'
import { isSafeAppActive } from '../../services/safeApp'

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
  persistedTxHashes: Record<number, string> | null
  persistedBundleId: string | null
  reset: () => void
}

export function submitManagedSetUriBundle(
  transactions: Array<{ chainId: number; target: string; data: string; value: string }>,
  signerAddress: string,
  managedAddress: string | undefined,
  deploymentKey: string | undefined,
  submit?: typeof createManagedRelayrBundle,
): Promise<{ bundleId: string }> {
  if (submit) return submit(transactions, signerAddress, managedAddress, deploymentKey)
  return createManagedRelayrBundle(transactions, signerAddress, managedAddress, deploymentKey)
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

function clearInProgressSetUri(deploymentKey: string | undefined): void {
  try {
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
 * // IMPORTANT: Omnichain projects have DIFFERENT projectIds per chain!
 * await setUri({
 *   chainProjectMappings: [
 *     { chainId: 1, projectId: 123 },   // Ethereum project ID
 *     { chainId: 10, projectId: 456 },  // Optimism project ID (different!)
 *   ],
 *   uri: 'ipfs://QmNewMetadataCid...',
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
  const latestManagedAddress = useRef(managedAddress)
  const latestConnectedAddress = useRef(connectedAddress)
  latestManagedAddress.current = managedAddress
  latestConnectedAddress.current = connectedAddress
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

  // Keep persisted state scoped to the reviewed operation when a component is reused.
  const hasResumedRef = useRef(false)
  useEffect(() => {
    setPersistedResult(loadSetUriResult(deploymentKey))
    setResumedInProgress(loadInProgressSetUri(deploymentKey))
    hasResumedRef.current = false
  }, [deploymentKey])

  // Restore in-progress on mount.
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

  // Handle errors. A failed bundle may be retried; a confirmed bundle may not.
  useEffect(() => {
    if (bundleState.status === 'failed' || bundleState.status === 'partial') {
      clearInProgressSetUri(deploymentKey)
      setResumedInProgress(null)
      if (bundleState.error) onErrorRef.current?.(new Error(bundleState.error))
    }
  }, [bundleState.status, bundleState.error, deploymentKey])

  /**
   * Update project URI on all specified chains.
   * Fetches the controller address from JBDirectory.controllerOf for each chain.
   */
  const setUri = useCallback(async (params: OmnichainSetUriParams) => {
    const { chainProjectMappings, uri, forceSelfCustody = false } = params

    if (persistedResult) {
      bundle._setError('This metadata update is already confirmed')
      return
    }
    if (resumedInProgress) {
      bundle._setError('This metadata update is already in progress')
      return
    }
    if (
      chainProjectMappings.length === 0 ||
      new Set(chainProjectMappings.map(mapping => mapping.chainId)).size !== chainProjectMappings.length
    ) {
      bundle._setError('Update chains must be a non-empty unique list')
      return
    }
    let hasInvalidProjectId = false
    try {
      hasInvalidProjectId = chainProjectMappings.some(mapping => BigInt(mapping.projectId) <= 0n)
    } catch {
      hasInvalidProjectId = true
    }
    if (hasInvalidProjectId) {
      bundle._setError('Every update must use a valid project ID')
      return
    }

    const useServerSigning = isManagedMode && !forceSelfCustody
    if (!useServerSigning && isSafeAppActive()) {
      bundle._setError(
        'A Safe cannot authorize Relayr ERC-2771 requests as an EOA. Use a managed account for this Relayr update, or submit a single-chain owner action through the Safe proposal flow.',
      )
      return
    }
    const signerAddress = useServerSigning ? managedAddress : connectedAddress

    if (!signerAddress) {
      bundle._setError('No wallet address available')
      return
    }
    const assertSignerUnchanged = () => assertTransactionAccountUnchanged(
      signerAddress,
      useServerSigning ? latestManagedAddress.current : latestConnectedAddress.current,
    )

    try {
      if (!isIpfsUri(uri, false)) {
        throw new Error('Project metadata URI must be a valid IPFS CID')
      }
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
          await publicClient.call({
            account: signerAddress as Address,
            to: controller,
            data: encodeSetUriOf({ projectId, uri }),
          })

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

      const chainIds = mappingsWithControllers.map(m => m.chainId)
      let bundleId: string

      // Discovery and exact simulations have passed on every chain. Only now
      // expose an execution state or request authorization from the user.
      assertSignerUnchanged()
      bundle._setCreating()

      if (useServerSigning) {
        // Server-side signing with smart account routing via ERC-2771
        // Transactions are wrapped through SmartAccount.execute() via the trusted forwarder
        // so that _msgSender() inside the target contract = smart account = project owner
        console.log('=== SERVER SIGNING MODE (setUri) ===')
        console.log(`Submitting ${transactions.length} transaction(s) for chains: ${chainIds.join(', ')}`)
        console.log(`Smart account routing via ERC-2771: ${managedAddress}`)

        const serverTransactions = transactions.map(tx => ({
          chainId: tx.chain,
          target: tx.target,
          data: tx.data,
          value: tx.value,
        }))

        // Pass smart account address for ERC-2771 routing through ForwardableSimpleAccount
        // The forwarder calls SmartAccount.execute(), _msgSender() = reserves EOA = owner
        assertSignerUnchanged()
        const result = await submitManagedSetUriBundle(
          serverTransactions,
          signerAddress,
          managedAddress ?? undefined,  // Smart account address for routing
          deploymentKey,
        )
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

          await requireTransactionReview({
            kind: 'authorization',
            title: `Review Relayr signature on chain ${tx.chain}`,
            description: 'This EIP-712 signature authorizes the Juicebox trusted forwarder to execute the exact project metadata call below. Signing is not execution; Relayr submits and tracks it afterward.',
            confirmLabel: 'Agree & sign Relayr request',
            authorization: {
              type: 'ERC-2771 ForwardRequest',
              ...typedData,
            },
            calls: [{
              chainId: tx.chain,
              from: signerAddress as Address,
              to: tx.target as Address,
              data: tx.data as Hex,
              value: BigInt(tx.value || '0'),
              label: 'Set project metadata on this destination chain',
              contractName: 'JBController',
            }],
          })
          assertSignerUnchanged()
          const signature = await signTypedDataAsync(typedData)
          assertSignerUnchanged()
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

        await Promise.all(mappingsWithControllers.map(async mapping => {
          const publicClient = getSafetyPublicClient(mapping.chainId)
          const currentController = await getProjectController(
            publicClient,
            BigInt(mapping.projectId),
          )
          if (currentController.toLowerCase() !== mapping.controller?.toLowerCase()) {
            throw new Error(`The project controller changed on chain ${mapping.chainId}`)
          }
          const transaction = transactions.find(candidate => candidate.chain === mapping.chainId)
          const wrapped = wrappedTransactions.find(candidate => candidate.chain === mapping.chainId)
          if (!transaction || !wrapped) {
            throw new Error(`Missing signed metadata transaction for chain ${mapping.chainId}`)
          }
          await publicClient.call({
            account: signerAddress as Address,
            to: currentController,
            data: transaction.data as Hex,
          })
          await publicClient.call({
            account: signerAddress as Address,
            to: ERC2771_FORWARDER_ADDRESS,
            data: wrapped.data as Hex,
            value: BigInt(wrapped.value),
          })
        }))

        const bundleRequest = {
          app_id: RELAYR_APP_ID,
          transactions: wrappedTransactions,
          perform_simulation: true,
          virtual_nonce_mode: 'Disabled' as const,
        }

        assertSignerUnchanged()
        const bundleResponse = await createReviewedForwarderBundle(bundleRequest)
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
      mappingsWithControllers.forEach(m => {
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
  }, [
    isManagedMode,
    managedAddress,
    connectedAddress,
    bundle,
    config,
    signTypedDataAsync,
    deploymentKey,
    persistedResult,
    resumedInProgress,
  ])

  const reset = useCallback(() => {
    resetBundle()
    setIsSigning(false)
    setSigningChainId(null)
    setPersistedResult(loadSetUriResult(deploymentKey))
    setResumedInProgress(loadInProgressSetUri(deploymentKey))
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
    persistedTxHashes: persistedResult?.txHashes ?? null,
    persistedBundleId: persistedResult?.bundleId ?? null,
    reset,
  }), [setUri, bundleState, isUpdating, isSigning, signingChainId, isComplete, persistedResult, reset])
}
