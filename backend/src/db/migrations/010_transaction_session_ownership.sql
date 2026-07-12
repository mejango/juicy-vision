-- Transaction history is owned either by an authenticated user UUID or by the
-- browser's opaque `ses_<timestamp>_<random>` ID. The original UUID foreign key
-- pointed at chat_sessions and could not store browser session IDs.
ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_session_id_fkey;

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS fk_session;

ALTER TABLE transactions
  ALTER COLUMN session_id TYPE VARCHAR(100) USING session_id::text;
