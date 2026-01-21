import { useSettingsStore } from '../../stores'

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

async function fetchApi<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const endpoint = getEndpoint()
  const response = await fetch(`${endpoint}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
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
export async function buildPayTransaction(request: JBPayRequest): Promise<JBTransactionResponse> {
  return fetchApi<JBTransactionResponse>('/v1/juicebox/pay', {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

// Build transaction data for JBMultiTerminal.cashOutTokensOf()
export async function buildCashOutTransaction(request: JBCashOutRequest): Promise<JBTransactionResponse> {
  return fetchApi<JBTransactionResponse>('/v1/juicebox/cashout', {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

// Build transaction data for JBMultiTerminal.sendPayoutsOf()
export async function buildSendPayoutsTransaction(request: JBSendPayoutsRequest): Promise<JBTransactionResponse> {
  return fetchApi<JBTransactionResponse>('/v1/juicebox/sendpayouts', {
    method: 'POST',
    body: JSON.stringify(request),
  })
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
    transactions: omnichainResponse.transactions.map(tx => ({
      chain: tx.txData.chainId,
      target: tx.txData.to,
      data: tx.txData.data,
      value: tx.txData.value,
    })),
    virtual_nonce_mode: 'MultiChain', // Ensure proper ordering across chains
  })
  return {
    bundleId: bundle.bundle_uuid,
    txIds: bundle.tx_uuids,
    synchronizedStartTime: omnichainResponse.synchronizedStartTime,
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
export async function buildQueueRulesetTransaction(request: JBQueueRulesetRequest): Promise<JBTransactionResponse> {
  return fetchApi<JBTransactionResponse>('/v1/juicebox/queueRuleset', {
    method: 'POST',
    body: JSON.stringify(request),
  })
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
