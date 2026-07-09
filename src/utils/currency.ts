import { formatUnits } from 'viem'

// Single source of truth for accounting-token rendering across the project page.
//
// Juicebox V6 classifies a project's accounting currency as an integer:
//   1 = the native token (ETH), 18 decimals
//   2 = USD-denominated (USDC on-chain), 6 decimals
// Bendystraw reports `currency` + `decimals` on the sucker-group balance and on
// per-chain accounting contexts. Everything user-facing should resolve the token
// through here rather than assuming ETH/18 — a USDC project has 6 decimals, so a
// raw balance divided by 1e18 (the old hardcode) is wrong by 1e12.

export interface AccountingToken {
  /** Ticker shown next to native amounts, e.g. "ETH" or "USDC". */
  symbol: string
  /** On-chain decimals for the accounting token. */
  decimals: number
  /** True when the token is a USD stablecoin — value equals the token amount. */
  isUsd: boolean
}

export function resolveAccountingToken(currency?: number, decimals?: number): AccountingToken {
  if (currency === 2) {
    return { symbol: 'USDC', decimals: decimals ?? 6, isUsd: true }
  }
  return { symbol: 'ETH', decimals: decimals ?? 18, isUsd: false }
}

/** Parse a raw on-chain amount to a float in the token's units. */
export function toTokenFloat(raw: string | bigint, decimals: number = 18): number {
  try {
    return parseFloat(formatUnits(typeof raw === 'bigint' ? raw : BigInt(raw), decimals))
  } catch {
    return 0
  }
}

/**
 * Format a raw balance as a USD string. ETH balances convert via `ethPrice`;
 * USD-denominated balances (currency 2) are shown as-is.
 */
export function formatBalanceUsd(
  balanceString: string,
  ethPrice: number | null,
  currency: number = 1,
  decimals: number = 18
): string {
  try {
    const value = toTokenFloat(balanceString, decimals)
    let usd: number
    if (currency === 2) {
      usd = value
    } else {
      if (!ethPrice) return '$--'
      usd = value * ethPrice
    }
    if (usd === 0) return '$0'
    if (usd < 0.01) return '<$0.01'
    if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`
    if (usd >= 1_000) return `$${(usd / 1_000).toFixed(2)}K`
    return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  } catch {
    return '$0'
  }
}

/**
 * Format a raw balance in its native accounting unit — "1.5 ETH" or, for a
 * USD-denominated project, a dollar amount ("$856"). Use this for axis/tooltip
 * labels so charts never mislabel a USDC balance as ETH.
 */
export function formatBalanceNative(
  balanceString: string,
  currency: number = 1,
  decimals: number = 18
): string {
  try {
    const value = toTokenFloat(balanceString, decimals)
    if (currency === 2) {
      if (value === 0) return '$0'
      if (value < 0.01) return '<$0.01'
      if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
      if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`
      return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    }
    if (value === 0) return '0 ETH'
    if (value < 0.001) return '<0.001 ETH'
    if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K ETH`
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })} ETH`
  } catch {
    return currency === 2 ? '$0' : '0 ETH'
  }
}

/** Short axis-tick label for a numeric value already in token units. */
export function formatAxisValue(value: number, token: AccountingToken): string {
  const abbrev =
    value >= 1_000_000
      ? `${(value / 1_000_000).toFixed(1)}M`
      : value >= 1_000
        ? `${(value / 1_000).toFixed(1)}K`
        : value.toLocaleString(undefined, { maximumFractionDigits: token.isUsd ? 2 : 4 })
  return token.isUsd ? `$${abbrev}` : `${abbrev} ${token.symbol}`
}
