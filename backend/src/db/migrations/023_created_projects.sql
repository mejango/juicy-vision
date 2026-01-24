-- Created Projects Tracking
-- Tracks projects and revnets created through juicy-vision across all chains

-- ============================================================================
-- Created Projects (Master Record)
-- One record per project/revnet creation, regardless of chain count
-- ============================================================================

CREATE TABLE IF NOT EXISTS created_projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Project identity
  project_name VARCHAR(255) NOT NULL,
  project_uri VARCHAR(255),                    -- IPFS CID for project metadata
  project_type VARCHAR(20) NOT NULL CHECK (project_type IN ('project', 'revnet')),

  -- Cross-chain linking (set after sucker deployment)
  sucker_group_id VARCHAR(66),                 -- Shared ID for linked projects

  -- Bundle tracking
  creation_bundle_id VARCHAR(66),              -- Relayr bundle ID
  creation_status VARCHAR(30) DEFAULT 'pending' CHECK (
    creation_status IN ('pending', 'processing', 'completed', 'partial', 'failed')
  ),

  -- For revnets: operator address
  split_operator VARCHAR(42),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_created_projects_user ON created_projects(user_id);
CREATE INDEX idx_created_projects_status ON created_projects(creation_status);
CREATE INDEX idx_created_projects_sucker_group ON created_projects(sucker_group_id);

-- Trigger for updated_at
CREATE TRIGGER update_created_projects_updated_at
  BEFORE UPDATE ON created_projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE created_projects IS
  'Master record for projects/revnets created through juicy-vision. One per creation action, links to per-chain records.';

-- ============================================================================
-- Created Project Chains
-- Per-chain records for each project creation
-- ============================================================================

CREATE TABLE IF NOT EXISTS created_project_chains (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_project_id UUID NOT NULL REFERENCES created_projects(id) ON DELETE CASCADE,

  -- Chain and project identity
  chain_id INTEGER NOT NULL,
  project_id INTEGER,                          -- Set after confirmation (null during pending)

  -- Transaction tracking
  tx_hash VARCHAR(66),
  tx_uuid VARCHAR(66),                         -- Relayr transaction UUID within bundle
  status VARCHAR(20) DEFAULT 'pending' CHECK (
    status IN ('pending', 'submitted', 'confirmed', 'failed')
  ),
  error_message TEXT,

  -- Gas tracking
  gas_used VARCHAR(78),
  gas_price VARCHAR(78),

  -- Sucker deployment (post-creation)
  sucker_address VARCHAR(42),
  sucker_tx_hash VARCHAR(66),
  sucker_status VARCHAR(20) DEFAULT 'pending' CHECK (
    sucker_status IN ('pending', 'submitted', 'confirmed', 'failed', 'skipped')
  ),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One record per chain per creation
  UNIQUE(created_project_id, chain_id)
);

CREATE INDEX idx_created_project_chains_project ON created_project_chains(created_project_id);
CREATE INDEX idx_created_project_chains_chain ON created_project_chains(chain_id);
CREATE INDEX idx_created_project_chains_project_id ON created_project_chains(project_id);
CREATE INDEX idx_created_project_chains_status ON created_project_chains(status);

-- Trigger for updated_at
CREATE TRIGGER update_created_project_chains_updated_at
  BEFORE UPDATE ON created_project_chains
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE created_project_chains IS
  'Per-chain records for project creation. Tracks transaction status and project IDs per chain.';

-- ============================================================================
-- Revnet Stage Configurations (for revnets only)
-- Store the stage configuration used at creation time
-- ============================================================================

CREATE TABLE IF NOT EXISTS created_revnet_stages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_project_id UUID NOT NULL REFERENCES created_projects(id) ON DELETE CASCADE,

  -- Stage order (0-indexed)
  stage_index INTEGER NOT NULL,

  -- Stage configuration
  starts_at_or_after INTEGER NOT NULL,         -- Unix timestamp
  split_percent INTEGER NOT NULL,              -- 0-1000000000 (to operator)
  initial_issuance VARCHAR(78) NOT NULL,       -- Tokens per unit
  issuance_decay_frequency INTEGER NOT NULL,   -- Seconds between decay
  issuance_decay_percent INTEGER NOT NULL,     -- 0-1000000000
  cash_out_tax_rate INTEGER NOT NULL,          -- 0-10000
  extra_metadata INTEGER DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One record per stage per project
  UNIQUE(created_project_id, stage_index)
);

CREATE INDEX idx_created_revnet_stages_project ON created_revnet_stages(created_project_id);

COMMENT ON TABLE created_revnet_stages IS
  'Stage configurations for revnet deployments. Preserves the exact config used at creation.';
