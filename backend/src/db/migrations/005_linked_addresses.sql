-- Migration: Linked Addresses for Account Merging
-- Allows multiple addresses to share a single JuicyID
-- When a user has both Touch ID (smart account) and connected wallet,
-- they can link them to share the same identity.

-- ============================================================================
-- Linked Addresses Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS linked_addresses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- The primary address that owns the JuicyID
  primary_address VARCHAR(42) NOT NULL,

  -- The secondary address that inherits the primary's JuicyID
  linked_address VARCHAR(42) NOT NULL UNIQUE,

  -- Type of link for analytics/display purposes
  link_type VARCHAR(20) NOT NULL DEFAULT 'manual'
    CHECK (link_type IN ('manual', 'smart_account', 'passkey', 'wallet')),

  -- Optional: user_id if linked through managed auth
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent self-links
  CONSTRAINT no_self_link CHECK (LOWER(primary_address) != LOWER(linked_address)),

  -- Ensure primary_address has an identity (enforced at application level, not FK)
  -- because the identity might be created after the link

  -- Each linked_address can only be linked to one primary
  CONSTRAINT unique_linked_address UNIQUE (linked_address)
);

-- Indexes for fast lookups
CREATE INDEX idx_linked_addresses_primary ON linked_addresses(LOWER(primary_address));
CREATE INDEX idx_linked_addresses_linked ON linked_addresses(LOWER(linked_address));
CREATE INDEX idx_linked_addresses_user ON linked_addresses(user_id) WHERE user_id IS NOT NULL;

-- ============================================================================
-- Linked Address History (Audit Trail)
-- ============================================================================

CREATE TABLE IF NOT EXISTS linked_address_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  primary_address VARCHAR(42) NOT NULL,
  linked_address VARCHAR(42) NOT NULL,
  link_type VARCHAR(20) NOT NULL,
  action VARCHAR(20) NOT NULL CHECK (action IN ('linked', 'unlinked')),
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  performed_by_address VARCHAR(42) -- Who initiated the action
);

CREATE INDEX idx_linked_address_history_primary ON linked_address_history(LOWER(primary_address));
CREATE INDEX idx_linked_address_history_linked ON linked_address_history(LOWER(linked_address));
CREATE INDEX idx_linked_address_history_time ON linked_address_history(performed_at DESC);

-- ============================================================================
-- Comments for Documentation
-- ============================================================================

COMMENT ON TABLE linked_addresses IS
'Links secondary addresses to a primary address for shared JuicyID.
When looking up an identity, if the address has a link, use the primary address identity.';

COMMENT ON COLUMN linked_addresses.primary_address IS
'The address that owns the JuicyID. All linked addresses inherit this identity.';

COMMENT ON COLUMN linked_addresses.linked_address IS
'Secondary address that inherits the primary''s JuicyID. Can only be linked to one primary.';

COMMENT ON COLUMN linked_addresses.link_type IS
'Type of link: manual (user initiated), smart_account (ERC-4337), passkey (Touch ID derived), wallet (connected wallet)';
