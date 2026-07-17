/**
 * Reserved-token splits + auto-issuance data layer for the Owners tab's
 * Splits/Reserved and Auto Issuance subtabs.
 *
 * 1:1 port of website/src/discover.js:
 *   renderOwnersSplits splits read (:15651) — JBSplits.splitsOf(projectId,
 *     stageId, RESERVED group 1n) on the home chain
 *   appendChainSplitBlock percent math (:16937) — split.percent is out of 1e9
 *     (share of the reserved GROUP); × the stage's reserved rate = share of
 *     total issuance; both are displayed
 *   fetchPendingReservedPerChain (:15641) — controller
 *     pendingReservedTokenBalanceOf on every project chain, null-tolerant per
 *     chain (a failed chain renders nothing rather than a fake zero)
 *   BENDYSTRAW_RESERVED_DIST_QUERY (:14124) — latest distributions feed
 *   fetchIndexedAutoIssuanceRows / loadAutoIssuanceRows (:14211/:14302) —
 *     Bendystraw storeAutoIssuanceAmountEvents (strict) + autoIssueEvents
 *     (best-effort), enriched with the live REVOwner.amountToAutoIssue
 *
 * Everything above the "async loading" divider is pure and unit-tested.
 */

import type { Address, PublicClient } from 'viem'
import { jbContractAddress, jbSplitsAbi, type JBChainId } from '@bananapus/nana-sdk-core'
import { getAmountToAutoIssue, RESERVED_TOKEN_SPLIT_GROUP_ID } from '@bananapus/nana-sdk-core/v6'

// ---------------------------------------------------------------------------
// Percent math (pure)
// ---------------------------------------------------------------------------

/** JBSplit.percent is a fraction out of 1e9. */
export const SPLIT_PERCENT_DENOMINATOR = 1_000_000_000

/**
 * Reserved splits routed here are burned by JBTokens (no beneficiary account).
 * Label such rows "Burn" — never as a regular recipient address.
 */
export const BURN_SENTINEL = '0x000000000000000000000000000000000000dEaD'

export function isBurnBeneficiary(beneficiary: string | null | undefined): boolean {
  return (beneficiary ?? '').toLowerCase() === BURN_SENTINEL.toLowerCase()
}

/** A split's share of the reserved GROUP, in percent (0..100). */
export function groupSharePercent(splitPercent: number): number {
  return (splitPercent / SPLIT_PERCENT_DENOMINATOR) * 100
}

/**
 * A split's share of TOTAL issuance, in percent: its group share × the
 * stage's reserved rate (reservedPercent is out of 10_000 → /100 = percent
 * of issuance). Parity: appendChainSplitBlock's `limitPct * frac`.
 */
export function issuancePercent(splitPercent: number, reservedPercent: number): number {
  return (reservedPercent / 100) * (splitPercent / SPLIT_PERCENT_DENOMINATOR)
}

/** "5%" / "2.63%" — the %-of-issuance figure, website formatting. */
export function formatIssuancePercent(splitPercent: number, reservedPercent: number): string {
  const effective = issuancePercent(splitPercent, reservedPercent)
  return effective.toFixed(effective % 1 === 0 ? 0 : 2) + '%'
}

/** "(50% of limit)" companion figure — the split's share of the reserved group. */
export function formatOfLimitPercent(splitPercent: number): string {
  return Math.round(groupSharePercent(splitPercent)) + '% of limit'
}

/** The slice of a chain's pending reserved balance this split would receive. */
export function pendingShareOf(pending: bigint, splitPercent: number): bigint {
  return (pending * BigInt(splitPercent)) / BigInt(SPLIT_PERCENT_DENOMINATOR)
}

// ---------------------------------------------------------------------------
// Pending-per-chain assembly (pure)
// ---------------------------------------------------------------------------

export interface PendingReservedRow {
  chainId: number
  /** Pending reserved token balance on that chain; null = unreadable (not 0). */
  pending: bigint | null
}

/**
 * Zip per-chain settled pending reads back onto their chain ids. A rejected
 * chain yields `pending: null` so the UI can skip it — never a fake zero.
 */
export function assemblePendingRows(
  chainIds: readonly number[],
  settled: readonly PromiseSettledResult<bigint>[],
): PendingReservedRow[] {
  return chainIds.map((chainId, index) => {
    const result = settled[index]
    return {
      chainId,
      pending: result && result.status === 'fulfilled' ? result.value : null,
    }
  })
}

// ---------------------------------------------------------------------------
// Auto-issuance row assembly (pure)
// ---------------------------------------------------------------------------

/** One indexed auto-issuance allocation, pre-enrichment. */
export interface StoredAutoIssuance {
  chainId: number
  /** The stage's ruleset id on that chain. */
  stageId: string
  beneficiary: string
  /** 1e18 token count allocated. */
  count: bigint
  /** Indexer timestamp of the StoreAutoIssuanceAmount event. */
  storedTimestamp: number
}

/**
 * (chainId, stageId, beneficiary, count) identity — the same allocation
 * re-indexed must not double-count, and a distribution event with the same
 * identity marks the allocation distributed.
 */
export function autoIssueKey(row: {
  chainId: number
  stageId: string
  beneficiary: string
  count: bigint
}): string {
  return [row.chainId, row.stageId, row.beneficiary.toLowerCase(), row.count.toString()].join(':')
}

/** Dedupe stored allocations by identity, keeping the newest indexed copy. */
export function dedupeStoredAllocations(rows: readonly StoredAutoIssuance[]): StoredAutoIssuance[] {
  const byKey = new Map<string, StoredAutoIssuance>()
  for (const row of rows) {
    if (!row.beneficiary || row.count <= 0n) continue
    const key = autoIssueKey(row)
    const previous = byKey.get(key)
    if (!previous || row.storedTimestamp > previous.storedTimestamp) byKey.set(key, row)
  }
  return [...byKey.values()]
}

// ---------------------------------------------------------------------------
// Async loading (network — not covered by the pure unit tests above)
// ---------------------------------------------------------------------------

const BENDYSTRAW_VERSION = 6

/** One reserved-split recipient as stored on JBSplits. */
export interface ReservedSplit {
  /** Out of 1e9 — share of the reserved group. */
  percent: number
  /** Non-zero routes the split to another Juicebox project. */
  projectId: number
  beneficiary: Address
  preferAddToBalance: boolean
  lockedUntil: number
  hook: Address
}

export interface ReservedDistributionRow {
  chainId: number
  timestamp: number
  txHash: string
  tokenCount: bigint
}

/** One auto-issuance table row, enriched with live on-chain state. */
export interface AutoIssuanceRow {
  chainId: number
  /** The stage's ruleset id on that chain. */
  stageId: string
  /** Start-order index — the same stage across chains shares this. */
  stageIndex: number
  /** Stage start = the allocation's unlock time (unix seconds). */
  stageStart: number
  beneficiary: Address
  /** Configured allocation (1e18). */
  count: bigint
  /** Live REVOwner.amountToAutoIssue; null = unreadable. */
  remaining: bigint | null
  /** The matched AutoIssue event's tx, when the indexer saw the distribution. */
  distributedTxHash: string | null
}

function v6Address(contract: keyof (typeof jbContractAddress)['6'], chainId: number): Address | null {
  const byChain = jbContractAddress['6'][contract] as Record<string, Address> | undefined
  return byChain?.[String(chainId)] ?? null
}

async function clientFor(chainId: number): Promise<PublicClient> {
  const { publicClientFor } = await import('./projectTx')
  return publicClientFor(chainId) as PublicClient
}

/**
 * The reserved-group splits of one ruleset (stage), read from JBSplits on the
 * given chain. Splits are stored per (projectId, rulesetId, group); the
 * reserved group is 1n.
 */
export async function fetchReservedSplits(
  projectId: number | string,
  chainId: number,
  rulesetId: number | string | bigint,
): Promise<ReservedSplit[]> {
  const splitsAddress = v6Address('JBSplits', chainId)
  if (!splitsAddress) throw new Error(`JBSplits is not deployed on chain ${chainId}`)
  const client = await clientFor(chainId)
  const splits = await client.readContract({
    address: splitsAddress,
    abi: jbSplitsAbi,
    functionName: 'splitsOf',
    args: [BigInt(projectId), BigInt(rulesetId), RESERVED_TOKEN_SPLIT_GROUP_ID],
  })
  return splits.map(split => ({
    percent: Number(split.percent),
    projectId: Number(split.projectId),
    beneficiary: split.beneficiary,
    preferAddToBalance: split.preferAddToBalance,
    lockedUntil: Number(split.lockedUntil),
    hook: split.hook,
  }))
}

/** Injectable for tests: swap the per-chain pending reader. */
export interface PendingReservedDeps {
  readPending?: (projectId: string, chainId: number) => Promise<bigint>
}

async function defaultReadPending(projectId: string, chainId: number): Promise<bigint> {
  const { fetchPendingReservedTokens } = await import('./bendystraw')
  return BigInt(await fetchPendingReservedTokens(projectId, chainId))
}

/**
 * Pending reserved tokens accrue per chain (each chain mints its own
 * issuance). Read the pending balance on every chain the project lives on;
 * a failed chain yields null. Parity: fetchPendingReservedPerChain (:15641).
 */
export async function fetchPendingReservedPerChain(
  projectId: number | string,
  chainIds: readonly number[],
  deps: PendingReservedDeps = {},
): Promise<PendingReservedRow[]> {
  const readPending = deps.readPending ?? defaultReadPending
  const settled = await Promise.allSettled(chainIds.map(chainId => readPending(String(projectId), chainId)))
  return assemblePendingRows(chainIds, settled)
}

/**
 * Strict single-chain pending read for tx re-verification — errors propagate
 * so the guarded runner aborts rather than distributing blind.
 */
export async function readPendingReserved(projectId: number | string, chainId: number): Promise<bigint> {
  return defaultReadPending(String(projectId), chainId)
}

const RESERVED_DIST_QUERY = `query($projectId: Int!, $version: Int!, $chainIds: [Int!], $limit: Int!) {
  sendReservedTokensToSplitsEvents(where: { projectId: $projectId, version: $version, chainId_in: $chainIds },
    orderBy: "timestamp", orderDirection: "desc", limit: $limit) {
    items { tokenCount timestamp txHash chainId } } }`

interface ReservedDistPage {
  sendReservedTokensToSplitsEvents: {
    items: Array<{ tokenCount: string; timestamp: string | number; txHash: string; chainId: string | number }>
  }
}

/**
 * Latest reserved-token distributions across the project's chains, newest
 * first, from Bendystraw (version: 6 rows only).
 */
export async function fetchReservedDistributions(
  projectId: number | string,
  chainIds: readonly number[],
  limit = 25,
): Promise<ReservedDistributionRow[]> {
  if (!chainIds.length) return []
  const { safeRequest, getNetworkOption } = await import('./bendystraw/client')
  const data = await safeRequest<ReservedDistPage>(
    RESERVED_DIST_QUERY,
    { projectId: Number(projectId), version: BENDYSTRAW_VERSION, chainIds: [...chainIds], limit },
    getNetworkOption(chainIds[0]),
  )
  const items = data?.sendReservedTokensToSplitsEvents?.items
  if (!Array.isArray(items)) throw new Error('Reserved distributions are unavailable')
  return items.map(item => ({
    chainId: Number(item.chainId),
    timestamp: Number(item.timestamp),
    txHash: String(item.txHash),
    tokenCount: BigInt(item.tokenCount || '0'),
  }))
}

const AUTO_ISSUE_PAGE_LIMIT = 500

const STORE_AUTO_ISSUANCE_QUERY = `query($projectId: Int!, $chainId: Int!, $version: Int!, $limit: Int!) {
  storeAutoIssuanceAmountEvents(where: { projectId: $projectId, chainId: $chainId, version: $version },
    orderBy: "timestamp", orderDirection: "desc", limit: $limit) {
    items { timestamp txHash beneficiary stageId count } } }`

const AUTO_ISSUE_EVENTS_QUERY = `query($projectId: Int!, $chainId: Int!, $version: Int!, $limit: Int!) {
  autoIssueEvents(where: { projectId: $projectId, chainId: $chainId, version: $version },
    orderBy: "timestamp", orderDirection: "desc", limit: $limit) {
    items { timestamp txHash beneficiary stageId count } } }`

interface AutoIssueEventsPage {
  [path: string]: {
    items: Array<{
      timestamp: string | number
      txHash: string
      beneficiary: string
      stageId: string | number
      count: string
    }>
  }
}

async function fetchAutoIssueEvents(
  path: 'storeAutoIssuanceAmountEvents' | 'autoIssueEvents',
  query: string,
  projectId: number,
  chainId: number,
) {
  const { safeRequest, getNetworkOption } = await import('./bendystraw/client')
  const data = await safeRequest<AutoIssueEventsPage>(
    query,
    { projectId, chainId, version: BENDYSTRAW_VERSION, limit: AUTO_ISSUE_PAGE_LIMIT },
    getNetworkOption(chainId),
  )
  const items = data?.[path]?.items
  if (!Array.isArray(items)) throw new Error('Auto-issuance data is unavailable')
  return items
}

/**
 * Auto-issuance table rows: Bendystraw allocations (strict — a failure here
 * propagates so the UI shows an error, never fabricated rows) matched against
 * best-effort distribution events, stage-matched via each chain's start-sorted
 * ruleset list (allocations pointing at superseded rulesets are dropped), and
 * enriched with the live remaining amount from REVOwner.
 * Parity: loadAutoIssuanceRows (:14302).
 */
export async function fetchAutoIssuanceRows(
  projectId: number | string,
  chainIds: readonly number[],
): Promise<AutoIssuanceRow[]> {
  const pid = Number(projectId)
  const revChainIds = chainIds.filter(chainId => v6Address('REVOwner', chainId) !== null)
  if (!revChainIds.length) return []
  const { fetchAllRulesets } = await import('./bendystraw')

  const perChain = await Promise.all(
    revChainIds.map(async chainId => {
      const [stages, storedRaw, issuedRaw] = await Promise.all([
        // fetchAllRulesets returns start-ascending stages — index-aligned across chains.
        fetchAllRulesets(String(pid), chainId),
        fetchAutoIssueEvents('storeAutoIssuanceAmountEvents', STORE_AUTO_ISSUANCE_QUERY, pid, chainId),
        // Distributed-status lookup is best-effort enrichment only.
        fetchAutoIssueEvents('autoIssueEvents', AUTO_ISSUE_EVENTS_QUERY, pid, chainId).catch(() => []),
      ])
      const stored = dedupeStoredAllocations(
        storedRaw.map(item => ({
          chainId,
          stageId: String(item.stageId),
          beneficiary: String(item.beneficiary || ''),
          count: BigInt(item.count || '0'),
          storedTimestamp: Number(item.timestamp) || 0,
        })),
      )
      const issuedByKey = new Map<string, string>()
      for (const item of issuedRaw) {
        issuedByKey.set(
          autoIssueKey({
            chainId,
            stageId: String(item.stageId),
            beneficiary: String(item.beneficiary || ''),
            count: BigInt(item.count || '0'),
          }),
          String(item.txHash),
        )
      }
      const client = await clientFor(chainId)
      const rows = await Promise.all(
        stored.map(async allocation => {
          // A stageId from a superseded ruleset matches no current stage → drop
          // the row (falling back to stage 1 dumped stale allocations there).
          const stageIndex = stages.findIndex(stage => String(stage.id) === allocation.stageId)
          if (stageIndex < 0) return null
          const remaining = await getAmountToAutoIssue(client, {
            chainId: chainId as JBChainId,
            revnetId: BigInt(pid),
            stageId: BigInt(allocation.stageId),
            beneficiary: allocation.beneficiary as Address,
          }).catch(() => null)
          return {
            chainId,
            stageId: allocation.stageId,
            stageIndex,
            stageStart: stages[stageIndex].start,
            beneficiary: allocation.beneficiary as Address,
            count: allocation.count,
            remaining,
            distributedTxHash: issuedByKey.get(autoIssueKey(allocation)) ?? null,
          } satisfies AutoIssuanceRow
        }),
      )
      return rows.filter((row): row is AutoIssuanceRow => row !== null)
    }),
  )

  const chainOrder = new Map(revChainIds.map((chainId, index) => [chainId, index]))
  return perChain.flat().sort((a, b) => {
    if (a.stageStart !== b.stageStart) return a.stageStart - b.stageStart
    if (a.stageIndex !== b.stageIndex) return a.stageIndex - b.stageIndex
    const chainDelta = (chainOrder.get(a.chainId) ?? 999) - (chainOrder.get(b.chainId) ?? 999)
    if (chainDelta !== 0) return chainDelta
    return a.beneficiary.localeCompare(b.beneficiary)
  })
}
