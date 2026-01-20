-- Smart Accounts for managed users
-- ERC-4337 compatible smart contract wallets

-- Track smart account deployment and ownership
CREATE TABLE user_smart_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chain_id INTEGER NOT NULL,

  -- Smart account address (deterministic via CREATE2, valid before deployment)
  address VARCHAR(42) NOT NULL,

  -- Salt used for deterministic address (derived from user_id)
  salt VARCHAR(66) NOT NULL,

  -- Deployment status
  deployed BOOLEAN NOT NULL DEFAULT FALSE,
  deploy_tx_hash VARCHAR(66),
  deployed_at TIMESTAMPTZ,

  -- Custody status
  custody_status VARCHAR(20) NOT NULL DEFAULT 'managed'
    CHECK (custody_status IN ('managed', 'transferring', 'self_custody')),

  -- If self-custody, who owns it now
  owner_address VARCHAR(42), -- NULL = system owns, set = user's EOA owns
  custody_transferred_at TIMESTAMPTZ,
  custody_transfer_tx_hash VARCHAR(66),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, chain_id),
  UNIQUE(chain_id, address)
);

CREATE INDEX idx_smart_accounts_user ON user_smart_accounts(user_id);
CREATE INDEX idx_smart_accounts_address ON user_smart_accounts(address);
CREATE INDEX idx_smart_accounts_custody ON user_smart_accounts(custody_status);

-- Track when smart accounts are set as recipients on projects
CREATE TABLE smart_account_project_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  smart_account_id UUID NOT NULL REFERENCES user_smart_accounts(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  chain_id INTEGER NOT NULL,

  role_type VARCHAR(30) NOT NULL
    CHECK (role_type IN ('payout_recipient', 'reserved_recipient', 'operator')),

  -- For splits: which group and percentage
  split_group INTEGER, -- 1 = ETH payouts, 2 = reserved tokens
  percent_bps INTEGER, -- Basis points (10000 = 100%)

  -- When was this role set on-chain
  set_tx_hash VARCHAR(66),
  set_at TIMESTAMPTZ,

  -- Is it still active?
  active BOOLEAN NOT NULL DEFAULT TRUE,
  removed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_account_roles_smart_account ON smart_account_project_roles(smart_account_id);
CREATE INDEX idx_account_roles_project ON smart_account_project_roles(project_id, chain_id);
CREATE INDEX idx_account_roles_active ON smart_account_project_roles(active) WHERE active = TRUE;

-- Track balances at smart account addresses (cached from chain)
CREATE TABLE smart_account_balances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  smart_account_id UUID NOT NULL REFERENCES user_smart_accounts(id) ON DELETE CASCADE,

  -- Token info
  token_address VARCHAR(42) NOT NULL, -- 0x0...0 for native ETH
  token_symbol VARCHAR(20) NOT NULL,
  token_decimals INTEGER NOT NULL DEFAULT 18,

  -- Balance (stored as string for uint256)
  balance VARCHAR(78) NOT NULL DEFAULT '0',

  -- Last update
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_block BIGINT,

  UNIQUE(smart_account_id, token_address)
);

CREATE INDEX idx_smart_balances_account ON smart_account_balances(smart_account_id);

-- Withdrawal requests from managed accounts
CREATE TABLE smart_account_withdrawals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  smart_account_id UUID NOT NULL REFERENCES user_smart_accounts(id) ON DELETE CASCADE,

  -- What to withdraw
  token_address VARCHAR(42) NOT NULL,
  amount VARCHAR(78) NOT NULL,

  -- Where to send
  to_address VARCHAR(42) NOT NULL,

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),

  -- Execution
  tx_hash VARCHAR(66),
  executed_at TIMESTAMPTZ,
  error_message TEXT,

  -- Gas sponsorship
  gas_sponsored BOOLEAN NOT NULL DEFAULT TRUE,
  gas_cost_wei VARCHAR(78),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_withdrawals_account ON smart_account_withdrawals(smart_account_id);
CREATE INDEX idx_withdrawals_status ON smart_account_withdrawals(status);

-- Trigger for updated_at
CREATE TRIGGER update_smart_accounts_updated_at
  BEFORE UPDATE ON user_smart_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
