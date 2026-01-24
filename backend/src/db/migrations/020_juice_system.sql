-- Juice System - Stored Value for Non-Crypto Users
-- Enables fiat → Juice → Juicebox project payments
-- 1 Juice = $1 USD, non-refundable, non-transferable

-- User Juice balances
CREATE TABLE juice_balances (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- Current balance in Juice (1 Juice = $1)
  balance DECIMAL(20, 2) NOT NULL DEFAULT 0
    CHECK (balance >= 0),

  -- Lifetime totals for analytics
  lifetime_purchased DECIMAL(20, 2) NOT NULL DEFAULT 0,
  lifetime_spent DECIMAL(20, 2) NOT NULL DEFAULT 0,
  lifetime_cashed_out DECIMAL(20, 2) NOT NULL DEFAULT 0,

  -- Legal protection: Juice expires (effectively never, but provides legal cover)
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1000 years',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger for updated_at
CREATE TRIGGER update_juice_balances_updated_at
  BEFORE UPDATE ON juice_balances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Juice purchases (fiat → Juice conversion)
CREATE TABLE juice_purchases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Stripe tracking
  stripe_payment_intent_id VARCHAR(255) UNIQUE NOT NULL,
  stripe_charge_id VARCHAR(255),

  -- Stripe Radar risk assessment
  radar_risk_score INTEGER
    CHECK (radar_risk_score IS NULL OR (radar_risk_score >= 0 AND radar_risk_score <= 100)),
  radar_risk_level VARCHAR(20), -- 'normal', 'elevated', 'highest'

  -- Amounts (1:1 ratio)
  fiat_amount DECIMAL(20, 2) NOT NULL,
  juice_amount DECIMAL(20, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',

  -- Status workflow: pending → clearing → credited | disputed | refunded
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',     -- Payment received, calculating delay
      'clearing',    -- Waiting for risk-based delay to pass
      'credited',    -- Juice credited to user balance
      'disputed',    -- Chargeback received - no credit
      'refunded'     -- Manually refunded via Stripe
    )),

  -- Risk-based clearing delay
  settlement_delay_days INTEGER NOT NULL DEFAULT 0
    CHECK (settlement_delay_days >= 0 AND settlement_delay_days <= 120),
  clears_at TIMESTAMPTZ, -- When the purchase can be credited
  credited_at TIMESTAMPTZ, -- When actually credited

  -- Error tracking
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for purchases
CREATE INDEX idx_juice_purchases_user ON juice_purchases(user_id);
CREATE INDEX idx_juice_purchases_status ON juice_purchases(status);
CREATE INDEX idx_juice_purchases_clears ON juice_purchases(clears_at)
  WHERE status = 'clearing';
CREATE INDEX idx_juice_purchases_stripe ON juice_purchases(stripe_payment_intent_id);

-- Juice spends (Juice → Project payment)
CREATE TABLE juice_spends (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Target project
  project_id INTEGER NOT NULL,
  chain_id INTEGER NOT NULL,
  beneficiary_address VARCHAR(42) NOT NULL,
  memo TEXT,

  -- Amounts
  juice_amount DECIMAL(20, 2) NOT NULL,
  crypto_amount VARCHAR(78), -- Amount in wei after conversion
  eth_usd_rate DECIMAL(12, 4), -- Rate at execution time

  -- Status workflow: pending → executing → completed | failed | refunded
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',    -- Juice deducted, awaiting execution
      'executing',  -- On-chain tx in progress
      'completed',  -- Successfully paid project
      'failed',     -- Execution failed (Juice refunded)
      'refunded'    -- Manually refunded to user's balance
    )),

  -- Transaction details
  tx_hash VARCHAR(66),
  tokens_received VARCHAR(78), -- Project tokens received
  nfts_received JSONB, -- Any NFTs received (tiered rewards)

  -- Error handling
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_retry_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for spends
CREATE INDEX idx_juice_spends_user ON juice_spends(user_id);
CREATE INDEX idx_juice_spends_status ON juice_spends(status);
CREATE INDEX idx_juice_spends_pending ON juice_spends(created_at)
  WHERE status = 'pending';
CREATE INDEX idx_juice_spends_project ON juice_spends(project_id, chain_id);

-- Trigger for updated_at
CREATE TRIGGER update_juice_spends_updated_at
  BEFORE UPDATE ON juice_spends
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Juice cash outs (Juice → Crypto to user's wallet)
CREATE TABLE juice_cash_outs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Destination (user's managed or external wallet)
  destination_address VARCHAR(42) NOT NULL,
  chain_id INTEGER NOT NULL DEFAULT 1,

  -- Amounts
  juice_amount DECIMAL(20, 2) NOT NULL,
  crypto_amount VARCHAR(78), -- Amount in wei after conversion
  eth_usd_rate DECIMAL(12, 4), -- Rate at execution time
  token_address VARCHAR(42), -- Token to receive (null = ETH, or stablecoin)

  -- Status workflow: pending → processing → completed | failed | cancelled
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',     -- Request submitted, waiting for delay
      'processing',  -- Transfer in progress
      'completed',   -- Crypto sent
      'failed',      -- Transfer failed
      'cancelled'    -- User cancelled
    )),

  -- Delay before processing (fraud protection)
  available_at TIMESTAMPTZ NOT NULL,

  -- Transaction details
  tx_hash VARCHAR(66),

  -- Error handling
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for cash outs
CREATE INDEX idx_juice_cash_outs_user ON juice_cash_outs(user_id);
CREATE INDEX idx_juice_cash_outs_status ON juice_cash_outs(status);
CREATE INDEX idx_juice_cash_outs_available ON juice_cash_outs(available_at)
  WHERE status = 'pending';

-- Trigger for updated_at
CREATE TRIGGER update_juice_cash_outs_updated_at
  BEFORE UPDATE ON juice_cash_outs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- View: User transaction history (all Juice movements)
CREATE VIEW juice_transactions AS
SELECT
  id,
  user_id,
  'purchase' as type,
  juice_amount as amount,
  status,
  created_at,
  null::integer as project_id,
  null::integer as chain_id
FROM juice_purchases
UNION ALL
SELECT
  id,
  user_id,
  'spend' as type,
  -juice_amount as amount,
  status,
  created_at,
  project_id,
  chain_id
FROM juice_spends
UNION ALL
SELECT
  id,
  user_id,
  'cash_out' as type,
  -juice_amount as amount,
  status,
  created_at,
  null as project_id,
  chain_id
FROM juice_cash_outs;

-- View: Pending Juice credits (for cron processing)
CREATE VIEW juice_pending_credits AS
SELECT
  id,
  user_id,
  juice_amount,
  clears_at,
  status
FROM juice_purchases
WHERE status = 'clearing'
  AND clears_at <= NOW();

-- Comments for documentation
COMMENT ON TABLE juice_balances IS
  'User Juice balances. 1 Juice = $1 USD. Non-refundable, non-transferable.';

COMMENT ON TABLE juice_purchases IS
  'Fiat → Juice purchases via Stripe. Risk-based clearing delay before crediting.';

COMMENT ON TABLE juice_spends IS
  'Juice → Juicebox project payments. Deducted immediately, executed asynchronously.';

COMMENT ON TABLE juice_cash_outs IS
  'Juice → Crypto withdrawals to user wallet. Delayed for fraud protection.';
