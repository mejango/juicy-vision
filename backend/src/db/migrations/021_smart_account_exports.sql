-- Smart Account Exports
-- Coordinates multi-chain custody transfer as a single atomic operation

-- Export requests (one per user export action)
CREATE TABLE smart_account_exports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Target owner (user's self-custody address)
  new_owner_address VARCHAR(42) NOT NULL,

  -- Which chains to export (user may have accounts on subset)
  chain_ids INTEGER[] NOT NULL,

  -- Per-chain status tracking
  -- Example: {
  --   "1": { "status": "completed", "txHash": "0x...", "completedAt": "..." },
  --   "10": { "status": "failed", "error": "insufficient gas", "attemptedAt": "..." }
  -- }
  chain_status JSONB NOT NULL DEFAULT '{}',

  -- Overall status
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'blocked', 'processing', 'completed', 'partial', 'failed', 'cancelled')),

  -- Blocked by pending operations
  blocked_by_pending_ops BOOLEAN NOT NULL DEFAULT FALSE,
  pending_ops_details JSONB,
  -- Example: { "withdrawals": [{ "id": "uuid", "chainId": 10, "amount": "1000000" }] }

  -- Pre-export snapshot of what user is exporting
  -- Helps with support requests and user confirmation
  export_snapshot JSONB,
  -- Example: {
  --   "accounts": [
  --     { "chainId": 10, "address": "0x...", "ethBalance": "1.5", "tokens": [...] },
  --     { "chainId": 8453, "address": "0x...", "ethBalance": "0.1", "tokens": [...] }
  --   ],
  --   "projectRoles": [
  --     { "projectId": 123, "chainId": 10, "role": "payout_recipient", "percentBps": 5000 }
  --   ]
  -- }

  -- User confirmation
  user_confirmed_at TIMESTAMPTZ,

  -- Completion
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Retry tracking
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_retry_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_exports_user ON smart_account_exports(user_id);
CREATE INDEX idx_exports_status ON smart_account_exports(status);
CREATE INDEX idx_exports_pending ON smart_account_exports(status) WHERE status IN ('pending', 'processing');

-- Trigger for updated_at
CREATE TRIGGER update_smart_account_exports_updated_at
  BEFORE UPDATE ON smart_account_exports
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comment explaining the statuses
COMMENT ON COLUMN smart_account_exports.status IS
  'pending: awaiting user confirmation
   blocked: has pending operations that must complete first
   processing: actively transferring ownership
   completed: all chains transferred successfully
   partial: some chains succeeded, some failed (can retry failed)
   failed: all chains failed
   cancelled: user cancelled the export';
