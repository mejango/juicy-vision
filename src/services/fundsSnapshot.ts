import { formatUnits, type Address, type PublicClient } from 'viem'
import {
  getProjectTerminalStore,
  jbContractAddress,
  jbFundAccessLimitsAbi,
  jbTerminalStoreAbi,
  type JBChainId,
} from '@bananapus/nana-sdk-core'
import { getAccountingContexts, getCurrentRuleset } from '@bananapus/nana-sdk-core/v6'
import { NATIVE_TOKEN, USDC_ADDRESSES, type SupportedChainId } from '../constants'
import { createFundAccessClient, remainingAccessAmount } from './fundAccess'

/**
 * Funds-tab data layer: per accounting-token KIND, per-chain live treasury
 * rows read straight from the deployed V6 contract graph (JBTerminalStore +
 * JBFundAccessLimits, scoped to the current ruleset).
 *
 * Invariant: a kind's cross-chain totals are only produced when EVERY chain
 * read succeeded. A single failed chain suppresses the aggregate (null)
 * instead of making it silently look smaller.
 */

/** Access amounts at or above this sentinel are configured as "Unlimited". */
export const UNLIMITED_ACCESS_THRESHOLD = 1n << 200n

export function isUnlimitedAccessAmount(amount: bigint): boolean {
  return amount >= UNLIMITED_ACCESS_THRESHOLD
}

/** One accounting-token kind (ETH, USDC, or a custom accounting ERC-20). */
export interface FundsKind {
  /** Stable key: 'native' | 'usdc' | lowercased token address. */
  key: string
  symbol: string
  name: string
  decimals: number
  /** The kind's token address on the project's home chain. */
  homeToken: Address
  /** The kind's token address on a given chain (USDC differs per chain). */
  tokenOf(chainId: number): Address | null
}

/** One configured payout limit / surplus allowance entry, with live usage. */
export interface FundsAccessAmount {
  currency: number
  configured: bigint
  used: bigint
  remaining: bigint
  unlimited: boolean
}

/** Live per-chain state for one kind. `ok: false` means the read failed. */
export interface FundsChainRow {
  chainId: number
  projectId: number
  ok: boolean
  balance: bigint | null
  surplus: bigint | null
  /** Primary payout limit (accounting-currency entry when present, else the first). */
  payoutLimit: bigint | null
  usedPayout: bigint | null
  remainingPayout: bigint | null
  /** Primary surplus allowance (same selection rule as the payout limit). */
  allowance: bigint | null
  usedAllowance: bigint | null
  usedPayoutUnlimited: boolean
  usedAllowanceUnlimited: boolean
  /** The accounting context's currency id, or null when the read failed. */
  currency: number | null
  decimals: number
  rulesetId: bigint | null
  /** Every configured payout-limit / allowance currency entry (for display). */
  payouts: FundsAccessAmount[]
  allowances: FundsAccessAmount[]
}

export interface FundsKindTotals {
  /** True only when every chain row for this kind read successfully. */
  allChainsOk: boolean
  balance: bigint | null
  surplus: bigint | null
  remainingPayout: bigint | null
  /** True when any chain's primary payout limit is the unlimited sentinel. */
  remainingPayoutUnlimited: boolean
}

export interface FundsKindSnapshot {
  kind: FundsKind
  rows: FundsChainRow[]
  totals: FundsKindTotals
}

export interface FundsSnapshot {
  kinds: FundsKindSnapshot[]
}

export interface FundsProjectRef {
  projectId: number | string
  chainId: number
}

export type FundsChainRef = number | { chainId: number; projectId: number }

export interface FundsSnapshotDeps {
  getClient?: (chainId: number) => PublicClient
}

// ---------------------------------------------------------------------------
// Kinds (ported from the website's nativeFundsKind/usdcFundsKind/customFundsKind)
// ---------------------------------------------------------------------------

export function nativeFundsKind(decimals?: number | null): FundsKind {
  return {
    key: 'native',
    symbol: 'ETH',
    name: 'Ether',
    decimals: decimals == null ? 18 : Number(decimals),
    homeToken: NATIVE_TOKEN,
    tokenOf: () => NATIVE_TOKEN,
  }
}

export function usdcFundsKind(homeChainId: number, decimals?: number | null): FundsKind {
  return {
    key: 'usdc',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: decimals == null ? 6 : Number(decimals),
    homeToken: USDC_ADDRESSES[homeChainId as SupportedChainId],
    tokenOf: chainId => USDC_ADDRESSES[chainId as SupportedChainId] ?? null,
  }
}

export function customFundsKind(meta: {
  address: Address
  symbol?: string
  name?: string
  decimals?: number | null
}): FundsKind {
  const address = meta.address
  return {
    key: address.toLowerCase(),
    symbol: meta.symbol || `${address.slice(0, 6)}…${address.slice(-4)}`,
    name: meta.name || '',
    decimals: meta.decimals == null ? 18 : Number(meta.decimals),
    homeToken: address,
    // Omnichain accounting ERC-20s deploy to the same address on every chain.
    tokenOf: () => address,
  }
}

/**
 * Classify the home chain's live accounting contexts into funds kinds.
 * A project accepting both ETH and USDC yields two kinds.
 */
export async function resolveFundsKinds(
  client: PublicClient,
  project: FundsProjectRef,
): Promise<FundsKind[]> {
  const contexts = await getAccountingContexts(client, {
    chainId: project.chainId as JBChainId,
    projectId: BigInt(project.projectId),
  })
  const usdcHome = (USDC_ADDRESSES[project.chainId as SupportedChainId] || '').toLowerCase()
  return contexts.map(context => {
    const token = context.token.toLowerCase()
    const decimals = Number(context.decimals)
    if (token === NATIVE_TOKEN.toLowerCase()) return nativeFundsKind(decimals)
    if (usdcHome && token === usdcHome) return usdcFundsKind(project.chainId, decimals)
    return customFundsKind({ address: context.token, decimals })
  })
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Format a raw amount in the kind's own decimals (NEVER assume 18: USDC is 6). */
export function formatKindAmount(value: bigint | null, decimals: number, symbol: string): string {
  if (value == null) return '—'
  const exact = formatUnits(value, decimals)
  const [whole, fraction = ''] = exact.split('.')
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const compactFraction = fraction.slice(0, 6).replace(/0+$/, '')
  return `${compactFraction ? `${groupedWhole}.${compactFraction}` : groupedWhole} ${symbol}`
}

function accessCurrencySymbol(currency: number, accountingCurrency: number | null, symbol: string): string {
  if (accountingCurrency != null && currency === accountingCurrency) return symbol
  if (currency === 1) return 'ETH'
  if (currency === 2) return 'USD'
  return `Currency ${currency}`
}

/** "Unlimited SYMBOL" at/above the 2^200 sentinel, else the formatted amount. */
export function accessAmountLabel(
  amount: bigint,
  currency: number,
  row: Pick<FundsChainRow, 'currency' | 'decimals'>,
  symbol: string,
): string {
  const unit = accessCurrencySymbol(currency, row.currency, symbol)
  if (isUnlimitedAccessAmount(amount)) return `Unlimited ${unit}`
  return formatKindAmount(amount, row.decimals, unit)
}

/**
 * Human label for a chain's configured access entries: "0 SYMBOL" when none,
 * entries joined with " + " otherwise (a token can have limits in several
 * currencies within one ruleset).
 */
export function formatAccessRows(
  entries: FundsAccessAmount[],
  row: Pick<FundsChainRow, 'currency' | 'decimals'>,
  symbol: string,
): string {
  if (!entries.length) return `0 ${symbol}`
  return entries
    .map(entry => accessAmountLabel(entry.remaining, entry.currency, row, symbol))
    .join(' + ')
}

// ---------------------------------------------------------------------------
// Per-chain reads
// ---------------------------------------------------------------------------

function primaryAccessEntry(
  entries: FundsAccessAmount[],
  accountingCurrency: number,
): FundsAccessAmount {
  const matching = entries.find(entry => entry.currency === accountingCurrency)
  const entry = matching ?? entries[0]
  return (
    entry ?? {
      currency: accountingCurrency,
      configured: 0n,
      used: 0n,
      remaining: 0n,
      unlimited: false,
    }
  )
}

function failedRow(chainId: number, projectId: number, decimals: number): FundsChainRow {
  return {
    chainId,
    projectId,
    ok: false,
    balance: null,
    surplus: null,
    payoutLimit: null,
    usedPayout: null,
    remainingPayout: null,
    allowance: null,
    usedAllowance: null,
    usedPayoutUnlimited: false,
    usedAllowanceUnlimited: false,
    currency: null,
    decimals,
    rulesetId: null,
    payouts: [],
    allowances: [],
  }
}

/**
 * Live, cycle-aware fund access for one kind on one chain. Configured limits
 * alone are not "available": payout usage is tracked per ruleset CYCLE and
 * surplus-allowance usage per ruleset ID.
 */
export async function readFundsChainRow(
  client: PublicClient,
  kind: FundsKind,
  chainId: number,
  projectId: number,
): Promise<FundsChainRow> {
  const chain = chainId as JBChainId
  const pid = BigInt(projectId)
  const contracts = jbContractAddress['6']
  const terminal = contracts.JBMultiTerminal[chain]
  const store = getProjectTerminalStore(chain, 6)
  const fundAccessLimits = contracts.JBFundAccessLimits[chain]
  const token = kind.tokenOf(chainId)
  if (!terminal || !store || !fundAccessLimits || !token) {
    throw new Error(`Fund access contracts are unavailable on chain ${chainId}`)
  }

  const [contexts, current] = await Promise.all([
    getAccountingContexts(client, { chainId: chain, projectId: pid }),
    getCurrentRuleset(client, { chainId: chain, projectId: pid }),
  ])
  const context = contexts.find(candidate => candidate.token.toLowerCase() === token.toLowerCase())
  if (!context) throw new Error(`No ${kind.symbol} accounting context on chain ${chainId}`)
  if (Number(context.decimals) !== kind.decimals) {
    throw new Error(`The accounting token decimals differ on chain ${chainId}`)
  }
  const rulesetId = BigInt(current.ruleset.id)
  const cycleNumber = BigInt(current.ruleset.cycleNumber)
  if (rulesetId === 0n) throw new Error(`No current ruleset on chain ${chainId}`)

  const decimals = Number(context.decimals)
  const currency = Number(context.currency)

  const [balance, surplus, payoutLimits, surplusAllowances] = await Promise.all([
    client.readContract({
      address: store,
      abi: jbTerminalStoreAbi,
      functionName: 'balanceOf',
      args: [terminal, pid, token],
    }),
    client.readContract({
      address: store,
      abi: jbTerminalStoreAbi,
      functionName: 'currentSurplusOf',
      args: [pid, [terminal], [token], BigInt(decimals), BigInt(currency)],
    }),
    client.readContract({
      address: fundAccessLimits,
      abi: jbFundAccessLimitsAbi,
      functionName: 'payoutLimitsOf',
      args: [pid, rulesetId, terminal, token],
    }),
    client.readContract({
      address: fundAccessLimits,
      abi: jbFundAccessLimitsAbi,
      functionName: 'surplusAllowancesOf',
      args: [pid, rulesetId, terminal, token],
    }),
  ])

  const payouts = await Promise.all(
    payoutLimits.map(async (limit): Promise<FundsAccessAmount> => {
      const used = await client.readContract({
        address: store,
        abi: jbTerminalStoreAbi,
        functionName: 'usedPayoutLimitOf',
        args: [terminal, pid, token, cycleNumber, BigInt(limit.currency)],
      })
      const configured = BigInt(limit.amount)
      return {
        currency: Number(limit.currency),
        configured,
        used,
        remaining: remainingAccessAmount(configured, used),
        unlimited: isUnlimitedAccessAmount(configured),
      }
    }),
  )
  const allowances = await Promise.all(
    surplusAllowances.map(async (allowance): Promise<FundsAccessAmount> => {
      const used = await client.readContract({
        address: store,
        abi: jbTerminalStoreAbi,
        functionName: 'usedSurplusAllowanceOf',
        args: [terminal, pid, token, rulesetId, BigInt(allowance.currency)],
      })
      const configured = BigInt(allowance.amount)
      return {
        currency: Number(allowance.currency),
        configured,
        used,
        remaining: remainingAccessAmount(configured, used),
        unlimited: isUnlimitedAccessAmount(configured),
      }
    }),
  )

  const primaryPayout = primaryAccessEntry(payouts, currency)
  const primaryAllowance = primaryAccessEntry(allowances, currency)
  return {
    chainId,
    projectId,
    ok: true,
    balance,
    surplus,
    payoutLimit: primaryPayout.configured,
    usedPayout: primaryPayout.used,
    remainingPayout: primaryPayout.remaining,
    allowance: primaryAllowance.configured,
    usedAllowance: primaryAllowance.used,
    usedPayoutUnlimited: primaryPayout.unlimited,
    usedAllowanceUnlimited: primaryAllowance.unlimited,
    currency,
    decimals,
    rulesetId,
    payouts,
    allowances,
  }
}

// ---------------------------------------------------------------------------
// Totals + snapshot
// ---------------------------------------------------------------------------

/** Cross-chain totals. Any failed chain suppresses every total (null). */
export function kindTotals(rows: FundsChainRow[]): FundsKindTotals {
  const allChainsOk = rows.length > 0 && rows.every(row => row.ok)
  if (!allChainsOk) {
    return {
      allChainsOk: false,
      balance: null,
      surplus: null,
      remainingPayout: null,
      remainingPayoutUnlimited: false,
    }
  }
  const remainingPayoutUnlimited = rows.some(row => row.usedPayoutUnlimited)
  return {
    allChainsOk: true,
    balance: rows.reduce((sum, row) => sum + (row.balance ?? 0n), 0n),
    surplus: rows.reduce((sum, row) => sum + (row.surplus ?? 0n), 0n),
    // An unlimited sentinel on any chain makes a numeric sum meaningless.
    remainingPayout: remainingPayoutUnlimited
      ? null
      : rows.reduce((sum, row) => sum + (row.remainingPayout ?? 0n), 0n),
    remainingPayoutUnlimited,
  }
}

function normalizeChainRefs(project: FundsProjectRef, chainRefs: readonly FundsChainRef[]) {
  const refs = chainRefs.length ? chainRefs : [project.chainId]
  return refs.map(ref => {
    if (typeof ref !== 'number') return { chainId: ref.chainId, projectId: ref.projectId }
    // A bare chain-id ref carries no per-chain project id, so it can ONLY mean the
    // home chain (whose id is project.projectId). V6 project ids are independent
    // per chain, so mapping a NON-home bare number to the home id would silently
    // read the WRONG project. Callers covering other chains must pass explicit
    // { chainId, projectId } objects.
    if (ref !== project.chainId) {
      throw new Error(
        `normalizeChainRefs: bare chain id ${ref} is not the home chain ${project.chainId}; ` +
          'pass { chainId, projectId } so the per-chain project id is explicit.',
      )
    }
    return { chainId: ref, projectId: Number(project.projectId) }
  })
}

/**
 * Load the full Funds snapshot: one entry per accounting-token kind (from the
 * home chain's live contexts), each with per-chain rows and guarded totals.
 */
export async function loadFundsSnapshot(
  project: FundsProjectRef,
  chainIds: readonly FundsChainRef[],
  deps: FundsSnapshotDeps = {},
): Promise<FundsSnapshot> {
  const getClient = deps.getClient ?? createFundAccessClient
  const chains = normalizeChainRefs(project, chainIds)
  const kinds = await resolveFundsKinds(getClient(project.chainId), project)

  const kindSnapshots = await Promise.all(
    kinds.map(async (kind): Promise<FundsKindSnapshot> => {
      const rows = await Promise.all(
        chains.map(chain =>
          Promise.resolve()
            .then(() => readFundsChainRow(getClient(chain.chainId), kind, chain.chainId, chain.projectId))
            .catch(() => failedRow(chain.chainId, chain.projectId, kind.decimals)),
        ),
      )
      return { kind, rows, totals: kindTotals(rows) }
    }),
  )
  return { kinds: kindSnapshots }
}
