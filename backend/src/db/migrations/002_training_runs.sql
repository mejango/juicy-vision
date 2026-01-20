-- Training runs tracking
-- Records each training pipeline execution

CREATE TABLE IF NOT EXISTS training_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),

  -- Metrics
  conversations_analyzed INTEGER DEFAULT 0,
  suggestions_generated INTEGER DEFAULT 0,
  few_shot_examples_created INTEGER DEFAULT 0,

  -- Output
  output_path TEXT,

  -- Error tracking
  error_message TEXT,

  -- Summary stats at time of run
  stats JSONB DEFAULT '{}'
);

CREATE INDEX idx_training_runs_status ON training_runs(status);
CREATE INDEX idx_training_runs_started_at ON training_runs(started_at);

-- Training suggestions that were approved and applied
CREATE TABLE IF NOT EXISTS applied_training_suggestions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  training_run_id UUID REFERENCES training_runs(id) ON DELETE CASCADE,

  section VARCHAR(100) NOT NULL,
  priority VARCHAR(20) NOT NULL,
  suggestion_text TEXT NOT NULL,

  -- Tracking
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_by VARCHAR(100), -- GitHub username or 'automated'

  -- Effectiveness tracking
  effectiveness_score DECIMAL(3,2), -- 0.00 to 1.00
  notes TEXT
);

CREATE INDEX idx_applied_suggestions_run ON applied_training_suggestions(training_run_id);
