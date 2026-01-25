-- Rate limiting table for distributed, persistent rate limiting
-- Supports multiple server instances and survives restarts

CREATE TABLE IF NOT EXISTS rate_limits (
    identifier VARCHAR(255) PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 1,
    window_start BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for cleanup queries (delete expired entries)
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON rate_limits(window_start);

-- Index for lookups by identifier prefix (e.g., all 'chat:' entries)
CREATE INDEX IF NOT EXISTS idx_rate_limits_identifier ON rate_limits(identifier varchar_pattern_ops);
