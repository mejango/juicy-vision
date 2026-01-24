-- Passkey Wallet Mappings
-- Maps WebAuthn credential IDs to derived wallet addresses for PRF-based wallets
-- This allows:
-- 1. Same credential always maps to same wallet (deterministic)
-- 2. Multiple credentials can be linked to the same primary wallet
-- 3. Cross-device support: new device can be linked to existing wallet

CREATE TABLE IF NOT EXISTS passkey_wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- The WebAuthn credential identifier (base64url encoded)
  credential_id VARCHAR(512) UNIQUE NOT NULL,

  -- The derived wallet address from PRF
  wallet_address VARCHAR(42) NOT NULL,

  -- Optional: link to a primary wallet (for multi-device scenarios)
  -- If set, this credential should use primary_wallet_address instead of wallet_address
  primary_wallet_address VARCHAR(42),

  -- Device info for user management
  device_name VARCHAR(100),
  device_type VARCHAR(50), -- 'platform', 'cross-platform', etc.

  -- Link to wallet_sessions for the associated SIWE session
  wallet_session_id UUID REFERENCES wallet_sessions(id) ON DELETE SET NULL,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX idx_passkey_wallets_credential ON passkey_wallets(credential_id);
CREATE INDEX idx_passkey_wallets_address ON passkey_wallets(wallet_address);
CREATE INDEX idx_passkey_wallets_primary ON passkey_wallets(primary_wallet_address);
