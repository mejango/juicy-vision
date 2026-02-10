-- Migration: Intent Embeddings for Semantic Routing
-- Purpose: Enable semantic intent detection using vector similarity
--
-- NOTE: This migration gracefully handles the case where pgvector is not available.
-- If pgvector is not installed, semantic routing will be disabled at runtime.

-- Try to create the extension (will silently fail if not available)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pgvector extension not available - skipping intent_embeddings table creation';
END $$;

-- Only create the table and indexes if vector extension was successfully created
DO $$
BEGIN
  -- Check if vector type exists
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
    RAISE NOTICE 'Skipping intent_embeddings - pgvector not available';
    RETURN;
  END IF;

  -- Create the table using EXECUTE to handle the vector type
  EXECUTE '
    CREATE TABLE IF NOT EXISTS intent_embeddings (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      domain VARCHAR(50) NOT NULL,
      sub_module VARCHAR(100),
      description TEXT NOT NULL,
      example_queries TEXT[] NOT NULL DEFAULT ''{}'',
      embedding vector(1024) NOT NULL,
      token_cost INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (domain, sub_module)
    )
  ';

  -- Create indexes
  EXECUTE '
    CREATE INDEX IF NOT EXISTS idx_intent_embeddings_vector
      ON intent_embeddings USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 10)
  ';

  CREATE INDEX IF NOT EXISTS idx_intent_embeddings_domain
    ON intent_embeddings (domain);

  CREATE INDEX IF NOT EXISTS idx_intent_embeddings_sub_module
    ON intent_embeddings (sub_module)
    WHERE sub_module IS NOT NULL;

  RAISE NOTICE 'intent_embeddings table created successfully';
END $$;

-- Create the trigger function (this is safe even without pgvector)
CREATE OR REPLACE FUNCTION update_intent_embeddings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only create trigger if table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'intent_embeddings') THEN
    DROP TRIGGER IF EXISTS trigger_intent_embeddings_updated_at ON intent_embeddings;
    CREATE TRIGGER trigger_intent_embeddings_updated_at
      BEFORE UPDATE ON intent_embeddings
      FOR EACH ROW
      EXECUTE FUNCTION update_intent_embeddings_updated_at();

    COMMENT ON TABLE intent_embeddings IS 'Stores vector embeddings for semantic intent detection and routing';
    COMMENT ON COLUMN intent_embeddings.domain IS 'High-level domain: dataQuery, hookDeveloper, transaction';
    COMMENT ON COLUMN intent_embeddings.sub_module IS 'Granular sub-module within a domain, NULL for domain-level';
    COMMENT ON COLUMN intent_embeddings.embedding IS 'Claude embedding vector (1024 dimensions)';
    COMMENT ON COLUMN intent_embeddings.token_cost IS 'Estimated tokens if this module is loaded';
  END IF;
END $$;
