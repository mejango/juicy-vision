-- Ruleset Cache Tables
-- Caches Juicebox V5 ruleset data with appropriate TTLs:
-- - Historical rulesets: Immutable, cached forever (expires_at = NULL)
-- - Current/queued rulesets: Cached with 5 minute TTL
-- - Splits: Mutable, cached with 2 minute TTL

-- ============================================================================
-- Ruleset Cache
-- ============================================================================

CREATE TABLE IF NOT EXISTS ruleset_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chain_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  ruleset_id VARCHAR(78) NOT NULL,
  cycle_number INTEGER NOT NULL,
  ruleset_data JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'historical'
    CHECK (status IN ('historical', 'current', 'queued')),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE(chain_id, project_id, ruleset_id)
);

CREATE INDEX idx_ruleset_cache_lookup ON ruleset_cache(chain_id, project_id, status);
CREATE INDEX idx_ruleset_cache_expires ON ruleset_cache(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================================================
-- Splits Cache
-- ============================================================================

CREATE TABLE IF NOT EXISTS splits_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chain_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  ruleset_id VARCHAR(78) NOT NULL,
  payout_splits JSONB NOT NULL DEFAULT '[]',
  reserved_splits JSONB NOT NULL DEFAULT '[]',
  fund_access_limits JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(chain_id, project_id, ruleset_id)
);

CREATE INDEX idx_splits_cache_lookup ON splits_cache(chain_id, project_id, ruleset_id);
CREATE INDEX idx_splits_cache_expires ON splits_cache(expires_at);

-- ============================================================================
-- Shop Data Cache (NFT tiers)
-- ============================================================================
-- NFT tier data is relatively stable - cache with 30 minute TTL
-- Tiers are fetched per-chain since different chains may have different hooks

CREATE TABLE IF NOT EXISTS shop_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chain_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  hook_address VARCHAR(42) NOT NULL,
  tiers JSONB NOT NULL DEFAULT '[]',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(chain_id, project_id)
);

CREATE INDEX idx_shop_cache_lookup ON shop_cache(chain_id, project_id);
CREATE INDEX idx_shop_cache_expires ON shop_cache(expires_at);
