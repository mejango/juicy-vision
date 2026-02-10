-- AI Confidence Escalation System
-- Adds confidence tracking to AI responses and escalation queue for admin review
-- Low-confidence responses are flagged for human review to reduce hallucinations

-- ============================================================================
-- Add confidence columns to multi_chat_messages
-- ============================================================================

ALTER TABLE multi_chat_messages ADD COLUMN IF NOT EXISTS ai_confidence VARCHAR(10);
ALTER TABLE multi_chat_messages ADD COLUMN IF NOT EXISTS ai_confidence_reason TEXT;

-- ============================================================================
-- AI Escalations Queue
-- ============================================================================
-- Low-confidence AI responses are queued here for admin review
-- Admins can approve, correct, or add notes

CREATE TABLE IF NOT EXISTS ai_escalations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES multi_chat_messages(id) ON DELETE CASCADE,
  user_query TEXT NOT NULL,
  ai_response TEXT NOT NULL,
  confidence_level VARCHAR(10) NOT NULL CHECK (confidence_level IN ('high', 'medium', 'low')),
  confidence_reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'corrected')),
  admin_correction TEXT,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by VARCHAR(100)
);

CREATE INDEX idx_ai_escalations_status ON ai_escalations(status);
CREATE INDEX idx_ai_escalations_chat ON ai_escalations(chat_id);
CREATE INDEX idx_ai_escalations_created ON ai_escalations(created_at DESC);

-- ============================================================================
-- Context Cache
-- ============================================================================
-- Generic cache for dynamic context (e.g., trending projects)
-- Used to inject fresh data into AI system prompts

CREATE TABLE IF NOT EXISTS context_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cache_key VARCHAR(100) UNIQUE NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_context_cache_key ON context_cache(cache_key);
CREATE INDEX idx_context_cache_expires ON context_cache(expires_at);
