-- Migration: Credit Expirations Table
-- Tracks expired Juice credits (6 months of inactivity)

CREATE TABLE IF NOT EXISTS credit_expirations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(12, 2) NOT NULL,
  expired_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL,
  -- Future: track where expired credits are sent
  beneficiary_project_id INTEGER,
  beneficiary_chain_id INTEGER,
  tx_hash VARCHAR(66),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_expirations_user_id ON credit_expirations(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_expirations_expired_at ON credit_expirations(expired_at);

COMMENT ON TABLE credit_expirations IS 'Records of expired Juice credits after 6 months of inactivity';
COMMENT ON COLUMN credit_expirations.last_activity_at IS 'When the user was last active before expiration';
