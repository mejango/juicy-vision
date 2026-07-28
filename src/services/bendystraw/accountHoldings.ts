/**
 * Account holdings (project token balances + owned store items) — pure shaping.
 *
 * Rows come from the V6-pinned account queries. `dedupeTokenHoldings` keeps the
 * first row per (chainId, projectId) and `dedupeNftHoldings` the first row per
 * (chainId, hook, tokenId) — the nft primary key includes the hook because
 * JB721 tokenIds (tierId*1e9+serial) collide across every collection on a
 * chain. Token grouping collapses per-chain rows into one row per sucker
 * group (per-chain projectIds can diverge inside a group); rows without a
 * suckerGroupId stay ungrouped so unrelated same-id projects never merge.
 * Store items group into one row per (chainId, projectId) with per-tier
 * tallies.
 */

/** One participant row: the account's token balance in a project on a chain. */
export interface TokenHoldingRow {
  chainId: number
  projectId: number
  version: number
  balance: string
  /** Unclaimed (credit) portion of `balance`. */
  creditBalance?: string
  /** Claimed ERC-20 portion of `balance`. */
  erc20Balance?: string
  /** Omnichain group the project belongs to; null/absent = ungrouped. */
  suckerGroupId?: string | null
}

/** One owned store item (721 token) row. */
export interface NftHoldingRow {
  chainId: number
  projectId: number
  /** The 721 hook (collection) address — part of the token's identity. */
  hook: string
  tokenId: string
  tierId: number
}

/** A page of holdings rows plus the server's total for truncation notices. */
export interface HoldingsPage<T> {
  rows: T[]
  totalCount: number
  /** True when the server holds more rows than the query window returned. */
  truncated: boolean
}

/** One chain's slice of a token-holding group. */
export interface TokenHoldingChainRow {
  chainId: number
  /** The project's id ON THIS CHAIN (sucker peers can have divergent ids). */
  projectId: number
  balance: string
  creditBalance?: string
  erc20Balance?: string
}

/** A project's token holdings grouped across chains (per-chain rows kept). */
export interface TokenHoldingGroup {
  suckerGroupId: string | null
  /** Representative projectId (the group's first row) for label fallbacks. */
  projectId: number
  chains: TokenHoldingChainRow[]
}

/** A project's owned store items on one chain, tallied per tier. */
export interface NftHoldingGroup {
  chainId: number
  projectId: number
  tiers: Array<{ tierId: number; count: number }>
}

/** First row wins per (chainId, projectId); input order is preserved. */
export function dedupeTokenHoldings(rows: TokenHoldingRow[]): TokenHoldingRow[] {
  const seen = new Set<string>()
  const out: TokenHoldingRow[] = []
  for (const row of rows) {
    if (!Number.isFinite(row.chainId) || !Number.isFinite(row.projectId)) continue
    const key = `${row.chainId}:${row.projectId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

/** First row wins per (chainId, hook, tokenId) — the hook is part of the
 *  token's identity because tokenIds repeat across collections on a chain. */
export function dedupeNftHoldings(rows: NftHoldingRow[]): NftHoldingRow[] {
  const seen = new Set<string>()
  const out: NftHoldingRow[] = []
  for (const row of rows) {
    if (row.tokenId == null || !Number.isFinite(row.chainId)) continue
    const key = `${row.chainId}:${(row.hook ?? '').toLowerCase()}:${row.tokenId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

/** One row per sucker group with per-chain balances, in first-encounter order
 *  (rows arrive balance-sorted, so the biggest holding leads its group).
 *  Rows without a suckerGroupId keep their own row per (chainId, projectId,
 *  version) — ungrouped rows never merge. */
export function groupTokenHoldings(rows: TokenHoldingRow[]): TokenHoldingGroup[] {
  const grouped = new Map<string, TokenHoldingGroup>()
  for (const row of rows) {
    const key = row.suckerGroupId
      ? `g:${row.suckerGroupId}`
      : `u:${row.chainId}:${row.projectId}:${row.version}`
    const chainRow: TokenHoldingChainRow = {
      chainId: row.chainId,
      projectId: row.projectId,
      balance: row.balance,
      creditBalance: row.creditBalance,
      erc20Balance: row.erc20Balance,
    }
    const existing = grouped.get(key)
    if (existing) {
      if (!existing.chains.some(c => c.chainId === row.chainId)) {
        existing.chains.push(chainRow)
      }
    } else {
      grouped.set(key, {
        suckerGroupId: row.suckerGroupId ?? null,
        projectId: row.projectId,
        chains: [chainRow],
      })
    }
  }
  return [...grouped.values()]
}

/** One row per (chainId, projectId) with per-tier counts, biggest tier first. */
export function groupNftHoldings(rows: NftHoldingRow[]): NftHoldingGroup[] {
  const grouped = new Map<string, { chainId: number; projectId: number; tiers: Map<number, number> }>()
  for (const row of rows) {
    const key = `${row.chainId}:${row.projectId}`
    let entry = grouped.get(key)
    if (!entry) {
      entry = { chainId: row.chainId, projectId: row.projectId, tiers: new Map() }
      grouped.set(key, entry)
    }
    const tierId = Number(row.tierId)
    entry.tiers.set(tierId, (entry.tiers.get(tierId) ?? 0) + 1)
  }
  return [...grouped.values()].map(entry => ({
    chainId: entry.chainId,
    projectId: entry.projectId,
    tiers: [...entry.tiers.entries()]
      .map(([tierId, count]) => ({ tierId, count }))
      .sort((a, b) => b.count - a.count || a.tierId - b.tierId),
  }))
}
