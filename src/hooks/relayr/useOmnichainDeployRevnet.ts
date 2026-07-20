import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isAddress, keccak256, toBytes } from 'viem'
import { useAuthStore } from '../../stores'
import { useManagedWallet, createManagedRelayrBundle, type RelayrTransaction } from '../useManagedWallet'
import { assertTransactionAccountUnchanged } from '../useReviewedTransactionAccount'
import {
  buildOmnichainDeployRevnetTransactions,
  type JBDeployRevnetRequest,
  type REVStageConfig,
  type REVSuckerDeploymentConfig,
  type REVChainConfigOverride,
  type JBTerminalConfig,
} from '../../services/relayr'
import type { JBDeployTiersHookConfig } from '../../services/omnichainDeployer'
import { fetchProjectCreationFee } from '../../services/omnichainDeployer'
import { getProjectIdsFromReceipts } from '../../services/bendystraw'
import { REV_DEPLOYER } from '../../constants'
import { getSafetyPublicClient } from '../../utils/transactionSafety'
import { useRelayrBundle } from './useRelayrBundle'
import { useRelayrStatus } from './useRelayrStatus'
import type { JBSuckerBridge } from '../../utils/suckerConfig'
import type { UseOmnichainTransactionOptions, BundleState } from './types'

export interface OmnichainDeployRevnetParams {
  chainIds: number[]
  stageConfigurations: REVStageConfig[]
  splitOperator: string                 // Address that receives operator split
  name: string
  ticker: string                        // ERC-20 symbol for the revnet token
  tagline: string
  projectUri: string                    // Pinned project metadata URI
  terminalConfigurations?: JBTerminalConfig[]  // Default terminal configs (ETH if not specified)
  chainConfigs?: REVChainConfigOverride[]      // Per-chain overrides for ERC20 tokens
  /** Include cross-chain suckers in the atomic revnet deployment. */
  configureSuckers?: boolean
  /** Bridge infrastructure for auto-generated suckers ("ccip" default). */
  suckerBridge?: JBSuckerBridge
  suckerDeploymentConfiguration?: REVSuckerDeploymentConfig
  /** When set, deploys a 721 tiers hook (NFT shop) atomically with the revnet. */
  deployTiersHookConfig?: JBDeployTiersHookConfig
}

export interface UseOmnichainDeployRevnetReturn {
  deploy: (params: OmnichainDeployRevnetParams) => Promise<void>
  bundleState: BundleState
  isDeploying: boolean
  isComplete: boolean
  hasError: boolean
  createdProjectIds: Record<number, number>
  predictedTokenAddress: string | null
  persistedTxHashes: Record<number, string> | null
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

const REVNET_RESULT_PREFIX = 'juicy-vision:revnet-result:'
const REVNET_IN_PROGRESS_PREFIX = 'juicy-vision:revnet-in-progress:'

interface PersistedRevnetResult {
  bundleId: string
  projectIds: Record<number, number>
  txHashes: Record<number, string>
  predictedTokenAddress: string | null
  timestamp: number
}

interface PersistedRevnetInProgress {
  bundleId: string
  chainIds: number[]
  predictedProjectIds: Record<number, number>
  predictedTokenAddress: string | null
  timestamp: number
}

function resultKey(deploymentKey?: string): string {
  return `${REVNET_RESULT_PREFIX}${deploymentKey || 'default'}`
}

function inProgressKey(deploymentKey?: string): string {
  return `${REVNET_IN_PROGRESS_PREFIX}${deploymentKey || 'default'}`
}

function loadPersistedRevnetResult(deploymentKey?: string): PersistedRevnetResult | null {
  try {
    const stored = localStorage.getItem(resultKey(deploymentKey))
    return stored ? JSON.parse(stored) as PersistedRevnetResult : null
  } catch {
    return null
  }
}

function savePersistedRevnetResult(
  result: PersistedRevnetResult,
  deploymentKey?: string,
): void {
  try {
    localStorage.setItem(resultKey(deploymentKey), JSON.stringify(result))
    localStorage.removeItem(inProgressKey(deploymentKey))
  } catch (error) {
    console.warn('Failed to persist revnet result:', error)
  }
}

function loadPersistedRevnetInProgress(deploymentKey?: string): PersistedRevnetInProgress | null {
  try {
    const key = inProgressKey(deploymentKey)
    const stored = localStorage.getItem(key)
    if (!stored) return null
    const data = JSON.parse(stored) as PersistedRevnetInProgress
    if (Date.now() - data.timestamp > 60 * 60 * 1000) {
      localStorage.removeItem(key)
      return null
    }
    return data
  } catch {
    return null
  }
}

function savePersistedRevnetInProgress(
  result: PersistedRevnetInProgress,
  deploymentKey?: string,
): void {
  try {
    localStorage.setItem(inProgressKey(deploymentKey), JSON.stringify(result))
  } catch (error) {
    console.warn('Failed to persist in-progress revnet:', error)
  }
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
 *     splitPercent: 2000,       // 20% to operator
 *     initialIssuance: '1000000000000000000000000',
 *     issuanceDecayFrequency: 86400 * 7,  // Weekly
 *     issuanceDecayPercent: 50000000,     // 5% decay
 *     cashOutTaxRate: 1000,               // 10% exit tax
 *     extraMetadata: 0,
 *   }],
 *   splitOperator: '0x...',
 *   name: 'My Revnet',
 *   ticker: 'REV',
 *   tagline: 'A revenue network',
 *   projectUri: 'ipfs://...',
 * })
 */
export function useOmnichainDeployRevnet(
  options: UseOmnichainTransactionOptions = {}
): UseOmnichainDeployRevnetReturn {
  const { onSuccess, onError, deploymentKey } = options

  // Auth state
  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()
  const { address: managedAddress } = useManagedWallet()
  const latestManagedAddress = useRef(managedAddress)
  latestManagedAddress.current = managedAddress

  // Track confirmed project IDs and the predicted token address.
  const [confirmedProjectIds, setConfirmedProjectIds] = useState<Record<number, number>>({})
  const [predictedTokenAddress, setPredictedTokenAddress] = useState<string | null>(null)
  const [persistedResult, setPersistedResult] = useState<PersistedRevnetResult | null>(
    () => loadPersistedRevnetResult(deploymentKey),
  )
  const [resumedInProgress, setResumedInProgress] = useState<PersistedRevnetInProgress | null>(
    () => loadPersistedRevnetInProgress(deploymentKey),
  )

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

  const hasResumedRef = useRef(false)
  const hasProcessedCompletionRef = useRef(false)
  const deploymentStartedRef = useRef(!!persistedResult || !!resumedInProgress)
  useEffect(() => {
    const result = loadPersistedRevnetResult(deploymentKey)
    const inProgress = loadPersistedRevnetInProgress(deploymentKey)
    setPersistedResult(result)
    setResumedInProgress(inProgress)
    setConfirmedProjectIds(result?.projectIds || {})
    setPredictedTokenAddress(result?.predictedTokenAddress ?? inProgress?.predictedTokenAddress ?? null)
    hasResumedRef.current = false
    hasProcessedCompletionRef.current = false
    deploymentStartedRef.current = !!result || !!inProgress
  }, [deploymentKey])

  useEffect(() => {
    if (resumedInProgress && !hasResumedRef.current && bundleState.status === 'idle') {
      hasResumedRef.current = true
      bundle._initializeBundle(
        resumedInProgress.bundleId,
        resumedInProgress.chainIds,
        resumedInProgress.predictedProjectIds,
        [],
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

  // Call onSuccess when complete and extract actual project IDs from receipts
  useEffect(() => {
    if (
      bundleState.status === 'completed' &&
      bundleState.bundleId &&
      !hasProcessedCompletionRef.current
    ) {
      hasProcessedCompletionRef.current = true
      const txHashes: Record<number, string> = {}
      bundleState.chainStates.forEach(cs => {
        if (cs.txHash) {
          txHashes[cs.chainId] = cs.txHash
        }
      })

      const persistCompletion = (projectIds: Record<number, number>) => {
        const result: PersistedRevnetResult = {
          bundleId: bundleState.bundleId!,
          projectIds,
          txHashes,
          predictedTokenAddress,
          timestamp: Date.now(),
        }
        savePersistedRevnetResult(result, deploymentKey)
        setPersistedResult(result)
        setResumedInProgress(null)
        setConfirmedProjectIds(projectIds)
        onSuccess?.(bundleState.bundleId!, txHashes)
      }

      getProjectIdsFromReceipts(txHashes)
        .then(persistCompletion)
        .catch(error => {
          console.error('Failed to extract revnet project IDs:', error)
          persistCompletion({})
        })
    }
    if (bundleState.status === 'idle') {
      hasProcessedCompletionRef.current = false
    }
  }, [
    bundleState.status,
    bundleState.bundleId,
    bundleState.chainStates,
    predictedTokenAddress,
    deploymentKey,
    onSuccess,
  ])

  // Call onError when failed
  useEffect(() => {
    if (bundleState.status === 'failed' && bundleState.error) {
      onError?.(new Error(bundleState.error))
    }
  }, [bundleState.status, bundleState.error, onError])

  /**
   * Deploy revnet on all specified chains.
   * Uses balance-sponsored bundle - admin pays all gas.
   *
   * For ERC20-based revnets (e.g., USDC), pass chainConfigs with per-chain
   * terminal configurations to ensure correct token addresses on each chain.
   *
   * IMPORTANT: Do NOT pass suckerDeploymentConfiguration from preview UI.
   * Let buildOmnichainDeployRevnetTransactions auto-generate correct per-chain
   * sucker configs. Preview-generated configs will be the same for all chains!
   */
  const deploy = useCallback(async (params: OmnichainDeployRevnetParams) => {
    const {
      chainIds,
      stageConfigurations,
      splitOperator,
      name,
      ticker,
      tagline,
      projectUri,
      terminalConfigurations,
      chainConfigs,
      configureSuckers,
      suckerDeploymentConfiguration,
      deployTiersHookConfig,
    } = params

    if (!isManagedMode || !managedAddress || !isAddress(managedAddress)) {
      bundle._setError('Revnet deployment requires an active managed account')
      return
    }
    if (!isAddress(splitOperator) || splitOperator.toLowerCase() !== managedAddress.toLowerCase()) {
      bundle._setError('Revnet operator must be the active managed account')
      return
    }
    const operator = managedAddress
    if (chainIds.length === 0 || new Set(chainIds).size !== chainIds.length) {
      bundle._setError('Deployment chains must be a non-empty unique list')
      return
    }
    if (persistedResult) {
      bundle._setError('This revnet deployment is already confirmed')
      return
    }
    if (resumedInProgress) {
      bundle._setError('This revnet deployment is already in progress')
      return
    }
    if (deploymentStartedRef.current) {
      bundle._setError('This revnet deployment has already started')
      return
    }
    deploymentStartedRef.current = true

    let bundleSubmitted = false
    try {
      // Generate deterministic salt for CREATE2
      const salt = generateRevnetSalt(name, operator)

      const creationFeesWei: Record<number, string> = {}
      await Promise.all(chainIds.map(async chainId => {
        creationFeesWei[chainId] = (await fetchProjectCreationFee(chainId)).toString()
      }))

      // Build revnet deployment request
      // Note: buildOmnichainDeployRevnetTransactions will auto-generate per-chain
      // sucker configs if suckerDeploymentConfiguration is not provided
      const deployRequest: JBDeployRevnetRequest = {
        chainIds,
        stageConfigurations,
        splitOperator: operator,
        description: {
          name,
          ticker,
          tagline,
          uri: projectUri,
          salt,
        },
        terminalConfigurations,
        chainConfigs,
        configureSuckers,
        suckerBridge: params.suckerBridge,
        suckerDeploymentConfiguration,
        deployTiersHookConfig,
        creationFeesWei,
      }

      const deployResponse = await buildOmnichainDeployRevnetTransactions(deployRequest)

      // Store predicted values
      setPredictedTokenAddress(
        deployResponse.predictedTokenAddress === '0x0000000000000000000000000000000000000000'
          ? null
          : deployResponse.predictedTokenAddress,
      )

      console.log('=== SERVER SIGNING MODE (deployRevnet) ===')
      console.log(`Smart account routing: ${managedAddress}`)

      // Convert to RelayrTransaction format
      const relayrTransactions: RelayrTransaction[] = deployResponse.transactions.map(tx => ({
        chainId: tx.txData.chainId,
        target: tx.txData.to,
        data: tx.txData.data,
        value: tx.txData.value,
      }))

      const expectedChains = new Set(chainIds)
      if (
        relayrTransactions.length !== expectedChains.size ||
        new Set(relayrTransactions.map(transaction => transaction.chainId)).size !== expectedChains.size
      ) {
        throw new Error('The revnet transaction set does not match the reviewed chains')
      }
      await Promise.all(relayrTransactions.map(async transaction => {
        if (!expectedChains.has(transaction.chainId)) {
          throw new Error(`Unexpected revnet deployment chain: ${transaction.chainId}`)
        }
        if (transaction.target.toLowerCase() !== REV_DEPLOYER.toLowerCase()) {
          throw new Error(`Revnet deployer not recognized: ${transaction.target}`)
        }
        if (transaction.value !== creationFeesWei[transaction.chainId]) {
          throw new Error(`Project creation fee changed on chain ${transaction.chainId}`)
        }
        await getSafetyPublicClient(transaction.chainId).call({
          account: operator,
          to: REV_DEPLOYER,
          data: transaction.data as `0x${string}`,
          value: BigInt(transaction.value),
        })
      }))

      assertTransactionAccountUnchanged(operator, latestManagedAddress.current)
      bundle._setCreating()

      // Use createManagedRelayrBundle with smart account routing
      // This ensures _msgSender() = smart account (project owner), not passkey EOA
      assertTransactionAccountUnchanged(operator, latestManagedAddress.current)
      const result = await createManagedRelayrBundle(
        relayrTransactions,
        operator,  // Project owner (split operator)
        managedAddress ?? undefined,  // Smart account address for routing
        deploymentKey,
      )
      bundleSubmitted = true

      const inProgress: PersistedRevnetInProgress = {
        bundleId: result.bundleId,
        chainIds,
        predictedProjectIds: deployResponse.predictedProjectIds,
        predictedTokenAddress:
          deployResponse.predictedTokenAddress === '0x0000000000000000000000000000000000000000'
            ? null
            : deployResponse.predictedTokenAddress,
        timestamp: Date.now(),
      }
      savePersistedRevnetInProgress(inProgress, deploymentKey)
      setResumedInProgress(inProgress)

      // Initialize bundle state
      bundle._initializeBundle(
        result.bundleId,
        chainIds,
        deployResponse.predictedProjectIds,
        [],  // No payment options - admin sponsored
      )

      // Start processing immediately (sponsored)
      bundle._setProcessing('sponsored')
    } catch (err) {
      if (!bundleSubmitted) deploymentStartedRef.current = false
      const errorMessage = err instanceof Error ? err.message : 'Failed to deploy revnet'
      bundle._setError(errorMessage)
      onError?.(err instanceof Error ? err : new Error(errorMessage))
    }
  }, [
    isManagedMode,
    managedAddress,
    persistedResult,
    resumedInProgress,
    bundle,
    deploymentKey,
    onError,
  ])

  const reset = useCallback(() => {
    resetBundle()
    const result = loadPersistedRevnetResult(deploymentKey)
    const inProgress = loadPersistedRevnetInProgress(deploymentKey)
    setPersistedResult(result)
    setResumedInProgress(inProgress)
    setConfirmedProjectIds(result?.projectIds || {})
    setPredictedTokenAddress(result?.predictedTokenAddress ?? inProgress?.predictedTokenAddress ?? null)
    hasResumedRef.current = false
    hasProcessedCompletionRef.current = false
    deploymentStartedRef.current = !!result || !!inProgress
  }, [resetBundle, deploymentKey])

  const isDeploying = bundleState.status === 'creating' ||
    bundleState.status === 'processing' ||
    !!resumedInProgress

  // Merge predicted and confirmed IDs
  const createdProjectIds = useMemo(() => confirmedProjectIds, [confirmedProjectIds])

  return useMemo(() => ({
    deploy,
    bundleState,
    isDeploying,
    isComplete: bundleState.status === 'completed' || !!persistedResult,
    hasError: !persistedResult && (bundleState.status === 'failed' || bundleState.status === 'partial'),
    createdProjectIds,
    predictedTokenAddress,
    persistedTxHashes: persistedResult?.txHashes || null,
    reset,
  }), [
    deploy,
    bundleState,
    isDeploying,
    persistedResult,
    createdProjectIds,
    predictedTokenAddress,
    reset,
  ])
}
