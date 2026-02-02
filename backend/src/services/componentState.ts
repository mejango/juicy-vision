/**
 * Component State Service
 *
 * Manages persistent state for dynamic message components (transaction-preview, etc.).
 * State is stored per-message and propagates to all chat participants.
 */

import { query, queryOne, execute } from '../db/index.ts';

// ============================================================================
// Types
// ============================================================================

export interface ComponentState {
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  [key: string]: unknown; // Component-specific fields
}

export interface TransactionPreviewState extends ComponentState {
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  projectIds?: Record<number, number>; // chainId -> projectId
  txHashes?: Record<number, string>;   // chainId -> txHash
  bundleId?: string;
  completedAt?: string; // ISO timestamp
  error?: string;
}

interface DbComponentState {
  message_id: string;
  component_key: string;
  state: ComponentState;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Get component state for a specific component in a message
 */
export async function getComponentState<T extends ComponentState = ComponentState>(
  messageId: string,
  componentKey: string
): Promise<T | null> {
  const result = await queryOne<DbComponentState>(
    'SELECT state FROM message_component_states WHERE message_id = $1 AND component_key = $2',
    [messageId, componentKey]
  );

  return result ? (result.state as T) : null;
}

/**
 * Get all component states for a message
 */
export async function getMessageComponentStates(
  messageId: string
): Promise<Record<string, ComponentState>> {
  const results = await query<DbComponentState>(
    'SELECT component_key, state FROM message_component_states WHERE message_id = $1',
    [messageId]
  );

  const states: Record<string, ComponentState> = {};
  for (const row of results) {
    states[row.component_key] = row.state;
  }
  return states;
}

/**
 * Set or update component state
 */
export async function setComponentState<T extends ComponentState>(
  messageId: string,
  componentKey: string,
  state: T
): Promise<T> {
  await execute(
    `INSERT INTO message_component_states (message_id, component_key, state, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (message_id, component_key) DO UPDATE SET
       state = $3::jsonb,
       updated_at = NOW()`,
    [messageId, componentKey, JSON.stringify(state)]
  );

  return state;
}

/**
 * Update component state (merge with existing)
 */
export async function updateComponentState<T extends ComponentState>(
  messageId: string,
  componentKey: string,
  updates: Partial<T>
): Promise<T> {
  // Get existing state
  const existing = await getComponentState<T>(messageId, componentKey);
  const newState = { ...(existing || { status: 'pending' }), ...updates } as T;

  return setComponentState(messageId, componentKey, newState);
}

/**
 * Delete component state (rarely needed)
 */
export async function deleteComponentState(
  messageId: string,
  componentKey: string
): Promise<void> {
  await execute(
    'DELETE FROM message_component_states WHERE message_id = $1 AND component_key = $2',
    [messageId, componentKey]
  );
}

/**
 * Batch get component states for multiple messages (efficient for loading chat history)
 */
export async function batchGetComponentStates(
  messageIds: string[]
): Promise<Map<string, Record<string, ComponentState>>> {
  if (messageIds.length === 0) return new Map();

  const results = await query<DbComponentState>(
    `SELECT message_id, component_key, state
     FROM message_component_states
     WHERE message_id = ANY($1)`,
    [messageIds]
  );

  const statesByMessage = new Map<string, Record<string, ComponentState>>();

  for (const row of results) {
    if (!statesByMessage.has(row.message_id)) {
      statesByMessage.set(row.message_id, {});
    }
    statesByMessage.get(row.message_id)![row.component_key] = row.state;
  }

  return statesByMessage;
}
