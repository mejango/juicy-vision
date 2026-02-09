/**
 * Rulesets API Routes
 *
 * Cached endpoints for Juicebox V5 ruleset data.
 * Uses server-side caching with appropriate TTLs:
 * - Historical rulesets: Never expire (immutable)
 * - Current/queued rulesets: 5 minute TTL
 * - Splits: 2 minute TTL
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  getCachedRuleset,
  getCachedCurrentRuleset,
  getCachedQueuedRuleset,
  getCachedRulesetHistory,
  getCachedSplits,
  getCachedShop,
  cacheRuleset,
  cacheRulesetHistory,
  cacheSplits,
  cacheShop,
  invalidateShop,
  getCacheStats,
  type RulesetData,
  type ShopTier,
} from '../services/rulesetCache.ts'
import {
  fetchCurrentRuleset,
  fetchQueuedRuleset,
  fetchRulesetHistory,
  fetchSplits,
  getCurrentCycleNumber,
} from '../services/chainReader.ts'

export const rulesetsRouter = new Hono()

// =============================================================================
// Validation Schemas
// =============================================================================

const ChainProjectParams = z.object({
  chainId: z.string().regex(/^\d+$/).transform(Number),
  projectId: z.string().regex(/^\d+$/).transform(Number),
})

const RulesetIdParams = z.object({
  chainId: z.string().regex(/^\d+$/).transform(Number),
  projectId: z.string().regex(/^\d+$/).transform(Number),
  rulesetId: z.string().regex(/^\d+$/),
})

// =============================================================================
// Routes
// =============================================================================

/**
 * GET /rulesets/:chainId/:projectId/current
 * Returns the cached current ruleset, fetching from chain on miss
 */
rulesetsRouter.get(
  '/:chainId/:projectId/current',
  zValidator('param', ChainProjectParams),
  async (c) => {
    const { chainId, projectId } = c.req.valid('param')

    try {
      // Check cache first
      const cached = await getCachedCurrentRuleset(chainId, projectId)
      if (cached) {
        return c.json({
          success: true,
          data: cached.rulesetData,
          cached: true,
          expiresAt: cached.expiresAt,
        })
      }

      // Cache miss - fetch from chain
      const result = await fetchCurrentRuleset(chainId, projectId)
      if (!result) {
        return c.json({ success: false, error: 'No current ruleset found' }, 404)
      }

      // Cache the result
      const rulesetData: RulesetData = {
        ...result.ruleset,
        metadata: result.metadata,
      }
      await cacheRuleset(chainId, projectId, result.ruleset.id, result.ruleset.cycleNumber, rulesetData, 'current')

      return c.json({
        success: true,
        data: rulesetData,
        cached: false,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch ruleset'
      console.error('Failed to fetch current ruleset:', error)
      return c.json({ success: false, error: message }, 500)
    }
  }
)

/**
 * GET /rulesets/:chainId/:projectId/queued
 * Returns the cached queued ruleset, fetching from chain on miss
 */
rulesetsRouter.get(
  '/:chainId/:projectId/queued',
  zValidator('param', ChainProjectParams),
  async (c) => {
    const { chainId, projectId } = c.req.valid('param')

    try {
      // Check cache first
      const cached = await getCachedQueuedRuleset(chainId, projectId)
      if (cached) {
        return c.json({
          success: true,
          data: cached.rulesetData,
          cached: true,
          expiresAt: cached.expiresAt,
        })
      }

      // Cache miss - fetch from chain
      const result = await fetchQueuedRuleset(chainId, projectId)
      if (!result) {
        return c.json({
          success: true,
          data: null,
          cached: false,
        })
      }

      // Cache the result
      await cacheRuleset(chainId, projectId, result.ruleset.id, result.ruleset.cycleNumber, result.ruleset, 'queued')

      return c.json({
        success: true,
        data: result.ruleset,
        approvalStatus: result.approvalStatus,
        cached: false,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch queued ruleset'
      console.error('Failed to fetch queued ruleset:', error)
      return c.json({ success: false, error: message }, 500)
    }
  }
)

/**
 * GET /rulesets/:chainId/:projectId/history
 * Returns all historical rulesets (cached forever)
 */
rulesetsRouter.get(
  '/:chainId/:projectId/history',
  zValidator('param', ChainProjectParams),
  async (c) => {
    const { chainId, projectId } = c.req.valid('param')

    try {
      // Check cache first
      const cached = await getCachedRulesetHistory(chainId, projectId)
      if (cached.length > 0) {
        return c.json({
          success: true,
          data: cached.map((r) => r.rulesetData),
          cached: true,
        })
      }

      // Cache miss - fetch from chain
      const rulesets = await fetchRulesetHistory(chainId, projectId)
      if (rulesets.length === 0) {
        return c.json({
          success: true,
          data: [],
          cached: false,
        })
      }

      // Cache all historical rulesets
      await cacheRulesetHistory(
        chainId,
        projectId,
        rulesets.map((r) => ({
          rulesetId: r.id,
          cycleNumber: r.cycleNumber,
          rulesetData: r,
        }))
      )

      return c.json({
        success: true,
        data: rulesets,
        cached: false,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch ruleset history'
      console.error('Failed to fetch ruleset history:', error)
      return c.json({ success: false, error: message }, 500)
    }
  }
)

/**
 * GET /rulesets/:chainId/:projectId/cycle
 * Lightweight endpoint returning only the current cycle number
 * Used for cache invalidation polling
 */
rulesetsRouter.get(
  '/:chainId/:projectId/cycle',
  zValidator('param', ChainProjectParams),
  async (c) => {
    const { chainId, projectId } = c.req.valid('param')

    try {
      const cycleNumber = await getCurrentCycleNumber(chainId, projectId)
      if (cycleNumber === null) {
        return c.json({ success: false, error: 'No ruleset found' }, 404)
      }

      return c.json({
        success: true,
        data: { cycleNumber },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch cycle number'
      console.error('Failed to fetch cycle number:', error)
      return c.json({ success: false, error: message }, 500)
    }
  }
)

/**
 * GET /rulesets/:chainId/:projectId/:rulesetId/splits
 * Returns splits for a specific ruleset
 */
rulesetsRouter.get(
  '/:chainId/:projectId/:rulesetId/splits',
  zValidator('param', RulesetIdParams),
  async (c) => {
    const { chainId, projectId, rulesetId } = c.req.valid('param')

    try {
      // Check cache first
      const cached = await getCachedSplits(chainId, projectId, rulesetId)
      if (cached) {
        return c.json({
          success: true,
          data: {
            payoutSplits: cached.payoutSplits,
            reservedSplits: cached.reservedSplits,
            fundAccessLimits: cached.fundAccessLimits,
          },
          cached: true,
          expiresAt: cached.expiresAt,
        })
      }

      // Cache miss - fetch from chain
      const splits = await fetchSplits(chainId, projectId, rulesetId)

      // Cache the result
      await cacheSplits(chainId, projectId, rulesetId, splits.payoutSplits, splits.reservedSplits, splits.fundAccessLimits)

      return c.json({
        success: true,
        data: splits,
        cached: false,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch splits'
      console.error('Failed to fetch splits:', error)
      return c.json({ success: false, error: message }, 500)
    }
  }
)

/**
 * GET /rulesets/:chainId/:projectId/:rulesetId
 * Returns a specific ruleset by ID
 */
rulesetsRouter.get(
  '/:chainId/:projectId/:rulesetId',
  zValidator('param', RulesetIdParams),
  async (c) => {
    const { chainId, projectId, rulesetId } = c.req.valid('param')

    try {
      // Check cache first
      const cached = await getCachedRuleset(chainId, projectId, rulesetId)
      if (cached) {
        return c.json({
          success: true,
          data: cached.rulesetData,
          status: cached.status,
          cached: true,
          expiresAt: cached.expiresAt,
        })
      }

      // Not in cache - would need to fetch from history
      // For now, return 404 since we don't want to fetch individual rulesets
      return c.json({ success: false, error: 'Ruleset not found in cache' }, 404)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch ruleset'
      console.error('Failed to fetch ruleset:', error)
      return c.json({ success: false, error: message }, 500)
    }
  }
)

/**
 * GET /rulesets/stats
 * Returns cache statistics for monitoring
 */
rulesetsRouter.get('/stats', async (c) => {
  try {
    const stats = await getCacheStats()
    return c.json({
      success: true,
      data: stats,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get cache stats'
    console.error('Failed to get cache stats:', error)
    return c.json({ success: false, error: message }, 500)
  }
})
