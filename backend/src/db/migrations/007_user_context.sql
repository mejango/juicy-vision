-- User Context for Personalization
-- Tracks user preferences, jargon familiarity, and observations

CREATE TABLE IF NOT EXISTS user_contexts (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  wallet_address VARCHAR(42),

  -- The generated context markdown
  context_md TEXT NOT NULL,

  -- Communication style
  jargon_level VARCHAR(20) NOT NULL DEFAULT 'beginner'
    CHECK (jargon_level IN ('beginner', 'intermediate', 'advanced')),

  -- Terms the user has used/understood
  familiar_terms TEXT[] DEFAULT '{}',

  -- Structured observations (timestamped, with confidence)
  observations JSONB DEFAULT '[]',

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_contexts_wallet ON user_contexts(wallet_address);
CREATE INDEX idx_user_contexts_jargon ON user_contexts(jargon_level);

-- Trigger for updated_at
CREATE TRIGGER update_user_contexts_updated_at
  BEFORE UPDATE ON user_contexts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
