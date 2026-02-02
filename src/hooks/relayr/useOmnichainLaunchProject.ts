import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAccount, useConfig, useSignTypedData } from 'wagmi'
import { encodeFunctionData, getContract, type Address, type Hex } from 'viem'
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
import { getProjectIdsFromReceipts } from '../../services/bendystraw'
import { buildOmnichainLaunchTransactions, type ChainConfigOverride } from '../../services/omnichainDeployer'
import { signTypedDataWithPasskey } from '../../services/passkeyWallet'
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
  reset: () => void
}

// 48 hours deadline for signatures
const ERC2771_DEADLINE_DURATION_SECONDS = 48 * 60 * 60

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
        if (Object.keys(extractedIds).length > 0) {
          console.log('Extracted project IDs from receipts:', extractedIds)
          setConfirmedProjectIds(extractedIds)
        } else {
          // Fallback to predicted IDs if extraction fails
          setConfirmedProjectIds(predictedProjectIds)
        }
        onSuccessRef.current?.(bundleState.bundleId!, txHashes)
      }).catch(err => {
        console.error('Failed to extract project IDs:', err)
        setConfirmedProjectIds(predictedProjectIds)
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

      // === ERC-2771 META-TRANSACTION SIGNING ===
      // Wrap each transaction with user's signature so _msgSender() returns user's address
      // This is critical for project ownership and future extensibility
      console.log('=== ERC-2771 SIGNING ===')
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

        // Sign the EIP-712 typed data
        // Use passkey signing for managed mode, wagmi for self-custody
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

        let signature: `0x${string}`
        if (isManagedMode) {
          // Managed mode: Use passkey signing (Touch ID / Face ID)
          signature = await signTypedDataWithPasskey(typedData)
        } else {
          // Self-custody: Use wagmi signing (MetaMask, etc.)
          signature = await signTypedDataAsync(typedData)
        }

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
    isSigning,
    signingChainId,
    isComplete: bundleState.status === 'completed',
    hasError: bundleState.status === 'failed' || bundleState.status === 'partial',
    createdProjectIds,
    reset,
  }), [launch, bundleState, isLaunching, isSigning, signingChainId, createdProjectIds, reset])
}
