import { query, queryOne, execute } from '../db/index.ts';
import type { ChatSession, ChatMessage, Event, Correction, PrivacyMode } from '../types/index.ts';
import { PrivacyModes } from '../types/index.ts';

// ============================================================================
// Chat Sessions
// ============================================================================

interface DbChatSession {
  id: string;
  user_id: string | null;
  privacy_mode: PrivacyMode;
  wallet_connected: boolean;
  mode: 'self_custody' | 'managed';
  entry_point: string | null;
  outcome_completed_payment: boolean;
  outcome_found_project: boolean;
  outcome_connected_wallet: boolean;
  outcome_error_encountered: boolean;
  outcome_user_abandoned: boolean;
  session_rating: number | null;
  session_feedback: string | null;
  started_at: Date;
  ended_at: Date | null;
}

export async function createChatSession(
  userId: string | null,
  privacyMode: PrivacyMode,
  mode: 'self_custody' | 'managed',
  entryPoint?: string
): Promise<string> {
  const settings = PrivacyModes[privacyMode];

  // Ghost mode: don't store anything
  if (!settings.storeChat && !settings.storeAnalytics) {
    return crypto.randomUUID(); // Return fake ID, won't be persisted
  }

  const result = await query<{ id: string }>(
    `INSERT INTO chat_sessions (user_id, privacy_mode, mode, entry_point)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [settings.stripIdentity ? null : userId, privacyMode, mode, entryPoint]
  );

  return result[0].id;
}

export async function updateChatSessionOutcome(
  sessionId: string,
  outcome: Partial<{
    completedPayment: boolean;
    foundProject: boolean;
    connectedWallet: boolean;
    errorEncountered: boolean;
    userAbandoned: boolean;
  }>
): Promise<void> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (outcome.completedPayment !== undefined) {
    updates.push(`outcome_completed_payment = $${paramIndex++}`);
    values.push(outcome.completedPayment);
  }
  if (outcome.foundProject !== undefined) {
    updates.push(`outcome_found_project = $${paramIndex++}`);
    values.push(outcome.foundProject);
  }
  if (outcome.connectedWallet !== undefined) {
    updates.push(`outcome_connected_wallet = $${paramIndex++}`);
    values.push(outcome.connectedWallet);
  }
  if (outcome.errorEncountered !== undefined) {
    updates.push(`outcome_error_encountered = $${paramIndex++}`);
    values.push(outcome.errorEncountered);
  }
  if (outcome.userAbandoned !== undefined) {
    updates.push(`outcome_user_abandoned = $${paramIndex++}`);
    values.push(outcome.userAbandoned);
  }

  if (updates.length === 0) return;

  values.push(sessionId);
  await execute(
    `UPDATE chat_sessions SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
    values
  );
}

export async function endChatSession(
  sessionId: string,
  rating?: number,
  feedback?: string
): Promise<void> {
  await execute(
    `UPDATE chat_sessions
     SET ended_at = NOW(), session_rating = $1, session_feedback = $2
     WHERE id = $3`,
    [rating, feedback, sessionId]
  );
}

// ============================================================================
// Chat Messages
// ============================================================================

interface DbChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls: unknown;
  feedback_helpful: boolean | null;
  feedback_reported: boolean;
  feedback_report_reason: string | null;
  feedback_user_correction: string | null;
  created_at: Date;
}

export async function storeChatMessage(
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  toolCalls?: unknown[]
): Promise<string> {
  // Check session privacy mode
  const session = await queryOne<DbChatSession>(
    'SELECT privacy_mode FROM chat_sessions WHERE id = $1',
    [sessionId]
  );

  if (!session) {
    // Ghost mode or invalid session - don't store
    return crypto.randomUUID();
  }

  const settings = PrivacyModes[session.privacy_mode];
  if (!settings.storeChat) {
    return crypto.randomUUID();
  }

  const result = await query<{ id: string }>(
    `INSERT INTO chat_messages (session_id, role, content, tool_calls)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [sessionId, role, content, toolCalls ? JSON.stringify(toolCalls) : null]
  );

  return result[0].id;
}

export async function updateMessageFeedback(
  messageId: string,
  feedback: {
    helpful?: boolean;
    reported?: boolean;
    reportReason?: string;
    userCorrection?: string;
  }
): Promise<void> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (feedback.helpful !== undefined) {
    updates.push(`feedback_helpful = $${paramIndex++}`);
    values.push(feedback.helpful);
  }
  if (feedback.reported !== undefined) {
    updates.push(`feedback_reported = $${paramIndex++}`);
    values.push(feedback.reported);
  }
  if (feedback.reportReason !== undefined) {
    updates.push(`feedback_report_reason = $${paramIndex++}`);
    values.push(feedback.reportReason);
  }
  if (feedback.userCorrection !== undefined) {
    updates.push(`feedback_user_correction = $${paramIndex++}`);
    values.push(feedback.userCorrection);

    // Also create a correction record for AI review
    const message = await queryOne<DbChatMessage>(
      'SELECT * FROM chat_messages WHERE id = $1',
      [messageId]
    );
    if (message) {
      await execute(
        `INSERT INTO corrections (message_id, session_id, original_content, user_correction)
         VALUES ($1, $2, $3, $4)`,
        [messageId, message.session_id, message.content, feedback.userCorrection]
      );
    }
  }

  if (updates.length === 0) return;

  values.push(messageId);
  await execute(
    `UPDATE chat_messages SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
    values
  );
}

// ============================================================================
// Raw Events
// ============================================================================

export async function storeEvent(
  sessionId: string | null,
  userId: string | null,
  eventType: string,
  eventData: Record<string, unknown>,
  privacyMode: PrivacyMode
): Promise<void> {
  const settings = PrivacyModes[privacyMode];

  if (!settings.storeAnalytics) {
    return; // Ghost mode - don't store
  }

  await execute(
    `INSERT INTO events (session_id, user_id, event_type, event_data)
     VALUES ($1, $2, $3, $4)`,
    [
      sessionId,
      settings.stripIdentity ? null : userId,
      eventType,
      JSON.stringify(eventData),
    ]
  );
}

// Batch insert events for efficiency
export async function storeEvents(
  events: Array<{
    sessionId: string | null;
    userId: string | null;
    eventType: string;
    eventData: Record<string, unknown>;
    privacyMode: PrivacyMode;
  }>
): Promise<void> {
  // Filter out ghost mode events
  const eventsToStore = events.filter(
    (e) => PrivacyModes[e.privacyMode].storeAnalytics
  );

  if (eventsToStore.length === 0) return;

  // Build bulk insert
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let paramIndex = 1;

  for (const event of eventsToStore) {
    const settings = PrivacyModes[event.privacyMode];
    placeholders.push(
      `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
    );
    values.push(
      event.sessionId,
      settings.stripIdentity ? null : event.userId,
      event.eventType,
      JSON.stringify(event.eventData)
    );
  }

  await execute(
    `INSERT INTO events (session_id, user_id, event_type, event_data)
     VALUES ${placeholders.join(', ')}`,
    values
  );
}

// ============================================================================
// Corrections Queue (for AI review)
// ============================================================================

interface DbCorrection {
  id: string;
  message_id: string;
  session_id: string;
  original_content: string;
  user_correction: string;
  status: 'pending' | 'approved' | 'rejected';
  review_notes: string | null;
  reviewed_at: Date | null;
  created_at: Date;
}

export async function getPendingCorrections(
  limit: number = 50,
  offset: number = 0
): Promise<Correction[]> {
  const results = await query<DbCorrection>(
    `SELECT * FROM corrections
     WHERE status = 'pending'
     ORDER BY created_at ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return results.map((r) => ({
    id: r.id,
    messageId: r.message_id,
    sessionId: r.session_id,
    originalContent: r.original_content,
    userCorrection: r.user_correction,
    status: r.status,
    reviewNotes: r.review_notes ?? undefined,
    reviewedAt: r.reviewed_at ?? undefined,
    createdAt: r.created_at,
  }));
}

export async function reviewCorrection(
  correctionId: string,
  status: 'approved' | 'rejected',
  reviewNotes?: string
): Promise<void> {
  await execute(
    `UPDATE corrections
     SET status = $1, review_notes = $2, reviewed_at = NOW()
     WHERE id = $3`,
    [status, reviewNotes, correctionId]
  );
}

// ============================================================================
// Training Data Export
// ============================================================================

export interface TrainingConversation {
  sessionId: string;
  mode: 'self_custody' | 'managed';
  messages: Array<{ role: string; content: string }>;
  quality: 'good' | 'bad';
  outcome?: string;
  feedback?: string;
}

export async function exportTrainingData(
  quality: 'good' | 'bad',
  limit: number = 1000
): Promise<TrainingConversation[]> {
  const view = quality === 'good' ? 'training_good_conversations' : 'training_bad_conversations';

  const results = await query<{
    session_id: string;
    mode: string;
    messages: unknown;
    session_rating: number | null;
    session_feedback: string | null;
  }>(
    `SELECT * FROM ${view} LIMIT $1`,
    [limit]
  );

  return results.map((r) => ({
    sessionId: r.session_id,
    mode: r.mode as 'self_custody' | 'managed',
    messages: r.messages as Array<{ role: string; content: string }>,
    quality,
    feedback: r.session_feedback ?? undefined,
  }));
}
