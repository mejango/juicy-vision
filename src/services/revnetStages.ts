// Revnet stage terms — decode + issuance math + auto-issuance totals.
//
// 1:1 port of website/src/discover.js:
//   decodeStageMetadata (:3646)  — packed JBRulesetMetadata bit layout
//   issuanceAtTime     (:13172)  — active stage weight decayed once per elapsed cycle
//   formatRate         (:13183)  — display formatting for tokens-per-base-unit rates
//   formatCutPercent   (:13139)  — weightCutPercent (out of 1e9) → "38%" / "7.5%"
//   percentFromRuleset (:4289)   — reservedPercent/cashOutTaxRate (out of 10000) → "5%"
//   loadStageAutoIssuanceTotals (:13145) — per-stage auto-issuance summed across
//     chains + beneficiaries from Bendystraw storeAutoIssuanceAmountEvents.
//
// Everything above the "async loading" divider is pure and unit-tested.

import {
  resolveRulesetIssuanceStages,
  rulesetIssuanceRateAt,
} from '@bananapus/nana-sdk-core/v6'

// ---------------------------------------------------------------------------
// Stage metadata decode
// ---------------------------------------------------------------------------

/** reservedPercent / cashOutTaxRate are out of 10_000 (= 100%). */
export const RULESET_PERCENT_SCALE = 10_000

/** weightCutPercent is out of 1e9. */
export const WEIGHT_CUT_SCALE = 1_000_000_000

export interface StageMetadata {
  /** Reserved (split-limit) percent, out of 10_000. */
  reservedPercent: number
  /** Cash out tax rate, out of 10_000. */
  cashOutTaxRate: number
  /** Ruleset base currency id (1 = ETH, 2 = USD, else uint32(uint160(token))). */
  baseCurrency: number
}

/**
 * Decode reserved %, cash out tax, and base currency from a ruleset's packed
 * metadata uint. Layout per JBRulesetMetadataResolver:
 * reservedPercent << 4, cashOutTaxRate << 20, baseCurrency << 36.
 */
export function decodeStageMetadata(packed: bigint | string | number): StageMetadata {
  const m = BigInt(packed)
  if (m < 0n) throw new Error('Ruleset metadata is invalid')
  return {
    reservedPercent: Number((m >> 4n) & 0xffffn),
    cashOutTaxRate: Number((m >> 20n) & 0xffffn),
    baseCurrency: Number((m >> 36n) & 0xffffffffn),
  }
}

// ---------------------------------------------------------------------------
// Issuance math
// ---------------------------------------------------------------------------

/** The economic terms of one revnet stage, in raw on-chain units. */
export interface StageTerms {
  /** Stage start timestamp (seconds). */
  start: number
  /** Seconds per issuance-cut cycle; 0 = perpetual (no cycling). */
  duration: number
  /** 1e18 fixed-point tokens issued per base unit paid. */
  weight: string
  /** Issuance cut applied once per elapsed cycle, out of 1e9. */
  weightCutPercent: number
}

/** Sort stages ascending by start without mutating the input. */
export function sortStagesByStart<T extends { start: number }>(stages: readonly T[]): T[] {
  return [...stages].sort((a, b) => a.start - b.start)
}

/**
 * Index of the stage active at time `t` in a start-sorted stage list:
 * the last stage whose start is <= t, or the first stage before any has begun.
 */
export function activeStageIndexAt(sorted: readonly { start: number }[], t: number): number {
  let active = 0
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].start <= t) active = i
  }
  return active
}

/** Whole issuance-cut cycles elapsed within a stage at time `t` (0 when duration is 0). */
export function cutsElapsed(stage: Pick<StageTerms, 'start' | 'duration'>, t: number): number {
  if (stage.duration === 0) return 0
  return Math.max(0, Math.floor((t - stage.start) / stage.duration))
}

/**
 * Issuance (tokens per base unit) at time `t`: find the active stage, then
 * decay its weight by weightCutPercent once per elapsed cycle.
 * Display-precision float, matching the website's issuance ladder.
 */
export function issuanceAtTime(sorted: readonly StageTerms[], t: number): number {
  const resolved = resolveRulesetIssuanceStages(
    sorted.map(stage => ({
      start: stage.start,
      duration: stage.duration,
      weight: BigInt(stage.weight),
      weightCutPercent: stage.weightCutPercent,
    })),
  )
  return rulesetIssuanceRateAt(resolved, t)
}

/**
 * Timestamp of the next issuance cut within the stage active at `t`, or null
 * when the stage doesn't cut (no cycling or a 0% cut).
 */
export function nextCutAt(stage: StageTerms, t: number): number | null {
  if (stage.duration === 0 || stage.weightCutPercent === 0) return null
  return stage.start + (cutsElapsed(stage, t) + 1) * stage.duration
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

/** Rate formatting: 1234.5 → "1,235", 2.5 → "2.50", 0.00123 → "0.00123". */
export function formatIssuanceRate(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  if (n >= 1000) return Math.round(n).toLocaleString('en-US')
  if (n >= 1) return n.toFixed(2)
  return n.toPrecision(3)
}

/** Cut percent formatted compactly (no trailing zeros): 380000000 → "38%", 75000000 → "7.5%". */
export function formatCutPercent(weightCutPercent: number): string {
  const v = weightCutPercent / (WEIGHT_CUT_SCALE / 100)
  return v.toFixed(2).replace(/\.?0+$/, '') + '%'
}

/** reservedPercent / cashOutTaxRate (out of 10_000) → "5%" / "2.50%" / "—". */
export function percentFromBasisPoints(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return (value / 100).toFixed(value % 100 === 0 ? 0 : 2) + '%'
}

/** Compact countdown: 90061s → "1d 1h", 3660s → "1h 1m", 59s → "<1m". */
export function formatCountdown(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'now'
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  if (minutes > 0) return `${minutes}m`
  return '<1m'
}

/** 1e18 token counts for table cells: compact, no decimals above 1. */
export function formatTokenCount18(wei: bigint): string {
  const n = Number(wei) / 1e18
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1) return Math.round(n).toLocaleString('en-US')
  return n.toPrecision(3)
}

// ---------------------------------------------------------------------------
// Auto-issuance totals (pure aggregation)
// ---------------------------------------------------------------------------

/** One indexed auto-issuance allocation (StoreAutoIssuanceAmount event). */
export interface AutoIssuanceAllocation {
  chainId: number
  /** The stage's ruleset id on that chain. */
  stageId: string
  beneficiary: string
  /** 1e18 token count allocated. */
  count: bigint
}

/**
 * Sum allocations per stage INDEX across chains + beneficiaries.
 * `stageIdsByChain` maps each chain to its start-ordered stage (ruleset) ids —
 * the same stage has a different ruleset id on every chain, but the same index.
 * Rows are deduped by (chainId, stageId, beneficiary, count) — re-indexed
 * duplicates of the same allocation must not double-count. Rows whose stageId
 * matches no current stage (superseded rulesets) are dropped.
 */
export function sumAutoIssuanceByStage(
  rows: readonly AutoIssuanceAllocation[],
  stageIdsByChain: Record<number, readonly string[]>,
): Record<number, bigint> {
  const seen = new Set<string>()
  const totals: Record<number, bigint> = {}
  for (const row of rows) {
    if (!row.beneficiary || row.count <= 0n) continue
    const key = `${row.chainId}:${row.stageId}:${row.beneficiary.toLowerCase()}:${row.count}`
    if (seen.has(key)) continue
    seen.add(key)
    const stageIds = stageIdsByChain[row.chainId]
    const index = stageIds ? stageIds.findIndex(id => String(id) === String(row.stageId)) : -1
    if (index < 0) continue
    totals[index] = (totals[index] ?? 0n) + row.count
  }
  return totals
}

// ---------------------------------------------------------------------------
// Async loading (network — not covered by the pure unit tests above)
// ---------------------------------------------------------------------------

const AUTO_ISSUE_PAGE_SIZE = 100
const AUTO_ISSUE_MAX_EVENTS = 500
const BENDYSTRAW_VERSION = 6

const STORE_AUTO_ISSUANCE_QUERY = `query($projectId: Int!, $chainId: Int!, $version: Int!, $limit: Int!, $offset: Int!) {
  storeAutoIssuanceAmountEvents(where: { projectId: $projectId, chainId: $chainId, version: $version },
    orderBy: "timestamp", orderDirection: "desc", limit: $limit, offset: $offset) {
    items { beneficiary stageId count } totalCount } }`

interface StoreAutoIssuanceEventsPage {
  storeAutoIssuanceAmountEvents: {
    items: Array<{ beneficiary: string; stageId: string | number; count: string }>
    totalCount: number
  }
}

// Mirrors bendystraw/client.ts getClient + getNetworkOption: proxy through the
// backend when configured, else the user's configured direct endpoint.
async function bendystrawClientFor(chainId: number) {
  const { GraphQLClient } = await import('graphql-request')
  const { IS_TESTNET } = await import('../config/environment')
  const isMainnetChain = [1, 10, 8453, 42161].includes(chainId)
  const network = IS_TESTNET && isMainnetChain ? 'mainnet' : undefined
  const apiUrl = import.meta.env.VITE_API_URL
  if (apiUrl) {
    return new GraphQLClient(`${apiUrl}/proxy/bendystraw${network ? `?network=${network}` : ''}`)
  }
  const { useSettingsStore } = await import('../stores')
  return new GraphQLClient(useSettingsStore.getState().bendystrawEndpoint)
}

async function fetchAutoIssuanceAllocations(
  projectId: number,
  chainId: number,
): Promise<AutoIssuanceAllocation[]> {
  const client = await bendystrawClientFor(chainId)
  const items: AutoIssuanceAllocation[] = []
  let totalCount = 0
  let offset = 0
  while (offset < AUTO_ISSUE_MAX_EVENTS) {
    const data = await client.request<StoreAutoIssuanceEventsPage>(STORE_AUTO_ISSUANCE_QUERY, {
      projectId,
      chainId,
      version: BENDYSTRAW_VERSION,
      limit: AUTO_ISSUE_PAGE_SIZE,
      offset,
    })
    const page = data?.storeAutoIssuanceAmountEvents
    if (!page || !Array.isArray(page.items)) throw new Error('Auto-issuance data is unavailable')
    totalCount = Number(page.totalCount) || 0
    for (const item of page.items) {
      items.push({
        chainId,
        stageId: String(item.stageId),
        beneficiary: String(item.beneficiary || ''),
        count: BigInt(item.count || '0'),
      })
    }
    if (page.items.length === 0 || items.length >= totalCount || items.length >= AUTO_ISSUE_MAX_EVENTS) break
    offset += page.items.length
  }
  return items
}

/**
 * Total auto-issuance per stage index, summed across the revnet's chains and
 * beneficiaries. Failures propagate so callers show "—" instead of fabricated
 * totals. Parity: website loadStageAutoIssuanceTotals (:13145).
 */
export async function fetchStageAutoIssuanceTotals(
  chains: readonly { chainId: number; projectId: number }[],
): Promise<Record<number, bigint>> {
  const { fetchAllRulesets } = await import('./bendystraw')
  const perChain = await Promise.all(chains.map(async chain => {
    const [rulesets, rows] = await Promise.all([
      // fetchAllRulesets returns start-ascending stages — index-aligned across chains.
      fetchAllRulesets(String(chain.projectId), chain.chainId),
      fetchAutoIssuanceAllocations(chain.projectId, chain.chainId),
    ])
    return { chainId: chain.chainId, stageIds: rulesets.map(r => r.id), rows }
  }))
  const stageIdsByChain: Record<number, readonly string[]> = {}
  const rows: AutoIssuanceAllocation[] = []
  for (const chain of perChain) {
    stageIdsByChain[chain.chainId] = chain.stageIds
    rows.push(...chain.rows)
  }
  return sumAutoIssuanceByStage(rows, stageIdsByChain)
}
