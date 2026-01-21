-- Passkey/WebAuthn Credentials
-- Enables biometric and hardware key authentication

CREATE TABLE IF NOT EXISTS passkey_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- User association (can be null for anonymous passkey-only users)
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,

  -- WebAuthn credential data
  credential_id BYTEA UNIQUE NOT NULL,  -- Raw credential ID
  credential_id_b64 VARCHAR(512) NOT NULL, -- Base64URL encoded for lookup
  public_key BYTEA NOT NULL,  -- COSE public key
  counter BIGINT NOT NULL DEFAULT 0,  -- Signature counter for replay protection

  -- Credential metadata
  device_type VARCHAR(50), -- 'platform' (biometric) or 'cross-platform' (security key)
  transports TEXT[], -- ['internal', 'usb', 'nfc', 'ble']
  backup_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  backup_state BOOLEAN NOT NULL DEFAULT FALSE,

  -- Friendly name for user management
  display_name VARCHAR(100),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,

  -- For anonymous users who only use passkey
  CONSTRAINT passkey_has_user CHECK (user_id IS NOT NULL)
);

CREATE INDEX idx_passkey_credentials_user_id ON passkey_credentials(user_id);
CREATE INDEX idx_passkey_credentials_cred_id ON passkey_credentials(credential_id_b64);

-- WebAuthn challenges (short-lived, for registration and authentication)
CREATE TABLE IF NOT EXISTS passkey_challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenge BYTEA UNIQUE NOT NULL,
  challenge_b64 VARCHAR(128) NOT NULL, -- Base64URL for client

  -- What this challenge is for
  type VARCHAR(20) NOT NULL CHECK (type IN ('registration', 'authentication')),

  -- For registration: which user is registering
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,

  -- For authentication: optional user hint
  email VARCHAR(255),

  -- Expiry (challenges should be short-lived)
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_passkey_challenges_challenge ON passkey_challenges(challenge_b64);
CREATE INDEX idx_passkey_challenges_expires ON passkey_challenges(expires_at);

-- Add passkey_enabled flag to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS passkey_enabled BOOLEAN NOT NULL DEFAULT FALSE;
