ALTER TABLE payment_sessions
  ADD COLUMN IF NOT EXISTS payer_address VARCHAR(42),
  ADD COLUMN IF NOT EXISTS quoted_token_amount VARCHAR(78),
  ADD COLUMN IF NOT EXISTS quoted_terminal_address VARCHAR(42),
  ADD COLUMN IF NOT EXISTS quoted_token_address VARCHAR(42),
  ADD COLUMN IF NOT EXISTS quoted_project_id BIGINT,
  ADD COLUMN IF NOT EXISTS quoted_chain_id INTEGER,
  ADD COLUMN IF NOT EXISTS quote_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_sessions_unique_wallet_tx
  ON payment_sessions (LOWER(tx_hash))
  WHERE tx_hash IS NOT NULL;
