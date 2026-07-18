import { type Address, type PublicClient, formatUnits } from 'viem'
import {
  createFundAccessClient,
  readFundAccessContexts,
  FUND_ACCESS_PRICES_ABI,
  PRICE_FIDELITY,
} from './fundAccess'
import { fetchEthPrice } from './bendystraw/client'
import { NATIVE_TOKEN } from '../constants'
import { USDC_ADDRESSES } from '../constants/chains'
import type { SupportedChainId } from '../constants/chains'

// One accounting token held on one chain. `unitUsd` is USD per whole token scaled to 18 decimals, or null
// when the protocol has no trustworthy price for it — never a guessed rate.
export interface BalanceRow {
  chainId: number
  token: string
  balance: bigint
  decimals: number
  currency: bigint
  symbol: string
  unitUsd: bigint | null
}

export interface ProjectBalanceBreakdown {
  rows: BalanceRow[]
  /** USD total, meaningful only when `priced` is true. */
  totalUsd: number
  /** True only when every chain read succeeded AND every non-zero token resolved a price. */
  priced: boolean
  /** Grouped raw amounts ("1.5 ETH + 2.5 USDC") — the honest fallback when a USD total can't be summed. */
  rawSummary: string
  /** False when any chain's contexts/balances could not be verified on-chain. */
  verified: boolean
}

// Convert a raw balance to USD using a verified per-whole-token price, keeping token decimals and the price's
// 18-decimal fixed point separate. This avoids the classic 6-decimal-USDC / 18-decimal-price scaling bug.
export function accountingTokenUsdValueAtPrice(
  balance: bigint,
  decimals: number,
  unitUsd: bigint | null,
  priceDecimals = 18,
): number | null {
  if (unitUsd == null) return null
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null
  if (!Number.isInteger(priceDecimals) || priceDecimals < 0 || priceDecimals > 36) return null
  const amount = Number(formatUnits(balance, decimals))
  const price = Number(formatUnits(unitUsd, priceDecimals))
  const value = amount * price
  return Number.isFinite(value) && value >= 0 ? value : null
}

// When at least one held token has no trustworthy USD price, the headline can't be summed honestly. Group the
// verified raw balances per token instead ("0.01 ETH + 12 KMAC") rather than guessing a dollar figure.
export function rawAccountingBalanceSummary(rows: BalanceRow[], readable: boolean): string {
  if (!readable) return '—'
  const groups = new Map<string, { amount: bigint; decimals: number; symbol: string }>()
  for (const row of rows) {
    if (row.balance <= 0n) continue
    const key = `${row.token.toLowerCase()}@${row.decimals}`
    const existing = groups.get(key)
    if (existing) existing.amount += row.balance
    else groups.set(key, { amount: row.balance, decimals: row.decimals, symbol: row.symbol || '' })
  }
  if (groups.size === 0) return '—'
  return Array.from(groups.values())
    .map(g => `${formatRawAmount(g.amount, g.decimals)}${g.symbol ? ` ${g.symbol}` : ''}`)
    .join(' + ')
}

function formatRawAmount(value: bigint, decimals: number): string {
  try {
    if (value === 0n) return '0'
    if (decimals >= 3 && value < 10n ** BigInt(decimals - 3)) return '<0.001'
    const [whole, fraction = ''] = formatUnits(value, decimals).split('.')
    const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    const compactFraction = fraction.slice(0, 4).replace(/0+$/, '')
    return compactFraction ? `${groupedWhole}.${compactFraction}` : groupedWhole
  } catch {
    return '0'
  }
}

// USD-per-whole-token (18-dec fixed point) via the protocol's own JBPrices oracle, so the value honors protocol
// defaults, L2 sequencer-aware feeds and project-specific custom-token feeds. Canonical USDC is $1; native ETH
// falls back to the ETH/USD spot when JBPrices carries no feed for the native accounting currency.
async function fetchAccountingTokenUsdPrice(
  client: PublicClient,
  prices: Address,
  projectId: bigint,
  token: string,
  currency: bigint,
  chainId: number,
): Promise<bigint | null> {
  const address = token.toLowerCase()
  const usdc = USDC_ADDRESSES[chainId as SupportedChainId]?.toLowerCase()
  if (usdc && address === usdc) return PRICE_FIDELITY

  try {
    const quoted = await client.readContract({
      address: prices,
      abi: FUND_ACCESS_PRICES_ABI,
      functionName: 'pricePerUnitOf',
      args: [projectId, 2n, currency, 18n],
    })
    if (quoted > 0n) return quoted
  } catch {
    // No feed for this accounting currency — fall through to the direct fallbacks below.
  }

  if (address === NATIVE_TOKEN.toLowerCase()) {
    const ethUsd = await fetchEthPrice()
    // Preserve the feed's practical 8-decimal precision while lifting it into the 18-decimal quote.
    return ethUsd == null ? null : BigInt(Math.round(ethUsd * 1e8)) * 10n ** 10n
  }
  return null
}

// Cross-chain balance breakdown across every accounting token, with a USD total only when every non-zero token
// is actually priced. Reuses the fail-closed on-chain reader (verified terminal/store/context) FundsSection
// uses; a chain that fails to verify marks the whole aggregate unpriced rather than reporting a partial total.
export async function fetchProjectBalanceBreakdown(
  chains: Array<{ chainId: number; projectId: number }>,
): Promise<ProjectBalanceBreakdown> {
  const perChain = await Promise.all(chains.map(async ({ chainId, projectId }) => {
    try {
      const client = createFundAccessClient(chainId)
      const contexts = await readFundAccessContexts(client, chainId, BigInt(projectId))
      const rows = await Promise.all(contexts.map(async (ctx): Promise<BalanceRow> => {
        const unitUsd = ctx.balance > 0n
          ? await fetchAccountingTokenUsdPrice(client, ctx.prices, ctx.projectId, ctx.token, ctx.accountingCurrency, chainId)
          : null
        return {
          chainId,
          token: ctx.token,
          balance: ctx.balance,
          decimals: ctx.decimals,
          currency: ctx.accountingCurrency,
          symbol: ctx.tokenSymbol,
          unitUsd,
        }
      }))
      return { rows, verified: true }
    } catch {
      return { rows: [] as BalanceRow[], verified: false }
    }
  }))

  const verified = chains.length > 0 && perChain.every(c => c.verified)
  const rows = perChain.flatMap(c => c.rows)

  let totalUsd = 0
  let hasUnpriced = false
  for (const row of rows) {
    if (row.balance <= 0n) continue
    const usd = accountingTokenUsdValueAtPrice(row.balance, row.decimals, row.unitUsd, 18)
    if (usd == null) { hasUnpriced = true; continue }
    totalUsd += usd
  }

  return {
    rows,
    totalUsd,
    priced: verified && !hasUnpriced,
    rawSummary: rawAccountingBalanceSummary(rows, verified),
    verified,
  }
}
