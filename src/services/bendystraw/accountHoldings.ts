/**
 * Account holdings (project token balances + owned store items) — pure shaping.
 *
 * Bendystraw indexes one row per project VERSION, so the same holding shows up
 * once per indexed version of the project. `dedupeTokenHoldings` keeps the
 * highest-version row per (chainId, projectId); `dedupeNftHoldings` keeps the
 * first row per (chainId, tokenId). Grouping then collapses per-chain token
 * rows into one row per projectId (the ProjectSearch/TrendingProjects idiom)
 * and store items into one row per (chainId, projectId) with per-tier tallies.
 */

/** One participant row: the account's token balance in a project on a chain. */
export interface TokenHoldingRow {
  chainId: number
  projectId: number
  version: number
  balance: string
}

/** One owned store item (721 token) row. */
export interface NftHoldingRow {
  chainId: number
  projectId: number
  tokenId: string
  tierId: number
}

/** A project's token holdings grouped across chains (per-chain balances kept). */
export interface TokenHoldingGroup {
  projectId: number
  chains: Array<{ chainId: number; balance: string }>
}

/** A project's owned store items on one chain, tallied per tier. */
export interface NftHoldingGroup {
  chainId: number
  projectId: number
  tiers: Array<{ tierId: number; count: number }>
}

/** Highest-version row wins per (chainId, projectId); input order is preserved. */
export function dedupeTokenHoldings(rows: TokenHoldingRow[]): TokenHoldingRow[] {
  const best = new Map<string, TokenHoldingRow>()
  const order: string[] = []
  for (const row of rows) {
    if (!Number.isFinite(row.chainId) || !Number.isFinite(row.projectId)) continue
    const key = `${row.chainId}:${row.projectId}`
    const existing = best.get(key)
    if (!existing) {
      best.set(key, row)
      order.push(key)
    } else if ((row.version ?? 0) > (existing.version ?? 0)) {
      best.set(key, row)
    }
  }
  return order.map(key => best.get(key)!)
}

/** First row wins per (chainId, tokenId) — the same physical token indexed
 *  under multiple versions collapses to one item. */
export function dedupeNftHoldings(rows: NftHoldingRow[]): NftHoldingRow[] {
  const seen = new Set<string>()
  const out: NftHoldingRow[] = []
  for (const row of rows) {
    if (row.tokenId == null || !Number.isFinite(row.chainId)) continue
    const key = `${row.chainId}:${row.tokenId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

/** One row per projectId with per-chain balances, in first-encounter order
 *  (rows arrive balance-sorted, so the biggest holding leads its group). */
export function groupTokenHoldings(rows: TokenHoldingRow[]): TokenHoldingGroup[] {
  const grouped = new Map<number, TokenHoldingGroup>()
  for (const row of rows) {
    const existing = grouped.get(row.projectId)
    if (existing) {
      if (!existing.chains.some(c => c.chainId === row.chainId)) {
        existing.chains.push({ chainId: row.chainId, balance: row.balance })
      }
    } else {
      grouped.set(row.projectId, {
        projectId: row.projectId,
        chains: [{ chainId: row.chainId, balance: row.balance }],
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
