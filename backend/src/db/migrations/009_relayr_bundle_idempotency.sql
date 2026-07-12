CREATE TABLE IF NOT EXISTS relayr_bundle_operations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_key VARCHAR(200) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL
    CHECK (status IN ('creating', 'created', 'rejected', 'uncertain')),
  bundle_id VARCHAR(255),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, operation_key)
);

CREATE INDEX IF NOT EXISTS idx_relayr_bundle_operations_bundle
  ON relayr_bundle_operations (bundle_id)
  WHERE bundle_id IS NOT NULL;
