-- Transactions table for persistent payment tracking
-- Stores blockchain transactions correlated to sessions and users

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,

  -- Blockchain data
  tx_hash VARCHAR(66),
  chain_id INTEGER NOT NULL,
  from_address VARCHAR(42) NOT NULL,
  to_address VARCHAR(42) NOT NULL,

  -- Payment details
  token_address VARCHAR(42),        -- NULL for ETH
  amount VARCHAR(78) NOT NULL,      -- BigInt as string
  project_id VARCHAR(20),           -- Juicebox project ID

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'confirmed', 'failed', 'cancelled')),
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,

  -- Receipt data (stored as JSON)
  receipt JSONB
);

-- Indexes for common queries
CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_session ON transactions(session_id);
CREATE INDEX idx_transactions_hash ON transactions(tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_project ON transactions(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_transactions_created ON transactions(created_at DESC);
