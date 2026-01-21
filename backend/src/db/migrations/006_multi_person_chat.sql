-- Multi-Person Chat System
-- P2P collaborative chats with E2E encryption, token gating, and AI billing

-- ============================================================================
-- Multi-Person Chats
-- ============================================================================

CREATE TABLE IF NOT EXISTS multi_chats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Ownership
  founder_address VARCHAR(42) NOT NULL, -- Ethereum address (checksummed)
  founder_user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Optional link to user

  -- Metadata
  name VARCHAR(255),
  description TEXT,
  is_public BOOLEAN NOT NULL DEFAULT TRUE,

  -- IPFS Archival
  ipfs_cid VARCHAR(64), -- Latest archived CID
  last_archived_at TIMESTAMPTZ,

  -- Token Gating (optional)
  token_gate_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  token_gate_chain_id INTEGER,
  token_gate_token_address VARCHAR(42), -- Token contract or JB project token
  token_gate_project_id INTEGER, -- Juicebox project ID if applicable
  token_gate_min_balance VARCHAR(78), -- BigInt as string

  -- AI Billing
  ai_balance_wei VARCHAR(78) NOT NULL DEFAULT '0', -- Remaining balance for AI invocations
  ai_total_spent_wei VARCHAR(78) NOT NULL DEFAULT '0', -- Lifetime spend

  -- E2E Encryption
  encrypted BOOLEAN NOT NULL DEFAULT FALSE,
  encryption_version INTEGER DEFAULT 1, -- For future MLS protocol upgrades

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_multi_chats_founder ON multi_chats(founder_address);
CREATE INDEX idx_multi_chats_public ON multi_chats(is_public);
CREATE INDEX idx_multi_chats_created_at ON multi_chats(created_at);

-- ============================================================================
-- Chat Members & Permissions
-- ============================================================================

CREATE TYPE chat_member_role AS ENUM ('founder', 'admin', 'member');

CREATE TABLE IF NOT EXISTS multi_chat_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,

  -- Member identity
  member_address VARCHAR(42) NOT NULL, -- Ethereum address
  member_user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Optional link

  -- Role & Permissions
  role chat_member_role NOT NULL DEFAULT 'member',
  can_invite BOOLEAN NOT NULL DEFAULT FALSE,
  can_invoke_ai BOOLEAN NOT NULL DEFAULT TRUE,
  can_manage_members BOOLEAN NOT NULL DEFAULT FALSE, -- Kick/ban (admin+)

  -- E2E Encryption - member's public key for this chat
  public_key TEXT, -- Base64-encoded public key

  -- Status
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,

  UNIQUE(chat_id, member_address)
);

CREATE INDEX idx_multi_chat_members_chat_id ON multi_chat_members(chat_id);
CREATE INDEX idx_multi_chat_members_address ON multi_chat_members(member_address);
CREATE INDEX idx_multi_chat_members_active ON multi_chat_members(chat_id, is_active);

-- ============================================================================
-- Chat Messages
-- ============================================================================

CREATE TABLE IF NOT EXISTS multi_chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,

  -- Sender
  sender_address VARCHAR(42) NOT NULL, -- Who sent this message
  sender_user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Message content
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL, -- Plaintext or encrypted blob
  is_encrypted BOOLEAN NOT NULL DEFAULT FALSE,

  -- For AI messages - track cost
  ai_cost_wei VARCHAR(78), -- Cost of this AI response
  ai_model VARCHAR(50), -- Which model was used

  -- Message signature (for verification)
  signature TEXT, -- Signed message hash for non-managed wallets

  -- Reply threading (optional)
  reply_to_id UUID REFERENCES multi_chat_messages(id) ON DELETE SET NULL,

  -- IPFS
  ipfs_cid VARCHAR(64), -- Individual message CID if archived separately

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ -- Soft delete
);

CREATE INDEX idx_multi_chat_messages_chat_id ON multi_chat_messages(chat_id);
CREATE INDEX idx_multi_chat_messages_sender ON multi_chat_messages(sender_address);
CREATE INDEX idx_multi_chat_messages_created_at ON multi_chat_messages(chat_id, created_at);
CREATE INDEX idx_multi_chat_messages_role ON multi_chat_messages(chat_id, role);

-- ============================================================================
-- Encryption Key Management (for E2E encrypted chats)
-- ============================================================================

CREATE TABLE IF NOT EXISTS multi_chat_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,

  -- Encrypted group key (one per member)
  member_address VARCHAR(42) NOT NULL,
  encrypted_key TEXT NOT NULL, -- Group key encrypted with member's public key

  -- Key rotation
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,

  UNIQUE(chat_id, member_address, key_version)
);

CREATE INDEX idx_multi_chat_keys_chat_member ON multi_chat_keys(chat_id, member_address);

-- ============================================================================
-- AI Billing Transactions
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_billing (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,

  -- Transaction type
  type VARCHAR(20) NOT NULL CHECK (type IN ('deposit', 'usage', 'refund')),

  -- Amount
  amount_wei VARCHAR(78) NOT NULL,

  -- For deposits - payment details
  payer_address VARCHAR(42), -- Who paid
  tx_hash VARCHAR(66), -- On-chain tx if applicable
  project_id INTEGER, -- Revnet project receiving payment (e.g., NANA = 1)
  chain_id INTEGER,

  -- For usage - what was consumed
  message_id UUID REFERENCES multi_chat_messages(id) ON DELETE SET NULL,
  model VARCHAR(50),
  tokens_used INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_billing_chat_id ON ai_billing(chat_id);
CREATE INDEX idx_ai_billing_type ON ai_billing(type);
CREATE INDEX idx_ai_billing_created_at ON ai_billing(created_at);

-- ============================================================================
-- Chat Invites (for private chats)
-- ============================================================================

CREATE TABLE IF NOT EXISTS multi_chat_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,

  -- Invite details
  invited_address VARCHAR(42), -- Specific address (optional)
  invite_code VARCHAR(32) UNIQUE, -- Random code for link-based invites

  -- Who created the invite
  created_by_address VARCHAR(42) NOT NULL,

  -- Limits
  max_uses INTEGER, -- NULL = unlimited
  uses_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,

  -- Status
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_multi_chat_invites_chat_id ON multi_chat_invites(chat_id);
CREATE INDEX idx_multi_chat_invites_code ON multi_chat_invites(invite_code);
CREATE INDEX idx_multi_chat_invites_address ON multi_chat_invites(invited_address);

-- ============================================================================
-- External Wallet Sessions (SIWE)
-- ============================================================================

CREATE TABLE IF NOT EXISTS wallet_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Wallet identity
  wallet_address VARCHAR(42) NOT NULL,

  -- SIWE verification
  siwe_message TEXT NOT NULL, -- The signed message
  siwe_signature TEXT NOT NULL, -- The signature
  nonce VARCHAR(32) NOT NULL,

  -- Session token
  session_token VARCHAR(64) UNIQUE NOT NULL,

  -- Expiry
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallet_sessions_address ON wallet_sessions(wallet_address);
CREATE INDEX idx_wallet_sessions_token ON wallet_sessions(session_token);
CREATE INDEX idx_wallet_sessions_expires ON wallet_sessions(expires_at);

-- ============================================================================
-- User Keypairs (for managed wallets - E2E encryption)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_keypairs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Keypair for E2E encryption (managed by server for custodial users)
  public_key TEXT NOT NULL, -- Base64-encoded
  encrypted_private_key TEXT NOT NULL, -- Server-encrypted private key

  -- Key metadata
  algorithm VARCHAR(20) NOT NULL DEFAULT 'x25519', -- Curve25519 for key exchange
  version INTEGER NOT NULL DEFAULT 1,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_user_keypairs_user_id ON user_keypairs(user_id);
CREATE UNIQUE INDEX idx_user_keypairs_active ON user_keypairs(user_id) WHERE is_active = TRUE;

-- ============================================================================
-- Triggers
-- ============================================================================

CREATE TRIGGER update_multi_chats_updated_at
  BEFORE UPDATE ON multi_chats
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Simple Feedback ("How's Juicy working for you?")
-- ============================================================================

CREATE TYPE juicy_rating AS ENUM ('wow', 'great', 'meh', 'bad');

CREATE TABLE IF NOT EXISTS juicy_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID REFERENCES multi_chats(id) ON DELETE CASCADE,
  session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE, -- For single-user chats

  -- Who gave feedback
  user_address VARCHAR(42),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- The feedback
  rating juicy_rating NOT NULL,
  custom_feedback TEXT, -- If they want to write something

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Only one feedback per user per chat
  UNIQUE(chat_id, user_address),
  UNIQUE(session_id, user_id)
);

CREATE INDEX idx_juicy_feedback_rating ON juicy_feedback(rating);
CREATE INDEX idx_juicy_feedback_created_at ON juicy_feedback(created_at);

-- ============================================================================
-- Views
-- ============================================================================

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
