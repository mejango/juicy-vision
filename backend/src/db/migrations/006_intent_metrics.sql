-- Migration: Intent Detection Metrics
-- Purpose: Track intent detection performance for optimization
--
-- This migration creates tables for logging intent detection results,
-- enabling analysis and threshold tuning over time.

-- Intent detection metrics table
-- Logs every intent detection invocation for analytics
CREATE TABLE IF NOT EXISTS intent_detection_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Link to chat/message
  chat_id UUID NOT NULL,
  message_id UUID,

  -- Detected intents (stored as arrays for flexibility)
  detected_intents TEXT[] NOT NULL DEFAULT '{}',
  sub_modules_loaded TEXT[] NOT NULL DEFAULT '{}',

  -- Detection method and confidence
  detection_method VARCHAR(20) NOT NULL, -- 'semantic', 'keyword', 'hybrid'
  semantic_confidence DECIMAL(4,3), -- 0.000 to 1.000

  -- Token metrics
  total_prompt_tokens INTEGER,
  tokens_saved INTEGER, -- Estimated savings vs full context

  -- Quality signals (updated after response)
  user_feedback VARCHAR(20), -- 'positive', 'negative', 'neutral', NULL
  required_followup BOOLEAN DEFAULT FALSE, -- True if user had to clarify
  ai_confidence_level VARCHAR(10), -- From AI response: 'high', 'medium', 'low'

  -- Timing
  detection_time_ms INTEGER, -- How long detection took
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_detection_method CHECK (detection_method IN ('semantic', 'keyword', 'hybrid')),
  CONSTRAINT valid_user_feedback CHECK (user_feedback IS NULL OR user_feedback IN ('positive', 'negative', 'neutral')),
  CONSTRAINT valid_ai_confidence CHECK (ai_confidence_level IS NULL OR ai_confidence_level IN ('high', 'medium', 'low'))
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_intent_metrics_chat_id
  ON intent_detection_metrics (chat_id);

CREATE INDEX IF NOT EXISTS idx_intent_metrics_created_at
  ON intent_detection_metrics (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_intent_metrics_detection_method
  ON intent_detection_metrics (detection_method);

CREATE INDEX IF NOT EXISTS idx_intent_metrics_confidence
  ON intent_detection_metrics (semantic_confidence DESC)
  WHERE semantic_confidence IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_intent_metrics_feedback
  ON intent_detection_metrics (user_feedback)
  WHERE user_feedback IS NOT NULL;

-- Aggregate statistics table for dashboard
-- Updated periodically by cron job
CREATE TABLE IF NOT EXISTS intent_detection_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Time period
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  period_type VARCHAR(20) NOT NULL, -- 'hourly', 'daily', 'weekly'

  -- Volume metrics
  total_detections INTEGER NOT NULL DEFAULT 0,
  semantic_detections INTEGER NOT NULL DEFAULT 0,
  keyword_detections INTEGER NOT NULL DEFAULT 0,
  hybrid_detections INTEGER NOT NULL DEFAULT 0,

  -- Confidence metrics
  avg_semantic_confidence DECIMAL(4,3),
  p50_semantic_confidence DECIMAL(4,3),
  p90_semantic_confidence DECIMAL(4,3),

  -- Token metrics
  avg_prompt_tokens INTEGER,
  avg_tokens_saved INTEGER,
  total_tokens_saved BIGINT,

  -- Quality metrics
  positive_feedback_count INTEGER DEFAULT 0,
  negative_feedback_count INTEGER DEFAULT 0,
  followup_required_count INTEGER DEFAULT 0,

  -- AI confidence breakdown
  high_confidence_count INTEGER DEFAULT 0,
  medium_confidence_count INTEGER DEFAULT 0,
  low_confidence_count INTEGER DEFAULT 0,

  -- Domain usage
  data_query_count INTEGER DEFAULT 0,
  hook_developer_count INTEGER DEFAULT 0,
  transaction_count INTEGER DEFAULT 0,

  -- Top sub-modules (JSONB for flexibility)
  top_sub_modules JSONB DEFAULT '[]',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique constraint on time period
  UNIQUE (period_start, period_type)
);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_intent_stats_period
  ON intent_detection_stats (period_start DESC, period_type);

-- Comments for documentation
COMMENT ON TABLE intent_detection_metrics IS 'Per-invocation intent detection logs for analytics';
COMMENT ON TABLE intent_detection_stats IS 'Aggregated statistics for dashboard and monitoring';
COMMENT ON COLUMN intent_detection_metrics.tokens_saved IS 'Estimated tokens saved vs loading full context';
COMMENT ON COLUMN intent_detection_metrics.required_followup IS 'True if user had to clarify, indicating possible false negative';
