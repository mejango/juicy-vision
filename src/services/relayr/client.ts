import { useSettingsStore } from '../../stores'
import { RELAYR_API_KEY } from '../../config/environment'
import {
  encodePayTransaction,
  encodeCashOutTransaction,
  encodeSendPayoutsTransaction,
  encodeQueueRulesetTransaction,
  encodeDeployERC20Transaction,
  encodeSendReservesTransaction,
  encodeLaunchProjectTransaction,
  encodeDeployRevnetTransaction,
  encodeDeploySuckersTransaction,
} from './encoder'

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
  // Settings store overrides env variable (allows user customization)
  return useSettingsStore.getState().relayrApiKey || RELAYR_API_KEY
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

export async function getQuote(request: QuoteRequest): Promise<Quote> {
  return fetchApi<Quote>('/v1/quote', {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

export async function sendTransaction(request: SendRequest): Promise<SendResponse> {
  return fetchApi<SendResponse>('/v1/send', {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

export async function getTransactionStatus(txHash: string): Promise<TransactionStatusResponse> {
  return fetchApi<TransactionStatusResponse>(`/v1/status/${txHash}`)
}

export async function getSupportedChains(): Promise<number[]> {
  const response = await fetchApi<{ chains: number[] }>('/v1/chains')
  return response.chains
}

export async function getSupportedTokens(chainId: number): Promise<string[]> {
  const response = await fetchApi<{ tokens: string[] }>(`/v1/tokens/${chainId}`)
  return response.tokens
}

// Juicebox-specific transaction types

export interface JBPayRequest {
  chainId: number
  projectId: number
  amount: string // in wei
  beneficiary: string
  minReturnedTokens: string
  memo: string
  metadata?: string
}

export interface JBCashOutRequest {
  chainId: number
  projectId: number
  tokenAmount: string
  beneficiary: string
  minReclaimedTokens: string
  metadata?: string
}

export interface JBSendPayoutsRequest {
  chainId: number
  projectId: number
  amount: string
  currency: number // 1 = ETH
  minTokensPaidOut: string
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

// Build transaction data for JBMultiTerminal.pay()
// Encoded client-side using viem (no API call needed)
export function buildPayTransaction(request: JBPayRequest): JBTransactionResponse {
  return encodePayTransaction(request)
}

// Build transaction data for JBMultiTerminal.cashOutTokensOf()
export function buildCashOutTransaction(request: JBCashOutRequest): JBTransactionResponse {
  return encodeCashOutTransaction(request)
}

// Build transaction data for JBMultiTerminal.sendPayoutsOf()
export function buildSendPayoutsTransaction(request: JBSendPayoutsRequest): JBTransactionResponse {
  return encodeSendPayoutsTransaction(request)
}

// Submit a signed transaction
export async function submitTransaction(signedTx: string, chainId: number): Promise<SendResponse> {
  return fetchApi<SendResponse>('/v1/submit', {
    method: 'POST',
    body: JSON.stringify({ signedTx, chainId }),
  })
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
export async function createBalanceBundle(request: BalanceBundleRequest): Promise<BalanceBundleResponse> {
  return fetchApi<BalanceBundleResponse>('/v1/bundle/balance', {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

/**
 * Get current organization balance for gas sponsorship.
 */
export async function getBalance(appId: string): Promise<BalanceInfo> {
  return fetchApi<BalanceInfo>(`/v1/balance/${appId}`)
}

/**
 * Get gas usage history for cost tracking and accounting.
 */
export async function getBalanceUsage(
  appId: string,
  options?: { limit?: number; offset?: number; from?: number; to?: number }
): Promise<{ records: BalanceUsageRecord[]; total: number }> {
  const params = new URLSearchParams()
  if (options?.limit) params.set('limit', options.limit.toString())
  if (options?.offset) params.set('offset', options.offset.toString())
  if (options?.from) params.set('from', options.from.toString())
  if (options?.to) params.set('to', options.to.toString())
  const query = params.toString() ? `?${params.toString()}` : ''
  return fetchApi(`/v1/balance/${appId}/usage${query}`)
}

/**
 * Helper to create a sponsored Juicebox pay transaction.
 * Wraps buildPayTransaction + createBalanceBundle for zero-gas UX.
 */
export async function sponsoredPay(
  appId: string,
  request: JBPayRequest
): Promise<{ bundleId: string; txId: string }> {
  const txResponse = await buildPayTransaction(request)
  const bundle = await createBalanceBundle({
    app_id: appId,
    transactions: [{
      chain: txResponse.txData.chainId,
      target: txResponse.txData.to,
      data: txResponse.txData.data,
      value: txResponse.txData.value,
    }],
  })
  return { bundleId: bundle.bundle_uuid, txId: bundle.tx_uuids[0] }
}

/**
 * Helper to create a sponsored Juicebox cash out transaction.
 */
export async function sponsoredCashOut(
  appId: string,
  request: JBCashOutRequest
): Promise<{ bundleId: string; txId: string }> {
  const txResponse = await buildCashOutTransaction(request)
  const bundle = await createBalanceBundle({
    app_id: appId,
    transactions: [{
      chain: txResponse.txData.chainId,
      target: txResponse.txData.to,
      data: txResponse.txData.data,
      value: txResponse.txData.value,
    }],
  })
  return { bundleId: bundle.bundle_uuid, txId: bundle.tx_uuids[0] }
}

/**
 * Helper to execute omnichain ruleset queue with gas sponsorship.
 * All chains in the bundle are sponsored from the same balance.
 */
export async function sponsoredOmnichainQueue(
  appId: string,
  request: JBOmnichainQueueRequest
): Promise<{ bundleId: string; txIds: string[]; synchronizedStartTime: number }> {
  const omnichainResponse = await buildOmnichainQueueRulesetTransactions(request)
  const bundle = await createBalanceBundle({
    app_id: appId,
    transactions: omnichainResponse.transactions.map((tx, index) => ({
      chain: tx.txData.chainId,
      target: tx.txData.to,
      data: tx.txData.data,
      value: tx.txData.value,
      virtual_nonce: index,
    })),
    virtual_nonce_mode: 'MultiChain', // Ensure proper ordering across chains
  })
  return {
    bundleId: bundle.bundle_uuid,
    txIds: bundle.tx_uuids,
    synchronizedStartTime: omnichainResponse.synchronizedStartTime,
  }
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
function transformBundleResponse(raw: RawBundleResponse): BundleStatusResponse {
  const transactions: BundleTransactionStatus[] = raw.transactions.map(tx => ({
    tx_uuid: tx.tx_uuid,
    chain_id: tx.request.chain,
    status: mapCallStateToStatus(tx.status),
    // tx_hash and gas_used are in the CallState data for Success/Reverted states
    tx_hash: 'data' in tx.status && typeof tx.status.data === 'object' && tx.status.data !== null
      ? (tx.status.data as Record<string, unknown>).tx_hash as string | undefined
      : undefined,
    error: tx.status.state === 'Reverted' || tx.status.state === 'Invalid'
      ? `Transaction ${tx.status.state.toLowerCase()}`
      : undefined,
  }))

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
 * Create a prepaid bundle for self-custody wallets.
 * User will pay gas on one chain, Relayr executes on all target chains.
 * Returns payment options showing cost per chain.
 */
export async function createPrepaidBundle(request: PrepaidBundleRequest): Promise<PrepaidBundleResponse> {
  return fetchApi<PrepaidBundleResponse>('/v1/bundle/prepaid', {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

/**
 * Get the status of a bundle (works for both prepaid and balance bundles).
 * Poll this to track transaction confirmations across chains.
 */
export async function getBundleStatus(bundleId: string): Promise<BundleStatusResponse> {
  const raw = await fetchApi<RawBundleResponse>(`/v1/bundle/${bundleId}`)
  return transformBundleResponse(raw)
}

/**
 * Submit signed payment transaction for a prepaid bundle.
 * Call this after user signs the payment tx on their chosen chain.
 */
export async function sendBundlePayment(request: BundlePaymentRequest): Promise<void> {
  await fetchApi<{}>('/v1/bundle/payment', {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

/**
 * Helper to build omnichain transactions for prepaid mode.
 * Similar to sponsoredOmnichainQueue but returns prepaid bundle with payment options.
 */
export async function createPrepaidOmnichainQueue(
  signerAddress: string,
  request: JBOmnichainQueueRequest
): Promise<{ bundle: PrepaidBundleResponse; synchronizedStartTime: number }> {
  const omnichainResponse = await buildOmnichainQueueRulesetTransactions(request)
  const bundle = await createPrepaidBundle({
    signer_address: signerAddress,
    transactions: omnichainResponse.transactions.map(tx => ({
      chain: tx.txData.chainId,
      target: tx.txData.to,
      data: tx.txData.data,
      value: tx.txData.value,
    })),
  })
  return {
    bundle,
    synchronizedStartTime: omnichainResponse.synchronizedStartTime,
  }
}

// ============================================================================
// Omnichain Distributions (Payouts + Reserved Tokens)
// ============================================================================

export interface JBOmnichainDistributeRequest {
  chainIds: number[]
  projectIds: Record<number, number>  // chainId -> projectId mapping
  type: 'payouts' | 'reserves'
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
 * Works for both sendPayoutsOf (payouts) and sendReservedTokensToSplitsOf (reserves).
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

    if (request.type === 'reserves') {
      // sendReservedTokensToSplitsOf only needs projectId
      const txResponse = encodeSendReservesTransaction(chainId, projectId)
      return {
        chainId,
        projectId,
        txData: txResponse.txData,
        estimatedGas: txResponse.estimatedGas,
      }
    } else {
      // sendPayoutsOf needs amount/currency - for now use max uint to trigger full payout
      const txResponse = encodeSendPayoutsTransaction({
        chainId,
        projectId,
        amount: '0', // 0 = distribute full payout limit
        currency: 1, // ETH
        minTokensPaidOut: '0',
      })
      return {
        chainId,
        projectId,
        txData: txResponse.txData,
        estimatedGas: txResponse.estimatedGas,
      }
    }
  })

  return { transactions }
}

/**
 * Create a prepaid bundle for omnichain distributions.
 */
export async function createPrepaidOmnichainDistribute(
  signerAddress: string,
  request: JBOmnichainDistributeRequest
): Promise<PrepaidBundleResponse> {
  const distributeResponse = await buildOmnichainDistributeTransactions(request)
  return createPrepaidBundle({
    signer_address: signerAddress,
    transactions: distributeResponse.transactions.map(tx => ({
      chain: tx.txData.chainId,
      target: tx.txData.to,
      data: tx.txData.data,
      value: tx.txData.value,
    })),
  })
}

/**
 * Create a sponsored bundle for omnichain distributions.
 */
export async function sponsoredOmnichainDistribute(
  appId: string,
  request: JBOmnichainDistributeRequest
): Promise<{ bundleId: string; txIds: string[] }> {
  const distributeResponse = await buildOmnichainDistributeTransactions(request)
  const bundle = await createBalanceBundle({
    app_id: appId,
    transactions: distributeResponse.transactions.map((tx, index) => ({
      chain: tx.txData.chainId,
      target: tx.txData.to,
      data: tx.txData.data,
      value: tx.txData.value,
      virtual_nonce: index,
    })),
    virtual_nonce_mode: 'MultiChain',
  })
  return {
    bundleId: bundle.bundle_uuid,
    txIds: bundle.tx_uuids,
  }
}

// Omnichain ruleset queueing

export interface JBRulesetMetadataConfig {
  reservedPercent: number         // 0-10000 (10000 = 100%)
  cashOutTaxRate: number          // 0-10000 (0 = full refund, 10000 = disabled)
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
  useTotalSurplusForCashOuts: boolean
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
  rulesetConfigurations: JBRulesetConfig[]
  memo: string
}

export interface JBOmnichainQueueRequest {
  chainIds: number[]               // All chains to queue on
  projectIds: Record<number, number>  // chainId -> projectId mapping
  rulesetConfigurations: JBRulesetConfig[]
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

// Build transaction data for JBController.queueRulesetsOf()
// Encoded client-side using viem (no API call needed)
export function buildQueueRulesetTransaction(request: JBQueueRulesetRequest): JBTransactionResponse {
  return encodeQueueRulesetTransaction(request)
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

    const txResponse = encodeDeployERC20Transaction(
      chainId,
      projectId,
      request.tokenName,
      request.tokenSymbol,
      request.salt
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

/**
 * Create a prepaid bundle for omnichain ERC20 deployment.
 */
export async function createPrepaidOmnichainDeployERC20(
  signerAddress: string,
  request: JBOmnichainDeployERC20Request
): Promise<{ bundle: PrepaidBundleResponse; predictedAddress: string }> {
  const deployResponse = await buildOmnichainDeployERC20Transactions(request)
  const bundle = await createPrepaidBundle({
    signer_address: signerAddress,
    transactions: deployResponse.transactions.map(tx => ({
      chain: tx.txData.chainId,
      target: tx.txData.to,
      data: tx.txData.data,
      value: tx.txData.value,
    })),
  })
  return {
    bundle,
    predictedAddress: deployResponse.predictedAddress,
  }
}

/**
 * Create a sponsored bundle for omnichain ERC20 deployment.
 */
export async function sponsoredOmnichainDeployERC20(
  appId: string,
  request: JBOmnichainDeployERC20Request
): Promise<{ bundleId: string; txIds: string[]; predictedAddress: string }> {
  const deployResponse = await buildOmnichainDeployERC20Transactions(request)
  const bundle = await createBalanceBundle({
    app_id: appId,
    transactions: deployResponse.transactions.map((tx, index) => ({
      chain: tx.txData.chainId,
      target: tx.txData.to,
      data: tx.txData.data,
      value: tx.txData.value,
      virtual_nonce: index,
    })),
    virtual_nonce_mode: 'MultiChain',
  })
  return {
    bundleId: bundle.bundle_uuid,
    txIds: bundle.tx_uuids,
    predictedAddress: deployResponse.predictedAddress,
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
export interface JBSuckerTokenMapping {
  localToken: string                    // Token address on local chain (0xEEEe... for native)
  remoteToken: string                   // Token address on remote chain
  minGas: number                        // Minimum gas for bridge operation
  minBridgeAmount: string               // Minimum amount to bridge (in wei)
}

// Sucker deployer configuration for a specific bridge type
export interface JBSuckerDeployerConfig {
  deployer: string                      // Sucker deployer contract address
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
}

export interface JBLaunchProjectResponse {
  transactions: Array<{
    chainId: number
    txData: JBTransactionData
    estimatedGas: string
  }>
  predictedProjectIds: Record<number, number>  // chainId -> predicted project ID
}

/**
 * Build omnichain project launch transactions.
 * Creates a new project on each specified chain with identical configuration.
 * Encoded client-side using viem (no API call needed)
 */
export function buildOmnichainLaunchProjectTransactions(
  request: JBLaunchProjectRequest
): JBLaunchProjectResponse {
  const transactions = request.chainIds.map(chainId => {
    const txResponse = encodeLaunchProjectTransaction(chainId, request)
    return {
      chainId,
      txData: txResponse.txData,
      estimatedGas: txResponse.estimatedGas,
    }
  })

  // Predicted project IDs would need on-chain query - return placeholders
  // Actual IDs come from transaction receipts
  const predictedProjectIds: Record<number, number> = {}
  request.chainIds.forEach((chainId, index) => {
    predictedProjectIds[chainId] = index + 1 // Placeholder
  })

  return {
    transactions,
    predictedProjectIds,
  }
}

/**
 * Create a sponsored bundle for omnichain project launch.
 * Admin pays gas for all users via balance bundle.
 */
export async function sponsoredOmnichainLaunchProject(
  appId: string,
  request: JBLaunchProjectRequest
): Promise<{ bundleId: string; txIds: string[]; predictedProjectIds: Record<number, number> }> {
  const launchResponse = await buildOmnichainLaunchProjectTransactions(request)
  const bundle = await createBalanceBundle({
    app_id: appId,
    transactions: launchResponse.transactions.map((tx, index) => ({
      chain: tx.txData.chainId,
      target: tx.txData.to,
      data: tx.txData.data,
      value: tx.txData.value,
      virtual_nonce: index,
    })),
    virtual_nonce_mode: 'MultiChain',
  })
  return {
    bundleId: bundle.bundle_uuid,
    txIds: bundle.tx_uuids,
    predictedProjectIds: launchResponse.predictedProjectIds,
  }
}

// ============================================================================
// Omnichain Revnet Deployment
// ============================================================================
// Deploy a revnet (revenue network) using REVDeployer on multiple chains.
// Revnets have stage-based configuration with automated issuance decay.

export interface REVStageConfig {
  startsAtOrAfter: number               // Unix timestamp
  splitPercent: number                  // To operator (0-1000000000, 1B = 100%)
  initialIssuance: string               // Tokens per currency unit (as string for bigint)
  issuanceDecayFrequency: number        // Seconds between decay applications
  issuanceDecayPercent: number          // Decay amount (0-1000000000)
  cashOutTaxRate: number                // Exit tax (0-10000, 10000 = 100%)
  extraMetadata: number                 // Additional stage metadata
}

export interface REVSuckerDeploymentConfig {
  deployerConfigurations: Array<{
    deployer: string                    // Sucker deployer address
    mappings: Array<{
      localToken: string                // Token on this chain
      remoteToken: string               // Token on remote chain
      minGas: number                    // Minimum gas for bridge
      minBridgeAmount: string           // Minimum amount to bridge
    }>
  }>
  salt: string                          // bytes32 for deterministic addresses
}

export interface JBDeployRevnetRequest {
  chainIds: number[]
  stageConfigurations: REVStageConfig[]
  splitOperator: string                 // Address that receives operator split
  description: {
    name: string
    tagline: string
    salt: string                        // bytes32 for CREATE2
  }
  suckerDeploymentConfiguration?: REVSuckerDeploymentConfig
  initialTokenReceivers?: Array<{
    beneficiary: string
    count: number                       // Number of tokens to mint
  }>
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

/**
 * Build omnichain revnet deployment transactions.
 * Creates a revnet on each specified chain with stage-based configuration.
 * Encoded client-side using viem (no API call needed)
 */
export function buildOmnichainDeployRevnetTransactions(
  request: JBDeployRevnetRequest
): JBDeployRevnetResponse {
  // Default terminal configuration for ETH
  const defaultTerminalConfig = [{
    terminal: '0x52869db3d61dde1e391967f2ce5039ad0ecd371c', // JBMultiTerminal
    accountingContextsToAccept: [{
      token: '0x000000000000000000000000000000000000EEEe', // Native ETH
      decimals: 18,
      currency: 1,
    }],
  }]

  const transactions = request.chainIds.map((chainId, index) => {
    const revnetId = index + 1 // Placeholder - actual ID from chain state
    const txResponse = encodeDeployRevnetTransaction(
      chainId,
      revnetId,
      request,
      defaultTerminalConfig
    )
    return {
      chainId,
      txData: txResponse.txData,
      estimatedGas: txResponse.estimatedGas,
    }
  })

  // Predicted project IDs would need on-chain query - return placeholders
  const predictedProjectIds: Record<number, number> = {}
  request.chainIds.forEach((chainId, index) => {
    predictedProjectIds[chainId] = index + 1 // Placeholder
  })

  return {
    transactions,
    predictedProjectIds,
    predictedTokenAddress: '0x0000000000000000000000000000000000000000', // Placeholder
  }
}

/**
 * Create a sponsored bundle for omnichain revnet deployment.
 * Admin pays gas for all users via balance bundle.
 */
export async function sponsoredOmnichainDeployRevnet(
  appId: string,
  request: JBDeployRevnetRequest
): Promise<{ bundleId: string; txIds: string[]; predictedProjectIds: Record<number, number>; predictedTokenAddress: string }> {
  const deployResponse = await buildOmnichainDeployRevnetTransactions(request)
  const bundle = await createBalanceBundle({
    app_id: appId,
    transactions: deployResponse.transactions.map((tx, index) => ({
      chain: tx.txData.chainId,
      target: tx.txData.to,
      data: tx.txData.data,
      value: tx.txData.value,
      virtual_nonce: index,
    })),
    virtual_nonce_mode: 'MultiChain',
  })
  return {
    bundleId: bundle.bundle_uuid,
    txIds: bundle.tx_uuids,
    predictedProjectIds: deployResponse.predictedProjectIds,
    predictedTokenAddress: deployResponse.predictedTokenAddress,
  }
}

// ============================================================================
// Omnichain Sucker Deployment
// ============================================================================
// Deploy suckers to link projects across chains after creation.
// Enables token bridging between the same project on different chains.

export interface SuckerTokenMapping {
  localToken: string                    // Token address on this chain
  remoteToken: string                   // Token address on remote chain
  minGas: number                        // Minimum gas for bridge operation
  minBridgeAmount: string               // Minimum amount to bridge (as string)
}

export interface JBDeploySuckersRequest {
  chainIds: number[]
  projectIds: Record<number, number>    // chainId -> projectId mapping
  salt: string                          // bytes32 for deterministic addresses
  tokenMappings: SuckerTokenMapping[]
  deployerOverrides?: Record<number, string>  // chainId -> deployer address override
}

export interface JBDeploySuckersResponse {
  transactions: Array<{
    chainId: number
    projectId: number
    txData: JBTransactionData
    estimatedGas: string
  }>
  suckerAddresses: Record<number, string>  // chainId -> predicted sucker address
  suckerGroupId: string                    // Shared ID linking all suckers
}

/**
 * Build omnichain sucker deployment transactions.
 * Creates suckers on each chain to enable cross-chain token bridging.
 * Encoded client-side using viem (no API call needed)
 */
export function buildOmnichainDeploySuckersTransactions(
  request: JBDeploySuckersRequest
): JBDeploySuckersResponse {
  // Default sucker deployer addresses (BPSuckerDeployer on each chain)
  const DEFAULT_SUCKER_DEPLOYER = '0x6c54f4e2d49c31b8d1d1eb8fa8a8fca83f29e90c'

  const transactions = request.chainIds.map(chainId => {
    const projectId = request.projectIds[chainId]
    if (!projectId) {
      throw new Error(`No project ID found for chain ${chainId}`)
    }

    // Get deployer override or use default
    const deployer = request.deployerOverrides?.[chainId] || DEFAULT_SUCKER_DEPLOYER

    // Build configurations from token mappings
    const configurations = [{
      deployer,
      mappings: request.tokenMappings,
    }]

    const txResponse = encodeDeploySuckersTransaction(
      chainId,
      projectId,
      request.salt,
      configurations
    )

    return {
      chainId,
      projectId,
      txData: txResponse.txData,
      estimatedGas: txResponse.estimatedGas,
    }
  })

  // Sucker addresses would come from CREATE2 prediction - return placeholders
  const suckerAddresses: Record<number, string> = {}
  request.chainIds.forEach(chainId => {
    suckerAddresses[chainId] = '0x0000000000000000000000000000000000000000' // Placeholder
  })

  return {
    transactions,
    suckerAddresses,
    suckerGroupId: request.salt, // Salt serves as group identifier
  }
}

/**
 * Create a sponsored bundle for omnichain sucker deployment.
 * Admin pays gas for all users via balance bundle.
 */
export async function sponsoredOmnichainDeploySuckers(
  appId: string,
  request: JBDeploySuckersRequest
): Promise<{ bundleId: string; txIds: string[]; suckerAddresses: Record<number, string>; suckerGroupId: string }> {
  const deployResponse = await buildOmnichainDeploySuckersTransactions(request)
  const bundle = await createBalanceBundle({
    app_id: appId,
    transactions: deployResponse.transactions.map((tx, index) => ({
      chain: tx.txData.chainId,
      target: tx.txData.to,
      data: tx.txData.data,
      value: tx.txData.value,
      virtual_nonce: index,
    })),
    virtual_nonce_mode: 'MultiChain',
  })
  return {
    bundleId: bundle.bundle_uuid,
    txIds: bundle.tx_uuids,
    suckerAddresses: deployResponse.suckerAddresses,
    suckerGroupId: deployResponse.suckerGroupId,
  }
}

// Build omnichain queue ruleset transactions with synchronized start time
export async function buildOmnichainQueueRulesetTransactions(
  request: JBOmnichainQueueRequest
): Promise<JBOmnichainQueueResponse> {
  // Calculate synchronized start time if not provided
  const synchronizedStartTime = request.mustStartAtOrAfter ?? calculateSynchronizedStartTime()

  // Apply synchronized start time to all ruleset configurations
  const synchronizedConfigs = request.rulesetConfigurations.map(config => ({
    ...config,
    mustStartAtOrAfter: synchronizedStartTime,
  }))

  // Build transactions for each chain
  const transactionPromises = request.chainIds.map(async chainId => {
    const projectId = request.projectIds[chainId]
    if (!projectId) {
      throw new Error(`No project ID found for chain ${chainId}`)
    }

    const response = await buildQueueRulesetTransaction({
      chainId,
      projectId,
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
