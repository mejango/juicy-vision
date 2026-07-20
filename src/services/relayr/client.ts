import { useSettingsStore } from '../../stores'
import type { JBDeployTiersHookConfig } from '../omnichainDeployer'
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
import {
  createSalt,
  NATIVE_TOKEN,
  parseSuckerDeployerConfig,
  shouldConfigureSuckers,
  type JBSuckerBridge,
} from '../../utils/suckerConfig'
import { requireNonzeroBytes32 } from '../../utils/erc20Safety'
import { getProjectController } from '../../utils/paymentTerminal'
import { getSafetyPublicClient } from '../../utils/transactionSafety'

export interface QuoteRequest {
  fromChainId: number
  toChainId: number
  fromToken: string
  toToken: string
  amount: string
  recipient: string
}

export interface Quote {
  quoteId: string
  fromChainId: number
  toChainId: number
  fromToken: string
  toToken: string
  fromAmount: string
  toAmount: string
  estimatedGas: string
  fee: string
  expiresAt: number
}

export interface SendRequest {
  quoteId: string
  signature: string
}

export interface SendResponse {
  txHash: string
  status: 'pending' | 'submitted' | 'confirmed' | 'failed'
}

export interface TransactionStatusResponse {
  txHash: string
  status: 'pending' | 'submitted' | 'confirmed' | 'failed'
  fromTxHash?: string
  toTxHash?: string
  error?: string
}

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

export async function sendTransaction(request: SendRequest): Promise<SendResponse> {
  return fetchApi<SendResponse>('/v1/send', {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

export interface JBTransactionData {
  to: string
  data: string
  value: string
  chainId: number
}

export interface JBTransactionResponse {
  txData: JBTransactionData
  estimatedGas: string
  description: string
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

export interface BalanceInfo {
  balance: string         // Current balance in wei
  currency: string        // e.g., "ETH"
  last_updated: number    // Unix timestamp
}

export interface BalanceUsageRecord {
  tx_uuid: string
  chain_id: number
  gas_used: string
  gas_price: string
  cost: string            // Total cost in wei
  timestamp: number
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

/**
 * Get current organization balance for gas sponsorship.
 */
export async function getBalance(appId: string): Promise<BalanceInfo> {
  return fetchApi<BalanceInfo>(`/v1/balance/${appId}`)
}

// ============================================================================
// Prepaid Bundles (Self-Custody Mode)
// ============================================================================
// User pays gas on ONE chain, Relayr executes on ALL chains.
// For connected wallets (wagmi) doing omnichain operations.

export interface PrepaidBundleTransaction {
  chain: number           // Target chain ID
  target: string          // Destination contract address (0x...)
  data?: string           // Calldata (0x...)
  value?: string          // ETH value in wei
  gas_limit?: number      // Optional gas limit override
}

export interface PaymentOption {
  chainId: number         // Chain to pay gas from
  token: string           // Payment token (ETH address or ERC20)
  amount: string          // Amount required in wei
  estimatedGas: string    // Total gas estimate
}

export interface PrepaidBundleRequest {
  transactions: PrepaidBundleTransaction[]
  perform_simulation?: boolean    // Default: true
  signer_address: string          // User's connected wallet address
}

export interface PrepaidBundleResponse {
  bundle_uuid: string
  tx_uuids: string[]
  payment_options: PaymentOption[]  // Available chains to pay from
  expires_at: number                // Unix timestamp when quote expires
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
  console.log('[Relayr] Raw bundle response:', JSON.stringify(raw, null, 2))
  const transactions: BundleTransactionStatus[] = raw.transactions.map(tx => {
    // Debug: log the status data structure
    if ('data' in tx.status) {
      console.log(`[Relayr] Chain ${tx.request.chain} status data:`, tx.status.data)
    }
    // Try both tx_hash and txHash (API might use either)
    const statusData = 'data' in tx.status && typeof tx.status.data === 'object' && tx.status.data !== null
      ? tx.status.data as Record<string, unknown>
      : null
    const txHash = statusData?.tx_hash ?? statusData?.txHash ?? statusData?.hash
    if (txHash) {
      console.log(`[Relayr] Found txHash for chain ${tx.request.chain}:`, txHash)
    }
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

export interface BundlePaymentRequest {
  bundle_uuid: string
  chain_id: number          // Chain the user is paying from
  signed_tx: string         // Signed payment transaction
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

export interface JBRulesetMetadataConfig {
  reservedPercent: number         // 0-10000 (10000 = 100%)
  cashOutTaxRate: number          // 0-10000 (0 = proportional baseline, 10000 = disabled)
  baseCurrency: number            // 1 = ETH, 2 = USD
  pausePay: boolean
  pauseCreditTransfers: boolean
  allowOwnerMinting: boolean
  allowSetCustomToken: boolean
  allowTerminalMigration: boolean
  allowSetTerminals: boolean
  allowSetController: boolean
  allowAddAccountingContext: boolean
  allowAddPriceFeed: boolean
  ownerMustSendPayouts: boolean
  holdFees: boolean
  // If true, omnichain cash-out
  // calculations use only the local chain's balances.
  scopeCashOutsToLocalBalances: boolean
  useDataHookForPay: boolean
  useDataHookForCashOut: boolean
  dataHook: string
  metadata: number
}

export interface JBSplitConfig {
  percent: number                  // Out of 1000000000 (1B = 100%)
  projectId: number                // 0 for wallet, or project ID to pay
  beneficiary: string              // Recipient wallet
  preferAddToBalance: boolean
  lockedUntil: number              // Unix timestamp, 0 = unlocked
  hook: string                     // 0x0 for none
}

export interface JBSplitGroupConfig {
  groupId: string                  // uint256 - use token address for payouts, "1" for reserved
  splits: JBSplitConfig[]
}

export interface JBCurrencyAmountConfig {
  amount: string                   // Amount in currency (as string for bigint)
  currency: number                 // 1 = ETH, 2 = USD
}

export interface JBFundAccessLimitGroupConfig {
  terminal: string                 // Terminal address
  token: string                    // 0xEEEE...EEEe for ETH
  payoutLimits: JBCurrencyAmountConfig[]
  surplusAllowances: JBCurrencyAmountConfig[]
}

export interface JBRulesetConfig {
  mustStartAtOrAfter: number       // Unix timestamp, use 0 for immediate
  duration: number                 // Seconds per cycle, 0 = ongoing
  weight: string                   // Tokens per currency unit (as string for bigint)
  weightCutPercent: number         // Decay per cycle (0-1000000000)
  approvalHook: string             // 0x0 for none
  metadata: JBRulesetMetadataConfig
  splitGroups: JBSplitGroupConfig[]
  fundAccessLimitGroups: JBFundAccessLimitGroupConfig[]
}

export interface JBQueueRulesetRequest {
  chainId: number
  projectId: number
  queueTarget: string
  rulesetConfigurations: JBRulesetConfig[]
  memo: string
}

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

export interface JBTerminalConfig {
  terminal: string                      // JBMultiTerminal address
  accountingContextsToAccept: Array<{
    token: string                       // NATIVE_TOKEN or ERC20 address
    decimals: number                    // Token decimals (18 for ETH, 6 for USDC)
    currency: number                    // 1=ETH, 2=USD
  }>
}

// Token mapping for cross-chain bridging via suckers
// V6 Solidity struct: localToken, minGas, remoteToken (bytes32)
export interface JBSuckerTokenMapping {
  localToken: string                    // Token address on local chain (0xEEEe... for native)
  minGas: number                        // Minimum gas for bridge operation (uint32)
  remoteToken: string                   // Token on remote chain (address or bytes32; padded at encode time)
}

// Sucker deployer configuration for a specific bridge type
export interface JBSuckerDeployerConfig {
  deployer: string                      // Sucker deployer contract address
  peer?: string                         // V6: explicit peer sucker (bytes32); omit for default same-address peer
  mappings: JBSuckerTokenMapping[]      // Token mappings for this deployer
}

// Full sucker deployment configuration for atomic project+sucker deployment
export interface JBSuckerDeploymentConfig {
  deployerConfigurations: JBSuckerDeployerConfig[]  // One per bridge type (BP, ARB, CCIP)
  salt: string                                      // bytes32 for deterministic addresses
}

export interface JBLaunchProjectRequest {
  chainIds: number[]
  owner: string                         // Project owner address
  projectUri: string                    // IPFS CID for project metadata
  rulesetConfigurations: JBRulesetConfig[]
  terminalConfigurations: JBTerminalConfig[]
  memo: string
  suckerDeploymentConfiguration?: JBSuckerDeploymentConfig  // Optional: deploy suckers atomically
  /** Exact JBProjects.creationFee() for each destination chain. */
  creationFeesWei: Record<number, string>
}

export interface JBLaunchProjectResponse {
  transactions: Array<{
    chainId: number
    txData: JBTransactionData
    estimatedGas: string
  }>
  predictedProjectIds: Record<number, number>  // chainId -> predicted project ID
}

// ============================================================================
// Omnichain Revnet Deployment
// ============================================================================
// Deploy a revnet (revenue network) using REVDeployer on multiple chains.
// Revnets have stage-based configuration with automated issuance decay.

export interface REVStageConfig {
  startsAtOrAfter: number               // Unix timestamp
  splitPercent: number                  // To operator (0-10000, 10000 = 100%)
  initialIssuance: string               // Tokens per currency unit (as string for bigint)
  issuanceCutFrequency: number          // V6 (was issuanceDecayFrequency): seconds between cuts
  issuanceCutPercent: number            // V6 (was issuanceDecayPercent): cut amount (0-1000000000)
  cashOutTaxRate: number                // Exit tax (0-10000, 10000 = 100%)
  extraMetadata: number                 // Additional stage metadata
}

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
  const tokenAddresses: Record<number, `0x${string}`> = {}
  for (const chainId of chainIds) {
    const chainConfig = chainConfigMap.get(chainId)
    const terminalConfigs = chainConfig?.terminalConfigurations ?? defaultTerminalConfig
    // Look for the first non-native token in terminal configs
    for (const terminal of terminalConfigs) {
      for (const ctx of terminal.accountingContextsToAccept) {
        // Skip native token (0xEEEe...) - we want ERC20 tokens
        if (ctx.token && ctx.token.toLowerCase() !== '0x000000000000000000000000000000000000eeee') {
          tokenAddresses[chainId] = ctx.token as `0x${string}`
          break
        }
      }
      if (tokenAddresses[chainId]) break
    }
  }

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
      // Pass token addresses for ERC20-based projects
      const hasTokenAddresses = Object.keys(tokenAddresses).length > 0
      const generatedConfig = parseSuckerDeployerConfig(chainId, chainIds, {
        salt: sharedSalt,
        tokenAddresses: hasTokenAddresses ? tokenAddresses : undefined,
        bridge: request.suckerBridge,
      })
      suckerConfig = {
        deployerConfigurations: generatedConfig.deployerConfigurations.map((dc: { deployer: string; peer: string; mappings: Array<{ localToken: string; minGas: number; remoteToken: string }> }) => ({
          deployer: dc.deployer,
          peer: dc.peer,
          mappings: dc.mappings.map((m: { localToken: string; minGas: number; remoteToken: string }) => ({
            // V6 Solidity JBTokenMapping: localToken, minGas, remoteToken (bytes32)
            localToken: m.localToken,
            minGas: m.minGas,
            remoteToken: m.remoteToken,
          })),
        })),
        salt: generatedConfig.salt,
      }
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
