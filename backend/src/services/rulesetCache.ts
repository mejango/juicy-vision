/**
 * Ruleset Cache Service
 *
 * PostgreSQL-backed caching for Juicebox V5 ruleset data with TTL-based expiration.
 *
 * Cache TTL Strategy:
 * - Historical rulesets: Never expire (expires_at = NULL) - immutable
 * - Current rulesets: 5 minute TTL - to detect new cycles
 * - Queued rulesets: 5 minute TTL - to detect new queued rulesets
 * - Splits: 2 minute TTL - mutable within ruleset limits
 */

import { execute, query, queryOne } from '../db/index.ts'

// TTL constants in milliseconds
// Current/queued rulesets are immutable once created - we cache them forever
// and rely on cycle watcher to invalidate when a new cycle starts
const QUEUED_RULESET_TTL_MS = 5 * 60 * 1000    // 5 minutes (to detect newly queued)
const SPLITS_TTL_MS = 2 * 60 * 1000            // 2 minutes
const SHOP_TTL_MS = 30 * 60 * 1000             // 30 minutes (tier data is stable)

export type RulesetStatus = 'historical' | 'current' | 'queued'

export interface CachedRuleset {
  id: string
  chainId: number
  projectId: number
  rulesetId: string
  cycleNumber: number
  rulesetData: RulesetData
  status: RulesetStatus
  fetchedAt: Date
  expiresAt: Date | null
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

export interface CachedSplits {
  id: string
  chainId: number
  projectId: number
  rulesetId: string
  payoutSplits: SplitData[]
  reservedSplits: SplitData[]
  fundAccessLimits: FundAccessLimits | null
  fetchedAt: Date
  expiresAt: Date
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

// ============================================================================
// Ruleset Cache Operations
// ============================================================================

/**
 * Get a single cached ruleset by ID
 */
export async function getCachedRuleset(
  chainId: number,
  projectId: number,
  rulesetId: string
): Promise<CachedRuleset | null> {
  const result = await queryOne<{
    id: string
    chain_id: number
    project_id: number
    ruleset_id: string
    cycle_number: number
    ruleset_data: RulesetData
    status: RulesetStatus
    fetched_at: Date
    expires_at: Date | null
  }>(
    `SELECT id, chain_id, project_id, ruleset_id, cycle_number, ruleset_data, status, fetched_at, expires_at
     FROM ruleset_cache
     WHERE chain_id = $1 AND project_id = $2 AND ruleset_id = $3
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [chainId, projectId, rulesetId]
  )

  if (!result) return null

  return {
    id: result.id,
    chainId: result.chain_id,
    projectId: result.project_id,
    rulesetId: result.ruleset_id,
    cycleNumber: result.cycle_number,
    rulesetData: result.ruleset_data,
    status: result.status,
    fetchedAt: result.fetched_at,
    expiresAt: result.expires_at,
  }
}

/**
 * Get the cached current ruleset for a project
 * Current rulesets are cached forever (immutable once created)
 */
export async function getCachedCurrentRuleset(
  chainId: number,
  projectId: number
): Promise<CachedRuleset | null> {
  const result = await queryOne<{
    id: string
    chain_id: number
    project_id: number
    ruleset_id: string
    cycle_number: number
    ruleset_data: RulesetData
    status: RulesetStatus
    fetched_at: Date
    expires_at: Date | null
  }>(
    `SELECT id, chain_id, project_id, ruleset_id, cycle_number, ruleset_data, status, fetched_at, expires_at
     FROM ruleset_cache
     WHERE chain_id = $1 AND project_id = $2 AND status = 'current'
     ORDER BY fetched_at DESC
     LIMIT 1`,
    [chainId, projectId]
  )

  if (!result) return null

  return {
    id: result.id,
    chainId: result.chain_id,
    projectId: result.project_id,
    rulesetId: result.ruleset_id,
    cycleNumber: result.cycle_number,
    rulesetData: result.ruleset_data,
    status: result.status,
    fetchedAt: result.fetched_at,
    expiresAt: result.expires_at,
  }
}

/**
 * Get cached queued ruleset for a project (if not expired)
 */
export async function getCachedQueuedRuleset(
  chainId: number,
  projectId: number
): Promise<CachedRuleset | null> {
  const result = await queryOne<{
    id: string
    chain_id: number
    project_id: number
    ruleset_id: string
    cycle_number: number
    ruleset_data: RulesetData
    status: RulesetStatus
    fetched_at: Date
    expires_at: Date | null
  }>(
    `SELECT id, chain_id, project_id, ruleset_id, cycle_number, ruleset_data, status, fetched_at, expires_at
     FROM ruleset_cache
     WHERE chain_id = $1 AND project_id = $2 AND status = 'queued'
       AND expires_at > NOW()
     ORDER BY fetched_at DESC
     LIMIT 1`,
    [chainId, projectId]
  )

  if (!result) return null

  return {
    id: result.id,
    chainId: result.chain_id,
    projectId: result.project_id,
    rulesetId: result.ruleset_id,
    cycleNumber: result.cycle_number,
    rulesetData: result.ruleset_data,
    status: result.status,
    fetchedAt: result.fetched_at,
    expiresAt: result.expires_at,
  }
}

/**
 * Get all cached historical rulesets for a project (never expire)
 */
export async function getCachedRulesetHistory(
  chainId: number,
  projectId: number
): Promise<CachedRuleset[]> {
  const results = await query<{
    id: string
    chain_id: number
    project_id: number
    ruleset_id: string
    cycle_number: number
    ruleset_data: RulesetData
    status: RulesetStatus
    fetched_at: Date
    expires_at: Date | null
  }>(
    `SELECT id, chain_id, project_id, ruleset_id, cycle_number, ruleset_data, status, fetched_at, expires_at
     FROM ruleset_cache
     WHERE chain_id = $1 AND project_id = $2 AND status = 'historical'
     ORDER BY cycle_number ASC`,
    [chainId, projectId]
  )

  return results.map((r) => ({
    id: r.id,
    chainId: r.chain_id,
    projectId: r.project_id,
    rulesetId: r.ruleset_id,
    cycleNumber: r.cycle_number,
    rulesetData: r.ruleset_data,
    status: r.status,
    fetchedAt: r.fetched_at,
    expiresAt: r.expires_at,
  }))
}

/**
 * Cache a ruleset with appropriate TTL based on status
 * Note: Current rulesets are cached forever (immutable once created)
 * and invalidated via cycle watcher when a new cycle starts
 */
export async function cacheRuleset(
  chainId: number,
  projectId: number,
  rulesetId: string,
  cycleNumber: number,
  rulesetData: RulesetData,
  status: RulesetStatus
): Promise<void> {
  // Calculate expires_at based on status
  // Current and historical rulesets are immutable - cache forever
  // Queued rulesets need short TTL to detect newly queued ones
  let expiresAt: Date | null = null

  if (status === 'queued') {
    expiresAt = new Date(Date.now() + QUEUED_RULESET_TTL_MS)
  }
  // Current and historical rulesets have expires_at = NULL (never expire)

  await execute(
    `INSERT INTO ruleset_cache (chain_id, project_id, ruleset_id, cycle_number, ruleset_data, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (chain_id, project_id, ruleset_id)
     DO UPDATE SET
       cycle_number = EXCLUDED.cycle_number,
       ruleset_data = EXCLUDED.ruleset_data,
       status = EXCLUDED.status,
       fetched_at = NOW(),
       expires_at = EXCLUDED.expires_at`,
    [chainId, projectId, rulesetId, cycleNumber, JSON.stringify(rulesetData), status, expiresAt]
  )
}

/**
 * Cache multiple historical rulesets at once (batch insert)
 */
export async function cacheRulesetHistory(
  chainId: number,
  projectId: number,
  rulesets: Array<{ rulesetId: string; cycleNumber: number; rulesetData: RulesetData }>
): Promise<void> {
  if (rulesets.length === 0) return

  // Build batch insert with ON CONFLICT
  const values: unknown[] = []
  const placeholders: string[] = []

  for (let i = 0; i < rulesets.length; i++) {
    const base = i * 5
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, 'historical', NULL)`)
    values.push(
      chainId,
      projectId,
      rulesets[i].rulesetId,
      rulesets[i].cycleNumber,
      JSON.stringify(rulesets[i].rulesetData)
    )
  }

  await execute(
    `INSERT INTO ruleset_cache (chain_id, project_id, ruleset_id, cycle_number, ruleset_data, status, expires_at)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (chain_id, project_id, ruleset_id) DO NOTHING`,
    values
  )
}

/**
 * Update status of a ruleset (e.g., current -> historical when cycle advances)
 */
export async function updateRulesetStatus(
  chainId: number,
  projectId: number,
  rulesetId: string,
  newStatus: RulesetStatus
): Promise<void> {
  // Both current and historical are cached forever, only queued has TTL
  const expiresAt = newStatus === 'queued' ? new Date(Date.now() + QUEUED_RULESET_TTL_MS) : null

  await execute(
    `UPDATE ruleset_cache
     SET status = $1, expires_at = $2, fetched_at = NOW()
     WHERE chain_id = $3 AND project_id = $4 AND ruleset_id = $5`,
    [newStatus, expiresAt, chainId, projectId, rulesetId]
  )
}

/**
 * Invalidate (delete) current ruleset cache for a project
 * Used when cycle advances or ruleset changes detected
 */
export async function invalidateCurrentRuleset(
  chainId: number,
  projectId: number
): Promise<void> {
  await execute(
    `DELETE FROM ruleset_cache
     WHERE chain_id = $1 AND project_id = $2 AND status = 'current'`,
    [chainId, projectId]
  )
}

/**
 * Invalidate (delete) queued ruleset cache for a project
 * Used after user queues a new ruleset
 */
export async function invalidateQueuedRuleset(
  chainId: number,
  projectId: number
): Promise<void> {
  await execute(
    `DELETE FROM ruleset_cache
     WHERE chain_id = $1 AND project_id = $2 AND status = 'queued'`,
    [chainId, projectId]
  )
}

// ============================================================================
// Splits Cache Operations
// ============================================================================

/**
 * Get cached splits for a ruleset (if not expired)
 */
export async function getCachedSplits(
  chainId: number,
  projectId: number,
  rulesetId: string
): Promise<CachedSplits | null> {
  const result = await queryOne<{
    id: string
    chain_id: number
    project_id: number
    ruleset_id: string
    payout_splits: SplitData[]
    reserved_splits: SplitData[]
    fund_access_limits: FundAccessLimits | null
    fetched_at: Date
    expires_at: Date
  }>(
    `SELECT id, chain_id, project_id, ruleset_id, payout_splits, reserved_splits, fund_access_limits, fetched_at, expires_at
     FROM splits_cache
     WHERE chain_id = $1 AND project_id = $2 AND ruleset_id = $3
       AND expires_at > NOW()`,
    [chainId, projectId, rulesetId]
  )

  if (!result) return null

  return {
    id: result.id,
    chainId: result.chain_id,
    projectId: result.project_id,
    rulesetId: result.ruleset_id,
    payoutSplits: result.payout_splits,
    reservedSplits: result.reserved_splits,
    fundAccessLimits: result.fund_access_limits,
    fetchedAt: result.fetched_at,
    expiresAt: result.expires_at,
  }
}

/**
 * Cache splits data with 2 minute TTL
 */
export async function cacheSplits(
  chainId: number,
  projectId: number,
  rulesetId: string,
  payoutSplits: SplitData[],
  reservedSplits: SplitData[],
  fundAccessLimits: FundAccessLimits | null
): Promise<void> {
  const expiresAt = new Date(Date.now() + SPLITS_TTL_MS)

  await execute(
    `INSERT INTO splits_cache (chain_id, project_id, ruleset_id, payout_splits, reserved_splits, fund_access_limits, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (chain_id, project_id, ruleset_id)
     DO UPDATE SET
       payout_splits = EXCLUDED.payout_splits,
       reserved_splits = EXCLUDED.reserved_splits,
       fund_access_limits = EXCLUDED.fund_access_limits,
       fetched_at = NOW(),
       expires_at = EXCLUDED.expires_at`,
    [chainId, projectId, rulesetId, JSON.stringify(payoutSplits), JSON.stringify(reservedSplits), fundAccessLimits ? JSON.stringify(fundAccessLimits) : null, expiresAt]
  )
}

/**
 * Invalidate (delete) splits cache for a ruleset
 * Used after user modifies splits
 */
export async function invalidateSplits(
  chainId: number,
  projectId: number,
  rulesetId: string
): Promise<void> {
  await execute(
    `DELETE FROM splits_cache
     WHERE chain_id = $1 AND project_id = $2 AND ruleset_id = $3`,
    [chainId, projectId, rulesetId]
  )
}

/**
 * Invalidate all splits for a project
 */
export async function invalidateProjectSplits(
  chainId: number,
  projectId: number
): Promise<void> {
  await execute(
    `DELETE FROM splits_cache
     WHERE chain_id = $1 AND project_id = $2`,
    [chainId, projectId]
  )
}

// ============================================================================
// Shop Cache Operations (NFT tiers)
// ============================================================================

export interface ShopTier {
  tierId: number
  name: string
  description?: string
  imageUri?: string
  price: string
  currency: number
  initialSupply: number
  remainingSupply: number
  reservedRate: number
  votingUnits: string
  category: number
  allowOwnerMint: boolean
  transfersPausable: boolean
  metadata?: Record<string, unknown>
}

export interface CachedShop {
  id: string
  chainId: number
  projectId: number
  hookAddress: string
  tiers: ShopTier[]
  fetchedAt: Date
  expiresAt: Date
}

/**
 * Get cached shop data for a project (if not expired)
 */
export async function getCachedShop(
  chainId: number,
  projectId: number
): Promise<CachedShop | null> {
  const result = await queryOne<{
    id: string
    chain_id: number
    project_id: number
    hook_address: string
    tiers: ShopTier[]
    fetched_at: Date
    expires_at: Date
  }>(
    `SELECT id, chain_id, project_id, hook_address, tiers, fetched_at, expires_at
     FROM shop_cache
     WHERE chain_id = $1 AND project_id = $2
       AND expires_at > NOW()`,
    [chainId, projectId]
  )

  if (!result) return null

  return {
    id: result.id,
    chainId: result.chain_id,
    projectId: result.project_id,
    hookAddress: result.hook_address,
    tiers: result.tiers,
    fetchedAt: result.fetched_at,
    expiresAt: result.expires_at,
  }
}

/**
 * Cache shop data with 30 minute TTL
 */
export async function cacheShop(
  chainId: number,
  projectId: number,
  hookAddress: string,
  tiers: ShopTier[]
): Promise<void> {
  const expiresAt = new Date(Date.now() + SHOP_TTL_MS)

  await execute(
    `INSERT INTO shop_cache (chain_id, project_id, hook_address, tiers, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (chain_id, project_id)
     DO UPDATE SET
       hook_address = EXCLUDED.hook_address,
       tiers = EXCLUDED.tiers,
       fetched_at = NOW(),
       expires_at = EXCLUDED.expires_at`,
    [chainId, projectId, hookAddress, JSON.stringify(tiers), expiresAt]
  )
}

/**
 * Invalidate shop cache for a project
 * Used after user modifies tiers or for manual refresh
 */
export async function invalidateShop(
  chainId: number,
  projectId: number
): Promise<void> {
  await execute(
    `DELETE FROM shop_cache
     WHERE chain_id = $1 AND project_id = $2`,
    [chainId, projectId]
  )
}

// ============================================================================
// Cleanup Operations
// ============================================================================

/**
 * Delete all expired cache entries
 * Should be run periodically (e.g., every 5 minutes)
 */
export async function cleanupExpiredCache(): Promise<{ rulesets: number; splits: number; shop: number }> {
  const rulesetsDeleted = await execute(
    `DELETE FROM ruleset_cache
     WHERE expires_at IS NOT NULL AND expires_at < NOW()`
  )

  const splitsDeleted = await execute(
    `DELETE FROM splits_cache
     WHERE expires_at < NOW()`
  )

  const shopDeleted = await execute(
    `DELETE FROM shop_cache
     WHERE expires_at < NOW()`
  )

  return {
    rulesets: rulesetsDeleted,
    splits: splitsDeleted,
    shop: shopDeleted,
  }
}

/**
 * Get cache stats for monitoring
 */
export async function getCacheStats(): Promise<{
  totalRulesets: number
  historicalRulesets: number
  currentRulesets: number
  queuedRulesets: number
  totalSplits: number
  totalShop: number
  expiredRulesets: number
  expiredSplits: number
  expiredShop: number
}> {
  const stats = await queryOne<{
    total_rulesets: string
    historical_rulesets: string
    current_rulesets: string
    queued_rulesets: string
    total_splits: string
    total_shop: string
    expired_rulesets: string
    expired_splits: string
    expired_shop: string
  }>(
    `SELECT
       (SELECT COUNT(*) FROM ruleset_cache) as total_rulesets,
       (SELECT COUNT(*) FROM ruleset_cache WHERE status = 'historical') as historical_rulesets,
       (SELECT COUNT(*) FROM ruleset_cache WHERE status = 'current') as current_rulesets,
       (SELECT COUNT(*) FROM ruleset_cache WHERE status = 'queued') as queued_rulesets,
       (SELECT COUNT(*) FROM splits_cache) as total_splits,
       (SELECT COUNT(*) FROM shop_cache) as total_shop,
       (SELECT COUNT(*) FROM ruleset_cache WHERE expires_at IS NOT NULL AND expires_at < NOW()) as expired_rulesets,
       (SELECT COUNT(*) FROM splits_cache WHERE expires_at < NOW()) as expired_splits,
       (SELECT COUNT(*) FROM shop_cache WHERE expires_at < NOW()) as expired_shop`
  )

  if (!stats) {
    return {
      totalRulesets: 0,
      historicalRulesets: 0,
      currentRulesets: 0,
      queuedRulesets: 0,
      totalSplits: 0,
      totalShop: 0,
      expiredRulesets: 0,
      expiredSplits: 0,
      expiredShop: 0,
    }
  }

  return {
    totalRulesets: parseInt(stats.total_rulesets, 10),
    historicalRulesets: parseInt(stats.historical_rulesets, 10),
    currentRulesets: parseInt(stats.current_rulesets, 10),
    queuedRulesets: parseInt(stats.queued_rulesets, 10),
    totalSplits: parseInt(stats.total_splits, 10),
    totalShop: parseInt(stats.total_shop, 10),
    expiredRulesets: parseInt(stats.expired_rulesets, 10),
    expiredSplits: parseInt(stats.expired_splits, 10),
    expiredShop: parseInt(stats.expired_shop, 10),
  }
}
