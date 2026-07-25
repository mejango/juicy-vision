import {
  createPublicClient,
  fallback,
  formatUnits,
  http,
  type Address,
  type Chain,
  type PublicClient,
} from 'viem'
import {
  jbContractAddress,
  jbFundAccessLimitsAbi,
  jbSplitsAbi,
  NATIVE_TOKEN,
  type JBChainId,
} from '@bananapus/nana-sdk-core'
import {
  getAccountingContexts,
  getAllRulesets,
  getCurrentRuleset,
  getUpcomingRuleset,
  payoutSplitGroupId,
  RESERVED_TOKEN_SPLIT_GROUP_ID,
  type JBRulesetWithMetadata,
} from '@bananapus/nana-sdk-core/v6'
import {
  ALL_VIEM_CHAINS,
  MAINNET_RPC_ENDPOINTS,
  RPC_ENDPOINTS,
  USDC_ADDRESSES,
  type SupportedChainId,
} from '../constants'
import { formatCutPercent } from './revnetStages'

function formatCarouselCutPercent(value: number): string {
  const percent = value / 1e7
  return percent === 0 || Math.abs(percent) >= 0.01
    ? `${percent.toFixed(2)}%`
    : formatCutPercent(value)
}

// Data layer for the project-page Rulesets carousel — a 1:1 port of the
// website's renderRulesetsFundsSection data model (website/src/discover.js).
// A "cycle" is a ruleset viewed at a cycle offset: real cycles come from the
// controller (past / current / upcoming); everything beyond is a projection
// of the nearest real ruleset with the weight decayed at cycle boundaries.

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address

/** `weightCutPercent` is a fraction out of 1e9 applied once per cycle boundary. */
export const WEIGHT_CUT_DENOMINATOR = 1_000_000_000n

/** JBSplit.percent is a fraction out of 1e9. */
export const SPLITS_TOTAL_PERCENT = 1_000_000_000

/** JBCurrencyAmount amounts at/above this sentinel render as "Unlimited". */
export const UNLIMITED_FUND_ACCESS_FLOOR = 2n ** 200n

export interface CycleRules {
  cycleNumber: number
  id: number
  basedOnId: number
  start: number
  duration: number
  weight: bigint
  weightCutPercent: number
  approvalHook: Address
}

export interface CycleMetadata {
  reservedPercent: number
  cashOutTaxRate: number
  baseCurrency: number
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
  scopeCashOutsToLocalBalances: boolean
  useDataHookForPay: boolean
  useDataHookForCashOut: boolean
  dataHook: Address
}

export interface CycleSplit {
  percent: number
  projectId: number
  beneficiary: Address
  preferAddToBalance: boolean
  lockedUntil: number
  hook: Address
}

export interface CycleCurrencyLimit {
  amount: bigint
  currency: number
}

/** Per-accounting-context funds access for one ruleset. */
export interface CycleFundsAccess {
  token: Address
  symbol: string
  decimals: number
  currency: number
  payoutGroupId: bigint
  payoutLimits: CycleCurrencyLimit[]
  surplusAllowances: CycleCurrencyLimit[]
  payoutSplits: CycleSplit[]
}

export type CycleRelation = 'past' | 'current' | 'upcoming' | 'projected'

export interface CarouselCycle {
  relation: CycleRelation
  rules: CycleRules
  metadata: CycleMetadata
  reservedSplits: CycleSplit[]
  fundsAccess: CycleFundsAccess[]
}

export interface RulesetCarouselData {
  chainId: number
  projectId: bigint
  /** Real cycles sorted ascending by cycle number: past… current [upcoming]. */
  cycles: CarouselCycle[]
  /** Index of the current cycle within `cycles`, or -1 when none is active. */
  currentIndex: number
}

// ---------------------------------------------------------------------------
// Projection math
// ---------------------------------------------------------------------------

function roundDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator
}

/**
 * Decay (n > 0) or un-decay (n < 0) a ruleset weight across `n` cycle
 * boundaries: each boundary multiplies by (1e9 - weightCutPercent) / 1e9.
 */
export function projectedWeight(weight: bigint, weightCutPercent: number, n: number): bigint {
  if (n === 0 || weight === 0n) return weight
  const keep = WEIGHT_CUT_DENOMINATOR - BigInt(weightCutPercent)
  if (n > 0) {
    if (keep <= 0n) return 0n
    return roundDiv(weight * keep ** BigInt(n), WEIGHT_CUT_DENOMINATOR ** BigInt(n))
  }
  // A full (or over-full) cut has no pre-image; surface the base weight as-is.
  if (keep <= 0n) return weight
  const back = BigInt(-n)
  return roundDiv(weight * WEIGHT_CUT_DENOMINATOR ** back, keep ** back)
}

/**
 * Project a real cycle `n` cycles forward (or backward) — rules and splits
 * unchanged, weight decayed and start shifted at cycle boundaries.
 */
export function projectCycle(cycle: CarouselCycle, n: number): CarouselCycle {
  if (n === 0) return cycle
  const rules = cycle.rules
  return {
    ...cycle,
    relation: 'projected',
    rules: {
      ...rules,
      cycleNumber: Math.max(1, rules.cycleNumber + n),
      start: rules.start + n * rules.duration,
      weight: projectedWeight(rules.weight, rules.weightCutPercent, n),
    },
  }
}

// ---------------------------------------------------------------------------
// Cross-chain signature
// ---------------------------------------------------------------------------

/**
 * Configuration signature for the cross-chain sync check. Compares the rules
 * and flags that should match across an omnichain project's chains while
 * ignoring per-chain timing (start, cycle number, decayed weight, ids).
 */
export function rulesetSignature(cycle: Pick<CarouselCycle, 'rules' | 'metadata'>): string {
  const r = cycle.rules
  const m = cycle.metadata
  return [
    r.duration,
    r.weightCutPercent,
    m.reservedPercent,
    m.cashOutTaxRate,
    m.baseCurrency,
    m.pausePay,
    m.pauseCreditTransfers,
    m.allowOwnerMinting,
    m.allowSetTerminals,
    m.allowSetController,
    m.allowTerminalMigration,
    m.holdFees,
    m.useDataHookForPay,
    m.useDataHookForCashOut,
    m.dataHook.toLowerCase(),
  ].map(String).join('|')
}

// ---------------------------------------------------------------------------
// Formatting (shared by the rows + the tab component)
// ---------------------------------------------------------------------------

export function truncAddr(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function formatTokenAmount(value: bigint, decimals = 18, maximumFractionDigits = 6): string {
  const [whole, fraction = ''] = formatUnits(value, decimals).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const compact = fraction.slice(0, maximumFractionDigits).replace(/0+$/, '')
  return compact ? `${grouped}.${compact}` : grouped
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'Not set'
  const units: Array<[string, number]> = [['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]]
  const parts: string[] = []
  let remaining = seconds
  for (const [label, size] of units) {
    if (remaining >= size && parts.length < 2) {
      const count = Math.floor(remaining / size)
      remaining -= count * size
      parts.push(`${count} ${label}${count === 1 ? '' : 's'}`)
    }
  }
  return parts.join(' ')
}

/** Coarse single-unit relative time, word form: "2 days" / "3 hours" / "1 minute". */
export function relativeFromNow(seconds: number): string {
  const s = Math.max(0, seconds)
  if (s >= 86400) {
    const d = Math.round(s / 86400)
    return `${d} day${d === 1 ? '' : 's'}`
  }
  if (s >= 3600) {
    const h = Math.round(s / 3600)
    return `${h} hour${h === 1 ? '' : 's'}`
  }
  const m = Math.max(1, Math.round(s / 60))
  return `${m} minute${m === 1 ? '' : 's'}`
}

export function formatDateTime(seconds: number): string {
  try {
    return new Date(seconds * 1000).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return '—'
  }
}

/**
 * Start time: a future start (upcoming / projected cycles) leads with
 * "In <relative>" plus the absolute date; a past start shows the date only.
 */
export function formatStartTime(seconds: number, now = Math.floor(Date.now() / 1000)): string {
  return seconds > now
    ? `In ${relativeFromNow(seconds - now)} (${formatDateTime(seconds)})`
    : formatDateTime(seconds)
}

export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'Ended'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${Math.max(1, minutes)}m`
}

function percentOutOf10000(value: number): string {
  const percent = value / 100
  const text = Number.isInteger(percent) ? String(percent) : percent.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return `${text}%`
}

/** Label for a JB currency id relative to an accounting context. */
export function fundsAccessCurrencyLabel(
  currency: number,
  context: Pick<CycleFundsAccess, 'currency' | 'symbol'>,
): string {
  if (currency === context.currency) return context.symbol
  if (currency === 1) return 'ETH'
  if (currency === 2) return 'USD'
  return `currency ${currency}`
}

/**
 * Render a set of JBCurrencyAmounts, e.g. "None", "Unlimited ETH" or
 * "1.5 ETH + 100 USD". Every amount uses the accounting token's decimals —
 * only the unit changes with the currency.
 */
export function formatFundsAccessLimits(
  limits: CycleCurrencyLimit[],
  context: Pick<CycleFundsAccess, 'currency' | 'symbol' | 'decimals'>,
): string {
  if (!limits.length) return 'None'
  return limits
    .map(limit => {
      const unit = fundsAccessCurrencyLabel(limit.currency, context)
      if (limit.amount >= UNLIMITED_FUND_ACCESS_FLOOR) return `Unlimited ${unit}`
      return `${formatTokenAmount(limit.amount, context.decimals)} ${unit}`
    })
    .join(' + ')
}

// ---------------------------------------------------------------------------
// Rule rows (the two-column detail + diffing source of truth)
// ---------------------------------------------------------------------------

export interface RulesetRow {
  section: string
  label: string
  value: string
}

/**
 * The flat rule rows for one cycle, 1:1 with the website's rulesetRows.
 * `baseUnit` is the base-currency unit label (e.g. "ETH", "USD").
 */
export function rulesetRows(
  cycle: Pick<CarouselCycle, 'rules' | 'metadata'>,
  baseUnit: string,
  now = Math.floor(Date.now() / 1000),
): RulesetRow[] {
  const r = cycle.rules
  const m = cycle.metadata
  const enabled = (flag: boolean) => (flag ? 'Enabled' : 'Disabled')
  return [
    { section: 'CYCLE', label: 'Duration', value: r.duration ? formatDuration(r.duration) : 'Not set' },
    { section: 'CYCLE', label: 'Start time', value: formatStartTime(r.start, now) },
    {
      section: 'CYCLE',
      label: 'Rule change deadline',
      value: r.approvalHook && r.approvalHook !== ZERO_ADDRESS ? truncAddr(r.approvalHook) : 'No deadline',
    },
    {
      section: 'TOKEN',
      label: 'Total issuance rate',
      value: `${r.weight === 0n ? '0' : formatTokenAmount(r.weight, 18)} / ${baseUnit}`,
    },
    { section: 'TOKEN', label: 'Reserved rate', value: percentOutOf10000(m.reservedPercent) },
    { section: 'TOKEN', label: 'Issuance cut percent', value: formatCarouselCutPercent(r.weightCutPercent) },
    { section: 'TOKEN', label: 'Cash out tax rate', value: percentOutOf10000(m.cashOutTaxRate) },
    // The v6 flag is scoped-to-local-balances; the website row is the inverse.
    { section: 'TOKEN', label: 'Cash outs use total surplus', value: enabled(!m.scopeCashOutsToLocalBalances) },
    { section: 'TOKEN', label: 'Base currency', value: baseUnit },
    { section: 'TOKEN', label: 'Owner token minting', value: enabled(m.allowOwnerMinting) },
    { section: 'TOKEN', label: 'Token transfers', value: m.pauseCreditTransfers ? 'Disabled' : 'Enabled' },
    { section: 'OTHER RULES', label: 'Payments to this project', value: m.pausePay ? 'Disabled' : 'Enabled' },
    { section: 'OTHER RULES', label: 'Hold fees', value: enabled(m.holdFees) },
    { section: 'OTHER RULES', label: 'Owner must send payouts', value: enabled(m.ownerMustSendPayouts) },
    { section: 'OTHER RULES', label: 'Set payment terminals', value: enabled(m.allowSetTerminals) },
    { section: 'OTHER RULES', label: 'Set controller', value: enabled(m.allowSetController) },
    { section: 'OTHER RULES', label: 'Migrate payment terminal', value: enabled(m.allowTerminalMigration) },
    { section: 'OTHER RULES', label: 'Set custom token', value: enabled(m.allowSetCustomToken) },
    { section: 'OTHER RULES', label: 'Add accounting context', value: enabled(m.allowAddAccountingContext) },
    { section: 'OTHER RULES', label: 'Add price feed', value: enabled(m.allowAddPriceFeed) },
    {
      section: 'EXTENSION',
      label: 'Data hook',
      value: m.dataHook && m.dataHook !== ZERO_ADDRESS ? truncAddr(m.dataHook) : 'None',
    },
    { section: 'EXTENSION', label: 'Use for payments', value: enabled(m.useDataHookForPay) },
    { section: 'EXTENSION', label: 'Use for cash outs', value: enabled(m.useDataHookForCashOut) },
  ]
}

export interface RuleChange {
  section: string
  label: string
  from: string
  to: string
}

/** Rows that differ between two cycles (Start time always differs, so it's skipped). */
export function ruleChanges(
  fromCycle: Pick<CarouselCycle, 'rules' | 'metadata'>,
  toCycle: Pick<CarouselCycle, 'rules' | 'metadata'>,
  baseUnitFrom: string,
  baseUnitTo: string,
): RuleChange[] {
  const fromRows = rulesetRows(fromCycle, baseUnitFrom)
  const toRows = rulesetRows(toCycle, baseUnitTo)
  const changes: RuleChange[] = []
  toRows.forEach((row, i) => {
    const before = fromRows[i]
    if (!before || row.label === 'Start time') return
    if (before.value !== row.value) {
      changes.push({ section: row.section, label: row.label, from: before.value, to: row.value })
    }
  })
  return changes
}

// ---------------------------------------------------------------------------
// Onchain loading
// ---------------------------------------------------------------------------

/** How many real past rulesets to hydrate with splits + fund-access config. */
const PAST_CYCLE_LIMIT = 8

const ERC20_SYMBOL_ABI = [{
  name: 'symbol',
  type: 'function',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'string' }],
}] as const

function createCarouselClient(chainId: number): PublicClient {
  const chain = (ALL_VIEM_CHAINS as Readonly<Record<number, Chain>>)[chainId]
  const rpcUrls = RPC_ENDPOINTS[chainId] || MAINNET_RPC_ENDPOINTS[chainId] || chain?.rpcUrls.default.http
  if (!chain || !rpcUrls?.length) throw new Error(`Rulesets are unavailable on unsupported chain ${chainId}`)
  return createPublicClient({ chain, transport: fallback(rpcUrls.map(url => http(url))) }) as PublicClient
}

function v6Address(contract: 'JBSplits' | 'JBFundAccessLimits' | 'JBMultiTerminal', chainId: number): Address {
  const address = (jbContractAddress['6'][contract] as Record<string, Address | undefined>)[String(chainId)]
  if (!address) throw new Error(`No v6 ${contract} deployment on chain ${chainId}`)
  return address
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

function decodeRules(ruleset: JBRulesetWithMetadata['ruleset']): CycleRules {
  return {
    cycleNumber: Number(ruleset.cycleNumber),
    id: Number(ruleset.id),
    basedOnId: Number(ruleset.basedOnId),
    start: Number(ruleset.start),
    duration: Number(ruleset.duration),
    weight: BigInt(ruleset.weight),
    weightCutPercent: Number(ruleset.weightCutPercent),
    approvalHook: ruleset.approvalHook as Address,
  }
}

function decodeMetadata(metadata: JBRulesetWithMetadata['metadata']): CycleMetadata {
  return {
    reservedPercent: Number(metadata.reservedPercent),
    cashOutTaxRate: Number(metadata.cashOutTaxRate),
    baseCurrency: Number(metadata.baseCurrency),
    pausePay: metadata.pausePay,
    pauseCreditTransfers: metadata.pauseCreditTransfers,
    allowOwnerMinting: metadata.allowOwnerMinting,
    allowSetCustomToken: metadata.allowSetCustomToken,
    allowTerminalMigration: metadata.allowTerminalMigration,
    allowSetTerminals: metadata.allowSetTerminals,
    allowSetController: metadata.allowSetController,
    allowAddAccountingContext: metadata.allowAddAccountingContext,
    allowAddPriceFeed: metadata.allowAddPriceFeed,
    ownerMustSendPayouts: metadata.ownerMustSendPayouts,
    holdFees: metadata.holdFees,
    scopeCashOutsToLocalBalances: metadata.scopeCashOutsToLocalBalances,
    useDataHookForPay: metadata.useDataHookForPay,
    useDataHookForCashOut: metadata.useDataHookForCashOut,
    dataHook: metadata.dataHook as Address,
  }
}

function decodeSplits(splits: readonly {
  percent: number
  projectId: bigint
  beneficiary: Address
  preferAddToBalance: boolean
  lockedUntil: number
  hook: Address
}[]): CycleSplit[] {
  return splits.map(split => ({
    percent: Number(split.percent),
    projectId: Number(split.projectId),
    beneficiary: split.beneficiary,
    preferAddToBalance: split.preferAddToBalance,
    lockedUntil: Number(split.lockedUntil),
    hook: split.hook,
  }))
}

async function tokenSymbol(client: PublicClient, chainId: number, token: Address): Promise<string> {
  if (sameAddress(token, NATIVE_TOKEN)) return 'ETH'
  const usdc = USDC_ADDRESSES[chainId as SupportedChainId]
  if (usdc && sameAddress(token, usdc)) return 'USDC'
  try {
    const symbol = await client.readContract({ address: token, abi: ERC20_SYMBOL_ABI, functionName: 'symbol' })
    if (/^[\x20-\x7e]{1,16}$/.test(symbol)) return symbol
  } catch {
    // A non-standard symbol must not block rendering an accounting context.
  }
  return truncAddr(token)
}

interface AccountingContextInfo {
  token: Address
  decimals: number
  currency: number
  symbol: string
}

/** Splits + fund-access config for one real ruleset id. */
async function loadCycleConfig(
  client: PublicClient,
  chainId: number,
  projectId: bigint,
  rulesetId: number,
  contexts: AccountingContextInfo[],
): Promise<{ reservedSplits: CycleSplit[]; fundsAccess: CycleFundsAccess[] }> {
  const splitsAddress = v6Address('JBSplits', chainId)
  const limitsAddress = v6Address('JBFundAccessLimits', chainId)
  const terminal = v6Address('JBMultiTerminal', chainId)
  const rulesetIdArg = BigInt(rulesetId)

  const [reserved, fundsAccess] = await Promise.all([
    client.readContract({
      address: splitsAddress,
      abi: jbSplitsAbi,
      functionName: 'splitsOf',
      args: [projectId, rulesetIdArg, RESERVED_TOKEN_SPLIT_GROUP_ID],
    }),
    Promise.all(contexts.map(async context => {
      const payoutGroupId = payoutSplitGroupId(context.token)
      const [payoutLimits, surplusAllowances, payoutSplits] = await Promise.all([
        client.readContract({
          address: limitsAddress,
          abi: jbFundAccessLimitsAbi,
          functionName: 'payoutLimitsOf',
          args: [projectId, rulesetIdArg, terminal, context.token],
        }),
        client.readContract({
          address: limitsAddress,
          abi: jbFundAccessLimitsAbi,
          functionName: 'surplusAllowancesOf',
          args: [projectId, rulesetIdArg, terminal, context.token],
        }),
        client.readContract({
          address: splitsAddress,
          abi: jbSplitsAbi,
          functionName: 'splitsOf',
          args: [projectId, rulesetIdArg, payoutGroupId],
        }),
      ])
      return {
        token: context.token,
        symbol: context.symbol,
        decimals: context.decimals,
        currency: context.currency,
        payoutGroupId,
        payoutLimits: payoutLimits.map(limit => ({ amount: BigInt(limit.amount), currency: Number(limit.currency) })),
        surplusAllowances: surplusAllowances.map(allowance => ({
          amount: BigInt(allowance.amount),
          currency: Number(allowance.currency),
        })),
        payoutSplits: decodeSplits(payoutSplits),
      }
    })),
  ])

  return { reservedSplits: decodeSplits(reserved), fundsAccess }
}

/**
 * Load everything the Rulesets carousel needs for one chain: the current
 * ruleset, the distinct queued upcoming one (when any), recent real past
 * rulesets, and — per real cycle — reserved splits plus per-accounting-context
 * fund-access limits and payout splits.
 */
export async function loadRulesetCarousel(
  projectId: string | number | bigint,
  chainId: number,
): Promise<RulesetCarouselData> {
  const id = BigInt(projectId)
  if (id <= 0n) throw new Error('Project ID is invalid')
  const client = createCarouselClient(chainId)
  const jbChainId = chainId as JBChainId

  const [current, upcoming, all, rawContexts] = await Promise.all([
    getCurrentRuleset(client, { chainId: jbChainId, projectId: id }),
    getUpcomingRuleset(client, { chainId: jbChainId, projectId: id }).catch(() => null),
    getAllRulesets(client, { chainId: jbChainId, projectId: id }).catch(() => [] as readonly JBRulesetWithMetadata[]),
    getAccountingContexts(client, { chainId: jbChainId, projectId: id }).catch(() => []),
  ])

  const currentRules = decodeRules(current.ruleset)
  if (currentRules.id === 0) return { chainId, projectId: id, cycles: [], currentIndex: -1 }

  const contexts: AccountingContextInfo[] = await Promise.all(rawContexts.map(async context => ({
    token: context.token as Address,
    decimals: Number(context.decimals),
    currency: Number(context.currency),
    symbol: await tokenSymbol(client, chainId, context.token as Address),
  })))

  // The distinct queued upcoming ruleset — a zero id or the current id means none.
  const upcomingRules = upcoming ? decodeRules(upcoming.ruleset) : null
  const hasUpcoming = !!upcomingRules && upcomingRules.id !== 0 && upcomingRules.id !== currentRules.id

  // Real past rulesets: everything that started before the current one.
  const past = all
    .map(entry => ({ rules: decodeRules(entry.ruleset), metadata: decodeMetadata(entry.metadata) }))
    .filter(entry => entry.rules.id !== 0 && entry.rules.start < currentRules.start && entry.rules.id !== currentRules.id)
    .sort((a, b) => a.rules.cycleNumber - b.rules.cycleNumber)
    .slice(-PAST_CYCLE_LIMIT)

  const skeletons: Array<{ relation: CycleRelation; rules: CycleRules; metadata: CycleMetadata }> = [
    ...past.map(entry => ({ relation: 'past' as CycleRelation, ...entry })),
    { relation: 'current', rules: currentRules, metadata: decodeMetadata(current.metadata) },
    ...(hasUpcoming && upcoming
      ? [{ relation: 'upcoming' as CycleRelation, rules: upcomingRules, metadata: decodeMetadata(upcoming.metadata) }]
      : []),
  ]

  // Splits and fund-access config are keyed by ruleset id — hydrate each real
  // cycle once and share the result across duplicates.
  const configByRulesetId = new Map<number, Promise<{ reservedSplits: CycleSplit[]; fundsAccess: CycleFundsAccess[] }>>()
  for (const skeleton of skeletons) {
    if (!configByRulesetId.has(skeleton.rules.id)) {
      configByRulesetId.set(
        skeleton.rules.id,
        loadCycleConfig(client, chainId, id, skeleton.rules.id, contexts)
          .catch(() => ({ reservedSplits: [], fundsAccess: [] })),
      )
    }
  }

  const cycles = await Promise.all(skeletons.map(async skeleton => ({
    ...skeleton,
    ...(await configByRulesetId.get(skeleton.rules.id)!),
  })))

  return { chainId, projectId: id, cycles, currentIndex: cycles.findIndex(cycle => cycle.relation === 'current') }
}

/**
 * The current ruleset's config signature on one chain, for the cross-chain
 * sync check. Null when the chain has no active ruleset or can't be read.
 */
export async function loadChainRulesetSignature(
  projectId: string | number | bigint,
  chainId: number,
): Promise<string | null> {
  try {
    const client = createCarouselClient(chainId)
    const current = await getCurrentRuleset(client, { chainId: chainId as JBChainId, projectId: BigInt(projectId) })
    const rules = decodeRules(current.ruleset)
    if (rules.id === 0) return null
    return rulesetSignature({ rules, metadata: decodeMetadata(current.metadata) })
  } catch {
    return null
  }
}
