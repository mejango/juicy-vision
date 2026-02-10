import { query, queryOne, execute } from '../db/index.ts';
import type { ConfidenceLevel } from './claude.ts';

// ============================================================================
// Escalation Service
// ============================================================================
// Manages AI response escalations for admin review.
// Low-confidence responses are automatically queued for human review.

export interface Escalation {
  id: string;
  chat_id: string;
  message_id: string;
  user_query: string;
  ai_response: string;
  confidence_level: ConfidenceLevel;
  confidence_reason: string | null;
  status: 'pending' | 'approved' | 'corrected';
  admin_correction: string | null;
  review_notes: string | null;
  created_at: Date;
  reviewed_at: Date | null;
  reviewed_by: string | null;
}

export interface EscalationWithContext extends Escalation {
  chat_title?: string;
  message_count?: number;
}

/**
 * Create an escalation for a low-confidence AI response.
 */
export async function createEscalation(params: {
  chatId: string;
  messageId: string;
  userQuery: string;
  aiResponse: string;
  confidenceLevel: ConfidenceLevel;
  confidenceReason?: string;
}): Promise<Escalation> {
  const result = await queryOne<Escalation>(
    `INSERT INTO ai_escalations (
      chat_id, message_id, user_query, ai_response,
      confidence_level, confidence_reason
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *`,
    [
      params.chatId,
      params.messageId,
      params.userQuery,
      params.aiResponse,
      params.confidenceLevel,
      params.confidenceReason ?? null,
    ]
  );

  if (!result) {
    throw new Error('Failed to create escalation');
  }

  return result;
}

/**
 * Get escalation queue with optional filtering.
 */
export async function getEscalationQueue(params?: {
  status?: 'pending' | 'approved' | 'corrected';
  limit?: number;
  offset?: number;
}): Promise<{ escalations: EscalationWithContext[]; total: number }> {
  const { status, limit = 50, offset = 0 } = params ?? {};

  // Build WHERE clause
  const conditions: string[] = [];
  const args: unknown[] = [];
  let argIndex = 1;

  if (status) {
    conditions.push(`e.status = $${argIndex++}`);
    args.push(status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM ai_escalations e ${whereClause}`,
    args
  );
  const total = parseInt(countResult?.count ?? '0', 10);

  // Get escalations with chat context
  const escalations = await query<EscalationWithContext>(
    `SELECT
      e.*,
      c.title as chat_title,
      (SELECT COUNT(*) FROM multi_chat_messages WHERE chat_id = e.chat_id) as message_count
    FROM ai_escalations e
    LEFT JOIN multi_chats c ON c.id = e.chat_id
    ${whereClause}
    ORDER BY e.created_at DESC
    LIMIT $${argIndex++} OFFSET $${argIndex++}`,
    [...args, limit, offset]
  );

  return { escalations, total };
}

/**
 * Get a single escalation by ID with surrounding message context.
 */
export async function getEscalation(id: string): Promise<{
  escalation: Escalation | null;
  context: Array<{ role: string; content: string; created_at: Date }>;
}> {
  const escalation = await queryOne<Escalation>(
    `SELECT * FROM ai_escalations WHERE id = $1`,
    [id]
  );

  if (!escalation) {
    return { escalation: null, context: [] };
  }

  // Get surrounding messages for context (5 before and 5 after the flagged message)
  const context = await query<{ role: string; content: string; created_at: Date }>(
    `WITH flagged AS (
      SELECT created_at FROM multi_chat_messages WHERE id = $1
    )
    SELECT role, content, created_at
    FROM multi_chat_messages
    WHERE chat_id = $2
      AND created_at BETWEEN
        (SELECT created_at - INTERVAL '1 hour' FROM flagged)
        AND
        (SELECT created_at + INTERVAL '5 minutes' FROM flagged)
    ORDER BY created_at ASC
    LIMIT 20`,
    [escalation.message_id, escalation.chat_id]
  );

  return { escalation, context };
}

/**
 * Resolve an escalation (approve or correct).
 */
export async function resolveEscalation(params: {
  id: string;
  status: 'approved' | 'corrected';
  reviewedBy: string;
  adminCorrection?: string;
  reviewNotes?: string;
}): Promise<Escalation | null> {
  const result = await queryOne<Escalation>(
    `UPDATE ai_escalations
    SET
      status = $1,
      reviewed_at = NOW(),
      reviewed_by = $2,
      admin_correction = $3,
      review_notes = $4
    WHERE id = $5
    RETURNING *`,
    [
      params.status,
      params.reviewedBy,
      params.adminCorrection ?? null,
      params.reviewNotes ?? null,
      params.id,
    ]
  );

  return result;
}

/**
 * Get escalation statistics.
 */
export async function getEscalationStats(): Promise<{
  pending: number;
  approved: number;
  corrected: number;
  avgReviewTimeHours: number | null;
}> {
  const stats = await queryOne<{
    pending: string;
    approved: string;
    corrected: string;
    avg_review_hours: string | null;
  }>(
    `SELECT
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'approved') as approved,
      COUNT(*) FILTER (WHERE status = 'corrected') as corrected,
      AVG(EXTRACT(EPOCH FROM (reviewed_at - created_at)) / 3600)
        FILTER (WHERE reviewed_at IS NOT NULL) as avg_review_hours
    FROM ai_escalations`
  );

  return {
    pending: parseInt(stats?.pending ?? '0', 10),
    approved: parseInt(stats?.approved ?? '0', 10),
    corrected: parseInt(stats?.corrected ?? '0', 10),
    avgReviewTimeHours: stats?.avg_review_hours ? parseFloat(stats.avg_review_hours) : null,
  };
}

/**
 * Store confidence metadata with a message.
 */
export async function updateMessageConfidence(params: {
  messageId: string;
  confidenceLevel: ConfidenceLevel;
  confidenceReason?: string;
}): Promise<void> {
  await execute(
    `UPDATE multi_chat_messages
    SET ai_confidence = $1, ai_confidence_reason = $2
    WHERE id = $3`,
    [params.confidenceLevel, params.confidenceReason ?? null, params.messageId]
  );
}
