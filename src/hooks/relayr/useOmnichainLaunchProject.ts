import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAccount, useConfig, useSignTypedData } from 'wagmi'
import { encodeFunctionData, getContract, type Address, type Hex } from 'viem'
import { useManagedWallet, createManagedRelayrBundle } from '../useManagedWallet'
import {
  createBalanceBundle,
  buildOmnichainLaunchProjectTransactions,
  getBundleStatus,
  type JBLaunchProjectRequest,
  type JBRulesetConfig,
  type JBTerminalConfig,
  type JBSuckerDeploymentConfig,
} from '../../services/relayr'
import { getProjectIdsFromReceipts } from '../../services/bendystraw'
import { buildOmnichainLaunchTransactions, type ChainConfigOverride } from '../../services/omnichainDeployer'
import { useRelayrBundle } from './useRelayrBundle'
import { useRelayrStatus } from './useRelayrStatus'
import type { UseOmnichainTransactionOptions, BundleState } from './types'
import {
  ERC2771_FORWARDER_ADDRESS,
  ERC2771_FORWARDER_ABI,
  FORWARD_REQUEST_TYPES,
} from '../../constants/abis'

// Relayr app ID for sponsored bundles
const RELAYR_APP_ID = import.meta.env.VITE_RELAYR_APP_ID || 'juicy-vision'

export interface OmnichainLaunchProjectParams {
  chainIds: number[]
  owner: string
  projectUri: string                    // IPFS CID for project metadata
  rulesetConfigurations: JBRulesetConfig[]
  terminalConfigurations: JBTerminalConfig[]  // Default terminal configs
  memo: string
  suckerDeploymentConfiguration?: JBSuckerDeploymentConfig  // Optional: deploy suckers atomically
  chainConfigs?: ChainConfigOverride[]  // Per-chain overrides (e.g., different USDC addresses)
  forceSelfCustody?: boolean  // Force wallet signing even if managed mode is available
}

export interface UseOmnichainLaunchProjectReturn {
  launch: (params: OmnichainLaunchProjectParams) => Promise<void>
  bundleState: BundleState
  isLaunching: boolean
  isSigning: boolean
  signingChainId: number | null
  isComplete: boolean
  hasError: boolean
  createdProjectIds: Record<number, number>
  persistedTxHashes: Record<number, string> | null  // tx hashes from persisted state (survives reload)
  reset: () => void
}

// 48 hours deadline for signatures
const ERC2771_DEADLINE_DURATION_SECONDS = 48 * 60 * 60

// localStorage keys for persisting deployment state
const DEPLOYMENT_RESULT_KEY = 'juicy-vision:deployment-result'
const DEPLOYMENT_IN_PROGRESS_KEY = 'juicy-vision:deployment-in-progress'

interface PersistedDeploymentResult {
  bundleId: string
  projectIds: Record<number, number>  // chainId -> projectId
  txHashes: Record<number, string>    // chainId -> txHash
  timestamp: number
}

interface PersistedInProgressDeployment {
  bundleId: string
  chainIds: number[]
  timestamp: number
}

function saveDeploymentResult(result: PersistedDeploymentResult): void {
  try {
    localStorage.setItem(DEPLOYMENT_RESULT_KEY, JSON.stringify(result))
    // Clear in-progress when we have a result
    localStorage.removeItem(DEPLOYMENT_IN_PROGRESS_KEY)
  } catch (err) {
    console.warn('Failed to save deployment result to localStorage:', err)
  }
}

function loadDeploymentResult(): PersistedDeploymentResult | null {
  try {
    const stored = localStorage.getItem(DEPLOYMENT_RESULT_KEY)
    if (!stored) return null
    const result = JSON.parse(stored) as PersistedDeploymentResult
    // Expire after 5 minutes - only purpose is to survive page reload during active deployment
    // Not meant to persist across sessions/new chats
    if (Date.now() - result.timestamp > 5 * 60 * 1000) {
      localStorage.removeItem(DEPLOYMENT_RESULT_KEY)
      return null
    }
    return result
  } catch {
    return null
  }
}

function clearDeploymentResult(): void {
  try {
    localStorage.removeItem(DEPLOYMENT_RESULT_KEY)
    localStorage.removeItem(DEPLOYMENT_IN_PROGRESS_KEY)
  } catch {
    // Ignore
  }
}

function saveInProgressDeployment(data: PersistedInProgressDeployment): void {
  try {
    localStorage.setItem(DEPLOYMENT_IN_PROGRESS_KEY, JSON.stringify(data))
  } catch (err) {
    console.warn('Failed to save in-progress deployment to localStorage:', err)
  }
}

function loadInProgressDeployment(): PersistedInProgressDeployment | null {
  try {
    const stored = localStorage.getItem(DEPLOYMENT_IN_PROGRESS_KEY)
    if (!stored) return null
    const data = JSON.parse(stored) as PersistedInProgressDeployment
    // Expire after 1 hour (bundles have limited lifetime)
    if (Date.now() - data.timestamp > 60 * 60 * 1000) {
      localStorage.removeItem(DEPLOYMENT_IN_PROGRESS_KEY)
      return null
    }
    return data
  } catch {
    return null
  }
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

  // Use refs for callbacks to avoid infinite loops when callbacks change
  const onSuccessRef = useRef(onSuccess)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onSuccessRef.current = onSuccess
    onErrorRef.current = onError
  })

  // Get wallet address - works for both passkey (Touch ID) and managed mode users
  const { address: managedAddress, isManagedMode } = useManagedWallet()

  // Wagmi hooks for ERC-2771 signing
  const { address: connectedAddress } = useAccount()
  const config = useConfig()
  const { signTypedDataAsync } = useSignTypedData()

  // Track ERC-2771 signing state
  const [isSigning, setIsSigning] = useState(false)
  const [signingChainId, setSigningChainId] = useState<number | null>(null)

  // Track predicted project IDs from launch response
  const [predictedProjectIds, setPredictedProjectIds] = useState<Record<number, number>>({})
  const [confirmedProjectIds, setConfirmedProjectIds] = useState<Record<number, number>>({})

  // Track persisted completed state (survives page reload)
  const [persistedResult, setPersistedResult] = useState<PersistedDeploymentResult | null>(() => loadDeploymentResult())

  // Track in-progress deployment that needs to be resumed (survives component remount)
  const [resumedInProgress, setResumedInProgress] = useState<PersistedInProgressDeployment | null>(() => loadInProgressDeployment())

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

  // Restore in-progress deployment on mount (if component was unmounted during launch)
  const hasResumedRef = useRef(false)
  useEffect(() => {
    if (resumedInProgress && !hasResumedRef.current && bundleState.status === 'idle') {
      hasResumedRef.current = true
      console.log('Resuming in-progress deployment:', resumedInProgress.bundleId)
      // Initialize bundle state to resume polling
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

  // Status polling - use resumed bundle ID if available
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

  // Call onSuccess when complete and extract actual project IDs from receipts
  // Use ref to track if we've already processed this completion to avoid duplicate calls
  const hasProcessedCompletionRef = useRef(false)
  useEffect(() => {
    if (bundleState.status === 'completed' && bundleState.bundleId && !hasProcessedCompletionRef.current) {
      hasProcessedCompletionRef.current = true
      const txHashes: Record<number, string> = {}
      bundleState.chainStates.forEach(cs => {
        if (cs.txHash) {
          txHashes[cs.chainId] = cs.txHash
        }
      })

      // Extract actual project IDs from transaction receipts
      // This is more reliable than predictions, especially for omnichain deployments
      getProjectIdsFromReceipts(txHashes).then(extractedIds => {
        const finalIds = Object.keys(extractedIds).length > 0 ? extractedIds : predictedProjectIds
        if (Object.keys(extractedIds).length > 0) {
          console.log('Extracted project IDs from receipts:', extractedIds)
        }
        setConfirmedProjectIds(finalIds)

        // Persist to localStorage so it survives page reload
        const persistedData: PersistedDeploymentResult = {
          bundleId: bundleState.bundleId!,
          projectIds: finalIds,
          txHashes,
          timestamp: Date.now(),
        }
        saveDeploymentResult(persistedData)  // Also clears in-progress from localStorage
        setPersistedResult(persistedData)
        setResumedInProgress(null)  // Clear in-progress state
        console.log('Deployment result saved to localStorage:', persistedData)

        onSuccessRef.current?.(bundleState.bundleId!, txHashes)
      }).catch(err => {
        console.error('Failed to extract project IDs:', err)
        const finalIds = predictedProjectIds
        setConfirmedProjectIds(finalIds)

        // Still persist even if extraction failed
        const persistedData: PersistedDeploymentResult = {
          bundleId: bundleState.bundleId!,
          projectIds: finalIds,
          txHashes,
          timestamp: Date.now(),
        }
        saveDeploymentResult(persistedData)  // Also clears in-progress from localStorage
        setPersistedResult(persistedData)
        setResumedInProgress(null)  // Clear in-progress state

        onSuccessRef.current?.(bundleState.bundleId!, txHashes)
      })
    }
    // Reset flag when bundle resets
    if (bundleState.status === 'idle') {
      hasProcessedCompletionRef.current = false
    }
  }, [bundleState.status, bundleState.bundleId, bundleState.chainStates, predictedProjectIds])

  // Call onError when failed
  useEffect(() => {
    if (bundleState.status === 'failed' && bundleState.error) {
      onErrorRef.current?.(new Error(bundleState.error))
    }
  }, [bundleState.status, bundleState.error])

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
      chainConfigs,
      forceSelfCustody = false,
    } = params

    // Clear any persisted state from previous deployments
    clearDeploymentResult()
    setPersistedResult(null)

    // Determine if we should use managed mode
    // Managed mode is used when: in managed mode AND not forced to self-custody
    const useServerSigning = isManagedMode && !forceSelfCustody

    // For managed mode, use managed wallet as owner if not specified
    const projectOwner = owner || (useServerSigning ? managedAddress : undefined)
    if (!projectOwner) {
      bundle._setError('No owner address specified')
      return
    }

    bundle._setCreating()

    try {
      let transactions: Array<{ chain: number; target: string; data: string; value: string }>
      let predictedIds: Record<number, number> = {}

      // For multi-chain deployments, ALWAYS use JBOmnichainDeployer with auto-generated suckers.
      // This ensures cross-chain token bridging is set up correctly.
      // For single-chain, we can use either path (no suckers needed).
      const useOmnichainDeployer = chainIds.length > 1 || suckerDeploymentConfiguration

      if (useOmnichainDeployer) {
        // Use JBOmnichainDeployer.launchProjectFor() - encode calldata locally
        // This creates projects AND deploys suckers atomically
        // Note: buildOmnichainLaunchTransactions auto-generates per-chain sucker configs
        // and applies per-chain terminal configuration overrides
        const txs = buildOmnichainLaunchTransactions({
          chainIds,
          owner: projectOwner as `0x${string}`,
          projectUri,
          rulesetConfigurations,
          terminalConfigurations,
          memo,
          suckerDeploymentConfiguration, // Optional - will be auto-generated if not provided
          chainConfigs, // Per-chain overrides for terminal configs
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
        // Single-chain deployment - use API endpoint (JBController.launchProjectFor)
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

      let bundleId: string

      if (useServerSigning) {
        // === SERVER SIGNING: Server-side ERC-2771 signing ===
        // User's signing key was stored at login - no prompts needed
        // Server handles all signing and bundle creation
        console.log('=== SERVER SIGNING MODE ===')
        console.log(`Submitting ${transactions.length} transaction(s) to server for chains: ${chainIds.join(', ')}`)

        const serverTransactions = transactions.map(tx => ({
          chainId: tx.chain,
          target: tx.target,
          data: tx.data,
          value: tx.value,
        }))

        const result = await createManagedRelayrBundle(serverTransactions, projectOwner)
        bundleId = result.bundleId

        console.log('Server created bundle:', bundleId)
      } else {
        // === SELF-CUSTODY MODE: Client-side ERC-2771 signing ===
        // User signs with their wallet (MetaMask, etc.) for each chain
        console.log('=== SELF-CUSTODY: Client-side ERC-2771 signing ===')
        console.log(`Signing ${transactions.length} transaction(s) for chains: ${chainIds.join(', ')}`)

        setIsSigning(true)
        const wrappedTransactions: Array<{ chain: number; target: string; data: string; value: string }> = []

        for (const tx of transactions) {
          setSigningChainId(tx.chain)
          console.log(`Requesting signature for chain ${tx.chain}...`)

          // Get public client for this chain
          const publicClient = config.getClient({ chainId: tx.chain })

          // Get user's nonce from the TrustedForwarder
          const forwarderContract = getContract({
            address: ERC2771_FORWARDER_ADDRESS,
            abi: ERC2771_FORWARDER_ABI,
            client: publicClient,
          })

          const nonce = await forwarderContract.read.nonces([projectOwner as Address])
          const deadline = Math.floor(Date.now() / 1000) + ERC2771_DEADLINE_DURATION_SECONDS

          // Build the ForwardRequest message
          const messageData = {
            from: projectOwner as Address,
            to: tx.target as Address,
            value: BigInt(tx.value || '0'),
            gas: BigInt(2000000), // Conservative gas estimate
            nonce,
            deadline,
            data: tx.data as Hex,
          }

          // Sign the EIP-712 typed data with wallet
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

          // Encode the execute() call with the signed request
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

        // Debug: Log the exact request being sent to Relayr
        const bundleRequest = {
          app_id: RELAYR_APP_ID,
          transactions: wrappedTransactions.map(tx => ({
            ...tx,
          })),
          perform_simulation: true,
          virtual_nonce_mode: 'Disabled' as const,
        }
        console.log('=== RELAYR BUNDLE REQUEST ===')
        console.log('Full request:', JSON.stringify(bundleRequest, null, 2))
        console.log('Chain IDs:', chainIds)
        console.log('Predicted Project IDs:', predictedIds)
        console.log('Transactions (via TrustedForwarder):')
        wrappedTransactions.forEach((tx, i) => {
          console.log(`  [${i}] Chain ${tx.chain}:`)
          console.log(`      Target: ${tx.target} (TrustedForwarder)`)
          console.log(`      Value: ${tx.value}`)
          console.log(`      Data: ${tx.data.slice(0, 66)}...`)
        })
        console.log('=============================')

        // Create balance-sponsored bundle (admin pays gas)
        const bundleResponse = await createBalanceBundle(bundleRequest)
        bundleId = bundleResponse.bundle_uuid
      }

      // Save in-progress deployment to localStorage (survives component remount)
      saveInProgressDeployment({
        bundleId,
        chainIds,
        timestamp: Date.now(),
      })
      console.log('Saved in-progress deployment:', bundleId)

      // Initialize bundle state with predicted project IDs
      bundle._initializeBundle(
        bundleId,
        chainIds,
        predictedIds,
        [],  // No payment options - admin sponsored
      )

      // Start processing immediately (sponsored)
      bundle._setProcessing('sponsored')
    } catch (err) {
      setIsSigning(false)
      setSigningChainId(null)
      const errorMessage = err instanceof Error ? err.message : 'Failed to launch project'
      bundle._setError(errorMessage)
      onErrorRef.current?.(err instanceof Error ? err : new Error(errorMessage))
    }
  }, [isManagedMode, managedAddress, bundle, config, signTypedDataAsync])

  const reset = useCallback(() => {
    resetBundle()
    setPredictedProjectIds({})
    setConfirmedProjectIds({})
    setIsSigning(false)
    setSigningChainId(null)
    // Clear persisted state
    clearDeploymentResult()
    setPersistedResult(null)
    setResumedInProgress(null)
    hasResumedRef.current = false
  }, [resetBundle])

  // Consider launching if bundle is processing OR if we're resuming an in-progress deployment
  const isLaunching = bundleState.status === 'creating' || bundleState.status === 'processing' ||
    (resumedInProgress !== null && bundleState.status === 'idle' && !persistedResult)

  // Merge predicted, confirmed, and persisted IDs (persisted takes precedence on page reload)
  const createdProjectIds = useMemo(() => {
    // If we have persisted result and bundle is idle (page was reloaded), use persisted
    if (persistedResult && bundleState.status === 'idle') {
      return persistedResult.projectIds
    }
    // Otherwise use current session's data
    return {
      ...predictedProjectIds,
      ...confirmedProjectIds,
    }
  }, [predictedProjectIds, confirmedProjectIds, persistedResult, bundleState.status])

  // Consider complete if bundle is completed OR if we have persisted result from a previous deployment
  const isComplete = bundleState.status === 'completed' || (bundleState.status === 'idle' && persistedResult !== null)

  // Get tx hashes from persisted state if available
  const persistedTxHashes = persistedResult?.txHashes ?? null

  return useMemo(() => ({
    launch,
    bundleState,
    isLaunching,
    isSigning,
    signingChainId,
    isComplete,
    hasError: bundleState.status === 'failed' || bundleState.status === 'partial',
    createdProjectIds,
    persistedTxHashes,
    reset,
  }), [launch, bundleState, isLaunching, isSigning, signingChainId, isComplete, createdProjectIds, persistedTxHashes, reset])
}
