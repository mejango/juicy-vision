-- Juicy Vision Database Schema
-- Run this to initialize the database

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Users & Auth
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  privacy_mode VARCHAR(20) NOT NULL DEFAULT 'open_book'
    CHECK (privacy_mode IN ('open_book', 'anonymous', 'private', 'ghost')),
  custodial_address_index INTEGER, -- For deriving HD wallet address
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- One-time codes for email verification
CREATE TABLE IF NOT EXISTS otp_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL,
  code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_otp_codes_email ON otp_codes(email);
CREATE INDEX idx_otp_codes_expires_at ON otp_codes(expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- OAuth connections (for social login)
CREATE TABLE IF NOT EXISTS oauth_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL, -- 'google', 'github', 'apple'
  provider_user_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, provider_user_id)
);

CREATE INDEX idx_oauth_connections_user_id ON oauth_connections(user_id);

-- ============================================================================
-- Custodial Wallet
-- ============================================================================

-- Pending transfers (30-day hold before execution)
CREATE TABLE IF NOT EXISTS pending_transfers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chain_id INTEGER NOT NULL,
  token_address VARCHAR(42) NOT NULL,
  token_symbol VARCHAR(20) NOT NULL,
  amount VARCHAR(78) NOT NULL, -- uint256 max as string
  to_address VARCHAR(42) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'executed', 'cancelled')),
  tx_hash VARCHAR(66),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  available_at TIMESTAMPTZ NOT NULL, -- 30 days from created_at
  executed_at TIMESTAMPTZ
);

CREATE INDEX idx_pending_transfers_user_id ON pending_transfers(user_id);
CREATE INDEX idx_pending_transfers_status ON pending_transfers(status);
CREATE INDEX idx_pending_transfers_available_at ON pending_transfers(available_at);

-- ============================================================================
-- Payments
-- ============================================================================

CREATE TABLE IF NOT EXISTS payment_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_payment_id VARCHAR(255) UNIQUE NOT NULL,
  amount_usd DECIMAL(10, 2) NOT NULL,
  project_id INTEGER NOT NULL,
  chain_id INTEGER NOT NULL,
  memo TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  tx_hash VARCHAR(66),
  tokens_received VARCHAR(78), -- BigInt as string
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_payment_executions_user_id ON payment_executions(user_id);
CREATE INDEX idx_payment_executions_status ON payment_executions(status);
CREATE INDEX idx_payment_executions_stripe_id ON payment_executions(stripe_payment_id);

-- ============================================================================
-- Chat & Events (Analytics)
-- ============================================================================

CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL for anonymous
  privacy_mode VARCHAR(20) NOT NULL DEFAULT 'open_book',
  wallet_connected BOOLEAN NOT NULL DEFAULT FALSE,
  mode VARCHAR(20) NOT NULL DEFAULT 'self_custody'
    CHECK (mode IN ('self_custody', 'managed')),
  entry_point VARCHAR(255),
  outcome_completed_payment BOOLEAN DEFAULT FALSE,
  outcome_found_project BOOLEAN DEFAULT FALSE,
  outcome_connected_wallet BOOLEAN DEFAULT FALSE,
  outcome_error_encountered BOOLEAN DEFAULT FALSE,
  outcome_user_abandoned BOOLEAN DEFAULT FALSE,
  session_rating INTEGER CHECK (session_rating >= 1 AND session_rating <= 5),
  session_feedback TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX idx_chat_sessions_user_id ON chat_sessions(user_id);
CREATE INDEX idx_chat_sessions_started_at ON chat_sessions(started_at);
CREATE INDEX idx_chat_sessions_privacy_mode ON chat_sessions(privacy_mode);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  tool_calls JSONB, -- Array of tool call objects
  feedback_helpful BOOLEAN,
  feedback_reported BOOLEAN DEFAULT FALSE,
  feedback_report_reason TEXT,
  feedback_user_correction TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX idx_chat_messages_created_at ON chat_messages(created_at);
CREATE INDEX idx_chat_messages_feedback ON chat_messages(feedback_helpful, feedback_reported);

-- Raw events for analytics
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(100) NOT NULL,
  event_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_session_id ON events(session_id);
CREATE INDEX idx_events_user_id ON events(user_id);
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_created_at ON events(created_at);

-- ============================================================================
-- User Corrections Queue (AI Review)
-- ============================================================================

CREATE TABLE IF NOT EXISTS corrections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  original_content TEXT NOT NULL,
  user_correction TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  review_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_corrections_status ON corrections(status);
CREATE INDEX idx_corrections_created_at ON corrections(created_at);

-- ============================================================================
-- Reserves Management (ETH/USDC)
-- ============================================================================

CREATE TABLE IF NOT EXISTS reserve_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chain_id INTEGER NOT NULL,
  token_address VARCHAR(42) NOT NULL, -- 0x0 for ETH
  amount VARCHAR(78) NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('in', 'out')),
  related_payment_id UUID REFERENCES payment_executions(id),
  tx_hash VARCHAR(66),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reserve_transactions_chain_id ON reserve_transactions(chain_id);
CREATE INDEX idx_reserve_transactions_created_at ON reserve_transactions(created_at);

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Views for Training Data Export
-- ============================================================================

-- Good conversations (for fine-tuning)
CREATE VIEW training_good_conversations AS
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
GROUP BY cs.id;

-- Bad conversations (for understanding failure modes)
CREATE VIEW training_bad_conversations AS
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
GROUP BY cs.id;
