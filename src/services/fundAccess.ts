import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  fallback,
  formatUnits,
  http,
  parseUnits,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from 'viem'
import {
  ALL_VIEM_CHAINS,
  JB_CONTRACTS,
  JB_ROUTER_TERMINAL,
  JB_ROUTER_TERMINAL_REGISTRY,
  MAINNET_RPC_ENDPOINTS,
  NATIVE_TOKEN,
  RPC_ENDPOINTS,
  USDC_ADDRESSES,
  type SupportedChainId,
} from '../constants'
import { quotedOutputFloor } from '../utils/terminalPreview'
import { collectErrorText } from '../utils/txErrors'
import { truncateAddress } from '../utils/ens'

/** Exact deployed V6 sentinel used by JBCurrencyAmount.amount (uint224). */
export const MAX_UINT224 = (1n << 224n) - 1n
export const PRICE_FIDELITY = 10n ** 18n

const RULESET_COMPONENTS = [
  { name: 'cycleNumber', type: 'uint48' },
  { name: 'id', type: 'uint48' },
  { name: 'basedOnId', type: 'uint48' },
  { name: 'start', type: 'uint48' },
  { name: 'duration', type: 'uint32' },
  { name: 'weight', type: 'uint112' },
  { name: 'weightCutPercent', type: 'uint32' },
  { name: 'approvalHook', type: 'address' },
  { name: 'metadata', type: 'uint256' },
] as const

const CURRENCY_AMOUNT_COMPONENTS = [
  { name: 'amount', type: 'uint224' },
  { name: 'currency', type: 'uint32' },
] as const

// These fragments are copied from nana-core-v6/deployments/ethereum/*.json.
// Runtime dependency reads below bind them to the deployed V6 contract graph.
const FUND_ACCESS_DIRECTORY_ABI = [
  {
    name: 'controllerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'terminalsOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address[]' }],
  },
] as const

export const FUND_ACCESS_TERMINAL_ABI = [
  {
    name: 'STORE',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'accountingContextsOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{
      name: '',
      type: 'tuple[]',
      components: [
        { name: 'token', type: 'address' },
        { name: 'decimals', type: 'uint8' },
        { name: 'currency', type: 'uint32' },
      ],
    }],
  },
  {
    name: 'currentSurplusOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'tokens', type: 'address[]' },
      { name: 'decimals', type: 'uint256' },
      { name: 'currency', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'sendPayoutsOf',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'currency', type: 'uint256' },
      { name: 'minTokensPaidOut', type: 'uint256' },
    ],
    outputs: [{ name: 'amountPaidOut', type: 'uint256' }],
  },
  {
    name: 'useAllowanceOf',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'currency', type: 'uint256' },
      { name: 'minTokensPaidOut', type: 'uint256' },
      { name: 'beneficiary', type: 'address' },
      { name: 'feeBeneficiary', type: 'address' },
      { name: 'memo', type: 'string' },
    ],
    outputs: [{ name: 'netAmountPaidOut', type: 'uint256' }],
  },
  {
    name: 'JBMultiTerminal_UnderMin',
    type: 'error',
    inputs: [
      { name: 'value', type: 'uint256' },
      { name: 'min', type: 'uint256' },
    ],
  },
  {
    name: 'JBTerminalStore_InadequateControllerAllowance',
    type: 'error',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'allowance', type: 'uint256' },
    ],
  },
  {
    name: 'JBTerminalStore_InadequateTerminalStoreBalance',
    type: 'error',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'balance', type: 'uint256' },
    ],
  },
] as const

export const FUND_ACCESS_STORE_ABI = [
  {
    name: 'PRICES',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'RULESETS',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'terminal', type: 'address' },
      { name: 'projectId', type: 'uint256' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'usedPayoutLimitOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'terminal', type: 'address' },
      { name: 'projectId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'rulesetCycleNumber', type: 'uint256' },
      { name: 'currency', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'usedSurplusAllowanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'terminal', type: 'address' },
      { name: 'projectId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'rulesetId', type: 'uint256' },
      { name: 'currency', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

const FUND_ACCESS_LIMITS_ABI = [
  {
    name: 'payoutLimitsOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'rulesetId', type: 'uint256' },
      { name: 'terminal', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: 'payoutLimits', type: 'tuple[]', components: CURRENCY_AMOUNT_COMPONENTS }],
  },
  {
    name: 'surplusAllowancesOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'rulesetId', type: 'uint256' },
      { name: 'terminal', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: 'surplusAllowances', type: 'tuple[]', components: CURRENCY_AMOUNT_COMPONENTS }],
  },
] as const

const FUND_ACCESS_RULESETS_ABI = [{
  name: 'currentOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [{ name: 'ruleset', type: 'tuple', components: RULESET_COMPONENTS }],
}] as const

export const FUND_ACCESS_PRICES_ABI = [{
  name: 'pricePerUnitOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'projectId', type: 'uint256' },
    { name: 'pricingCurrency', type: 'uint256' },
    { name: 'unitCurrency', type: 'uint256' },
    { name: 'decimals', type: 'uint256' },
  ],
  outputs: [{ name: 'price', type: 'uint256' }],
}] as const

export const FUND_ACCESS_CONTROLLER_ABI = [{
  name: 'FUND_ACCESS_LIMITS',
  type: 'function',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'address' }],
}] as const

export type FundAccessKind = 'payout' | 'allowance'

export interface FundAccessAmountSnapshot {
  configured: bigint
  used: bigint
  remaining: bigint
  currency: bigint
  pricePerUnit: bigint
  sourceInCurrency: bigint
  available: bigint
  unlimited: boolean
}

export interface FundAccessContextSnapshot {
  projectId: bigint
  terminal: Address
  store: Address
  prices: Address
  rulesets: Address
  fundAccessLimits: Address
  token: Address
  tokenSymbol: string
  decimals: number
  accountingCurrency: bigint
  rulesetId: bigint
  rulesetCycleNumber: bigint
  balance: bigint
  currentSurplus: bigint
  payoutLimits: FundAccessAmountSnapshot[]
  surplusAllowances: FundAccessAmountSnapshot[]
}

export interface PreparedFundAccessTransaction {
  target: Address
  data: Hex
  quotedAmount: bigint
  minimumOutput: bigint
  context: FundAccessContextSnapshot
  access: FundAccessAmountSnapshot
  review: {
    abi: typeof FUND_ACCESS_TERMINAL_ABI
    functionName: 'sendPayoutsOf' | 'useAllowanceOf'
    args: readonly unknown[]
  }
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

function requireAddress(actual: Address, expected: Address, label: string): void {
  if (!sameAddress(actual, expected)) throw new Error(`${label} is not the deployed V6 contract: ${actual}`)
}

export function createFundAccessClient(chainId: number): PublicClient {
  const chain = (ALL_VIEM_CHAINS as Readonly<Record<number, Chain>>)[chainId]
  const rpcUrls = RPC_ENDPOINTS[chainId] || MAINNET_RPC_ENDPOINTS[chainId] || chain?.rpcUrls.default.http
  if (!chain || !rpcUrls?.length) throw new Error(`Fund access is unavailable on unsupported chain ${chainId}`)
  return createPublicClient({ chain, transport: fallback(rpcUrls.map(url => http(url))) }) as PublicClient
}

export function remainingAccessAmount(configured: bigint, used: bigint): bigint {
  return configured > used ? configured - used : 0n
}

/** Convert accounting-currency units A into configured-currency units C using price(C, A), flooring. */
export function accountingAmountInConfiguredCurrency(amount: bigint, pricePerUnit: bigint): bigint {
  if (amount <= 0n || pricePerUnit <= 0n) return 0n
  return (amount * pricePerUnit) / PRICE_FIDELITY
}

export function protectedFundAccessOutput(quoted: bigint, exactCurrency: boolean): bigint {
  if (quoted <= 0n) return 0n
  if (exactCurrency) return quoted
  return quotedOutputFloor(quoted)
}

export function parseFundAccessAmount(value: string, decimals: number): bigint | null {
  try {
    const parsed = parseUnits(value.trim(), decimals)
    return parsed > 0n ? parsed : null
  } catch {
    return null
  }
}

export function formatFundAccessAmount(value: bigint, decimals: number, maximumFractionDigits = 8): string {
  const exact = formatUnits(value, decimals)
  const [whole, fraction = ''] = exact.split('.')
  if (!fraction) return whole
  const compact = fraction.slice(0, maximumFractionDigits).replace(/0+$/, '')
  return compact ? `${whole}.${compact}` : whole
}

export function currencyLabel(currency: bigint, context: Pick<FundAccessContextSnapshot, 'accountingCurrency' | 'tokenSymbol'>): string {
  if (currency === context.accountingCurrency) return context.tokenSymbol
  if (currency === 1n) return 'ETH'
  if (currency === 2n) return 'USD'
  return `Currency ${currency}`
}

export function rawFraction(value: bigint, numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n || numerator < 0n) throw new Error('Invalid fraction')
  return (value * numerator) / denominator
}

async function tokenSymbol(client: PublicClient, chainId: number, token: Address): Promise<string> {
  if (sameAddress(token, NATIVE_TOKEN)) return 'ETH'
  const usdc = USDC_ADDRESSES[chainId as SupportedChainId]
  if (usdc && sameAddress(token, usdc)) return 'USDC'
  try {
    const symbol = await client.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' })
    if (/^[\x20-\x7e]{1,16}$/.test(symbol)) return symbol
  } catch {
    // A non-standard ERC-20 symbol must not block a live accounting context.
  }
  return truncateAddress(token)
}

async function priceFor(
  client: PublicClient,
  prices: Address,
  projectId: bigint,
  configuredCurrency: bigint,
  accountingCurrency: bigint,
): Promise<bigint> {
  if (configuredCurrency === accountingCurrency) return PRICE_FIDELITY
  const price = await client.readContract({
    address: prices,
    abi: FUND_ACCESS_PRICES_ABI,
    functionName: 'pricePerUnitOf',
    args: [projectId, configuredCurrency, accountingCurrency, 18n],
  })
  if (price <= 0n) throw new Error('The configured currency price is unavailable')
  return price
}

export async function readFundAccessContexts(
  client: PublicClient,
  chainId: number,
  projectId: bigint,
): Promise<FundAccessContextSnapshot[]> {
  if (projectId <= 0n) throw new Error('Project ID is invalid')

  const terminal = JB_CONTRACTS.JBMultiTerminal as Address
  const [terminals, controller, contexts, store] = await Promise.all([
    client.readContract({
      address: JB_CONTRACTS.JBDirectory,
      abi: FUND_ACCESS_DIRECTORY_ABI,
      functionName: 'terminalsOf',
      args: [projectId],
    }),
    client.readContract({
      address: JB_CONTRACTS.JBDirectory,
      abi: FUND_ACCESS_DIRECTORY_ABI,
      functionName: 'controllerOf',
      args: [projectId],
    }),
    client.readContract({
      address: terminal,
      abi: FUND_ACCESS_TERMINAL_ABI,
      functionName: 'accountingContextsOf',
      args: [projectId],
    }),
    client.readContract({
      address: terminal,
      abi: FUND_ACCESS_TERMINAL_ABI,
      functionName: 'STORE',
    }),
  ])

  const recognizedTerminals = new Set([
    terminal.toLowerCase(),
    JB_ROUTER_TERMINAL.toLowerCase(),
    JB_ROUTER_TERMINAL_REGISTRY.toLowerCase(),
  ])
  if (terminals.some(candidate => !recognizedTerminals.has(candidate.toLowerCase()))) {
    throw new Error('Project contains an unrecognized terminal')
  }
  if (terminals.filter(candidate => sameAddress(candidate, terminal)).length !== 1) {
    throw new Error('The deployed V6 accounting terminal is unavailable or ambiguous')
  }
  requireAddress(controller, JB_CONTRACTS.JBController as Address, 'Project controller')
  requireAddress(store, JB_CONTRACTS.JBTerminalStore as Address, 'Terminal store')

  const [prices, rulesets, fundAccessLimits, ruleset] = await Promise.all([
    client.readContract({ address: store, abi: FUND_ACCESS_STORE_ABI, functionName: 'PRICES' }),
    client.readContract({ address: store, abi: FUND_ACCESS_STORE_ABI, functionName: 'RULESETS' }),
    client.readContract({
      address: controller,
      abi: FUND_ACCESS_CONTROLLER_ABI,
      functionName: 'FUND_ACCESS_LIMITS',
    }),
    client.readContract({
      address: JB_CONTRACTS.JBRulesets,
      abi: FUND_ACCESS_RULESETS_ABI,
      functionName: 'currentOf',
      args: [projectId],
    }),
  ])
  requireAddress(prices, JB_CONTRACTS.JBPrices as Address, 'Price store')
  requireAddress(rulesets, JB_CONTRACTS.JBRulesets as Address, 'Ruleset store')
  requireAddress(fundAccessLimits, JB_CONTRACTS.JBFundAccessLimits as Address, 'Fund access limits')
  if (BigInt(ruleset.id) === 0n || BigInt(ruleset.cycleNumber) === 0n) throw new Error('Project has no current ruleset')
  if (contexts.length === 0) throw new Error('Project has no accounting context')

  const seenTokens = new Set<string>()
  return Promise.all(contexts.map(async accountingContext => {
    const normalizedToken = accountingContext.token.toLowerCase()
    if (seenTokens.has(normalizedToken)) throw new Error(`Duplicate accounting context: ${accountingContext.token}`)
    seenTokens.add(normalizedToken)
    const decimals = Number(accountingContext.decimals)
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) {
      throw new Error(`Accounting decimals are invalid for ${accountingContext.token}`)
    }
    const accountingCurrency = BigInt(accountingContext.currency)
    const [balance, currentSurplus, payoutLimits, surplusAllowances, symbol] = await Promise.all([
      client.readContract({
        address: store,
        abi: FUND_ACCESS_STORE_ABI,
        functionName: 'balanceOf',
        args: [terminal, projectId, accountingContext.token],
      }),
      client.readContract({
        address: terminal,
        abi: FUND_ACCESS_TERMINAL_ABI,
        functionName: 'currentSurplusOf',
        args: [projectId, [accountingContext.token], BigInt(decimals), accountingCurrency],
      }),
      client.readContract({
        address: fundAccessLimits,
        abi: FUND_ACCESS_LIMITS_ABI,
        functionName: 'payoutLimitsOf',
        args: [projectId, BigInt(ruleset.id), terminal, accountingContext.token],
      }),
      client.readContract({
        address: fundAccessLimits,
        abi: FUND_ACCESS_LIMITS_ABI,
        functionName: 'surplusAllowancesOf',
        args: [projectId, BigInt(ruleset.id), terminal, accountingContext.token],
      }),
      tokenSymbol(client, chainId, accountingContext.token),
    ])

    const duplicatePayoutCurrencies = new Set<string>()
    const resolvedPayouts = await Promise.all(payoutLimits.map(async limit => {
      const currency = BigInt(limit.currency)
      if (duplicatePayoutCurrencies.has(currency.toString())) throw new Error(`Duplicate payout currency ${currency}`)
      duplicatePayoutCurrencies.add(currency.toString())
      const [used, pricePerUnit] = await Promise.all([
        client.readContract({
          address: store,
          abi: FUND_ACCESS_STORE_ABI,
          functionName: 'usedPayoutLimitOf',
          args: [terminal, projectId, accountingContext.token, BigInt(ruleset.cycleNumber), currency],
        }),
        priceFor(client, prices, projectId, currency, accountingCurrency),
      ])
      const configured = BigInt(limit.amount)
      const remaining = remainingAccessAmount(configured, used)
      const sourceInCurrency = accountingAmountInConfiguredCurrency(balance, pricePerUnit)
      return {
        configured,
        used,
        remaining,
        currency,
        pricePerUnit,
        sourceInCurrency,
        available: remaining < sourceInCurrency ? remaining : sourceInCurrency,
        unlimited: configured === MAX_UINT224,
      }
    }))

    const duplicateAllowanceCurrencies = new Set<string>()
    const resolvedAllowances = await Promise.all(surplusAllowances.map(async allowance => {
      const currency = BigInt(allowance.currency)
      if (duplicateAllowanceCurrencies.has(currency.toString())) throw new Error(`Duplicate allowance currency ${currency}`)
      duplicateAllowanceCurrencies.add(currency.toString())
      const [used, pricePerUnit] = await Promise.all([
        client.readContract({
          address: store,
          abi: FUND_ACCESS_STORE_ABI,
          functionName: 'usedSurplusAllowanceOf',
          args: [terminal, projectId, accountingContext.token, BigInt(ruleset.id), currency],
        }),
        priceFor(client, prices, projectId, currency, accountingCurrency),
      ])
      const configured = BigInt(allowance.amount)
      const remaining = remainingAccessAmount(configured, used)
      const sourceInCurrency = accountingAmountInConfiguredCurrency(currentSurplus, pricePerUnit)
      return {
        configured,
        used,
        remaining,
        currency,
        pricePerUnit,
        sourceInCurrency,
        available: remaining < sourceInCurrency ? remaining : sourceInCurrency,
        unlimited: configured === MAX_UINT224,
      }
    }))

    return {
      projectId,
      terminal,
      store,
      prices,
      rulesets,
      fundAccessLimits,
      token: accountingContext.token,
      tokenSymbol: symbol,
      decimals,
      accountingCurrency,
      rulesetId: BigInt(ruleset.id),
      rulesetCycleNumber: BigInt(ruleset.cycleNumber),
      balance,
      currentSurplus,
      payoutLimits: resolvedPayouts,
      surplusAllowances: resolvedAllowances,
    }
  }))
}

export async function prepareFundAccessTransaction(params: {
  client: PublicClient
  chainId: number
  projectId: bigint
  token: Address
  currency: bigint
  amount: bigint
  account: Address
  kind: FundAccessKind
}): Promise<PreparedFundAccessTransaction> {
  if (params.amount <= 0n) throw new Error('Enter an amount greater than zero')
  const contexts = await readFundAccessContexts(params.client, params.chainId, params.projectId)
  const matchingContexts = contexts.filter(context => sameAddress(context.token, params.token))
  if (matchingContexts.length !== 1) throw new Error('The selected accounting context changed')
  const context = matchingContexts[0]
  const candidates = params.kind === 'payout' ? context.payoutLimits : context.surplusAllowances
  const matches = candidates.filter(candidate => candidate.currency === params.currency)
  if (matches.length !== 1) throw new Error(`The selected ${params.kind} currency changed`)
  const access = matches[0]
  if (access.remaining <= 0n) throw new Error(`The ${params.kind === 'payout' ? 'payout limit' : 'surplus allowance'} is depleted`)
  if (params.amount > access.available) {
    throw new Error(params.kind === 'payout'
      ? 'The terminal balance or price changed. Review the updated available amount and try again.'
      : 'The current surplus or price changed. Review the updated available amount and try again.')
  }

  let quotedAmount: bigint
  let minimumOutput: bigint
  let data: Hex
  let review: PreparedFundAccessTransaction['review']
  if (params.kind === 'payout') {
    const quoteArgs = [params.projectId, context.token, params.amount, params.currency, 0n] as const
    const simulation = await params.client.simulateContract({
      account: params.account,
      address: context.terminal,
      abi: FUND_ACCESS_TERMINAL_ABI,
      functionName: 'sendPayoutsOf',
      args: quoteArgs,
    })
    quotedAmount = simulation.result
    minimumOutput = protectedFundAccessOutput(quotedAmount, params.currency === context.accountingCurrency)
    if (minimumOutput <= 0n) throw new Error('This payout would send zero terminal tokens')
    const finalArgs = [params.projectId, context.token, params.amount, params.currency, minimumOutput] as const
    await params.client.simulateContract({
      account: params.account,
      address: context.terminal,
      abi: FUND_ACCESS_TERMINAL_ABI,
      functionName: 'sendPayoutsOf',
      args: finalArgs,
    })
    data = encodeFunctionData({
      abi: FUND_ACCESS_TERMINAL_ABI,
      functionName: 'sendPayoutsOf',
      args: finalArgs,
    })
    review = { abi: FUND_ACCESS_TERMINAL_ABI, functionName: 'sendPayoutsOf', args: finalArgs }
  } else {
    const quoteArgs = [
      params.projectId,
      context.token,
      params.amount,
      params.currency,
      0n,
      params.account,
      params.account,
      '',
    ] as const
    const simulation = await params.client.simulateContract({
      account: params.account,
      address: context.terminal,
      abi: FUND_ACCESS_TERMINAL_ABI,
      functionName: 'useAllowanceOf',
      args: quoteArgs,
    })
    quotedAmount = simulation.result
    minimumOutput = protectedFundAccessOutput(quotedAmount, params.currency === context.accountingCurrency)
    if (minimumOutput <= 0n) throw new Error('This withdrawal would return zero terminal tokens')
    const finalArgs = [
      params.projectId,
      context.token,
      params.amount,
      params.currency,
      minimumOutput,
      params.account,
      params.account,
      '',
    ] as const
    await params.client.simulateContract({
      account: params.account,
      address: context.terminal,
      abi: FUND_ACCESS_TERMINAL_ABI,
      functionName: 'useAllowanceOf',
      args: finalArgs,
    })
    data = encodeFunctionData({
      abi: FUND_ACCESS_TERMINAL_ABI,
      functionName: 'useAllowanceOf',
      args: finalArgs,
    })
    review = { abi: FUND_ACCESS_TERMINAL_ABI, functionName: 'useAllowanceOf', args: finalArgs }
  }

  return { target: context.terminal, data, quotedAmount, minimumOutput, context, access, review }
}

export function fundAccessErrorMessage(error: unknown, kind: FundAccessKind): string {
  const text = collectErrorText(error).join(' | ')
  const normalized = text.toLowerCase()
  if (
    normalized.includes('0x9fa59b9a') ||
    normalized.includes('jbterminalstore_inadequateterminalstorebalance')
  ) {
    return kind === 'payout'
      ? 'The terminal balance or price changed. Review the updated available amount and try again.'
      : 'The current surplus or price changed. Review the updated available amount and try again.'
  }
  if (normalized.includes('jbterminalstore_inadequatecontrollerallowance')) {
    return 'The selected surplus allowance changed or is depleted. Refresh the live configuration and try again.'
  }
  if (normalized.includes('jbmultiterminal_undermin')) {
    return 'The live terminal-token quote changed below the protected minimum. Refresh and try again.'
  }
  return text || (kind === 'payout' ? 'Could not safely prepare this payout.' : 'Could not safely prepare this withdrawal.')
}
