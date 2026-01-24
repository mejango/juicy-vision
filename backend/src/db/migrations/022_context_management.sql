-- Context Management System
-- Enables conversation continuity via transaction state, summaries, and attachment processing

-- ============================================================================
-- Chat Transaction State (Entity Memory)
-- Persists project design decisions independently of message history
-- ============================================================================

CREATE TABLE IF NOT EXISTS chat_transaction_state (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,

  -- The actual state object (project config, user preferences, etc.)
  state JSONB NOT NULL DEFAULT '{}',

  -- Schema version for future migrations
  schema_version INTEGER NOT NULL DEFAULT 1,

  -- Last message that updated this state (for debugging/auditing)
  last_updated_by_message_id UUID REFERENCES multi_chat_messages(id) ON DELETE SET NULL,

  -- Timestamps
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One state per chat
  UNIQUE(chat_id)
);

CREATE INDEX idx_chat_transaction_state_chat ON chat_transaction_state(chat_id);

-- Trigger for updated_at
CREATE TRIGGER update_chat_transaction_state_updated_at
  BEFORE UPDATE ON chat_transaction_state
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE chat_transaction_state IS
  'Entity memory for chat sessions. Preserves project design decisions and user preferences even when messages are summarized.';

-- ============================================================================
-- Chat Summaries (Anchored Iterative Summarization)
-- Structured summaries with forced preservation of key information
-- ============================================================================

CREATE TABLE IF NOT EXISTS chat_summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,

  -- The summary content (structured markdown)
  summary_md TEXT NOT NULL,

  -- Message range this summary covers
  covers_from_message_id UUID REFERENCES multi_chat_messages(id) ON DELETE SET NULL,
  covers_to_message_id UUID REFERENCES multi_chat_messages(id) ON DELETE SET NULL,
  covers_from_created_at TIMESTAMPTZ,
  covers_to_created_at TIMESTAMPTZ,

  -- Token accounting
  message_count INTEGER NOT NULL,
  original_token_count INTEGER NOT NULL,
  summary_token_count INTEGER NOT NULL,
  compression_ratio NUMERIC(5,2) GENERATED ALWAYS AS (
    CASE WHEN summary_token_count > 0
    THEN original_token_count::NUMERIC / summary_token_count
    ELSE 0 END
  ) STORED,

  -- Generation metadata
  model_used VARCHAR(50),
  generation_latency_ms INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_summaries_chat ON chat_summaries(chat_id, created_at DESC);
CREATE INDEX idx_chat_summaries_range ON chat_summaries(chat_id, covers_to_created_at DESC);

COMMENT ON TABLE chat_summaries IS
  'Anchored iterative summaries. New summaries are merged with existing rather than regenerated from scratch.';

-- ============================================================================
-- Attachment Summaries
-- Preserve document/image context independently of message history
-- ============================================================================

CREATE TABLE IF NOT EXISTS attachment_summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES multi_chat_messages(id) ON DELETE CASCADE,
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,

  -- Which attachment in the message (0-indexed)
  attachment_index INTEGER NOT NULL,

  -- Original attachment metadata
  original_filename VARCHAR(255),
  original_mime_type VARCHAR(100),
  original_size_bytes INTEGER,

  -- Generated summary
  summary_md TEXT NOT NULL,

  -- Extracted structured data (tables, key-value pairs, etc.)
  extracted_data JSONB,

  -- Token accounting
  token_count INTEGER NOT NULL,

  -- Generation metadata
  model_used VARCHAR(50),
  generation_latency_ms INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One summary per attachment
  UNIQUE(message_id, attachment_index)
);

CREATE INDEX idx_attachment_summaries_chat ON attachment_summaries(chat_id, created_at DESC);
CREATE INDEX idx_attachment_summaries_message ON attachment_summaries(message_id);

COMMENT ON TABLE attachment_summaries IS
  'Persistent summaries of uploaded documents/images. Accessible even after source message falls out of context window.';

-- ============================================================================
-- Add token_count to messages for budget tracking
-- ============================================================================

ALTER TABLE multi_chat_messages ADD COLUMN IF NOT EXISTS token_count INTEGER;

COMMENT ON COLUMN multi_chat_messages.token_count IS
  'Estimated token count for this message content. Used for context budget management.';

-- ============================================================================
-- Add summarization tracking to chats
-- ============================================================================

ALTER TABLE multi_chats ADD COLUMN IF NOT EXISTS last_summarized_message_id UUID REFERENCES multi_chat_messages(id) ON DELETE SET NULL;
ALTER TABLE multi_chats ADD COLUMN IF NOT EXISTS total_message_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN multi_chats.last_summarized_message_id IS
  'The last message that was included in a summary. Messages after this are raw in context.';

-- ============================================================================
-- Context Usage Analytics (optional, for tuning)
-- ============================================================================

CREATE TABLE IF NOT EXISTS context_usage_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,
  message_id UUID REFERENCES multi_chat_messages(id) ON DELETE SET NULL,

  -- Token breakdown
  total_tokens INTEGER NOT NULL,
  system_prompt_tokens INTEGER,
  transaction_state_tokens INTEGER,
  user_context_tokens INTEGER,
  summary_tokens INTEGER,
  recent_message_tokens INTEGER,
  attachment_summary_tokens INTEGER,

  -- What was included
  recent_message_count INTEGER,
  summary_count INTEGER,
  attachment_count INTEGER,

  -- Was budget exceeded? Did we need to summarize?
  budget_exceeded BOOLEAN DEFAULT FALSE,
  triggered_summarization BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_context_usage_log_chat ON context_usage_log(chat_id, created_at DESC);

-- Keep only last 100 logs per chat (housekeeping)
CREATE OR REPLACE FUNCTION cleanup_context_usage_log()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM context_usage_log
  WHERE chat_id = NEW.chat_id
  AND id NOT IN (
    SELECT id FROM context_usage_log
    WHERE chat_id = NEW.chat_id
    ORDER BY created_at DESC
    LIMIT 100
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_cleanup_context_usage_log
  AFTER INSERT ON context_usage_log
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_context_usage_log();

COMMENT ON TABLE context_usage_log IS
  'Analytics for tuning token budgets. Tracks what was included in each AI invocation.';
