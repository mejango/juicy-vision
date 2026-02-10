-- Migration: Intent Embeddings for Semantic Routing
-- Purpose: Enable semantic intent detection using vector similarity
--
-- This migration sets up pgvector for storing intent embeddings,
-- allowing the system to match user queries to relevant knowledge domains
-- using semantic similarity rather than just keyword matching.

-- Enable pgvector extension (requires superuser or extension already available)
CREATE EXTENSION IF NOT EXISTS vector;

-- Intent embeddings table
-- Stores pre-computed embeddings for domains and sub-modules
CREATE TABLE IF NOT EXISTS intent_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Domain classification (dataQuery, hookDeveloper, transaction)
  domain VARCHAR(50) NOT NULL,

  -- Sub-module within domain (e.g., 'chains', 'v51_addresses', 'nft_tiers')
  -- NULL means this is a domain-level embedding
  sub_module VARCHAR(100),

  -- Human-readable description of what this intent covers
  description TEXT NOT NULL,

  -- Example queries that should match this intent
  -- Used for training and debugging
  example_queries TEXT[] NOT NULL DEFAULT '{}',

  -- The embedding vector (Claude uses 1024 dimensions)
  embedding vector(1024) NOT NULL,

  -- Estimated token cost if this module is loaded
  token_cost INTEGER NOT NULL DEFAULT 0,

  -- Priority for tie-breaking (higher = more likely to be selected)
  priority INTEGER NOT NULL DEFAULT 0,

  -- Metadata for analytics
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ensure unique domain + sub_module combinations
  UNIQUE (domain, sub_module)
);

-- Create IVFFlat index for fast approximate nearest neighbor search
-- Lists = sqrt(n) where n is expected number of vectors
-- For ~50 intents, 10 lists is reasonable
CREATE INDEX IF NOT EXISTS idx_intent_embeddings_vector
  ON intent_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);

-- Index for domain filtering
CREATE INDEX IF NOT EXISTS idx_intent_embeddings_domain
  ON intent_embeddings (domain);

-- Index for sub-module filtering
CREATE INDEX IF NOT EXISTS idx_intent_embeddings_sub_module
  ON intent_embeddings (sub_module)
  WHERE sub_module IS NOT NULL;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_intent_embeddings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS trigger_intent_embeddings_updated_at ON intent_embeddings;
CREATE TRIGGER trigger_intent_embeddings_updated_at
  BEFORE UPDATE ON intent_embeddings
  FOR EACH ROW
  EXECUTE FUNCTION update_intent_embeddings_updated_at();

-- Comments for documentation
COMMENT ON TABLE intent_embeddings IS 'Stores vector embeddings for semantic intent detection and routing';
COMMENT ON COLUMN intent_embeddings.domain IS 'High-level domain: dataQuery, hookDeveloper, transaction';
COMMENT ON COLUMN intent_embeddings.sub_module IS 'Granular sub-module within a domain, NULL for domain-level';
COMMENT ON COLUMN intent_embeddings.embedding IS 'Claude embedding vector (1024 dimensions)';
COMMENT ON COLUMN intent_embeddings.token_cost IS 'Estimated tokens if this module is loaded';
