/**
 * Intent Metrics Service
 *
 * Tracks intent detection performance for optimization and monitoring.
 * Logs every detection, aggregates statistics, and provides analytics.
 */

import { query, queryOne, execute } from '../db/index.ts';
import type { SemanticIntentResult } from './intentDetection.ts';

// ============================================================================
// Types
// ============================================================================

export interface IntentMetricsEntry {
  chatId: string;
  messageId?: string;
  detectedIntents: string[];
  subModulesLoaded: string[];
  detectionMethod: 'semantic' | 'keyword' | 'hybrid';
  semanticConfidence?: number;
  totalPromptTokens?: number;
  tokensSaved?: number;
  detectionTimeMs?: number;
}

export interface IntentMetricsUpdate {
  userFeedback?: 'positive' | 'negative' | 'neutral';
  requiredFollowup?: boolean;
  aiConfidenceLevel?: 'high' | 'medium' | 'low';
}

export interface IntentStatsRow {
  period_start: Date;
  period_end: Date;
  period_type: string;
  total_detections: number;
  semantic_detections: number;
  keyword_detections: number;
  hybrid_detections: number;
  avg_semantic_confidence: number | null;
  avg_prompt_tokens: number | null;
  avg_tokens_saved: number | null;
  total_tokens_saved: number | null;
  positive_feedback_count: number;
  negative_feedback_count: number;
  followup_required_count: number;
  high_confidence_count: number;
  medium_confidence_count: number;
  low_confidence_count: number;
  data_query_count: number;
  hook_developer_count: number;
  transaction_count: number;
  top_sub_modules: Array<{ module: string; count: number }>;
}

// ============================================================================
// Logging
// ============================================================================

/**
 * Log an intent detection event
 */
export async function logIntentDetection(
  entry: IntentMetricsEntry
): Promise<string> {
  try {
    const result = await queryOne<{ id: string }>(
      `INSERT INTO intent_detection_metrics (
         chat_id, message_id,
         detected_intents, sub_modules_loaded,
         detection_method, semantic_confidence,
         total_prompt_tokens, tokens_saved, detection_time_ms
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        entry.chatId,
        entry.messageId || null,
        entry.detectedIntents,
        entry.subModulesLoaded,
        entry.detectionMethod,
        entry.semanticConfidence ?? null,
        entry.totalPromptTokens ?? null,
        entry.tokensSaved ?? null,
        entry.detectionTimeMs ?? null,
      ]
    );

    return result?.id || '';
  } catch (error) {
    // Non-critical, just log
    console.error('Failed to log intent detection:', error);
    return '';
  }
}

/**
 * Create metrics entry from SemanticIntentResult
 */
export function createMetricsEntryFromResult(
  result: SemanticIntentResult,
  chatId: string,
  messageId?: string
): IntentMetricsEntry {
  const detectedIntents: string[] = [];

  if (result.domains.dataQuery.matched) {
    detectedIntents.push('dataQuery');
  }
  if (result.domains.hookDeveloper.matched) {
    detectedIntents.push('hookDeveloper');
  }
  if (result.domains.transaction.matched) {
    detectedIntents.push('transaction');
  }

  // Estimate tokens saved compared to full context
  const FULL_CONTEXT_TOKENS = 19500;
  const loadedTokens = result.matches.reduce((sum, m) => sum + m.tokenCost, 0) + 6000; // BASE_PROMPT
  const tokensSaved = FULL_CONTEXT_TOKENS - loadedTokens;

  return {
    chatId,
    messageId,
    detectedIntents,
    subModulesLoaded: result.transactionSubModules,
    detectionMethod: result.method,
    semanticConfidence: result.overallConfidence,
    totalPromptTokens: loadedTokens,
    tokensSaved: Math.max(0, tokensSaved),
    detectionTimeMs: result.metadata.processingTimeMs,
  };
}

/**
 * Update metrics entry with quality signals
 */
export async function updateIntentMetrics(
  metricsId: string,
  update: IntentMetricsUpdate
): Promise<void> {
  if (!metricsId) return;

  const sets: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (update.userFeedback !== undefined) {
    sets.push(`user_feedback = $${paramIndex++}`);
    values.push(update.userFeedback);
  }

  if (update.requiredFollowup !== undefined) {
    sets.push(`required_followup = $${paramIndex++}`);
    values.push(update.requiredFollowup);
  }

  if (update.aiConfidenceLevel !== undefined) {
    sets.push(`ai_confidence_level = $${paramIndex++}`);
    values.push(update.aiConfidenceLevel);
  }

  if (sets.length === 0) return;

  values.push(metricsId);

  try {
    await execute(
      `UPDATE intent_detection_metrics SET ${sets.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
  } catch (error) {
    console.error('Failed to update intent metrics:', error);
  }
}

// ============================================================================
// Analytics
// ============================================================================

/**
 * Get recent intent detection stats
 */
export async function getRecentStats(
  limit = 24
): Promise<IntentStatsRow[]> {
  return query<IntentStatsRow>(
    `SELECT * FROM intent_detection_stats
     WHERE period_type = 'hourly'
     ORDER BY period_start DESC
     LIMIT $1`,
    [limit]
  );
}

/**
 * Get daily aggregated stats
 */
export async function getDailyStats(
  days = 7
): Promise<IntentStatsRow[]> {
  return query<IntentStatsRow>(
    `SELECT * FROM intent_detection_stats
     WHERE period_type = 'daily'
     ORDER BY period_start DESC
     LIMIT $1`,
    [days]
  );
}

/**
 * Get summary statistics for dashboard
 */
export async function getStatsSummary(): Promise<{
  totalDetections: number;
  avgConfidence: number;
  avgTokensSaved: number;
  methodDistribution: { semantic: number; keyword: number; hybrid: number };
  feedbackDistribution: { positive: number; negative: number; neutral: number };
}> {
  // Last 24 hours
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const stats = await queryOne<{
    total: number;
    avg_confidence: number | null;
    avg_tokens_saved: number | null;
    semantic_count: number;
    keyword_count: number;
    hybrid_count: number;
    positive_count: number;
    negative_count: number;
    neutral_count: number;
  }>(
    `SELECT
       COUNT(*) as total,
       AVG(semantic_confidence) as avg_confidence,
       AVG(tokens_saved) as avg_tokens_saved,
       COUNT(*) FILTER (WHERE detection_method = 'semantic') as semantic_count,
       COUNT(*) FILTER (WHERE detection_method = 'keyword') as keyword_count,
       COUNT(*) FILTER (WHERE detection_method = 'hybrid') as hybrid_count,
       COUNT(*) FILTER (WHERE user_feedback = 'positive') as positive_count,
       COUNT(*) FILTER (WHERE user_feedback = 'negative') as negative_count,
       COUNT(*) FILTER (WHERE user_feedback = 'neutral') as neutral_count
     FROM intent_detection_metrics
     WHERE created_at > $1`,
    [since]
  );

  if (!stats) {
    return {
      totalDetections: 0,
      avgConfidence: 0,
      avgTokensSaved: 0,
      methodDistribution: { semantic: 0, keyword: 0, hybrid: 0 },
      feedbackDistribution: { positive: 0, negative: 0, neutral: 0 },
    };
  }

  return {
    totalDetections: Number(stats.total),
    avgConfidence: stats.avg_confidence || 0,
    avgTokensSaved: stats.avg_tokens_saved || 0,
    methodDistribution: {
      semantic: Number(stats.semantic_count),
      keyword: Number(stats.keyword_count),
      hybrid: Number(stats.hybrid_count),
    },
    feedbackDistribution: {
      positive: Number(stats.positive_count),
      negative: Number(stats.negative_count),
      neutral: Number(stats.neutral_count),
    },
  };
}

/**
 * Get top sub-modules by usage
 */
export async function getTopSubModules(
  limit = 10
): Promise<Array<{ module: string; count: number }>> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Last 7 days

  const results = await query<{ module: string; count: number }>(
    `SELECT
       unnest(sub_modules_loaded) as module,
       COUNT(*) as count
     FROM intent_detection_metrics
     WHERE created_at > $1
     GROUP BY module
     ORDER BY count DESC
     LIMIT $2`,
    [since, limit]
  );

  return results;
}

// ============================================================================
// Aggregation (for cron job)
// ============================================================================

/**
 * Aggregate hourly statistics
 * Called by cron job every hour
 */
export async function aggregateHourlyStats(): Promise<void> {
  const now = new Date();
  const periodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0);
  const periodStart = new Date(periodEnd.getTime() - 60 * 60 * 1000);

  try {
    // Get top sub-modules for this period
    const topModules = await query<{ module: string; count: number }>(
      `SELECT
         unnest(sub_modules_loaded) as module,
         COUNT(*) as count
       FROM intent_detection_metrics
       WHERE created_at >= $1 AND created_at < $2
       GROUP BY module
       ORDER BY count DESC
       LIMIT 10`,
      [periodStart, periodEnd]
    );

    await execute(
      `INSERT INTO intent_detection_stats (
         period_start, period_end, period_type,
         total_detections, semantic_detections, keyword_detections, hybrid_detections,
         avg_semantic_confidence, p50_semantic_confidence, p90_semantic_confidence,
         avg_prompt_tokens, avg_tokens_saved, total_tokens_saved,
         positive_feedback_count, negative_feedback_count, followup_required_count,
         high_confidence_count, medium_confidence_count, low_confidence_count,
         data_query_count, hook_developer_count, transaction_count,
         top_sub_modules
       )
       SELECT
         $1, $2, 'hourly',
         COUNT(*),
         COUNT(*) FILTER (WHERE detection_method = 'semantic'),
         COUNT(*) FILTER (WHERE detection_method = 'keyword'),
         COUNT(*) FILTER (WHERE detection_method = 'hybrid'),
         AVG(semantic_confidence),
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY semantic_confidence),
         PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY semantic_confidence),
         AVG(total_prompt_tokens),
         AVG(tokens_saved),
         SUM(tokens_saved),
         COUNT(*) FILTER (WHERE user_feedback = 'positive'),
         COUNT(*) FILTER (WHERE user_feedback = 'negative'),
         COUNT(*) FILTER (WHERE required_followup = true),
         COUNT(*) FILTER (WHERE ai_confidence_level = 'high'),
         COUNT(*) FILTER (WHERE ai_confidence_level = 'medium'),
         COUNT(*) FILTER (WHERE ai_confidence_level = 'low'),
         COUNT(*) FILTER (WHERE 'dataQuery' = ANY(detected_intents)),
         COUNT(*) FILTER (WHERE 'hookDeveloper' = ANY(detected_intents)),
         COUNT(*) FILTER (WHERE 'transaction' = ANY(detected_intents)),
         $3::jsonb
       FROM intent_detection_metrics
       WHERE created_at >= $1 AND created_at < $2
       ON CONFLICT (period_start, period_type) DO UPDATE SET
         total_detections = EXCLUDED.total_detections,
         semantic_detections = EXCLUDED.semantic_detections,
         keyword_detections = EXCLUDED.keyword_detections,
         hybrid_detections = EXCLUDED.hybrid_detections,
         avg_semantic_confidence = EXCLUDED.avg_semantic_confidence,
         p50_semantic_confidence = EXCLUDED.p50_semantic_confidence,
         p90_semantic_confidence = EXCLUDED.p90_semantic_confidence,
         avg_prompt_tokens = EXCLUDED.avg_prompt_tokens,
         avg_tokens_saved = EXCLUDED.avg_tokens_saved,
         total_tokens_saved = EXCLUDED.total_tokens_saved,
         positive_feedback_count = EXCLUDED.positive_feedback_count,
         negative_feedback_count = EXCLUDED.negative_feedback_count,
         followup_required_count = EXCLUDED.followup_required_count,
         high_confidence_count = EXCLUDED.high_confidence_count,
         medium_confidence_count = EXCLUDED.medium_confidence_count,
         low_confidence_count = EXCLUDED.low_confidence_count,
         data_query_count = EXCLUDED.data_query_count,
         hook_developer_count = EXCLUDED.hook_developer_count,
         transaction_count = EXCLUDED.transaction_count,
         top_sub_modules = EXCLUDED.top_sub_modules`,
      [periodStart, periodEnd, JSON.stringify(topModules)]
    );

    console.log(`Aggregated intent stats for ${periodStart.toISOString()}`);
  } catch (error) {
    console.error('Failed to aggregate hourly stats:', error);
  }
}

/**
 * Aggregate daily statistics
 * Called by cron job once per day
 */
export async function aggregateDailyStats(): Promise<void> {
  const now = new Date();
  const periodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const periodStart = new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000);

  try {
    // Similar to hourly but with 'daily' period_type
    await execute(
      `INSERT INTO intent_detection_stats (
         period_start, period_end, period_type,
         total_detections, semantic_detections, keyword_detections, hybrid_detections,
         avg_semantic_confidence, avg_prompt_tokens, avg_tokens_saved, total_tokens_saved,
         positive_feedback_count, negative_feedback_count, followup_required_count,
         high_confidence_count, medium_confidence_count, low_confidence_count,
         data_query_count, hook_developer_count, transaction_count
       )
       SELECT
         $1, $2, 'daily',
         COUNT(*),
         COUNT(*) FILTER (WHERE detection_method = 'semantic'),
         COUNT(*) FILTER (WHERE detection_method = 'keyword'),
         COUNT(*) FILTER (WHERE detection_method = 'hybrid'),
         AVG(semantic_confidence),
         AVG(total_prompt_tokens),
         AVG(tokens_saved),
         SUM(tokens_saved),
         COUNT(*) FILTER (WHERE user_feedback = 'positive'),
         COUNT(*) FILTER (WHERE user_feedback = 'negative'),
         COUNT(*) FILTER (WHERE required_followup = true),
         COUNT(*) FILTER (WHERE ai_confidence_level = 'high'),
         COUNT(*) FILTER (WHERE ai_confidence_level = 'medium'),
         COUNT(*) FILTER (WHERE ai_confidence_level = 'low'),
         COUNT(*) FILTER (WHERE 'dataQuery' = ANY(detected_intents)),
         COUNT(*) FILTER (WHERE 'hookDeveloper' = ANY(detected_intents)),
         COUNT(*) FILTER (WHERE 'transaction' = ANY(detected_intents))
       FROM intent_detection_metrics
       WHERE created_at >= $1 AND created_at < $2
       ON CONFLICT (period_start, period_type) DO UPDATE SET
         total_detections = EXCLUDED.total_detections`,
      [periodStart, periodEnd]
    );

    console.log(`Aggregated daily intent stats for ${periodStart.toISOString()}`);
  } catch (error) {
    console.error('Failed to aggregate daily stats:', error);
  }
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Delete old metrics entries
 * Keep last 30 days of detailed logs
 */
export async function cleanupOldMetrics(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  try {
    const result = await queryOne<{ count: number }>(
      `WITH deleted AS (
         DELETE FROM intent_detection_metrics
         WHERE created_at < $1
         RETURNING id
       )
       SELECT COUNT(*) as count FROM deleted`,
      [cutoff]
    );

    return result?.count || 0;
  } catch (error) {
    console.error('Failed to cleanup old metrics:', error);
    return 0;
  }
}
