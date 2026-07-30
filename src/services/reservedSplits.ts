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
import type { SimpleRuleset } from './bendystraw'
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
 * A chain the project lives on, with the project's id ON THAT CHAIN. V6 project
 * ids are independent per chain, so every per-chain read/tx must use the id for
 * that specific chain — never the home id everywhere.
 */
export interface ChainProject {
  chainId: number
  projectId: number | string
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

/**
 * One chain's ruleset for a browsed stage. The same stage is a DIFFERENT
 * ruleset id on every chain, so a stage is identified by its start-order index
 * (fetchAllRulesets is start-ascending and index-aligned across chains) and
 * resolved to a ruleset per chain.
 */
export interface ChainStageRuleset {
  chainId: number
  projectId: number | string
  /** That chain's ruleset for the stage; null = the chain has no such stage, or the read failed. */
  ruleset: SimpleRuleset | null
}

/** One chain's reserved splits for a browsed stage. */
export interface ChainStageSplits {
  chainId: number
  projectId: number | string
  /** The ruleset id the splits were read at, on that chain; null = unresolved. */
  rulesetId: string | null
  /** Reserved-group splits; null = unreadable (never a fake empty group). */
  splits: ReservedSplit[] | null
}

/** Injectable for tests: swap the per-chain ruleset/splits readers. */
export interface StageSplitsDeps {
  readStages?: (projectId: string, chainId: number) => Promise<SimpleRuleset[]>
  readSplits?: (
    projectId: number | string,
    chainId: number,
    rulesetId: string,
  ) => Promise<ReservedSplit[]>
}

async function defaultReadStages(projectId: string, chainId: number): Promise<SimpleRuleset[]> {
  const { fetchAllRulesets } = await import('./bendystraw')
  return fetchAllRulesets(projectId, chainId)
}

/**
 * Resolve the browsed stage's ruleset on every chain the project lives on. A
 * chain that can't be read (or has no stage at that index) yields a null
 * ruleset so callers fail closed on that chain alone.
 */
export async function fetchStageRulesetsPerChain(
  chainProjects: readonly ChainProject[],
  stageIndex: number,
  deps: StageSplitsDeps = {},
): Promise<ChainStageRuleset[]> {
  const readStages = deps.readStages ?? defaultReadStages
  const settled = await Promise.allSettled(
    chainProjects.map(cp => readStages(String(cp.projectId), cp.chainId)),
  )
  return chainProjects.map((cp, index) => {
    const result = settled[index]
    return {
      chainId: cp.chainId,
      projectId: cp.projectId,
      ruleset: result && result.status === 'fulfilled' ? (result.value[stageIndex] ?? null) : null,
    }
  })
}

/**
 * One chain's reserved splits for the browsed stage, read at THAT chain's
 * ruleset id with THAT chain's project id. Never throws — an unreadable chain
 * reports null splits so the other chains keep rendering.
 */
export async function fetchStageReservedSplits(
  chainProject: ChainProject,
  stageIndex: number,
  deps: StageSplitsDeps = {},
): Promise<ChainStageSplits> {
  const [{ ruleset }] = await fetchStageRulesetsPerChain([chainProject], stageIndex, deps)
  const base = { chainId: chainProject.chainId, projectId: chainProject.projectId }
  if (!ruleset) return { ...base, rulesetId: null, splits: null }
  const readSplits = deps.readSplits ?? fetchReservedSplits
  try {
    return {
      ...base,
      rulesetId: ruleset.id,
      splits: await readSplits(chainProject.projectId, chainProject.chainId, ruleset.id),
    }
  } catch {
    return { ...base, rulesetId: ruleset.id, splits: null }
  }
}

/**
 * Pre-send guard for an edit aimed at a browsed stage: the stage must still map
 * to the ruleset id that was reviewed. This is the stage-scoped counterpart of
 * assertCurrentRulesetId, which only fits an edit aimed at the current ruleset —
 * a queued stage is legitimately not the current one. Fails closed: an
 * unreadable schedule aborts rather than writing splits to a stale ruleset.
 */
export async function assertStageRulesetUnchanged(params: {
  chainProject: ChainProject
  stageIndex: number
  expectedRulesetId: string
  deps?: StageSplitsDeps
}): Promise<void> {
  const [{ ruleset }] = await fetchStageRulesetsPerChain(
    [params.chainProject],
    params.stageIndex,
    params.deps ?? {},
  )
  if (!ruleset || ruleset.id !== params.expectedRulesetId) {
    throw new Error(
      `The project stages changed on chain ${params.chainProject.chainId}. Close this review and load the latest configuration.`,
    )
  }
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
  chainProjects: readonly ChainProject[],
  deps: PendingReservedDeps = {},
): Promise<PendingReservedRow[]> {
  const readPending = deps.readPending ?? defaultReadPending
  const settled = await Promise.allSettled(
    chainProjects.map(cp => readPending(String(cp.projectId), cp.chainId)),
  )
  return assemblePendingRows(chainProjects.map(cp => cp.chainId), settled)
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
  chainProjects: readonly ChainProject[],
  limit = 25,
): Promise<ReservedDistributionRow[]> {
  if (!chainProjects.length) return []
  const { safeRequest, getNetworkOption } = await import('./bendystraw/client')
  // Per-chain project ids differ, so query each chain by its own id and merge —
  // a single projectId + chainId_in filter would read the wrong project off-home.
  const pages = await Promise.all(
    chainProjects.map(cp =>
      safeRequest<ReservedDistPage>(
        RESERVED_DIST_QUERY,
        { projectId: Number(cp.projectId), version: BENDYSTRAW_VERSION, chainIds: [cp.chainId], limit },
        getNetworkOption(cp.chainId),
      ),
    ),
  )
  const rows = pages.flatMap(data => {
    const items = data?.sendReservedTokensToSplitsEvents?.items
    if (!Array.isArray(items)) return []
    return items.map(item => ({
      chainId: Number(item.chainId),
      timestamp: Number(item.timestamp),
      txHash: String(item.txHash),
      tokenCount: BigInt(item.tokenCount || '0'),
    }))
  })
  return rows.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit)
}

const AUTO_ISSUE_PAGE_SIZE = 250

const STORE_AUTO_ISSUANCE_QUERY = `query($projectId: Int!, $chainId: Int!, $version: Int!, $limit: Int!, $offset: Int!) {
  storeAutoIssuanceAmountEvents(where: { projectId: $projectId, chainId: $chainId, version: $version },
    orderBy: "timestamp", orderDirection: "desc", limit: $limit, offset: $offset) {
    items { timestamp txHash beneficiary stageId count } totalCount } }`

const AUTO_ISSUE_EVENTS_QUERY = `query($projectId: Int!, $chainId: Int!, $version: Int!, $limit: Int!, $offset: Int!) {
  autoIssueEvents(where: { projectId: $projectId, chainId: $chainId, version: $version },
    orderBy: "timestamp", orderDirection: "desc", limit: $limit, offset: $offset) {
    items { timestamp txHash beneficiary stageId count } totalCount } }`

interface AutoIssueEventsPage {
  [path: string]: {
    items: Array<{
      timestamp: string | number
      txHash: string
      beneficiary: string
      stageId: string | number
      count: string
    }>
    totalCount: number
  }
}

async function fetchAutoIssueEvents(
  path: 'storeAutoIssuanceAmountEvents' | 'autoIssueEvents',
  query: string,
  projectId: number,
  chainId: number,
) {
  const { safeRequest, getNetworkOption } = await import('./bendystraw/client')
  const items: AutoIssueEventsPage[string]['items'] = []
  let totalCount = 0
  do {
    const data = await safeRequest<AutoIssueEventsPage>(
      query,
      {
        projectId,
        chainId,
        version: BENDYSTRAW_VERSION,
        limit: AUTO_ISSUE_PAGE_SIZE,
        offset: items.length,
      },
      getNetworkOption(chainId),
    )
    const page = data?.[path]
    if (!Array.isArray(page?.items)) throw new Error('Auto-issuance data is unavailable')
    totalCount = page.totalCount ?? page.items.length
    items.push(...page.items)
    if (!page.items.length) break
  } while (items.length < totalCount)
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
  chainProjects: readonly ChainProject[],
): Promise<AutoIssuanceRow[]> {
  const revChainProjects = chainProjects.filter(cp => v6Address('REVOwner', cp.chainId) !== null)
  if (!revChainProjects.length) return []
  const { fetchAllRulesets } = await import('./bendystraw')

  const perChain = await Promise.all(
    revChainProjects.map(async ({ chainId, projectId }) => {
      const pid = Number(projectId)
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

  const chainOrder = new Map(revChainProjects.map((cp, index) => [cp.chainId, index]))
  return perChain.flat().sort((a, b) => {
    if (a.stageStart !== b.stageStart) return a.stageStart - b.stageStart
    if (a.stageIndex !== b.stageIndex) return a.stageIndex - b.stageIndex
    const chainDelta = (chainOrder.get(a.chainId) ?? 999) - (chainOrder.get(b.chainId) ?? 999)
    if (chainDelta !== 0) return chainDelta
    return a.beneficiary.localeCompare(b.beneficiary)
  })
}
