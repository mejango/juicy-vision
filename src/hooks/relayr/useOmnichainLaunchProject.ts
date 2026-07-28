import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAccount, useConfig, useSignTypedData, useSwitchChain } from 'wagmi'
import { encodeFunctionData, getContract, isAddress, type Address, type Hex } from 'viem'
import { useManagedWallet, createManagedRelayrBundle } from '../useManagedWallet'
import { assertTransactionAccountUnchanged } from '../useReviewedTransactionAccount'
import {
  createReviewedForwarderBundle,
  type JBRulesetConfig,
  type JBTerminalConfig,
  type JBSuckerDeploymentConfig,
} from '../../services/relayr'
import { getProjectIdsFromReceipts } from '../../services/bendystraw'
import {
  buildOmnichainLaunchTransactions,
  buildOmnichainLaunch721Transactions,
  fetchProjectCreationFee,
  type ChainConfigOverride,
  type JBDeployTiersHookConfig,
} from '../../services/omnichainDeployer'
import { estimateForwardRequestGas } from './forwardRequestGas'
import { useRelayrBundle } from './useRelayrBundle'
import { useRelayrStatus } from './useRelayrStatus'
import type { UseOmnichainTransactionOptions, BundleState } from './types'
import type { JBSuckerBridge } from '../../utils/suckerConfig'
import {
  ERC2771_FORWARDER_ADDRESS,
  ERC2771_FORWARDER_ABI,
  FORWARD_REQUEST_TYPES,
} from '../../constants/abis'
import { JB_OMNICHAIN_DEPLOYER } from '../../constants'
import { getSafetyPublicClient } from '../../utils/transactionSafety'
import { requireTransactionReview } from '../../utils/transactionReview'
import { isSafeAppActive } from '../../services/safeApp'
import { useGuardedTx } from '../useGuardedTx'

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
  /** Bridge infrastructure for auto-generated suckers ("ccip" default). */
  suckerBridge?: JBSuckerBridge
  forceSelfCustody?: boolean  // Force wallet signing even if managed mode is available
  /**
   * Optional: deploy a 721 NFT tiers hook WITH the project atomically.
   * When present, the launch always routes through JBOmnichainDeployer's 721
   * launchProjectFor overload (for both single- AND multi-chain), since the
   * backend single-chain path has no 721 support.
   */
  deployTiersHookConfig?: JBDeployTiersHookConfig
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

// Signed forward-request gas when per-chain estimation is unavailable. A full
// launch (project + terminals + suckers + optional 721 hook) runs well past
// 4.5M gas, and the signature-bound cap cannot be raised by the relayer.
const FALLBACK_LAUNCH_FORWARD_GAS = 6_000_000n

// localStorage key prefixes for persisting deployment state (scoped by deploymentKey)
const DEPLOYMENT_RESULT_PREFIX = 'juicy-vision:deployment-result:'
const DEPLOYMENT_IN_PROGRESS_PREFIX = 'juicy-vision:deployment-in-progress:'

interface PersistedDeploymentResult {
  bundleId: string
  projectIds: Record<number, number>  // chainId -> projectId
  txHashes: Record<number, string>    // chainId -> txHash
  timestamp: number
  chatId?: string  // Scopes result to a specific chat
}

interface PersistedInProgressDeployment {
  bundleId: string
  chainIds: number[]
  timestamp: number
}

function getResultKey(deploymentKey: string | undefined): string {
  return deploymentKey ? `${DEPLOYMENT_RESULT_PREFIX}${deploymentKey}` : `${DEPLOYMENT_RESULT_PREFIX}default`
}

function getInProgressKey(deploymentKey: string | undefined): string {
  return deploymentKey ? `${DEPLOYMENT_IN_PROGRESS_PREFIX}${deploymentKey}` : `${DEPLOYMENT_IN_PROGRESS_PREFIX}default`
}

function saveDeploymentResult(result: PersistedDeploymentResult, deploymentKey: string | undefined): void {
  try {
    localStorage.setItem(getResultKey(deploymentKey), JSON.stringify(result))
    // Clear in-progress when we have a result
    localStorage.removeItem(getInProgressKey(deploymentKey))
  } catch (err) {
    console.warn('Failed to save deployment result to localStorage:', err)
  }
}

function loadDeploymentResult(deploymentKey: string | undefined): PersistedDeploymentResult | null {
  try {
    const stored = localStorage.getItem(getResultKey(deploymentKey))
    if (!stored) return null
    return JSON.parse(stored) as PersistedDeploymentResult
  } catch {
    return null
  }
}

function saveInProgressDeployment(data: PersistedInProgressDeployment, deploymentKey: string | undefined): void {
  try {
    localStorage.setItem(getInProgressKey(deploymentKey), JSON.stringify(data))
  } catch (err) {
    console.warn('Failed to save in-progress deployment to localStorage:', err)
  }
}

function loadInProgressDeployment(deploymentKey: string | undefined): PersistedInProgressDeployment | null {
  try {
    const stored = localStorage.getItem(getInProgressKey(deploymentKey))
    if (!stored) return null
    const data = JSON.parse(stored) as PersistedInProgressDeployment
    // Expire after 1 hour (bundles have limited lifetime)
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
  const { onSuccess, onError, deploymentKey, chatId } = options

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
  const { activeAddress: guardedAddress, run: runGuardedTx } = useGuardedTx()
  const latestManagedAddress = useRef(managedAddress)
  const latestConnectedAddress = useRef(connectedAddress)
  latestManagedAddress.current = managedAddress
  latestConnectedAddress.current = connectedAddress
  const config = useConfig()
  const { signTypedDataAsync } = useSignTypedData()
  const { switchChainAsync } = useSwitchChain()

  // Track ERC-2771 signing state
  const [isSigning, setIsSigning] = useState(false)
  const [signingChainId, setSigningChainId] = useState<number | null>(null)

  const [confirmedProjectIds, setConfirmedProjectIds] = useState<Record<number, number>>({})

  // Track persisted completed state (survives page reload) - scoped by deploymentKey
  const [persistedResult, setPersistedResult] = useState<PersistedDeploymentResult | null>(() => loadDeploymentResult(deploymentKey))

  // Track in-progress deployment that needs to be resumed (survives component remount)
  const [resumedInProgress, setResumedInProgress] = useState<PersistedInProgressDeployment | null>(() => loadInProgressDeployment(deploymentKey))

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
    _setDirectCompleted: (chainId: number, projectId: number, txHash: string) => void
    _setError: (error: string) => void
  }
  const { bundleState, reset: resetBundle } = bundle

  // Restore in-progress deployment on mount (if component was unmounted during launch)
  const hasResumedRef = useRef(false)
  useEffect(() => {
    setPersistedResult(loadDeploymentResult(deploymentKey))
    setResumedInProgress(loadInProgressDeployment(deploymentKey))
    hasResumedRef.current = false
  }, [deploymentKey])

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
      console.log('[useOmnichainLaunchProject] Bundle completed, extracting project IDs')
      console.log('[useOmnichainLaunchProject] chainStates:', bundleState.chainStates)
      const txHashes: Record<number, string> = {}
      bundleState.chainStates.forEach(cs => {
        console.log(`[useOmnichainLaunchProject] Chain ${cs.chainId}: txHash=${cs.txHash}, status=${cs.status}`)
        if (cs.txHash) {
          txHashes[cs.chainId] = cs.txHash
        }
      })
      console.log('[useOmnichainLaunchProject] Built txHashes:', txHashes)

      // Extract actual project IDs from transaction receipts
      // Only receipt-decoded IDs are safe to expose as project identifiers.
      getProjectIdsFromReceipts(txHashes).then(extractedIds => {
        if (Object.keys(extractedIds).length > 0) {
          console.log('Extracted project IDs from receipts:', extractedIds)
        }
        setConfirmedProjectIds(extractedIds)

        // Persist to localStorage so it survives page reload
        const persistedData: PersistedDeploymentResult = {
          bundleId: bundleState.bundleId!,
          projectIds: extractedIds,
          txHashes,
          timestamp: Date.now(),
          chatId,
        }
        saveDeploymentResult(persistedData, deploymentKey)  // Also clears in-progress from localStorage
        setPersistedResult(persistedData)
        setResumedInProgress(null)  // Clear in-progress state
        console.log('Deployment result saved to localStorage:', persistedData)

        onSuccessRef.current?.(bundleState.bundleId!, txHashes)
      }).catch(err => {
        console.error('Failed to extract project IDs:', err)
        setConfirmedProjectIds({})

        // Preserve confirmed transaction hashes, but never invent project IDs.
        const persistedData: PersistedDeploymentResult = {
          bundleId: bundleState.bundleId!,
          projectIds: {},
          txHashes,
          timestamp: Date.now(),
          chatId,
        }
        saveDeploymentResult(persistedData, deploymentKey)  // Also clears in-progress from localStorage
        setPersistedResult(persistedData)
        setResumedInProgress(null)  // Clear in-progress state

        onSuccessRef.current?.(bundleState.bundleId!, txHashes)
      })
    }
    // Reset flag when bundle resets
    if (bundleState.status === 'idle') {
      hasProcessedCompletionRef.current = false
    }
  }, [bundleState.status, bundleState.bundleId, bundleState.chainStates, chatId, deploymentKey])

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
      deployTiersHookConfig,
    } = params

    // Determine if we should use managed mode
    // Managed mode is used when: in managed mode AND not forced to self-custody
    const isSingleChain = chainIds.length === 1
    const useServerSigning = isManagedMode && !forceSelfCustody

    if (!isSingleChain && !useServerSigning && isSafeAppActive()) {
      bundle._setError(
        'A Safe cannot authorize Relayr ERC-2771 requests as an EOA. Use a managed account for this Relayr launch, or leave Safe and connect the EOA that will own the project.',
      )
      return
    }

    // For managed mode, use managed wallet as owner if not specified
    const projectOwner = owner || (useServerSigning ? managedAddress : undefined)
    if (!projectOwner || !isAddress(projectOwner)) {
      bundle._setError('No owner address specified')
      return
    }
    const signingOwner = isSingleChain
      ? guardedAddress
      : useServerSigning
        ? managedAddress
        : connectedAddress
    if (!signingOwner || projectOwner.toLowerCase() !== signingOwner.toLowerCase()) {
      bundle._setError('Project owner must match the active signing account')
      return
    }
    const assertSigningOwnerUnchanged = () => assertTransactionAccountUnchanged(
      signingOwner,
      useServerSigning ? latestManagedAddress.current : latestConnectedAddress.current,
    )
    if (chainIds.length === 0 || new Set(chainIds).size !== chainIds.length) {
      bundle._setError('Launch chains must be a non-empty unique list')
      return
    }
    if (persistedResult) {
      bundle._setError('This project launch is already confirmed')
      return
    }
    if (resumedInProgress) {
      bundle._setError('This project launch is already in progress')
      return
    }

    try {
      const predictedIds: Record<number, number> = {}

      // Every launch uses the same validated JBOmnichainDeployer encoder. For
      // one chain it emits an empty sucker configuration; for multiple chains
      // it derives the appropriate atomic sucker configuration.
      const creationFeesWei: Record<number, string> = {}
      await Promise.all(chainIds.map(async chainId => {
        creationFeesWei[chainId] = (await fetchProjectCreationFee(chainId)).toString()
      }))

      const txs = deployTiersHookConfig
        ? buildOmnichainLaunch721Transactions({
            chainIds,
            owner: projectOwner as `0x${string}`,
            projectUri,
            deployTiersHookConfig,
            rulesetConfigurations,
            terminalConfigurations,
            memo,
            suckerDeploymentConfiguration,
            chainConfigs,
            creationFeesWei,
            suckerBridge: params.suckerBridge,
          })
        : buildOmnichainLaunchTransactions({
            chainIds,
            owner: projectOwner as `0x${string}`,
            projectUri,
            rulesetConfigurations,
            terminalConfigurations,
            memo,
            suckerDeploymentConfiguration,
            chainConfigs,
            creationFeesWei,
            suckerBridge: params.suckerBridge,
          })

      const transactions = txs.map(tx => ({
        chain: tx.chainId,
        target: tx.to,
        data: tx.data,
        value: tx.value,
      }))
      chainIds.forEach(chainId => {
        predictedIds[chainId] = 0
      })

      if (
        transactions.length !== chainIds.length ||
        new Set(transactions.map(transaction => transaction.chain)).size !== chainIds.length
      ) {
        throw new Error('The launch transaction set does not match the reviewed chains')
      }
      await Promise.all(transactions.map(async transaction => {
        if (!chainIds.includes(transaction.chain)) {
          throw new Error(`Unexpected project launch chain: ${transaction.chain}`)
        }
        if (transaction.target.toLowerCase() !== JB_OMNICHAIN_DEPLOYER.toLowerCase()) {
          throw new Error(`Project deployer not recognized: ${transaction.target}`)
        }
        if (BigInt(transaction.value) !== BigInt(creationFeesWei[transaction.chain])) {
          throw new Error(`Project creation fee changed on chain ${transaction.chain}`)
        }
        await getSafetyPublicClient(transaction.chain).call({
          account: projectOwner as Address,
          to: JB_OMNICHAIN_DEPLOYER,
          data: transaction.data as Hex,
          value: BigInt(transaction.value),
        })
      }))

      assertSigningOwnerUnchanged()
      // Store predicted project IDs
      bundle._setCreating()

      let bundleId: string

      if (isSingleChain) {
        const transaction = transactions[0]
        if (!transaction) throw new Error('Missing single-chain launch transaction')
        const hash = await runGuardedTx({
          chainId: transaction.chain,
          to: transaction.target as Address,
          data: transaction.data as Hex,
          value: BigInt(transaction.value),
          reverify: async () => {
            assertSigningOwnerUnchanged()
            const freshFee = await fetchProjectCreationFee(transaction.chain)
            if (freshFee !== BigInt(transaction.value)) {
              throw new Error(`Project creation fee changed on chain ${transaction.chain}`)
            }
          },
          review: {
            title: 'Review project launch',
            description: 'Review the exact single-chain project launch before submitting it directly.',
            label: 'Launch project',
            contractName: 'JBOmnichainDeployer',
          },
        })
        bundle._setDirectCompleted(transaction.chain, 0, hash)
        return
      }

      if (useServerSigning) {
        // === SERVER SIGNING: Server-side ERC-2771 signing ===
        // NOTE: For project launches, we do NOT use smart account routing because:
        // 1. The smart account might not be deployed yet (lazy deployment)
        // 2. The project doesn't exist yet - owner is specified in the calldata
        // Smart account routing is only for operations on EXISTING projects
        console.log('=== SERVER SIGNING MODE ===')
        console.log(`Submitting ${transactions.length} transaction(s) to server for chains: ${chainIds.join(', ')}`)

        const serverTransactions = transactions.map(tx => ({
          chainId: tx.chain,
          target: tx.target,
          data: tx.data,
          value: tx.value,
        }))

        // For launches, don't pass smartAccountAddress - the owner is in the calldata
        assertSigningOwnerUnchanged()
        const result = await createManagedRelayrBundle(
          serverTransactions,
          projectOwner,
          // No smart account routing for launches - project doesn't exist yet
          undefined,
          deploymentKey,
        )
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

          // Wallets reject EIP-712 typed data whose domain chainId differs
          // from the active chain — switch before every per-chain signature.
          await switchChainAsync({ chainId: tx.chain })

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
          const gas = await estimateForwardRequestGas({
            chainId: tx.chain,
            account: projectOwner as Address,
            to: tx.target as Address,
            data: tx.data as Hex,
            value: BigInt(tx.value || '0'),
            fallbackGas: FALLBACK_LAUNCH_FORWARD_GAS,
          })

          // Build the ForwardRequest message
          const messageData = {
            from: projectOwner as Address,
            to: tx.target as Address,
            value: BigInt(tx.value || '0'),
            gas,
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

          await requireTransactionReview({
            kind: 'authorization',
            title: `Review Relayr signature on chain ${tx.chain}`,
            description: 'This EIP-712 signature authorizes the Juicebox trusted forwarder to execute the exact project-launch call below. Signing is not execution; Relayr submits and tracks it afterward.',
            confirmLabel: 'Agree & sign Relayr request',
            authorization: {
              type: 'ERC-2771 ForwardRequest',
              ...typedData,
            },
            calls: [{
              chainId: tx.chain,
              from: projectOwner as Address,
              to: tx.target as Address,
              data: tx.data as Hex,
              value: BigInt(tx.value || '0'),
              label: 'Launch project on this destination chain',
              contractName: 'JBOmnichainDeployer',
            }],
          })
          assertSigningOwnerUnchanged()
          const signature = await signTypedDataAsync(typedData)
          assertSigningOwnerUnchanged()
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

        await Promise.all(transactions.map(async transaction => {
          const freshFee = await fetchProjectCreationFee(transaction.chain)
          if (freshFee !== BigInt(transaction.value)) {
            throw new Error(`Project creation fee changed on chain ${transaction.chain}`)
          }
          const publicClient = getSafetyPublicClient(transaction.chain)
          await publicClient.call({
            account: projectOwner as Address,
            to: JB_OMNICHAIN_DEPLOYER,
            data: transaction.data as Hex,
            value: BigInt(transaction.value),
          })
          const wrapped = wrappedTransactions.find(candidate => candidate.chain === transaction.chain)
          if (!wrapped) throw new Error(`Missing signed launch transaction for chain ${transaction.chain}`)
          await publicClient.call({
            account: projectOwner as Address,
            to: ERC2771_FORWARDER_ADDRESS,
            data: wrapped.data as Hex,
            value: BigInt(wrapped.value),
          })
        }))

        const bundleRequest = {
          app_id: RELAYR_APP_ID,
          transactions: wrappedTransactions.map(tx => ({
            ...tx,
          })),
          perform_simulation: true,
          virtual_nonce_mode: 'Disabled' as const,
        }

        // Create balance-sponsored bundle (admin pays gas)
        assertSigningOwnerUnchanged()
        const bundleResponse = await createReviewedForwarderBundle(bundleRequest)
        bundleId = bundleResponse.bundle_uuid
      }

      // Save in-progress deployment to localStorage (survives component remount)
      saveInProgressDeployment({
        bundleId,
        chainIds,
        timestamp: Date.now(),
      }, deploymentKey)
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
  }, [isManagedMode, managedAddress, connectedAddress, guardedAddress, runGuardedTx, bundle, config, signTypedDataAsync, switchChainAsync, persistedResult, resumedInProgress, deploymentKey])

  const reset = useCallback(() => {
    resetBundle()
    setConfirmedProjectIds({})
    setIsSigning(false)
    setSigningChainId(null)
    setPersistedResult(loadDeploymentResult(deploymentKey))
    setResumedInProgress(loadInProgressDeployment(deploymentKey))
    hasResumedRef.current = false
  }, [resetBundle, deploymentKey])

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
    return confirmedProjectIds
  }, [confirmedProjectIds, persistedResult, bundleState.status])

  // A completed result is scoped by deploymentKey. Treat it as authoritative
  // after reload so the same reviewed launch cannot be submitted twice.
  const isComplete = bundleState.status === 'completed' ||
    (bundleState.status === 'idle' && persistedResult !== null)

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
