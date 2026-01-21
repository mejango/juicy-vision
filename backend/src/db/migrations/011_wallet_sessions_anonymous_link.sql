-- Migration: Add anonymous_session_id to wallet_sessions for session upgrade flow
-- This allows linking anonymous sessions to wallet sessions

-- Add anonymous_session_id column (nullable)
ALTER TABLE wallet_sessions
ADD COLUMN IF NOT EXISTS anonymous_session_id VARCHAR(64);

-- Make siwe_message, siwe_signature, nonce nullable for simplified auth
-- (not all auth flows need to store the full SIWE details)
ALTER TABLE wallet_sessions
ALTER COLUMN siwe_message DROP NOT NULL,
ALTER COLUMN siwe_signature DROP NOT NULL,
ALTER COLUMN nonce DROP NOT NULL;

-- Add unique constraint on wallet_address for upsert support
-- Drop existing unique constraint if any, then create
DO $$
BEGIN
  -- Check if constraint doesn't exist before adding
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wallet_sessions_wallet_address_key'
  ) THEN
    ALTER TABLE wallet_sessions ADD CONSTRAINT wallet_sessions_wallet_address_key UNIQUE (wallet_address);
  END IF;
END
$$;

-- Index for anonymous session lookups
CREATE INDEX IF NOT EXISTS idx_wallet_sessions_anonymous ON wallet_sessions(anonymous_session_id) WHERE anonymous_session_id IS NOT NULL;
