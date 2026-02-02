-- Migration: Message Component States
-- Persists resolved state for dynamic components (transaction-preview, options-picker, etc.)
-- State is scoped per-message and propagates to all chat participants.

-- ============================================================================
-- Message Component States Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS message_component_states (
  -- Composite primary key: one state per component per message
  message_id UUID NOT NULL,
  component_key VARCHAR(64) NOT NULL,

  -- The resolved state as JSON (e.g., { status: 'completed', projectIds: {...} })
  state JSONB NOT NULL DEFAULT '{}',

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (message_id, component_key)
);

-- Note: We don't add FK constraint to multi_chat_messages because:
-- 1. Some chats may use chat_messages (single-user)
-- 2. We want to support both message tables
-- 3. Orphaned states are harmless and can be cleaned up periodically

-- Index for fast lookups by message
CREATE INDEX idx_message_component_states_message ON message_component_states(message_id);

-- Index for finding recently updated states (useful for debugging/admin)
CREATE INDEX idx_message_component_states_updated ON message_component_states(updated_at DESC);

-- ============================================================================
-- Comments for Documentation
-- ============================================================================

COMMENT ON TABLE message_component_states IS
'Stores resolved state for dynamic message components like transaction-preview.
State persists across sessions and is visible to all chat participants.
Component key uniquely identifies the component within a message (e.g., "transaction-preview").';

COMMENT ON COLUMN message_component_states.component_key IS
'Unique identifier for the component within the message. Convention: component-name or component-name:index if multiple.';

COMMENT ON COLUMN message_component_states.state IS
'JSON state object. Structure depends on component type.
For transaction-preview: { status, projectIds, txHashes, completedAt }';
