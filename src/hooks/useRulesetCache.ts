/**
 * Ruleset Cache Hooks
 *
 * React Query hooks for cached Juicebox V5 ruleset data.
 * Uses server-side caching with appropriate stale times:
 * - Historical rulesets: staleTime = Infinity (immutable)
 * - Current/queued rulesets: staleTime = 5 min
 * - Splits: staleTime = 2 min
 *
 * ## Usage Examples
 *
 * ```tsx
 * // Basic usage - get current ruleset
 * function ProjectInfo({ chainId, projectId }: { chainId: number; projectId: number }) {
 *   const { data: ruleset, isLoading } = useCurrentRuleset(chainId, projectId)
 *   if (isLoading) return <Spinner />
 *   if (!ruleset) return <div>No ruleset found</div>
 *   return <div>Cycle #{ruleset.cycleNumber}</div>
 * }
 *
 * // With splits data
 * function ProjectSplits({ chainId, projectId }: Props) {
 *   const { data: ruleset } = useCurrentRuleset(chainId, projectId)
 *   const { data: splits } = useRulesetSplits(chainId, projectId, ruleset?.id)
 *
 *   return (
 *     <div>
 *       {splits?.payoutSplits.map(s => <Split key={s.beneficiary} data={s} />)}
 *     </div>
 *   )
 * }
 *
 * // Watch for cycle changes (auto-invalidates current ruleset cache)
 * function CycleAwareComponent({ chainId, projectId }: Props) {
 *   const { cycleNumber } = useCycleWatcher(chainId, projectId)
 *   // cycleNumber updates every 60s, cache invalidates on change
 * }
 *
 * // Manual invalidation after user action
 * function QueueRulesetButton({ chainId, projectId }: Props) {
 *   const invalidateQueued = useInvalidateQueuedRuleset()
 *
 *   const handleQueue = async () => {
 *     await queueRuleset()
 *     invalidateQueued(chainId, projectId) // Force refetch
 *   }
 * }
 * ```
 *
 * ## Migration Guide
 *
 * Replace direct bendystraw calls with cached hooks:
 *
 * Before:
 * ```ts
 * const project = await fetchProjectWithRuleset(projectId, chainId)
 * const ruleset = project.currentRuleset
 * ```
 *
 * After:
 * ```ts
 * const { data: ruleset } = useCurrentRuleset(chainId, parseInt(projectId))
 * ```
 *
 * For splits:
 * Before:
 * ```ts
 * const splits = await fetchProjectSplits(projectId, chainId, rulesetId)
 * ```
 *
 * After:
 * ```ts
 * const { data: splits } = useRulesetSplits(chainId, parseInt(projectId), rulesetId)
 * ```
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

// Stale time constants (match backend TTLs)
// Current rulesets are immutable - cache forever, use cycle watcher for invalidation
const QUEUED_RULESET_STALE_TIME = 5 * 60 * 1000   // 5 minutes (to detect newly queued)
const SPLITS_STALE_TIME = 2 * 60 * 1000           // 2 minutes
const SHOP_STALE_TIME = 30 * 60 * 1000            // 30 minutes (tier data is stable)
const CYCLE_POLL_INTERVAL = 60 * 1000             // 60 seconds

// ============================================================================
// Types
// ============================================================================

export interface RulesetMetadata {
  reservedPercent: number
  cashOutTaxRate: number
  baseCurrency: number
  pausePay: boolean
  pauseCashOut: boolean
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
  useTotalSurplusForCashOuts: boolean
  useDataHookForPay: boolean
  useDataHookForCashOut: boolean
  dataHook: string
  metadata: number
}

export interface RulesetData {
  cycleNumber: number
  id: string
  start: number
  duration: number
  weight: string
  weightCutPercent: number
  basedOnId?: string
  metadata?: RulesetMetadata
}

export interface SplitData {
  percent: number
  projectId: number
  beneficiary: string
  preferAddToBalance: boolean
  lockedUntil: number
  hook: string
}

export interface FundAccessLimits {
  payoutLimits: Array<{ amount: string; currency: number }>
  surplusAllowances: Array<{ amount: string; currency: number }>
}

export interface SplitsData {
  payoutSplits: SplitData[]
  reservedSplits: SplitData[]
  fundAccessLimits: FundAccessLimits | null
}

// ============================================================================
// Query Key Factory
// ============================================================================

export const rulesetKeys = {
  all: ['rulesets'] as const,
  current: (chainId: number, projectId: number) =>
    ['rulesets', chainId, projectId, 'current'] as const,
  queued: (chainId: number, projectId: number) =>
    ['rulesets', chainId, projectId, 'queued'] as const,
  history: (chainId: number, projectId: number) =>
    ['rulesets', chainId, projectId, 'history'] as const,
  splits: (chainId: number, projectId: number, rulesetId: string) =>
    ['rulesets', chainId, projectId, 'splits', rulesetId] as const,
  cycle: (chainId: number, projectId: number) =>
    ['rulesets', chainId, projectId, 'cycle'] as const,
  shop: (chainId: number, projectId: number) =>
    ['shop', chainId, projectId] as const,
}

// ============================================================================
// API Fetchers
// ============================================================================

async function fetchCurrentRuleset(chainId: number, projectId: number): Promise<RulesetData | null> {
  const response = await fetch(`${API_BASE_URL}/rulesets/${chainId}/${projectId}/current`)
  const data = await response.json()

  if (!response.ok || !data.success) {
    if (response.status === 404) return null
    throw new Error(data.error || 'Failed to fetch current ruleset')
  }

  return data.data
}

async function fetchQueuedRuleset(chainId: number, projectId: number): Promise<RulesetData | null> {
  const response = await fetch(`${API_BASE_URL}/rulesets/${chainId}/${projectId}/queued`)
  const data = await response.json()

  if (!response.ok || !data.success) {
    if (response.status === 404) return null
    throw new Error(data.error || 'Failed to fetch queued ruleset')
  }

  return data.data
}

async function fetchRulesetHistory(chainId: number, projectId: number): Promise<RulesetData[]> {
  const response = await fetch(`${API_BASE_URL}/rulesets/${chainId}/${projectId}/history`)
  const data = await response.json()

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to fetch ruleset history')
  }

  return data.data || []
}

async function fetchSplits(chainId: number, projectId: number, rulesetId: string): Promise<SplitsData> {
  const response = await fetch(`${API_BASE_URL}/rulesets/${chainId}/${projectId}/${rulesetId}/splits`)
  const data = await response.json()

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to fetch splits')
  }

  return data.data
}

async function fetchCycleNumber(chainId: number, projectId: number): Promise<number | null> {
  const response = await fetch(`${API_BASE_URL}/rulesets/${chainId}/${projectId}/cycle`)
  const data = await response.json()

  if (!response.ok || !data.success) {
    return null
  }

  return data.data?.cycleNumber ?? null
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch the current ruleset for a project
 * staleTime: Infinity (current rulesets are immutable)
 * Use useCycleWatcher to detect when a new cycle starts and invalidate
 */
export function useCurrentRuleset(chainId: number | undefined, projectId: number | undefined) {
  return useQuery({
    queryKey: rulesetKeys.current(chainId ?? 0, projectId ?? 0),
    queryFn: () => fetchCurrentRuleset(chainId!, projectId!),
    enabled: !!chainId && !!projectId,
    staleTime: Infinity, // Immutable - rely on cycle watcher for invalidation
  })
}

/**
 * Fetch the queued ruleset for a project
 * staleTime: 5 minutes (to detect newly queued rulesets)
 */
export function useQueuedRuleset(chainId: number | undefined, projectId: number | undefined) {
  return useQuery({
    queryKey: rulesetKeys.queued(chainId ?? 0, projectId ?? 0),
    queryFn: () => fetchQueuedRuleset(chainId!, projectId!),
    enabled: !!chainId && !!projectId,
    staleTime: QUEUED_RULESET_STALE_TIME,
  })
}

/**
 * Fetch all historical rulesets for a project
 * staleTime: Infinity (historical rulesets are immutable)
 */
export function useRulesetHistory(chainId: number | undefined, projectId: number | undefined) {
  return useQuery({
    queryKey: rulesetKeys.history(chainId ?? 0, projectId ?? 0),
    queryFn: () => fetchRulesetHistory(chainId!, projectId!),
    enabled: !!chainId && !!projectId,
    staleTime: Infinity, // Historical rulesets never change
  })
}

/**
 * Fetch splits for a specific ruleset
 * staleTime: 2 minutes (splits can change within ruleset limits)
 */
export function useRulesetSplits(
  chainId: number | undefined,
  projectId: number | undefined,
  rulesetId: string | undefined
) {
  return useQuery({
    queryKey: rulesetKeys.splits(chainId ?? 0, projectId ?? 0, rulesetId ?? ''),
    queryFn: () => fetchSplits(chainId!, projectId!, rulesetId!),
    enabled: !!chainId && !!projectId && !!rulesetId,
    staleTime: SPLITS_STALE_TIME,
  })
}

/**
 * Watch for cycle changes and invalidate current ruleset cache
 * Polls the /cycle endpoint every 60 seconds
 */
export function useCycleWatcher(chainId: number | undefined, projectId: number | undefined) {
  const queryClient = useQueryClient()
  const lastCycleRef = useRef<number | null>(null)

  const { data: cycleNumber } = useQuery({
    queryKey: rulesetKeys.cycle(chainId ?? 0, projectId ?? 0),
    queryFn: () => fetchCycleNumber(chainId!, projectId!),
    enabled: !!chainId && !!projectId,
    refetchInterval: CYCLE_POLL_INTERVAL,
    staleTime: 0, // Always refetch to detect changes
  })

  // Invalidate current ruleset cache when cycle changes
  useEffect(() => {
    if (cycleNumber === null || cycleNumber === undefined) return
    if (!chainId || !projectId) return

    if (lastCycleRef.current !== null && lastCycleRef.current !== cycleNumber) {
      // Cycle changed - invalidate current ruleset
      queryClient.invalidateQueries({
        queryKey: rulesetKeys.current(chainId, projectId),
      })
    }

    lastCycleRef.current = cycleNumber
  }, [cycleNumber, chainId, projectId, queryClient])

  return { cycleNumber }
}

// ============================================================================
// Cache Invalidation Helpers
// ============================================================================

/**
 * Invalidate current ruleset cache (call after detecting cycle change)
 */
export function useInvalidateCurrentRuleset() {
  const queryClient = useQueryClient()

  return (chainId: number, projectId: number) => {
    queryClient.invalidateQueries({
      queryKey: rulesetKeys.current(chainId, projectId),
    })
  }
}

/**
 * Invalidate queued ruleset cache (call after user queues new ruleset)
 */
export function useInvalidateQueuedRuleset() {
  const queryClient = useQueryClient()

  return (chainId: number, projectId: number) => {
    queryClient.invalidateQueries({
      queryKey: rulesetKeys.queued(chainId, projectId),
    })
  }
}

/**
 * Invalidate splits cache (call after user modifies splits)
 */
export function useInvalidateSplits() {
  const queryClient = useQueryClient()

  return (chainId: number, projectId: number, rulesetId?: string) => {
    if (rulesetId) {
      queryClient.invalidateQueries({
        queryKey: rulesetKeys.splits(chainId, projectId, rulesetId),
      })
    } else {
      // Invalidate all splits for this project
      queryClient.invalidateQueries({
        queryKey: ['rulesets', chainId, projectId, 'splits'],
      })
    }
  }
}

/**
 * Prefetch current ruleset (useful for preloading on hover)
 */
export function usePrefetchCurrentRuleset() {
  const queryClient = useQueryClient()

  return (chainId: number, projectId: number) => {
    queryClient.prefetchQuery({
      queryKey: rulesetKeys.current(chainId, projectId),
      queryFn: () => fetchCurrentRuleset(chainId, projectId),
      staleTime: Infinity,
    })
  }
}

// ============================================================================
// Shop Data Hooks
// ============================================================================

/**
 * Invalidate shop cache (call after user modifies tiers or for manual refresh)
 */
export function useInvalidateShop() {
  const queryClient = useQueryClient()

  return (chainId: number, projectId: number) => {
    queryClient.invalidateQueries({
      queryKey: rulesetKeys.shop(chainId, projectId),
    })
  }
}

/**
 * Refetch shop data (for refresh button)
 */
export function useRefetchShop() {
  const queryClient = useQueryClient()

  return (chainId: number, projectId: number) => {
    queryClient.refetchQueries({
      queryKey: rulesetKeys.shop(chainId, projectId),
    })
  }
}

/**
 * Get the stale time for shop data
 */
export function getShopStaleTime() {
  return SHOP_STALE_TIME
}
