/**
 * Export training data from the database
 * Extracts good/bad conversations, corrections, and feedback
 */

import { getPool } from '../../src/db/index.ts';

export interface ConversationExport {
  sessionId: string;
  mode: string;
  messages: Array<{ role: string; content: string }>;
  rating?: number;
  feedback?: string;
  outcomes: {
    completedPayment: boolean;
    foundProject: boolean;
    connectedWallet: boolean;
    errorEncountered: boolean;
    userAbandoned: boolean;
  };
}

export interface CorrectionExport {
  messageId: string;
  sessionId: string;
  originalContent: string;
  userCorrection: string;
  status: string;
}

export interface FeedbackExport {
  messageId: string;
  sessionId: string;
  role: string;
  content: string;
  helpful: boolean | null;
  reported: boolean;
  reportReason?: string;
}

export interface TrainingDataExport {
  exportedAt: string;
  goodConversations: ConversationExport[];
  badConversations: ConversationExport[];
  corrections: CorrectionExport[];
  feedback: FeedbackExport[];
  stats: {
    totalSessions: number;
    totalMessages: number;
    avgRating: number;
    helpfulRate: number;
    completionRate: number;
  };
}

/**
 * Export good conversations (high ratings, successful outcomes, helpful feedback)
 */
export async function exportGoodConversations(): Promise<ConversationExport[]> {
  const pool = getPool();
  const conn = await pool.connect();

  try {
    const { rows } = await conn.queryObject<{
      session_id: string;
      mode: string;
      messages: Array<{ role: string; content: string }>;
      outcome_completed_payment: boolean;
      outcome_found_project: boolean;
      session_rating: number | null;
    }>(`
      SELECT
        cs.id as session_id,
        cs.mode,
        array_agg(
          json_build_object(
            'role', cm.role,
            'content', cm.content
          ) ORDER BY cm.created_at
        ) as messages,
        cs.outcome_completed_payment,
        cs.outcome_found_project,
        cs.session_rating
      FROM chat_sessions cs
      JOIN chat_messages cm ON cm.session_id = cs.id
      WHERE cs.privacy_mode IN ('open_book', 'anonymous')
        AND (
          cs.session_rating >= 4
          OR cs.outcome_completed_payment = TRUE
          OR EXISTS (
            SELECT 1 FROM chat_messages m
            WHERE m.session_id = cs.id
            AND m.feedback_helpful = TRUE
          )
        )
      GROUP BY cs.id
      ORDER BY cs.session_rating DESC NULLS LAST, cs.started_at DESC
      LIMIT 500
    `);

    return rows.map((row) => ({
      sessionId: row.session_id,
      mode: row.mode,
      messages: row.messages,
      rating: row.session_rating ?? undefined,
      outcomes: {
        completedPayment: row.outcome_completed_payment ?? false,
        foundProject: row.outcome_found_project ?? false,
        connectedWallet: false,
        errorEncountered: false,
        userAbandoned: false,
      },
    }));
  } finally {
    conn.release();
  }
}

/**
 * Export bad conversations (low ratings, errors, abandonment)
 */
export async function exportBadConversations(): Promise<ConversationExport[]> {
  const pool = getPool();
  const conn = await pool.connect();

  try {
    const { rows } = await conn.queryObject<{
      session_id: string;
      mode: string;
      messages: Array<{ role: string; content: string }>;
      outcome_error_encountered: boolean;
      outcome_user_abandoned: boolean;
      session_rating: number | null;
      session_feedback: string | null;
    }>(`
      SELECT
        cs.id as session_id,
        cs.mode,
        array_agg(
          json_build_object(
            'role', cm.role,
            'content', cm.content
          ) ORDER BY cm.created_at
        ) as messages,
        cs.outcome_error_encountered,
        cs.outcome_user_abandoned,
        cs.session_rating,
        cs.session_feedback
      FROM chat_sessions cs
      JOIN chat_messages cm ON cm.session_id = cs.id
      WHERE cs.privacy_mode IN ('open_book', 'anonymous')
        AND (
          cs.session_rating <= 2
          OR cs.outcome_user_abandoned = TRUE
          OR cs.outcome_error_encountered = TRUE
          OR EXISTS (
            SELECT 1 FROM chat_messages m
            WHERE m.session_id = cs.id
            AND m.feedback_helpful = FALSE
          )
        )
      GROUP BY cs.id
      ORDER BY cs.started_at DESC
      LIMIT 500
    `);

    return rows.map((row) => ({
      sessionId: row.session_id,
      mode: row.mode,
      messages: row.messages,
      rating: row.session_rating ?? undefined,
      feedback: row.session_feedback ?? undefined,
      outcomes: {
        completedPayment: false,
        foundProject: false,
        connectedWallet: false,
        errorEncountered: row.outcome_error_encountered ?? false,
        userAbandoned: row.outcome_user_abandoned ?? false,
      },
    }));
  } finally {
    conn.release();
  }
}

/**
 * Export user corrections (explicit feedback on wrong responses)
 */
export async function exportCorrections(): Promise<CorrectionExport[]> {
  const pool = getPool();
  const conn = await pool.connect();

  try {
    const { rows } = await conn.queryObject<{
      id: string;
      message_id: string;
      session_id: string;
      original_content: string;
      user_correction: string;
      status: string;
    }>(`
      SELECT id, message_id, session_id, original_content, user_correction, status
      FROM corrections
      ORDER BY created_at DESC
      LIMIT 200
    `);

    return rows.map((row) => ({
      messageId: row.message_id,
      sessionId: row.session_id,
      originalContent: row.original_content,
      userCorrection: row.user_correction,
      status: row.status,
    }));
  } finally {
    conn.release();
  }
}

/**
 * Export message-level feedback
 */
export async function exportFeedback(): Promise<FeedbackExport[]> {
  const pool = getPool();
  const conn = await pool.connect();

  try {
    const { rows } = await conn.queryObject<{
      id: string;
      session_id: string;
      role: string;
      content: string;
      feedback_helpful: boolean | null;
      feedback_reported: boolean;
      feedback_report_reason: string | null;
    }>(`
      SELECT id, session_id, role, content, feedback_helpful, feedback_reported, feedback_report_reason
      FROM chat_messages
      WHERE feedback_helpful IS NOT NULL OR feedback_reported = TRUE
      ORDER BY created_at DESC
      LIMIT 500
    `);

    return rows.map((row) => ({
      messageId: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      helpful: row.feedback_helpful,
      reported: row.feedback_reported,
      reportReason: row.feedback_report_reason ?? undefined,
    }));
  } finally {
    conn.release();
  }
}

/**
 * Get overall statistics
 */
export async function getStats(): Promise<TrainingDataExport['stats']> {
  const pool = getPool();
  const conn = await pool.connect();

  try {
    const { rows: [stats] } = await conn.queryObject<{
      total_sessions: string;
      total_messages: string;
      avg_rating: string | null;
      helpful_count: string;
      total_feedback: string;
      completed_count: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM chat_sessions WHERE privacy_mode IN ('open_book', 'anonymous')) as total_sessions,
        (SELECT COUNT(*) FROM chat_messages cm JOIN chat_sessions cs ON cm.session_id = cs.id WHERE cs.privacy_mode IN ('open_book', 'anonymous')) as total_messages,
        (SELECT AVG(session_rating) FROM chat_sessions WHERE session_rating IS NOT NULL AND privacy_mode IN ('open_book', 'anonymous')) as avg_rating,
        (SELECT COUNT(*) FROM chat_messages WHERE feedback_helpful = TRUE) as helpful_count,
        (SELECT COUNT(*) FROM chat_messages WHERE feedback_helpful IS NOT NULL) as total_feedback,
        (SELECT COUNT(*) FROM chat_sessions WHERE outcome_completed_payment = TRUE AND privacy_mode IN ('open_book', 'anonymous')) as completed_count
    `);

    const totalSessions = parseInt(stats.total_sessions);
    const helpfulCount = parseInt(stats.helpful_count);
    const totalFeedback = parseInt(stats.total_feedback);
    const completedCount = parseInt(stats.completed_count);

    return {
      totalSessions,
      totalMessages: parseInt(stats.total_messages),
      avgRating: stats.avg_rating ? parseFloat(stats.avg_rating) : 0,
      helpfulRate: totalFeedback > 0 ? helpfulCount / totalFeedback : 0,
      completionRate: totalSessions > 0 ? completedCount / totalSessions : 0,
    };
  } finally {
    conn.release();
  }
}

/**
 * Export all training data
 */
export async function exportAllTrainingData(): Promise<TrainingDataExport> {
  console.log('Exporting training data...');

  const [goodConversations, badConversations, corrections, feedback, stats] = await Promise.all([
    exportGoodConversations(),
    exportBadConversations(),
    exportCorrections(),
    exportFeedback(),
    getStats(),
  ]);

  console.log(`Exported:
  - ${goodConversations.length} good conversations
  - ${badConversations.length} bad conversations
  - ${corrections.length} corrections
  - ${feedback.length} feedback items`);

  return {
    exportedAt: new Date().toISOString(),
    goodConversations,
    badConversations,
    corrections,
    feedback,
    stats,
  };
}
