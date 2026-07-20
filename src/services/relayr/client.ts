import { useSettingsStore } from '../../stores'
import {
  extractChainTokenAddresses,
  perChainSuckerConfig,
  type JBDeployTiersHookConfig,
} from '../omnichainDeployer'
import { RELAYR_APP_ID } from '../../config/environment'
import { decodeFunctionData, isAddress, zeroAddress, type Hex } from 'viem'
import {
  JB_CONTRACTS,
  JB_OMNICHAIN_DEPLOYER,
  USDC_ADDRESSES,
  VIEM_CHAINS,
  type SupportedChainId,
} from '../../constants'
import {
  ERC2771_FORWARDER_ABI,
  ERC2771_FORWARDER_ADDRESS,
  JB_CONTROLLER_ABI,
  JB_OMNICHAIN_DEPLOYER_ABI,
} from '../../constants/abis'
import {
  encodeQueueRulesetTransaction,
  encodeDeployERC20Transaction,
  encodeSendReservesTransaction,
  encodeDeployRevnetTransaction,
} from './encoder'
import type {
  JBRulesetConfig,
  JBTerminalConfig,
  JBTransactionData,
  REVStageConfig,
} from './encoder'
import { NATIVE_TOKEN } from '../../constants'
import {
  createSalt,
  shouldConfigureSuckers,
  type JBSuckerBridge,
} from '../../utils/suckerConfig'
import { requireNonzeroBytes32 } from '../../utils/erc20Safety'
import { getProjectController } from '../../utils/paymentTerminal'
import { getSafetyPublicClient } from '../../utils/transactionSafety'

// Shared JB config/transaction types live in the encoder module.
export type {
  JBRulesetMetadataConfig,
  JBSplitConfig,
  JBSplitGroupConfig,
  JBCurrencyAmountConfig,
  JBFundAccessLimitGroupConfig,
  JBRulesetConfig,
  JBQueueRulesetRequest,
  JBTransactionData,
  JBTransactionResponse,
  JBTerminalConfig,
  JBSuckerTokenMapping,
  JBSuckerDeployerConfig,
  JBSuckerDeploymentConfig,
  REVStageConfig,
} from './encoder'

function getEndpoint(): string {
  return useSettingsStore.getState().relayrEndpoint
}

function getApiKey(): string {
  return useSettingsStore.getState().relayrApiKey
}

async function fetchApi<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const endpoint = getEndpoint()
  const apiKey = getApiKey()
  const response = await fetch(`${endpoint}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
      ...options.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }))
    throw new Error(error.message || `HTTP ${response.status}`)
  }

  return response.json()
}

// ============================================================================
// Balance-Based Gas Sponsorship
// ============================================================================
// Fund a pooled balance to sponsor gas for users across all EVM chains.
// Organization pays gas from balance instead of users needing native tokens.

export interface BalanceBundleTransaction {
  chain: number           // Chain ID
  target: string          // Destination address (0x...)
  data?: string           // Calldata (0x...)
  value?: string          // ETH value in wei
  gas_limit?: number      // Optional gas limit override
  virtual_nonce?: number  // For ordering within bundle
}

export interface BalanceBundleRequest {
  app_id: string                        // UUID identifying the app
  transactions: BalanceBundleTransaction[]
  perform_simulation?: boolean          // Default: true
  virtual_nonce_mode?: 'Disabled' | 'ChainIndependent' | 'MultiChain'
}

export interface BalanceBundleResponse {
  bundle_uuid: string
  tx_uuids: string[]
}

/**
 * Create a gas-sponsored bundle via organization balance.
 * Users don't need native tokens - organization pays from pooled balance.
 */
async function createBalanceBundle(request: BalanceBundleRequest): Promise<BalanceBundleResponse> {
  const endpoint = getEndpoint()
  const apiKey = getApiKey()
  const url = `${endpoint}/v1/bundle/balance`
  const body = JSON.stringify(request)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
    body,
  })

  const responseText = await response.text()

  if (!response.ok) {
    let error: { message?: string; reason?: string; error?: string; details?: unknown } = { message: 'Request failed' }
    try {
      error = JSON.parse(responseText)
    } catch {
      // Keep default error
    }
    throw new Error(error.reason || error.error || error.message || `HTTP ${response.status}`)
  }

  return JSON.parse(responseText)
}

/** Submit only the two reviewed self-custody forwarder operations used by Juicy Vision. */
export async function createReviewedForwarderBundle(
  request: BalanceBundleRequest,
): Promise<BalanceBundleResponse> {
  if (request.app_id !== RELAYR_APP_ID) throw new Error('Relayr app is not recognized')
  if (request.perform_simulation === false) throw new Error('Relayr simulation is required')
  if (request.virtual_nonce_mode !== 'Disabled') {
    throw new Error('Relayr nonce mode is not recognized')
  }
  if (request.transactions.length === 0 || request.transactions.length > 8) {
    throw new Error('Relayr bundle must contain 1-8 reviewed transactions')
  }
  const chains = new Set<number>()
  let signer: string | null = null
  const now = BigInt(Math.floor(Date.now() / 1000))

  for (const transaction of request.transactions) {
    if (chains.has(transaction.chain)) throw new Error('Only one reviewed transaction per chain is allowed')
    chains.add(transaction.chain)
    if (!VIEM_CHAINS[transaction.chain as SupportedChainId]) {
      throw new Error(`Unsupported Relayr chain: ${transaction.chain}`)
    }
    if (transaction.target.toLowerCase() !== ERC2771_FORWARDER_ADDRESS.toLowerCase()) {
      throw new Error(`Forwarder not recognized: ${transaction.target}`)
    }
    if (!transaction.data) throw new Error('Signed forwarder calldata is required')
    const decoded = decodeFunctionData({
      abi: ERC2771_FORWARDER_ABI,
      data: transaction.data as Hex,
    })
    if (decoded.functionName !== 'execute' || !decoded.args) {
      throw new Error('Forwarder operation is not recognized')
    }
    const forwarded = decoded.args[0]
    if (!isAddress(forwarded.from) || forwarded.from.toLowerCase() === zeroAddress) {
      throw new Error('Forwarder signer is invalid')
    }
    if (signer && forwarded.from.toLowerCase() !== signer) {
      throw new Error('Every forwarded transaction must use the same signer')
    }
    signer = forwarded.from.toLowerCase()
    const outerValue = BigInt(transaction.value || '0')
    if (outerValue < 0n || forwarded.value !== outerValue) {
      throw new Error('Forwarder value does not match the reviewed transaction')
    }
    if (forwarded.gas <= 0n || forwarded.gas > 5_000_000n) {
      throw new Error('Forwarder gas limit is not recognized')
    }
    if (BigInt(forwarded.deadline) <= now) throw new Error('Forwarder signature expired')
    if (!/^0x[0-9a-fA-F]+$/.test(forwarded.signature) || forwarded.signature === '0x') {
      throw new Error('Forwarder signature is missing')
    }

    const target = forwarded.to.toLowerCase()
    if (target === JB_OMNICHAIN_DEPLOYER.toLowerCase()) {
      const inner = decodeFunctionData({
        abi: JB_OMNICHAIN_DEPLOYER_ABI,
        data: forwarded.data,
      })
      if (inner.functionName !== 'launchProjectFor') {
        throw new Error('Forwarded deployment operation is not recognized')
      }
    } else if (target === JB_CONTRACTS.JBController.toLowerCase()) {
      if (forwarded.value !== 0n) throw new Error('Metadata updates cannot send native currency')
      const inner = decodeFunctionData({ abi: JB_CONTROLLER_ABI, data: forwarded.data })
      if (inner.functionName !== 'setUriOf' || !inner.args) {
        throw new Error('Forwarded controller operation is not recognized')
      }
      const projectId = inner.args[0]
      if (typeof projectId !== 'bigint' || projectId < 1n) {
        throw new Error('Metadata project ID is invalid')
      }
      const liveController = await getProjectController(
        getSafetyPublicClient(transaction.chain),
        projectId,
      )
      if (liveController.toLowerCase() !== target) {
        throw new Error(`The project controller changed on chain ${transaction.chain}`)
      }
    } else {
      throw new Error(`Forwarded contract not recognized: ${forwarded.to}`)
    }
  }

  return createBalanceBundle(request)
}

export interface PaymentOption {
  chainId: number         // Chain to pay gas from
  token: string           // Payment token (ETH address or ERC20)
  amount: string          // Amount required in wei
  estimatedGas: string    // Total gas estimate
}

// Raw relayr API types (matching relayr-ts)
export type CallState =
  | { state: 'Invalid' }
  | { state: 'Pending' }
  | { state: 'Mempool'; data: Record<string, unknown> }
  | { state: 'Cancel'; data: Record<string, unknown> }
  | { state: 'Resend'; data: Record<string, unknown> }
  | { state: 'Included'; data: { block: number } }
  | { state: 'Cancelled'; data: Record<string, unknown> }
  | { state: 'Success'; data: Record<string, unknown> }
  | { state: 'Reverted'; data: Record<string, unknown> }

export interface RawTransactionStatus {
  request: {
    chain: number
    target: string
    data?: string | null
    gas_limit?: string | null
    value?: string | null
    virtual_nonce?: number | null
  }
  status: CallState
  tx_uuid: string
}

export interface RawBundleResponse {
  bundle_uuid: string
  created_at: string
  expires_at?: string | null
  payment: unknown // PaymentMethod - complex union type
  payment_received: boolean
  transactions: RawTransactionStatus[]
}

// Simplified types for internal use (transformed from raw API response)
export interface BundleTransactionStatus {
  tx_uuid: string
  chain_id: number
  status: 'pending' | 'submitted' | 'confirmed' | 'failed'
  tx_hash?: string
  error?: string
  gas_used?: string
}

export interface BundleStatusResponse {
  bundle_uuid: string
  status: 'pending' | 'processing' | 'completed' | 'partial' | 'failed'
  transactions: BundleTransactionStatus[]
  payment_received: boolean
  payment_chain_id?: number
  payment_tx_hash?: string
}

// Transform CallState to simplified status
function mapCallStateToStatus(callState: CallState): 'pending' | 'submitted' | 'confirmed' | 'failed' {
  switch (callState.state) {
    case 'Invalid':
    case 'Reverted':
    case 'Cancelled':
      return 'failed'
    case 'Success':
      return 'confirmed'
    case 'Mempool':
    case 'Cancel':
    case 'Resend':
    case 'Included':
      return 'submitted'
    case 'Pending':
    default:
      return 'pending'
  }
}

// Derive bundle-level status from transaction statuses
function deriveBundleStatus(
  transactions: BundleTransactionStatus[],
  paymentReceived: boolean
): 'pending' | 'processing' | 'completed' | 'partial' | 'failed' {
  if (transactions.length === 0) {
    return paymentReceived ? 'processing' : 'pending'
  }

  const statuses = transactions.map(t => t.status)
  const allConfirmed = statuses.every(s => s === 'confirmed')
  const anyFailed = statuses.some(s => s === 'failed')
  const anyPending = statuses.some(s => s === 'pending')
  const anySubmitted = statuses.some(s => s === 'submitted')

  if (allConfirmed) return 'completed'
  if (anyFailed && statuses.some(s => s === 'confirmed')) return 'partial'
  if (anyFailed) return 'failed'
  if (anySubmitted || anyPending) return 'processing'
  return paymentReceived ? 'processing' : 'pending'
}

// Transform raw API response to simplified format
export function transformBundleResponse(raw: RawBundleResponse): BundleStatusResponse {
  const transactions: BundleTransactionStatus[] = raw.transactions.map(tx => {
    // Try both tx_hash and txHash (API might use either)
    const statusData = 'data' in tx.status && typeof tx.status.data === 'object' && tx.status.data !== null
      ? tx.status.data as Record<string, unknown>
      : null
    const txHash = statusData?.tx_hash ?? statusData?.txHash ?? statusData?.hash
    return {
      tx_uuid: tx.tx_uuid,
      chain_id: tx.request.chain,
      status: mapCallStateToStatus(tx.status),
      tx_hash: txHash as string | undefined,
      error: tx.status.state === 'Reverted' || tx.status.state === 'Invalid'
        ? `Transaction ${tx.status.state.toLowerCase()}`
        : undefined,
    }
  })

  return {
    bundle_uuid: raw.bundle_uuid,
    status: deriveBundleStatus(transactions, raw.payment_received),
    transactions,
    payment_received: raw.payment_received,
  }
}

/**
 * Get the status of a bundle (works for both prepaid and balance bundles).
 * Poll this to track transaction confirmations across chains.
 */
export async function getBundleStatus(bundleId: string): Promise<BundleStatusResponse> {
  const raw = await fetchApi<RawBundleResponse>(`/v1/bundle/${bundleId}`)
  return transformBundleResponse(raw)
}

// ============================================================================
// Omnichain Reserved Token Distributions
// ============================================================================

export interface JBOmnichainDistributeRequest {
  chainIds: number[]
  projectIds: Record<number, number>  // chainId -> projectId mapping
  type: 'reserves'
  controllerAddresses?: Record<number, string>
}

export interface JBOmnichainDistributeResponse {
  transactions: Array<{
    chainId: number
    projectId: number
    txData: JBTransactionData
    estimatedGas: string
  }>
}

/**
 * Build omnichain distribution transactions.
 * Builds sendReservedTokensToSplitsOf calls. Payouts are chain-specific and
 * require an exact token, amount, currency, terminal, and recipient review.
 * Encoded client-side using viem (no API call needed)
 */
export function buildOmnichainDistributeTransactions(
  request: JBOmnichainDistributeRequest
): JBOmnichainDistributeResponse {
  const transactions = request.chainIds.map(chainId => {
    const projectId = request.projectIds[chainId]
    if (!projectId) {
      throw new Error(`No project ID found for chain ${chainId}`)
    }

    const controllerAddress = request.controllerAddresses?.[chainId]
    if (!controllerAddress) {
      throw new Error(`Controller address missing for chain ${chainId}`)
    }
    const txResponse = encodeSendReservesTransaction(chainId, projectId, controllerAddress)
    return {
      chainId,
      projectId,
      txData: txResponse.txData,
      estimatedGas: txResponse.estimatedGas,
    }
  })

  return { transactions }
}

// Omnichain ruleset queueing

export interface JBOmnichainQueueRequest {
  chainIds: number[]               // All chains to queue on
  projectIds: Record<number, number>  // chainId -> projectId mapping
  rulesetConfigurations?: JBRulesetConfig[]
  rulesetConfigurationsByChain?: Record<number, JBRulesetConfig[]>
  queueTargets?: Record<number, string>
  memo: string
  mustStartAtOrAfter?: number      // Optional override, otherwise calculated
}

export interface JBOmnichainQueueResponse {
  transactions: Array<{
    chainId: number
    projectId: number
    txData: JBTransactionData
    estimatedGas: string
  }>
  synchronizedStartTime: number    // The coordinated start time used
}

// Calculate synchronized start time for omnichain deployment
// Uses 5 minutes in the future to ensure all chains can finalize
export function calculateSynchronizedStartTime(): number {
  const now = Math.floor(Date.now() / 1000)
  const fiveMinutesFromNow = now + (5 * 60) // 5 minutes buffer
  return fiveMinutesFromNow
}

// ============================================================================
// Omnichain ERC20 Deployment
// ============================================================================
// Deploy ERC20 token on multiple chains with SAME address using CREATE2.
// Uses identical salt across all chains to ensure deterministic address.

export interface JBOmnichainDeployERC20Request {
  chainIds: number[]
  projectIds: Record<number, number>  // chainId -> projectId mapping
  tokenName: string
  tokenSymbol: string
  salt: string                         // bytes32 - SAME salt for all chains
  controllerAddresses?: Record<number, string>
}

export interface JBOmnichainDeployERC20Response {
  transactions: Array<{
    chainId: number
    projectId: number
    txData: JBTransactionData
    estimatedGas: string
  }>
  predictedAddress: string             // Same address on all chains
}

/**
 * Build omnichain ERC20 deployment transactions.
 * Uses same salt to deploy at identical address on all chains.
 * Encoded client-side using viem (no API call needed)
 */
export function buildOmnichainDeployERC20Transactions(
  request: JBOmnichainDeployERC20Request
): JBOmnichainDeployERC20Response {
  const transactions = request.chainIds.map(chainId => {
    const projectId = request.projectIds[chainId]
    if (!projectId) {
      throw new Error(`No project ID found for chain ${chainId}`)
    }
    const controllerAddress = request.controllerAddresses?.[chainId]
    if (!controllerAddress) {
      throw new Error(`Controller address missing for chain ${chainId}`)
    }

    const txResponse = encodeDeployERC20Transaction(
      chainId,
      projectId,
      request.tokenName,
      request.tokenSymbol,
      request.salt,
      controllerAddress,
    )

    return {
      chainId,
      projectId,
      txData: txResponse.txData,
      estimatedGas: txResponse.estimatedGas,
    }
  })

  // TODO: Calculate predicted address using CREATE2 formula
  // For now, leave as empty - actual address comes from tx receipt
  return {
    transactions,
    predictedAddress: '0x0000000000000000000000000000000000000000',
  }
}

// ============================================================================
// Omnichain Project Launch
// ============================================================================
// Deploy a new Juicebox project on multiple chains simultaneously.
// Uses JBOmnichainDeployer.launchProjectFor() to create projects with suckers atomically.

// ============================================================================
// Omnichain Revnet Deployment
// ============================================================================
// Deploy a revnet (revenue network) using REVDeployer on multiple chains.
// Revnets have stage-based configuration with automated issuance decay.

export interface REVSuckerDeploymentConfig {
  deployerConfigurations: Array<{
    deployer: string                    // Sucker deployer address
    peer?: string                       // V6: explicit peer sucker (bytes32); omit for default
    mappings: Array<{
      localToken: string                // Token on this chain
      remoteToken: string               // Token on remote chain (address or bytes32)
      minGas: number                    // Minimum gas for bridge
    }>
  }>
  salt: string                          // bytes32 for deterministic addresses
}

// Per-chain configuration overrides for revnet deployments
// Allows different terminal configurations per chain (e.g., different USDC addresses)
export interface REVChainConfigOverride {
  chainId: number
  terminalConfigurations?: JBTerminalConfig[]
}

export interface JBDeployRevnetRequest {
  chainIds: number[]
  stageConfigurations: REVStageConfig[]
  splitOperator: string                 // Address that receives operator split
  description: {
    name: string
    ticker: string                      // ERC-20 symbol for the revnet token
    tagline: string
    uri: string                         // Pinned project metadata URI
    salt: string                        // bytes32 for CREATE2
  }
  terminalConfigurations?: JBTerminalConfig[]  // Default terminal configs (ETH if not specified)
  chainConfigs?: REVChainConfigOverride[]      // Per-chain overrides for ERC20 tokens
  /** Bridge infrastructure for auto-generated suckers ("ccip" default). */
  suckerBridge?: JBSuckerBridge
  /** Include cross-chain suckers in the atomic deployFor call. */
  configureSuckers?: boolean
  suckerDeploymentConfiguration?: REVSuckerDeploymentConfig
  /** When set, deploys a 721 tiers hook (NFT shop) atomically via the 6-arg deployFor. */
  deployTiersHookConfig?: JBDeployTiersHookConfig
  /** Exact JBProjects.creationFee() for each destination chain. */
  creationFeesWei: Record<number, string>
}

export interface JBDeployRevnetResponse {
  transactions: Array<{
    chainId: number
    txData: JBTransactionData
    estimatedGas: string
  }>
  predictedProjectIds: Record<number, number>  // chainId -> predicted project ID
  predictedTokenAddress: string                // Same on all chains via CREATE2
}

function deriveRevnetBaseCurrency(
  chainId: number,
  terminalConfigurations: JBTerminalConfig[],
): 1 | 2 {
  if (terminalConfigurations.length !== 1) {
    throw new Error('This revnet flow supports exactly one recognized accounting terminal')
  }
  const terminal = terminalConfigurations[0]
  if (terminal.terminal.toLowerCase() !== JB_CONTRACTS.JBMultiTerminal.toLowerCase()) {
    throw new Error(`Terminal not recognized for revnet accounting: ${terminal.terminal}`)
  }
  if (terminal.accountingContextsToAccept.length !== 1) {
    throw new Error('This revnet flow supports exactly one recognized accounting token')
  }
  const context = terminal.accountingContextsToAccept[0]
  const normalizedToken = context.token.toLowerCase()
  const isNative = normalizedToken === NATIVE_TOKEN.toLowerCase()
  const usdc = USDC_ADDRESSES[chainId as SupportedChainId]
  const isUsdc = !!usdc && normalizedToken === usdc.toLowerCase()
  if (!isNative && !isUsdc) {
    throw new Error(`Accounting token not recognized on chain ${chainId}: ${context.token}`)
  }
  const expectedDecimals = isNative ? 18 : 6
  const expectedCurrency = Number(BigInt(context.token) & 0xffffffffn)
  if (context.decimals !== expectedDecimals || context.currency !== expectedCurrency) {
    throw new Error(
      `Accounting context does not match ${context.token}: expected ${expectedDecimals} decimals and currency ${expectedCurrency}`,
    )
  }
  return isNative ? 1 : 2
}

/**
 * Build omnichain revnet deployment transactions.
 * Creates a revnet on each specified chain with stage-based configuration.
 * Encoded client-side using viem (no API call needed)
 *
 * IMPORTANT: For multi-chain deployments, each chain needs DIFFERENT sucker
 * deployer configurations (connecting to the other chains). This function
 * auto-generates per-chain sucker configs when deploying to multiple chains.
 *
 * For ERC20-based revnets (e.g., USDC), pass chainConfigs with per-chain
 * terminal configurations to ensure correct token addresses on each chain.
 */
export function buildOmnichainDeployRevnetTransactions(
  request: JBDeployRevnetRequest
): JBDeployRevnetResponse {
  // Default terminal configuration for ETH (V6 JBMultiTerminal; native currency = uint32(uint160(0xEEEe)))
  const defaultTerminalConfig: JBTerminalConfig[] = request.terminalConfigurations || [{
    terminal: JB_CONTRACTS.JBMultiTerminal,
    accountingContextsToAccept: [{
      token: NATIVE_TOKEN,
      decimals: 18,
      currency: 61166, // NATIVE_TOKEN_CURRENCY = uint32(uint160(NATIVE_TOKEN))
    }],
  }]

  const { chainIds, chainConfigs = [] } = request
  if (chainIds.length === 0 || new Set(chainIds).size !== chainIds.length) {
    throw new Error('Deployment chains must be a non-empty unique list')
  }

  // Generate a shared salt for all chains (ensures deterministic sucker addresses)
  const sharedSalt = request.suckerDeploymentConfiguration
    ? requireNonzeroBytes32(request.suckerDeploymentConfiguration.salt, 'Revnet bridge salt')
    : createSalt()

  // Build a map of chainId -> terminal configurations from chainConfigs
  const chainConfigMap = new Map<number, REVChainConfigOverride>()
  for (const cfg of chainConfigs) {
    if (!chainIds.includes(cfg.chainId)) {
      throw new Error(`Revnet configuration includes an unrelated chain: ${cfg.chainId}`)
    }
    if (chainConfigMap.has(cfg.chainId)) {
      throw new Error(`Duplicate revnet chain configuration: ${cfg.chainId}`)
    }
    chainConfigMap.set(cfg.chainId, cfg)
  }

  const accountingByChain = new Map<number, {
    contexts: JBTerminalConfig['accountingContextsToAccept']
    baseCurrency: 1 | 2
  }>()
  for (const chainId of chainIds) {
    const terminalConfigurations = chainConfigMap.get(chainId)?.terminalConfigurations ?? defaultTerminalConfig
    accountingByChain.set(chainId, {
      contexts: terminalConfigurations.flatMap(config => config.accountingContextsToAccept),
      baseCurrency: deriveRevnetBaseCurrency(chainId, terminalConfigurations),
    })
  }
  if (new Set([...accountingByChain.values()].map(config => config.baseCurrency)).size !== 1) {
    throw new Error('Every revnet chain must use the same recognized base currency')
  }

  // Extract per-chain token addresses from terminal configurations for sucker config
  // This enables proper ERC20 bridging (e.g., USDC on each chain)
  const tokenAddresses = extractChainTokenAddresses(
    chainIds,
    (chainId) => chainConfigMap.get(chainId)?.terminalConfigurations ?? defaultTerminalConfig,
  )

  const transactions = request.chainIds.map((chainId) => {
    // REVDeployer uses revnetId 0 to allocate a new revnet. Non-zero IDs refer
    // to an existing revnet and must never be guessed client-side.
    const revnetId = 0

    // Get per-chain terminal configurations (use override if available)
    const accounting = accountingByChain.get(chainId)
    if (!accounting) throw new Error(`Missing revnet accounting configuration for chain ${chainId}`)

    // Generate per-chain sucker configuration
    // Each chain needs deployers for the OTHER chains in the deployment
    let suckerConfig: REVSuckerDeploymentConfig | undefined

    // Check if we have a non-empty provided config
    const hasProvidedConfig = (request.suckerDeploymentConfiguration?.deployerConfigurations?.length ?? 0) > 0

    if (hasProvidedConfig) {
      // Use provided config (for custom configurations)
      suckerConfig = request.suckerDeploymentConfiguration
    } else if (request.configureSuckers && shouldConfigureSuckers(chainIds)) {
      // Auto-generate sucker config for this chain connecting to other chains
      suckerConfig = perChainSuckerConfig({
        chainId,
        chainIds,
        sharedSalt,
        tokenAddresses,
        bridge: request.suckerBridge,
      })
    }

    // V6 REVDeployer.deployFor takes accounting contexts directly (it wires the
    // canonical multi terminal + router terminal registry itself).
    const txResponse = encodeDeployRevnetTransaction(
      chainId,
      revnetId,
      {
        ...request,
        suckerDeploymentConfiguration: suckerConfig,
        creationFeeWei: request.creationFeesWei[chainId],
      },
      accounting.contexts,
      accounting.baseCurrency,
    )

    return {
      chainId,
      txData: txResponse.txData,
      estimatedGas: txResponse.estimatedGas,
    }
  })

  // Predicted project IDs would need on-chain query - return 0 for multi-chain
  // Actual IDs will be extracted from transaction receipts after completion
  const predictedProjectIds: Record<number, number> = {}
  request.chainIds.forEach((chainId) => {
    predictedProjectIds[chainId] = 0 // Will be updated from tx receipt
  })

  return {
    transactions,
    predictedProjectIds,
    predictedTokenAddress: '0x0000000000000000000000000000000000000000', // Placeholder
  }
}

// Build omnichain queue ruleset transactions with synchronized start time
export async function buildOmnichainQueueRulesetTransactions(
  request: JBOmnichainQueueRequest
): Promise<JBOmnichainQueueResponse> {
  // Calculate synchronized start time if not provided
  const synchronizedStartTime = request.mustStartAtOrAfter ?? calculateSynchronizedStartTime()

  // Build transactions for each chain
  const transactionPromises = request.chainIds.map(async chainId => {
    const projectId = request.projectIds[chainId]
    if (!projectId) {
      throw new Error(`No project ID found for chain ${chainId}`)
    }

    const chainConfigs = request.rulesetConfigurationsByChain?.[chainId] ?? request.rulesetConfigurations
    if (!chainConfigs?.length) {
      throw new Error(`No ruleset configuration found for chain ${chainId}`)
    }
    const synchronizedConfigs = chainConfigs.map(config => ({
      ...config,
      mustStartAtOrAfter: synchronizedStartTime,
    }))

    const queueTarget = request.queueTargets?.[chainId]
    if (!queueTarget) {
      throw new Error(`Ruleset queue target missing for chain ${chainId}`)
    }
    const response = encodeQueueRulesetTransaction({
      chainId,
      projectId,
      queueTarget,
      rulesetConfigurations: synchronizedConfigs,
      memo: request.memo,
    })

    return {
      chainId,
      projectId,
      txData: response.txData,
      estimatedGas: response.estimatedGas,
    }
  })

  const transactions = await Promise.all(transactionPromises)

  return {
    transactions,
    synchronizedStartTime,
  }
}
