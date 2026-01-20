-- Pending fiat payments awaiting settlement
-- 7-day hold for chargeback protection before on-chain execution

CREATE TABLE pending_fiat_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- User who made the payment
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Stripe tracking
  stripe_payment_intent_id VARCHAR(255) UNIQUE NOT NULL,
  stripe_charge_id VARCHAR(255),

  -- Payment details (locked at payment time)
  amount_usd DECIMAL(10, 2) NOT NULL,
  amount_cents INTEGER NOT NULL, -- Stripe uses cents

  -- Target project
  project_id INTEGER NOT NULL,
  chain_id INTEGER NOT NULL,
  memo TEXT,
  beneficiary_address VARCHAR(42) NOT NULL, -- Who receives tokens (user's smart account)

  -- Settlement timing
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settles_at TIMESTAMPTZ NOT NULL, -- paid_at + 7 days

  -- Status tracking
  status VARCHAR(30) NOT NULL DEFAULT 'pending_settlement'
    CHECK (status IN (
      'pending_settlement',  -- Waiting for settlement period
      'settling',            -- Currently executing on-chain
      'settled',             -- On-chain payment complete
      'disputed',            -- Chargeback received - DO NOT SETTLE
      'refunded',            -- Manually refunded via Stripe
      'failed'               -- On-chain tx failed (will retry)
    )),

  -- Settlement execution details
  settled_at TIMESTAMPTZ,
  settlement_rate_eth_usd DECIMAL(12, 4), -- ETH/USD rate at settlement
  settlement_amount_wei VARCHAR(78),       -- Amount in wei
  settlement_tx_hash VARCHAR(66),
  tokens_received VARCHAR(78),             -- Project tokens received

  -- Error tracking for retries
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  last_retry_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_pending_fiat_status ON pending_fiat_payments(status);
CREATE INDEX idx_pending_fiat_settles_at ON pending_fiat_payments(settles_at)
  WHERE status = 'pending_settlement';
CREATE INDEX idx_pending_fiat_user ON pending_fiat_payments(user_id);
CREATE INDEX idx_pending_fiat_project ON pending_fiat_payments(project_id, chain_id);
CREATE INDEX idx_pending_fiat_stripe ON pending_fiat_payments(stripe_payment_intent_id);

-- View for aggregate pending balances per project (for UI display)
CREATE VIEW project_pending_balances AS
SELECT
  project_id,
  chain_id,
  COUNT(*) as pending_count,
  SUM(amount_usd) as pending_usd,
  MIN(settles_at) as next_settlement_at,
  MAX(settles_at) as last_settlement_at
FROM pending_fiat_payments
WHERE status = 'pending_settlement'
GROUP BY project_id, chain_id;

-- View for user's pending payments
CREATE VIEW user_pending_payments AS
SELECT
  user_id,
  COUNT(*) as pending_count,
  SUM(amount_usd) as pending_usd,
  MIN(settles_at) as next_settlement_at,
  json_agg(json_build_object(
    'id', id,
    'project_id', project_id,
    'chain_id', chain_id,
    'amount_usd', amount_usd,
    'settles_at', settles_at,
    'status', status
  ) ORDER BY settles_at) as payments
FROM pending_fiat_payments
WHERE status IN ('pending_settlement', 'settling')
GROUP BY user_id;

-- Trigger for updated_at
CREATE TRIGGER update_pending_fiat_updated_at
  BEFORE UPDATE ON pending_fiat_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Disputed payments log (for audit trail)
CREATE TABLE fiat_payment_disputes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pending_payment_id UUID NOT NULL REFERENCES pending_fiat_payments(id),

  -- Stripe dispute info
  stripe_dispute_id VARCHAR(255) NOT NULL,
  dispute_reason VARCHAR(100),
  dispute_status VARCHAR(50),
  dispute_amount_cents INTEGER,

  -- Resolution
  resolved_at TIMESTAMPTZ,
  resolution VARCHAR(50), -- 'won', 'lost', 'withdrawn'

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_disputes_payment ON fiat_payment_disputes(pending_payment_id);
