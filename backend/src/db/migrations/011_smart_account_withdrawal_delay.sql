-- Restore the delayed-withdrawal fields used by SmartAccountsService. These
-- fields were present in the original schema migration but were accidentally
-- omitted from the reviewed schema snapshot used to initialize fresh databases.
-- IF NOT EXISTS keeps the repair safe for databases that already have them.

ALTER TABLE public.smart_account_withdrawals
  ADD COLUMN IF NOT EXISTS transfer_type VARCHAR(20) NOT NULL DEFAULT 'immediate',
  ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'smart_account_withdrawals_transfer_type_check'
      AND conrelid = 'public.smart_account_withdrawals'::regclass
  ) THEN
    ALTER TABLE public.smart_account_withdrawals
      ADD CONSTRAINT smart_account_withdrawals_transfer_type_check
      CHECK (transfer_type IN ('immediate', 'delayed'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_withdrawals_available_at
  ON public.smart_account_withdrawals(available_at)
  WHERE status = 'pending' AND transfer_type = 'delayed';

COMMENT ON COLUMN public.smart_account_withdrawals.transfer_type IS
  'immediate: executes right away, delayed: waits for available_at (fraud protection)';
COMMENT ON COLUMN public.smart_account_withdrawals.available_at IS
  'For delayed transfers, the timestamp when the transfer becomes executable';
