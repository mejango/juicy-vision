-- Juicy Identity System
-- Unique identities in format username[emoji] (e.g., jango🍉)
-- Each address has one identity, emoji+username combo must be unique

CREATE TABLE IF NOT EXISTS juicy_identities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- The address this identity belongs to
  address VARCHAR(42) NOT NULL UNIQUE,

  -- Identity components
  emoji VARCHAR(10) NOT NULL,
  username VARCHAR(20) NOT NULL,
  username_lower VARCHAR(20) NOT NULL,  -- for case-insensitive uniqueness

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Emoji + lowercase username must be unique
  UNIQUE(emoji, username_lower)
);

-- History of identity changes for each address
CREATE TABLE IF NOT EXISTS juicy_identity_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  address VARCHAR(42) NOT NULL,

  -- What the identity was
  emoji VARCHAR(10) NOT NULL,
  username VARCHAR(20) NOT NULL,

  -- When this identity was active
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Why it changed
  change_type VARCHAR(20) NOT NULL CHECK (change_type IN ('created', 'updated', 'deleted'))
);

-- Index for fast resolution lookups
CREATE INDEX idx_juicy_identities_lookup ON juicy_identities(emoji, username_lower);
CREATE INDEX idx_juicy_identities_address ON juicy_identities(address);

-- Index for history lookups
CREATE INDEX idx_juicy_identity_history_address ON juicy_identity_history(address);
CREATE INDEX idx_juicy_identity_history_ended_at ON juicy_identity_history(ended_at DESC);

-- Trigger to update updated_at
CREATE TRIGGER update_juicy_identities_updated_at
  BEFORE UPDATE ON juicy_identities
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE juicy_identities IS 'Unique juicy identities in format [emoji]username that resolve to addresses';
COMMENT ON COLUMN juicy_identities.emoji IS 'The fruit/juice emoji (e.g., 🍉, 🍑, 🧃)';
COMMENT ON COLUMN juicy_identities.username IS 'Display username (preserves case)';
COMMENT ON COLUMN juicy_identities.username_lower IS 'Lowercase username for case-insensitive uniqueness';
COMMENT ON TABLE juicy_identity_history IS 'History of identity changes - tracks all past identities for each address';
