-- Terminal & Payment Sessions Schema
-- For PayTerm physical payment terminal system

-- ============================================================================
-- Terminal Devices
-- ============================================================================

CREATE TABLE IF NOT EXISTS terminal_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  project_id INTEGER NOT NULL,
  chain_id INTEGER NOT NULL DEFAULT 42161, -- Arbitrum default
  accepted_tokens TEXT[] NOT NULL DEFAULT '{"ETH"}',
  api_key_hash VARCHAR(64) NOT NULL,
  api_key_prefix VARCHAR(8) NOT NULL, -- First 8 chars for identification
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_terminal_devices_merchant ON terminal_devices(merchant_id);
CREATE INDEX idx_terminal_devices_project ON terminal_devices(project_id, chain_id);
CREATE INDEX idx_terminal_devices_api_key ON terminal_devices(api_key_prefix);
CREATE INDEX idx_terminal_devices_active ON terminal_devices(is_active) WHERE is_active = TRUE;

CREATE TRIGGER update_terminal_devices_updated_at
  BEFORE UPDATE ON terminal_devices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE terminal_devices IS 'Physical payment terminals registered by merchants';
COMMENT ON COLUMN terminal_devices.accepted_tokens IS 'Array of token symbols accepted (ETH, USDC, etc.)';
COMMENT ON COLUMN terminal_devices.api_key_hash IS 'SHA-256 hash of the API key for authentication';

-- ============================================================================
-- Payment Sessions
-- ============================================================================

CREATE TABLE IF NOT EXISTS payment_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id UUID NOT NULL REFERENCES terminal_devices(id) ON DELETE CASCADE,

  -- Payment details
  amount_usd DECIMAL(20, 2) NOT NULL CHECK (amount_usd > 0),
  token VARCHAR(42), -- Token address (null = native ETH)
  token_symbol VARCHAR(20) NOT NULL DEFAULT 'ETH',

  -- Status tracking
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paying', 'completed', 'failed', 'expired', 'cancelled')),

  -- Consumer info (populated when payment starts)
  consumer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  payment_method VARCHAR(20) -- 'juice', 'wallet', 'apple_pay', 'google_pay'
    CHECK (payment_method IS NULL OR payment_method IN ('juice', 'wallet', 'apple_pay', 'google_pay')),

  -- Transaction details (populated on completion)
  tx_hash VARCHAR(66),
  tokens_issued VARCHAR(78),

  -- Juice spend reference (if paid with Juice)
  juice_spend_id UUID REFERENCES juice_spends(id) ON DELETE SET NULL,

  -- Timing
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_sessions_device ON payment_sessions(device_id);
CREATE INDEX idx_payment_sessions_status ON payment_sessions(status);
CREATE INDEX idx_payment_sessions_consumer ON payment_sessions(consumer_id) WHERE consumer_id IS NOT NULL;
CREATE INDEX idx_payment_sessions_expires ON payment_sessions(expires_at) WHERE status = 'pending';
CREATE INDEX idx_payment_sessions_created ON payment_sessions(created_at DESC);

CREATE TRIGGER update_payment_sessions_updated_at
  BEFORE UPDATE ON payment_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE payment_sessions IS 'Individual payment sessions created by terminals';
COMMENT ON COLUMN payment_sessions.token IS 'ERC-20 token address, null for native ETH';
COMMENT ON COLUMN payment_sessions.tokens_issued IS 'Amount of project tokens received by consumer';

-- ============================================================================
-- Views
-- ============================================================================

-- Merchant terminal summary
CREATE VIEW merchant_terminal_summary AS
SELECT
  td.merchant_id,
  td.id as device_id,
  td.name as device_name,
  td.project_id,
  td.chain_id,
  td.is_active,
  td.last_seen_at,
  (
    SELECT COUNT(*)
    FROM payment_sessions ps
    WHERE ps.device_id = td.id
    AND ps.status = 'completed'
  ) as completed_payments,
  (
    SELECT COALESCE(SUM(amount_usd), 0)
    FROM payment_sessions ps
    WHERE ps.device_id = td.id
    AND ps.status = 'completed'
  ) as total_volume_usd,
  (
    SELECT MAX(completed_at)
    FROM payment_sessions ps
    WHERE ps.device_id = td.id
    AND ps.status = 'completed'
  ) as last_payment_at
FROM terminal_devices td;

-- Pending payment sessions (for expiry cleanup)
CREATE VIEW pending_payment_sessions AS
SELECT
  ps.id,
  ps.device_id,
  ps.amount_usd,
  ps.expires_at,
  ps.created_at,
  td.merchant_id,
  td.project_id,
  td.chain_id
FROM payment_sessions ps
JOIN terminal_devices td ON td.id = ps.device_id
WHERE ps.status = 'pending'
  AND ps.expires_at <= NOW();
