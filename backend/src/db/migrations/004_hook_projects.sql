-- Migration: Hook Projects and Forge Jobs
-- Enables hook development, compilation, testing, and deployment tracking

-- ============================================================================
-- Hook Projects Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS hook_projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_address VARCHAR(42) NOT NULL,
  name VARCHAR(255) NOT NULL,
  project_type VARCHAR(50) NOT NULL, -- 'pay-hook', 'cash-out-hook', 'split-hook'
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_deployed BOOLEAN DEFAULT FALSE,
  deployed_addresses JSONB DEFAULT '{}', -- { chainId: address, ... }
  CONSTRAINT valid_project_type CHECK (project_type IN ('pay-hook', 'cash-out-hook', 'split-hook'))
);

CREATE INDEX IF NOT EXISTS idx_hook_projects_user_address ON hook_projects(user_address);
CREATE INDEX IF NOT EXISTS idx_hook_projects_created_at ON hook_projects(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hook_projects_is_deployed ON hook_projects(is_deployed);

COMMENT ON TABLE hook_projects IS 'Custom Juicebox hook development projects';
COMMENT ON COLUMN hook_projects.user_address IS 'Wallet address of the project owner';
COMMENT ON COLUMN hook_projects.project_type IS 'Type of hook: pay-hook, cash-out-hook, or split-hook';
COMMENT ON COLUMN hook_projects.deployed_addresses IS 'JSON map of chainId to deployed contract address';

-- ============================================================================
-- Hook Project Files Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS hook_project_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES hook_projects(id) ON DELETE CASCADE,
  path VARCHAR(255) NOT NULL, -- e.g., "src/MyHook.sol", "test/MyHook.t.sol"
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, path)
);

CREATE INDEX IF NOT EXISTS idx_hook_project_files_project_id ON hook_project_files(project_id);

COMMENT ON TABLE hook_project_files IS 'Source files belonging to hook projects';
COMMENT ON COLUMN hook_project_files.path IS 'File path within the project (e.g., src/MyHook.sol)';

-- ============================================================================
-- Forge Jobs Queue
-- ============================================================================

CREATE TABLE IF NOT EXISTS forge_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES hook_projects(id) ON DELETE SET NULL,
  user_address VARCHAR(42) NOT NULL,
  job_type VARCHAR(20) NOT NULL, -- 'compile', 'test', 'script'
  input_hash VARCHAR(64) NOT NULL, -- SHA-256 of input for deduplication
  input_data JSONB NOT NULL, -- Files, config, fork settings, etc.
  status VARCHAR(20) NOT NULL DEFAULT 'queued', -- 'queued', 'running', 'completed', 'failed', 'timeout'
  result_data JSONB, -- Compilation output, test results, errors
  output_log TEXT, -- Full console output for streaming
  docker_container_id VARCHAR(64), -- For tracking/cleanup
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 minutes',
  CONSTRAINT valid_job_type CHECK (job_type IN ('compile', 'test', 'script')),
  CONSTRAINT valid_status CHECK (status IN ('queued', 'running', 'completed', 'failed', 'timeout'))
);

CREATE INDEX IF NOT EXISTS idx_forge_jobs_user_address ON forge_jobs(user_address);
CREATE INDEX IF NOT EXISTS idx_forge_jobs_status ON forge_jobs(status);
CREATE INDEX IF NOT EXISTS idx_forge_jobs_project_id ON forge_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_forge_jobs_expires_at ON forge_jobs(expires_at);
CREATE INDEX IF NOT EXISTS idx_forge_jobs_input_hash ON forge_jobs(input_hash);

COMMENT ON TABLE forge_jobs IS 'Queue for Forge compilation and test jobs';
COMMENT ON COLUMN forge_jobs.input_hash IS 'SHA-256 hash of input for result caching';
COMMENT ON COLUMN forge_jobs.input_data IS 'Job configuration including files and fork settings';
COMMENT ON COLUMN forge_jobs.expires_at IS 'When this job record should be cleaned up';

-- ============================================================================
-- Security Analysis Results
-- ============================================================================

CREATE TABLE IF NOT EXISTS security_analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES hook_projects(id) ON DELETE CASCADE,
  tool VARCHAR(50) NOT NULL, -- 'semgrep', 'slither', 'custom'
  findings JSONB NOT NULL DEFAULT '[]', -- Array of security findings
  summary JSONB, -- { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_analyses_project_id ON security_analyses(project_id);
CREATE INDEX IF NOT EXISTS idx_security_analyses_created_at ON security_analyses(created_at DESC);

COMMENT ON TABLE security_analyses IS 'Security analysis results for hook projects';
COMMENT ON COLUMN security_analyses.findings IS 'Array of security findings with severity, message, and location';

-- ============================================================================
-- Triggers for updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_hook_project_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER hook_projects_updated_at
  BEFORE UPDATE ON hook_projects
  FOR EACH ROW
  EXECUTE FUNCTION update_hook_project_timestamp();

CREATE OR REPLACE TRIGGER hook_project_files_updated_at
  BEFORE UPDATE ON hook_project_files
  FOR EACH ROW
  EXECUTE FUNCTION update_hook_project_timestamp();
