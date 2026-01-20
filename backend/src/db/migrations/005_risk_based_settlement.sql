-- Add risk-based settlement support to pending fiat payments
-- Stripe Radar risk score determines settlement delay:
--   0-20:   Immediate settlement (0 days)
--   21-40:  7 days delay
--   41-60:  30 days delay
--   61-80:  60 days delay
--   81-100: 120 days delay (maximum protection)

-- Add risk score from Stripe Radar (0-100)
ALTER TABLE pending_fiat_payments
ADD COLUMN risk_score INTEGER
  CHECK (risk_score IS NULL OR (risk_score >= 0 AND risk_score <= 100));

-- Add settlement delay in days (calculated from risk score)
ALTER TABLE pending_fiat_payments
ADD COLUMN settlement_delay_days INTEGER NOT NULL DEFAULT 7
  CHECK (settlement_delay_days >= 0 AND settlement_delay_days <= 120);

-- Index for analytics on risk-based settlements
CREATE INDEX idx_pending_fiat_risk_score ON pending_fiat_payments(risk_score)
  WHERE risk_score IS NOT NULL;

-- Update the comment on settles_at to reflect variable delay
COMMENT ON COLUMN pending_fiat_payments.settles_at IS
  'Settlement date (paid_at + settlement_delay_days based on risk score)';

COMMENT ON COLUMN pending_fiat_payments.risk_score IS
  'Stripe Radar risk score (0-100, higher = riskier). Used to calculate settlement delay.';

COMMENT ON COLUMN pending_fiat_payments.settlement_delay_days IS
  'Settlement delay in days based on risk score. 0 = immediate, up to 120 for high risk.';
