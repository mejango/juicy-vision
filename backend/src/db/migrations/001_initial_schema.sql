-- Juicy Vision Database Schema (Consolidated)
-- Run this to initialize the database

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Users & Auth
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  privacy_mode VARCHAR(20) NOT NULL DEFAULT 'open_book'
    CHECK (privacy_mode IN ('open_book', 'anonymous', 'private', 'ghost')),
  custodial_address_index INTEGER,
  passkey_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- One-time codes for email verification
CREATE TABLE IF NOT EXISTS otp_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL,
  code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_otp_codes_email ON otp_codes(email);
CREATE INDEX idx_otp_codes_expires_at ON otp_codes(expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- OAuth connections (for social login)
CREATE TABLE IF NOT EXISTS oauth_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  provider_user_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, provider_user_id)
);

CREATE INDEX idx_oauth_connections_user_id ON oauth_connections(user_id);

-- ============================================================================
-- Passkey/WebAuthn Authentication
-- ============================================================================

CREATE TABLE IF NOT EXISTS passkey_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  credential_id BYTEA UNIQUE NOT NULL,
  credential_id_b64 VARCHAR(512) NOT NULL,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  device_type VARCHAR(50),
  transports TEXT[],
  backup_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  backup_state BOOLEAN NOT NULL DEFAULT FALSE,
  display_name VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  CONSTRAINT passkey_has_user CHECK (user_id IS NOT NULL)
);

CREATE INDEX idx_passkey_credentials_user_id ON passkey_credentials(user_id);
CREATE INDEX idx_passkey_credentials_cred_id ON passkey_credentials(credential_id_b64);

CREATE TABLE IF NOT EXISTS passkey_challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenge BYTEA UNIQUE NOT NULL,
  challenge_b64 VARCHAR(128) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('registration', 'authentication')),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(255),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_passkey_challenges_challenge ON passkey_challenges(challenge_b64);
CREATE INDEX idx_passkey_challenges_expires ON passkey_challenges(expires_at);

-- ============================================================================
-- Wallet Sessions (SIWE & Passkey-derived wallets)
-- ============================================================================

CREATE TABLE IF NOT EXISTS wallet_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address VARCHAR(42) NOT NULL UNIQUE,
  siwe_message TEXT,
  siwe_signature TEXT,
  nonce VARCHAR(32),
  session_token VARCHAR(64) UNIQUE NOT NULL,
  anonymous_session_id VARCHAR(64),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallet_sessions_address ON wallet_sessions(wallet_address);
CREATE INDEX idx_wallet_sessions_token ON wallet_sessions(session_token);
CREATE INDEX idx_wallet_sessions_expires ON wallet_sessions(expires_at);
CREATE INDEX idx_wallet_sessions_anonymous ON wallet_sessions(anonymous_session_id) WHERE anonymous_session_id IS NOT NULL;

-- Passkey-derived wallet mappings
CREATE TABLE IF NOT EXISTS passkey_wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  credential_id VARCHAR(512) UNIQUE NOT NULL,
  wallet_address VARCHAR(42) NOT NULL,
  primary_wallet_address VARCHAR(42),
  device_name VARCHAR(100),
  device_type VARCHAR(50),
  wallet_session_id UUID REFERENCES wallet_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX idx_passkey_wallets_credential ON passkey_wallets(credential_id);
CREATE INDEX idx_passkey_wallets_address ON passkey_wallets(wallet_address);
CREATE INDEX idx_passkey_wallets_primary ON passkey_wallets(primary_wallet_address);

-- ============================================================================
-- User Keypairs (for E2E encryption)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_keypairs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  encrypted_private_key TEXT NOT NULL,
  algorithm VARCHAR(20) NOT NULL DEFAULT 'x25519',
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_user_keypairs_user_id ON user_keypairs(user_id);
CREATE UNIQUE INDEX idx_user_keypairs_active ON user_keypairs(user_id) WHERE is_active = TRUE;

-- ============================================================================
-- User Context for Personalization
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_contexts (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  wallet_address VARCHAR(42),
  context_md TEXT NOT NULL,
  jargon_level VARCHAR(20) NOT NULL DEFAULT 'beginner'
    CHECK (jargon_level IN ('beginner', 'intermediate', 'advanced')),
  familiar_terms TEXT[] DEFAULT '{}',
  observations JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_contexts_wallet ON user_contexts(wallet_address);
CREATE INDEX idx_user_contexts_jargon ON user_contexts(jargon_level);

CREATE TRIGGER update_user_contexts_updated_at
  BEFORE UPDATE ON user_contexts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- User Regions (Analytics)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_regions (
  id SERIAL PRIMARY KEY,
  ip_hash VARCHAR(32) NOT NULL,
  country_code VARCHAR(3) NOT NULL,
  country VARCHAR(100) NOT NULL,
  region VARCHAR(100),
  city VARCHAR(100),
  suggested_language VARCHAR(10) NOT NULL,
  language_used VARCHAR(10) NOT NULL,
  user_id UUID REFERENCES users(id),
  visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_regions_country ON user_regions(country_code);
CREATE INDEX idx_user_regions_language ON user_regions(language_used);
CREATE INDEX idx_user_regions_visited ON user_regions(visited_at);
CREATE INDEX idx_user_regions_user ON user_regions(user_id) WHERE user_id IS NOT NULL;

-- ============================================================================
-- Juicy Identity System
-- ============================================================================

CREATE TABLE IF NOT EXISTS juicy_identities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  address VARCHAR(42) NOT NULL UNIQUE,
  emoji VARCHAR(10) NOT NULL,
  username VARCHAR(20) NOT NULL,
  username_lower VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(emoji, username_lower)
);

CREATE INDEX idx_juicy_identities_lookup ON juicy_identities(emoji, username_lower);
CREATE INDEX idx_juicy_identities_address ON juicy_identities(address);

CREATE TABLE IF NOT EXISTS juicy_identity_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  address VARCHAR(42) NOT NULL,
  emoji VARCHAR(10) NOT NULL,
  username VARCHAR(20) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_type VARCHAR(20) NOT NULL CHECK (change_type IN ('created', 'updated', 'deleted'))
);

CREATE INDEX idx_juicy_identity_history_address ON juicy_identity_history(address);
CREATE INDEX idx_juicy_identity_history_ended_at ON juicy_identity_history(ended_at DESC);

CREATE TRIGGER update_juicy_identities_updated_at
  BEFORE UPDATE ON juicy_identities
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Smart Accounts (ERC-4337)
-- ============================================================================

CREATE TABLE user_smart_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chain_id INTEGER NOT NULL,
  address VARCHAR(42) NOT NULL,
  salt VARCHAR(66) NOT NULL,
  deployed BOOLEAN NOT NULL DEFAULT FALSE,
  deploy_tx_hash VARCHAR(66),
  deployed_at TIMESTAMPTZ,
  custody_status VARCHAR(20) NOT NULL DEFAULT 'managed'
    CHECK (custody_status IN ('managed', 'transferring', 'self_custody')),
  owner_address VARCHAR(42),
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

CREATE TRIGGER update_smart_accounts_updated_at
  BEFORE UPDATE ON user_smart_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE smart_account_project_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  smart_account_id UUID NOT NULL REFERENCES user_smart_accounts(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  chain_id INTEGER NOT NULL,
  role_type VARCHAR(30) NOT NULL
    CHECK (role_type IN ('payout_recipient', 'reserved_recipient', 'operator')),
  split_group INTEGER,
  percent_bps INTEGER,
  set_tx_hash VARCHAR(66),
  set_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_account_roles_smart_account ON smart_account_project_roles(smart_account_id);
CREATE INDEX idx_account_roles_project ON smart_account_project_roles(project_id, chain_id);
CREATE INDEX idx_account_roles_active ON smart_account_project_roles(active) WHERE active = TRUE;

CREATE TABLE smart_account_balances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  smart_account_id UUID NOT NULL REFERENCES user_smart_accounts(id) ON DELETE CASCADE,
  token_address VARCHAR(42) NOT NULL,
  token_symbol VARCHAR(20) NOT NULL,
  token_decimals INTEGER NOT NULL DEFAULT 18,
  balance VARCHAR(78) NOT NULL DEFAULT '0',
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_block BIGINT,
  UNIQUE(smart_account_id, token_address)
);

CREATE INDEX idx_smart_balances_account ON smart_account_balances(smart_account_id);

CREATE TABLE smart_account_withdrawals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  smart_account_id UUID NOT NULL REFERENCES user_smart_accounts(id) ON DELETE CASCADE,
  token_address VARCHAR(42) NOT NULL,
  amount VARCHAR(78) NOT NULL,
  to_address VARCHAR(42) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  transfer_type VARCHAR(20) NOT NULL DEFAULT 'immediate'
    CHECK (transfer_type IN ('immediate', 'delayed')),
  available_at TIMESTAMPTZ,
  tx_hash VARCHAR(66),
  executed_at TIMESTAMPTZ,
  error_message TEXT,
  gas_sponsored BOOLEAN NOT NULL DEFAULT TRUE,
  gas_cost_wei VARCHAR(78),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_withdrawals_account ON smart_account_withdrawals(smart_account_id);
CREATE INDEX idx_withdrawals_status ON smart_account_withdrawals(status);
CREATE INDEX idx_withdrawals_available_at ON smart_account_withdrawals(available_at)
  WHERE status = 'pending' AND transfer_type = 'delayed';

COMMENT ON COLUMN smart_account_withdrawals.available_at IS
  'For delayed transfers, the timestamp when the transfer becomes executable';
COMMENT ON COLUMN smart_account_withdrawals.transfer_type IS
  'immediate: executes right away, delayed: waits for available_at (fraud protection)';

-- Smart Account Exports
CREATE TABLE smart_account_exports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_owner_address VARCHAR(42) NOT NULL,
  chain_ids INTEGER[] NOT NULL,
  chain_status JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'blocked', 'processing', 'completed', 'partial', 'failed', 'cancelled')),
  blocked_by_pending_ops BOOLEAN NOT NULL DEFAULT FALSE,
  pending_ops_details JSONB,
  export_snapshot JSONB,
  user_confirmed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_exports_user ON smart_account_exports(user_id);
CREATE INDEX idx_exports_status ON smart_account_exports(status);
CREATE INDEX idx_exports_pending ON smart_account_exports(status) WHERE status IN ('pending', 'processing');

CREATE TRIGGER update_smart_account_exports_updated_at
  BEFORE UPDATE ON smart_account_exports
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Custodial Wallet
-- ============================================================================

CREATE TABLE IF NOT EXISTS pending_transfers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chain_id INTEGER NOT NULL,
  token_address VARCHAR(42) NOT NULL,
  token_symbol VARCHAR(20) NOT NULL,
  amount VARCHAR(78) NOT NULL,
  to_address VARCHAR(42) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'executed', 'cancelled')),
  tx_hash VARCHAR(66),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  available_at TIMESTAMPTZ NOT NULL,
  executed_at TIMESTAMPTZ
);

CREATE INDEX idx_pending_transfers_user_id ON pending_transfers(user_id);
CREATE INDEX idx_pending_transfers_status ON pending_transfers(status);
CREATE INDEX idx_pending_transfers_available_at ON pending_transfers(available_at);

-- ============================================================================
-- Payments
-- ============================================================================

CREATE TABLE IF NOT EXISTS payment_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_payment_id VARCHAR(255) UNIQUE NOT NULL,
  amount_usd DECIMAL(10, 2) NOT NULL,
  project_id INTEGER NOT NULL,
  chain_id INTEGER NOT NULL,
  memo TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  tx_hash VARCHAR(66),
  tokens_received VARCHAR(78),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_payment_executions_user_id ON payment_executions(user_id);
CREATE INDEX idx_payment_executions_status ON payment_executions(status);
CREATE INDEX idx_payment_executions_stripe_id ON payment_executions(stripe_payment_id);

-- Pending fiat payments (7-day hold for chargeback protection)
CREATE TABLE pending_fiat_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  stripe_payment_intent_id VARCHAR(255) UNIQUE NOT NULL,
  stripe_charge_id VARCHAR(255),
  amount_usd DECIMAL(10, 2) NOT NULL,
  amount_cents INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  chain_id INTEGER NOT NULL,
  memo TEXT,
  beneficiary_address VARCHAR(42) NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settles_at TIMESTAMPTZ NOT NULL,
  risk_score INTEGER CHECK (risk_score IS NULL OR (risk_score >= 0 AND risk_score <= 100)),
  settlement_delay_days INTEGER NOT NULL DEFAULT 7 CHECK (settlement_delay_days >= 0 AND settlement_delay_days <= 120),
  status VARCHAR(30) NOT NULL DEFAULT 'pending_settlement'
    CHECK (status IN ('pending_settlement', 'settling', 'settled', 'disputed', 'refunded', 'failed')),
  settled_at TIMESTAMPTZ,
  settlement_rate_eth_usd DECIMAL(12, 4),
  settlement_amount_wei VARCHAR(78),
  settlement_tx_hash VARCHAR(66),
  tokens_received VARCHAR(78),
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  last_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pending_fiat_status ON pending_fiat_payments(status);
CREATE INDEX idx_pending_fiat_settles_at ON pending_fiat_payments(settles_at) WHERE status = 'pending_settlement';
CREATE INDEX idx_pending_fiat_user ON pending_fiat_payments(user_id);
CREATE INDEX idx_pending_fiat_project ON pending_fiat_payments(project_id, chain_id);
CREATE INDEX idx_pending_fiat_stripe ON pending_fiat_payments(stripe_payment_intent_id);
CREATE INDEX idx_pending_fiat_risk_score ON pending_fiat_payments(risk_score) WHERE risk_score IS NOT NULL;

CREATE TRIGGER update_pending_fiat_updated_at
  BEFORE UPDATE ON pending_fiat_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE fiat_payment_disputes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pending_payment_id UUID NOT NULL REFERENCES pending_fiat_payments(id),
  stripe_dispute_id VARCHAR(255) NOT NULL,
  dispute_reason VARCHAR(100),
  dispute_status VARCHAR(50),
  dispute_amount_cents INTEGER,
  resolved_at TIMESTAMPTZ,
  resolution VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_disputes_payment ON fiat_payment_disputes(pending_payment_id);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id UUID,
  tx_hash VARCHAR(66),
  chain_id INTEGER NOT NULL,
  from_address VARCHAR(42) NOT NULL,
  to_address VARCHAR(42) NOT NULL,
  token_address VARCHAR(42),
  amount VARCHAR(78) NOT NULL,
  project_id VARCHAR(20),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'confirmed', 'failed', 'cancelled')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  receipt JSONB
);

CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_session ON transactions(session_id);
CREATE INDEX idx_transactions_hash ON transactions(tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_project ON transactions(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_transactions_created ON transactions(created_at DESC);

-- ============================================================================
-- Juice System (Stored Value)
-- ============================================================================

CREATE TABLE juice_balances (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance DECIMAL(20, 2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_purchased DECIMAL(20, 2) NOT NULL DEFAULT 0,
  lifetime_spent DECIMAL(20, 2) NOT NULL DEFAULT 0,
  lifetime_cashed_out DECIMAL(20, 2) NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1000 years',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_juice_balances_updated_at
  BEFORE UPDATE ON juice_balances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE juice_purchases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_payment_intent_id VARCHAR(255) UNIQUE NOT NULL,
  stripe_charge_id VARCHAR(255),
  radar_risk_score INTEGER CHECK (radar_risk_score IS NULL OR (radar_risk_score >= 0 AND radar_risk_score <= 100)),
  radar_risk_level VARCHAR(20),
  fiat_amount DECIMAL(20, 2) NOT NULL,
  juice_amount DECIMAL(20, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'clearing', 'credited', 'disputed', 'refunded')),
  settlement_delay_days INTEGER NOT NULL DEFAULT 0 CHECK (settlement_delay_days >= 0 AND settlement_delay_days <= 120),
  clears_at TIMESTAMPTZ,
  credited_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_juice_purchases_user ON juice_purchases(user_id);
CREATE INDEX idx_juice_purchases_status ON juice_purchases(status);
CREATE INDEX idx_juice_purchases_clears ON juice_purchases(clears_at) WHERE status = 'clearing';
CREATE INDEX idx_juice_purchases_stripe ON juice_purchases(stripe_payment_intent_id);

CREATE TABLE juice_spends (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  chain_id INTEGER NOT NULL,
  beneficiary_address VARCHAR(42) NOT NULL,
  memo TEXT,
  juice_amount DECIMAL(20, 2) NOT NULL,
  crypto_amount VARCHAR(78),
  eth_usd_rate DECIMAL(12, 4),
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'executing', 'completed', 'failed', 'refunded')),
  tx_hash VARCHAR(66),
  tokens_received VARCHAR(78),
  nfts_received JSONB,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_juice_spends_user ON juice_spends(user_id);
CREATE INDEX idx_juice_spends_status ON juice_spends(status);
CREATE INDEX idx_juice_spends_pending ON juice_spends(created_at) WHERE status = 'pending';
CREATE INDEX idx_juice_spends_project ON juice_spends(project_id, chain_id);

CREATE TRIGGER update_juice_spends_updated_at
  BEFORE UPDATE ON juice_spends
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE juice_cash_outs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  destination_address VARCHAR(42) NOT NULL,
  chain_id INTEGER NOT NULL DEFAULT 1,
  juice_amount DECIMAL(20, 2) NOT NULL,
  crypto_amount VARCHAR(78),
  eth_usd_rate DECIMAL(12, 4),
  token_address VARCHAR(42),
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  available_at TIMESTAMPTZ NOT NULL,
  tx_hash VARCHAR(66),
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_juice_cash_outs_user ON juice_cash_outs(user_id);
CREATE INDEX idx_juice_cash_outs_status ON juice_cash_outs(status);
CREATE INDEX idx_juice_cash_outs_available ON juice_cash_outs(available_at) WHERE status = 'pending';

CREATE TRIGGER update_juice_cash_outs_updated_at
  BEFORE UPDATE ON juice_cash_outs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Multi-Person Chat System
-- ============================================================================

CREATE TYPE chat_member_role AS ENUM ('founder', 'admin', 'member');
CREATE TYPE juicy_rating AS ENUM ('wow', 'great', 'meh', 'bad');

CREATE TABLE IF NOT EXISTS multi_chats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  founder_address VARCHAR(42) NOT NULL,
  founder_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name VARCHAR(255),
  description TEXT,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  is_private BOOLEAN NOT NULL DEFAULT FALSE,
  ipfs_cid VARCHAR(64),
  last_archived_at TIMESTAMPTZ,
  token_gate_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  token_gate_chain_id INTEGER,
  token_gate_token_address VARCHAR(42),
  token_gate_project_id INTEGER,
  token_gate_min_balance VARCHAR(78),
  ai_balance_wei VARCHAR(78) NOT NULL DEFAULT '0',
  ai_total_spent_wei VARCHAR(78) NOT NULL DEFAULT '0',
  ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  encrypted BOOLEAN NOT NULL DEFAULT FALSE,
  encryption_version INTEGER DEFAULT 1,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  pin_order INTEGER,
  folder_id UUID,
  auto_generated_title VARCHAR(255),
  last_summarized_message_id UUID,
  total_message_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_multi_chats_founder ON multi_chats(founder_address);
CREATE INDEX idx_multi_chats_public ON multi_chats(is_public);
CREATE INDEX idx_multi_chats_private ON multi_chats(is_private);
CREATE INDEX idx_multi_chats_created_at ON multi_chats(created_at);
CREATE INDEX idx_multi_chats_pinned ON multi_chats(founder_address, is_pinned) WHERE is_pinned = TRUE;
CREATE INDEX idx_multi_chats_folder ON multi_chats(folder_id);
CREATE INDEX idx_multi_chats_ai_enabled ON multi_chats(ai_enabled);

CREATE TRIGGER update_multi_chats_updated_at
  BEFORE UPDATE ON multi_chats
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS multi_chat_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,
  member_address VARCHAR(42) NOT NULL,
  member_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  role chat_member_role NOT NULL DEFAULT 'member',
  can_invite BOOLEAN NOT NULL DEFAULT FALSE,
  can_invoke_ai BOOLEAN NOT NULL DEFAULT TRUE,
  can_manage_members BOOLEAN NOT NULL DEFAULT FALSE,
  can_send_messages BOOLEAN NOT NULL DEFAULT TRUE,
  can_pause_ai BOOLEAN NOT NULL DEFAULT FALSE,
  custom_emoji VARCHAR(10),
  display_name VARCHAR(100),
  public_key TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  UNIQUE(chat_id, member_address)
);

CREATE INDEX idx_multi_chat_members_chat_id ON multi_chat_members(chat_id);
CREATE INDEX idx_multi_chat_members_address ON multi_chat_members(member_address);
CREATE INDEX idx_multi_chat_members_active ON multi_chat_members(chat_id, is_active);
CREATE INDEX idx_multi_chat_members_permissions ON multi_chat_members(chat_id, member_address, can_send_messages, can_invite);

CREATE TABLE IF NOT EXISTS multi_chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,
  sender_address VARCHAR(42) NOT NULL,
  sender_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  is_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
  ai_cost_wei VARCHAR(78),
  ai_model VARCHAR(50),
  signature TEXT,
  reply_to_id UUID REFERENCES multi_chat_messages(id) ON DELETE SET NULL,
  ipfs_cid VARCHAR(64),
  token_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_multi_chat_messages_chat_id ON multi_chat_messages(chat_id);
CREATE INDEX idx_multi_chat_messages_sender ON multi_chat_messages(sender_address);
CREATE INDEX idx_multi_chat_messages_created_at ON multi_chat_messages(chat_id, created_at);
CREATE INDEX idx_multi_chat_messages_role ON multi_chat_messages(chat_id, role);

-- Add FK for last_summarized_message_id now that multi_chat_messages exists
ALTER TABLE multi_chats ADD CONSTRAINT fk_last_summarized_message
  FOREIGN KEY (last_summarized_message_id) REFERENCES multi_chat_messages(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS multi_chat_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,
  member_address VARCHAR(42) NOT NULL,
  encrypted_key TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE(chat_id, member_address, key_version)
);

CREATE INDEX idx_multi_chat_keys_chat_member ON multi_chat_keys(chat_id, member_address);

CREATE TABLE IF NOT EXISTS ai_billing (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('deposit', 'usage', 'refund')),
  amount_wei VARCHAR(78) NOT NULL,
  payer_address VARCHAR(42),
  tx_hash VARCHAR(66),
  project_id INTEGER,
  chain_id INTEGER,
  message_id UUID REFERENCES multi_chat_messages(id) ON DELETE SET NULL,
  model VARCHAR(50),
  tokens_used INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_billing_chat_id ON ai_billing(chat_id);
CREATE INDEX idx_ai_billing_type ON ai_billing(type);
CREATE INDEX idx_ai_billing_created_at ON ai_billing(created_at);

CREATE TABLE IF NOT EXISTS multi_chat_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,
  invited_address VARCHAR(42),
  invite_code VARCHAR(32) UNIQUE,
  created_by_address VARCHAR(42) NOT NULL,
  max_uses INTEGER,
  uses_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_multi_chat_invites_chat_id ON multi_chat_invites(chat_id);
CREATE INDEX idx_multi_chat_invites_code ON multi_chat_invites(invite_code);
CREATE INDEX idx_multi_chat_invites_address ON multi_chat_invites(invited_address);

-- Chat invites with permissions
CREATE TABLE IF NOT EXISTS chat_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL UNIQUE,
  created_by VARCHAR(255) NOT NULL,
  can_send_messages BOOLEAN NOT NULL DEFAULT TRUE,
  can_invite_others BOOLEAN NOT NULL DEFAULT FALSE,
  can_pass_on_roles BOOLEAN NOT NULL DEFAULT FALSE,
  can_invoke_ai BOOLEAN NOT NULL DEFAULT TRUE,
  can_pause_ai BOOLEAN NOT NULL DEFAULT FALSE,
  can_grant_pause_ai BOOLEAN NOT NULL DEFAULT FALSE,
  role VARCHAR(20) NOT NULL DEFAULT 'member',
  uses INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_invites_chat ON chat_invites(chat_id);
CREATE INDEX idx_chat_invites_code ON chat_invites(code);

-- Chat events
CREATE TABLE IF NOT EXISTS chat_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  actor_id VARCHAR(255),
  target_id VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_events_chat ON chat_events(chat_id);
CREATE INDEX idx_chat_events_created ON chat_events(created_at);

-- Chat folders
CREATE TABLE IF NOT EXISTS chat_folders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_address VARCHAR(42) NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL DEFAULT 'New Folder',
  parent_folder_id UUID REFERENCES chat_folders(id) ON DELETE CASCADE,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  pin_order INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_folders_user ON chat_folders(user_address);
CREATE INDEX idx_chat_folders_parent ON chat_folders(parent_folder_id);
CREATE INDEX idx_chat_folders_pinned ON chat_folders(user_address, is_pinned) WHERE is_pinned = TRUE;

CREATE TRIGGER update_chat_folders_updated_at
  BEFORE UPDATE ON chat_folders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add FK for folder_id now that chat_folders exists
ALTER TABLE multi_chats ADD CONSTRAINT fk_folder
  FOREIGN KEY (folder_id) REFERENCES chat_folders(id) ON DELETE SET NULL;

-- Chat reports
CREATE TABLE IF NOT EXISTS chat_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,
  reporter_address TEXT NOT NULL,
  reason TEXT,
  metadata JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed', 'actioned')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chat_id, reporter_address)
);

CREATE INDEX idx_chat_reports_chat_id ON chat_reports(chat_id);
CREATE INDEX idx_chat_reports_status ON chat_reports(status);
CREATE INDEX idx_chat_reports_created_at ON chat_reports(created_at DESC);

-- Juicy feedback
CREATE TABLE IF NOT EXISTS juicy_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID REFERENCES multi_chats(id) ON DELETE CASCADE,
  session_id UUID,
  user_address VARCHAR(42),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  rating juicy_rating NOT NULL,
  custom_feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(chat_id, user_address),
  UNIQUE(session_id, user_id)
);

CREATE INDEX idx_juicy_feedback_rating ON juicy_feedback(rating);
CREATE INDEX idx_juicy_feedback_created_at ON juicy_feedback(created_at);

-- ============================================================================
-- Chat Analytics (Legacy single-user)
-- ============================================================================

CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  privacy_mode VARCHAR(20) NOT NULL DEFAULT 'open_book',
  wallet_connected BOOLEAN NOT NULL DEFAULT FALSE,
  mode VARCHAR(20) NOT NULL DEFAULT 'self_custody'
    CHECK (mode IN ('self_custody', 'managed')),
  entry_point VARCHAR(255),
  outcome_completed_payment BOOLEAN DEFAULT FALSE,
  outcome_found_project BOOLEAN DEFAULT FALSE,
  outcome_connected_wallet BOOLEAN DEFAULT FALSE,
  outcome_error_encountered BOOLEAN DEFAULT FALSE,
  outcome_user_abandoned BOOLEAN DEFAULT FALSE,
  session_rating INTEGER CHECK (session_rating >= 1 AND session_rating <= 5),
  session_feedback TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX idx_chat_sessions_user_id ON chat_sessions(user_id);
CREATE INDEX idx_chat_sessions_started_at ON chat_sessions(started_at);
CREATE INDEX idx_chat_sessions_privacy_mode ON chat_sessions(privacy_mode);

-- Add FK for session_id in transactions now that chat_sessions exists
ALTER TABLE transactions ADD CONSTRAINT fk_session
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL;

-- Add FK for session_id in juicy_feedback
ALTER TABLE juicy_feedback ADD CONSTRAINT fk_session
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  tool_calls JSONB,
  feedback_helpful BOOLEAN,
  feedback_reported BOOLEAN DEFAULT FALSE,
  feedback_report_reason TEXT,
  feedback_user_correction TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX idx_chat_messages_created_at ON chat_messages(created_at);
CREATE INDEX idx_chat_messages_feedback ON chat_messages(feedback_helpful, feedback_reported);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(100) NOT NULL,
  event_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_session_id ON events(session_id);
CREATE INDEX idx_events_user_id ON events(user_id);
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_created_at ON events(created_at);

CREATE TABLE IF NOT EXISTS corrections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  original_content TEXT NOT NULL,
  user_correction TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  review_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_corrections_status ON corrections(status);
CREATE INDEX idx_corrections_created_at ON corrections(created_at);

-- ============================================================================
-- Context Management
-- ============================================================================

CREATE TABLE IF NOT EXISTS chat_transaction_state (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE UNIQUE,
  state JSONB NOT NULL DEFAULT '{}',
  schema_version INTEGER NOT NULL DEFAULT 1,
  last_updated_by_message_id UUID REFERENCES multi_chat_messages(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_transaction_state_chat ON chat_transaction_state(chat_id);

CREATE TRIGGER update_chat_transaction_state_updated_at
  BEFORE UPDATE ON chat_transaction_state
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS chat_summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,
  summary_md TEXT NOT NULL,
  covers_from_message_id UUID REFERENCES multi_chat_messages(id) ON DELETE SET NULL,
  covers_to_message_id UUID REFERENCES multi_chat_messages(id) ON DELETE SET NULL,
  covers_from_created_at TIMESTAMPTZ,
  covers_to_created_at TIMESTAMPTZ,
  message_count INTEGER NOT NULL,
  original_token_count INTEGER NOT NULL,
  summary_token_count INTEGER NOT NULL,
  compression_ratio NUMERIC(5,2) GENERATED ALWAYS AS (
    CASE WHEN summary_token_count > 0
    THEN original_token_count::NUMERIC / summary_token_count
    ELSE 0 END
  ) STORED,
  model_used VARCHAR(50),
  generation_latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_summaries_chat ON chat_summaries(chat_id, created_at DESC);
CREATE INDEX idx_chat_summaries_range ON chat_summaries(chat_id, covers_to_created_at DESC);

CREATE TABLE IF NOT EXISTS attachment_summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES multi_chat_messages(id) ON DELETE CASCADE,
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,
  attachment_index INTEGER NOT NULL,
  original_filename VARCHAR(255),
  original_mime_type VARCHAR(100),
  original_size_bytes INTEGER,
  summary_md TEXT NOT NULL,
  extracted_data JSONB,
  token_count INTEGER NOT NULL,
  model_used VARCHAR(50),
  generation_latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, attachment_index)
);

CREATE INDEX idx_attachment_summaries_chat ON attachment_summaries(chat_id, created_at DESC);
CREATE INDEX idx_attachment_summaries_message ON attachment_summaries(message_id);

CREATE TABLE IF NOT EXISTS context_usage_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,
  message_id UUID REFERENCES multi_chat_messages(id) ON DELETE SET NULL,
  total_tokens INTEGER NOT NULL,
  system_prompt_tokens INTEGER,
  transaction_state_tokens INTEGER,
  user_context_tokens INTEGER,
  summary_tokens INTEGER,
  recent_message_tokens INTEGER,
  attachment_summary_tokens INTEGER,
  recent_message_count INTEGER,
  summary_count INTEGER,
  attachment_count INTEGER,
  budget_exceeded BOOLEAN DEFAULT FALSE,
  triggered_summarization BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_context_usage_log_chat ON context_usage_log(chat_id, created_at DESC);

CREATE OR REPLACE FUNCTION cleanup_context_usage_log()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM context_usage_log
  WHERE chat_id = NEW.chat_id
  AND id NOT IN (
    SELECT id FROM context_usage_log
    WHERE chat_id = NEW.chat_id
    ORDER BY created_at DESC
    LIMIT 100
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_cleanup_context_usage_log
  AFTER INSERT ON context_usage_log
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_context_usage_log();

-- ============================================================================
-- Training System
-- ============================================================================

CREATE TABLE IF NOT EXISTS training_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  conversations_analyzed INTEGER DEFAULT 0,
  suggestions_generated INTEGER DEFAULT 0,
  few_shot_examples_created INTEGER DEFAULT 0,
  output_path TEXT,
  error_message TEXT,
  stats JSONB DEFAULT '{}'
);

CREATE INDEX idx_training_runs_status ON training_runs(status);
CREATE INDEX idx_training_runs_started_at ON training_runs(started_at);

CREATE TABLE IF NOT EXISTS applied_training_suggestions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  training_run_id UUID REFERENCES training_runs(id) ON DELETE CASCADE,
  section VARCHAR(100) NOT NULL,
  priority VARCHAR(20) NOT NULL,
  suggestion_text TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_by VARCHAR(100),
  effectiveness_score DECIMAL(3,2),
  notes TEXT
);

CREATE INDEX idx_applied_suggestions_run ON applied_training_suggestions(training_run_id);

-- ============================================================================
-- Reserves Management
-- ============================================================================

CREATE TABLE IF NOT EXISTS reserve_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chain_id INTEGER NOT NULL,
  token_address VARCHAR(42) NOT NULL,
  amount VARCHAR(78) NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('in', 'out')),
  related_payment_id UUID REFERENCES payment_executions(id),
  tx_hash VARCHAR(66),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reserve_transactions_chain_id ON reserve_transactions(chain_id);
CREATE INDEX idx_reserve_transactions_created_at ON reserve_transactions(created_at);

-- ============================================================================
-- Created Projects Tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS created_projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  project_name VARCHAR(255) NOT NULL,
  project_uri VARCHAR(255),
  project_type VARCHAR(20) NOT NULL CHECK (project_type IN ('project', 'revnet')),
  sucker_group_id VARCHAR(66),
  creation_bundle_id VARCHAR(66),
  creation_status VARCHAR(30) DEFAULT 'pending' CHECK (
    creation_status IN ('pending', 'processing', 'completed', 'partial', 'failed')
  ),
  split_operator VARCHAR(42),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_created_projects_user ON created_projects(user_id);
CREATE INDEX idx_created_projects_status ON created_projects(creation_status);
CREATE INDEX idx_created_projects_sucker_group ON created_projects(sucker_group_id);

CREATE TRIGGER update_created_projects_updated_at
  BEFORE UPDATE ON created_projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS created_project_chains (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_project_id UUID NOT NULL REFERENCES created_projects(id) ON DELETE CASCADE,
  chain_id INTEGER NOT NULL,
  project_id INTEGER,
  tx_hash VARCHAR(66),
  tx_uuid VARCHAR(66),
  status VARCHAR(20) DEFAULT 'pending' CHECK (
    status IN ('pending', 'submitted', 'confirmed', 'failed')
  ),
  error_message TEXT,
  gas_used VARCHAR(78),
  gas_price VARCHAR(78),
  sucker_address VARCHAR(42),
  sucker_tx_hash VARCHAR(66),
  sucker_status VARCHAR(20) DEFAULT 'pending' CHECK (
    sucker_status IN ('pending', 'submitted', 'confirmed', 'failed', 'skipped')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(created_project_id, chain_id)
);

CREATE INDEX idx_created_project_chains_project ON created_project_chains(created_project_id);
CREATE INDEX idx_created_project_chains_chain ON created_project_chains(chain_id);
CREATE INDEX idx_created_project_chains_project_id ON created_project_chains(project_id);
CREATE INDEX idx_created_project_chains_status ON created_project_chains(status);

CREATE TRIGGER update_created_project_chains_updated_at
  BEFORE UPDATE ON created_project_chains
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS created_revnet_stages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_project_id UUID NOT NULL REFERENCES created_projects(id) ON DELETE CASCADE,
  stage_index INTEGER NOT NULL,
  starts_at_or_after INTEGER NOT NULL,
  split_percent INTEGER NOT NULL,
  initial_issuance VARCHAR(78) NOT NULL,
  issuance_decay_frequency INTEGER NOT NULL,
  issuance_decay_percent INTEGER NOT NULL,
  cash_out_tax_rate INTEGER NOT NULL,
  extra_metadata INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(created_project_id, stage_index)
);

CREATE INDEX idx_created_revnet_stages_project ON created_revnet_stages(created_project_id);

-- ============================================================================
-- Rate Limiting
-- ============================================================================

CREATE TABLE IF NOT EXISTS rate_limits (
  identifier VARCHAR(255) PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  window_start BIGINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON rate_limits(window_start);
CREATE INDEX IF NOT EXISTS idx_rate_limits_identifier ON rate_limits(identifier varchar_pattern_ops);

-- ============================================================================
-- Views
-- ============================================================================

-- Good conversations (for fine-tuning)
CREATE VIEW training_good_conversations AS
SELECT
  cs.id as session_id,
  cs.mode,
  array_agg(
    json_build_object(
      'role', cm.role,
      'content', cm.content
    ) ORDER BY cm.created_at
  ) as messages,
  cs.outcome_completed_payment,
  cs.outcome_found_project,
  cs.session_rating
FROM chat_sessions cs
JOIN chat_messages cm ON cm.session_id = cs.id
WHERE cs.privacy_mode IN ('open_book', 'anonymous')
  AND (
    cs.session_rating >= 4
    OR cs.outcome_completed_payment = TRUE
    OR EXISTS (
      SELECT 1 FROM chat_messages m
      WHERE m.session_id = cs.id
      AND m.feedback_helpful = TRUE
    )
  )
GROUP BY cs.id;

-- Bad conversations
CREATE VIEW training_bad_conversations AS
SELECT
  cs.id as session_id,
  cs.mode,
  array_agg(
    json_build_object(
      'role', cm.role,
      'content', cm.content
    ) ORDER BY cm.created_at
  ) as messages,
  cs.outcome_error_encountered,
  cs.outcome_user_abandoned,
  cs.session_rating,
  cs.session_feedback
FROM chat_sessions cs
JOIN chat_messages cm ON cm.session_id = cs.id
WHERE cs.privacy_mode IN ('open_book', 'anonymous')
  AND (
    cs.session_rating <= 2
    OR cs.outcome_user_abandoned = TRUE
    OR cs.outcome_error_encountered = TRUE
    OR EXISTS (
      SELECT 1 FROM chat_messages m
      WHERE m.session_id = cs.id
      AND m.feedback_helpful = FALSE
    )
  )
GROUP BY cs.id;

-- Project pending balances
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

-- User pending payments
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

-- Active chats for a user
CREATE VIEW user_active_chats AS
SELECT
  mc.id,
  mc.name,
  mc.description,
  mc.is_public,
  mc.encrypted,
  mc.ai_balance_wei,
  mcm.member_address,
  mcm.role,
  mcm.can_invoke_ai,
  (
    SELECT COUNT(*)
    FROM multi_chat_members m
    WHERE m.chat_id = mc.id AND m.is_active = TRUE
  ) as member_count,
  (
    SELECT MAX(created_at)
    FROM multi_chat_messages msg
    WHERE msg.chat_id = mc.id AND msg.deleted_at IS NULL
  ) as last_message_at
FROM multi_chats mc
JOIN multi_chat_members mcm ON mcm.chat_id = mc.id
WHERE mcm.is_active = TRUE;

-- Public chats discovery
CREATE VIEW public_chats AS
SELECT
  mc.id,
  mc.name,
  mc.description,
  mc.founder_address,
  mc.token_gate_enabled,
  mc.token_gate_project_id,
  mc.created_at,
  (
    SELECT COUNT(*)
    FROM multi_chat_members m
    WHERE m.chat_id = mc.id AND m.is_active = TRUE
  ) as member_count,
  (
    SELECT COUNT(*)
    FROM multi_chat_messages msg
    WHERE msg.chat_id = mc.id AND msg.deleted_at IS NULL
  ) as message_count
FROM multi_chats mc
WHERE mc.is_public = TRUE;

-- Juice transactions
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

-- Pending Juice credits
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
