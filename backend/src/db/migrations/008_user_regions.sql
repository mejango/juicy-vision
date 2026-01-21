-- User Regions Table for Analytics
-- Tracks user visits with their geographic location and language preferences

CREATE TABLE IF NOT EXISTS user_regions (
  id SERIAL PRIMARY KEY,
  ip_hash VARCHAR(32) NOT NULL,
  country_code VARCHAR(3) NOT NULL,
  country VARCHAR(100) NOT NULL,
  region VARCHAR(100),
  city VARCHAR(100),
  suggested_language VARCHAR(10) NOT NULL,
  language_used VARCHAR(10) NOT NULL,
  user_id UUID REFERENCES users(id),
  visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for analytics queries
CREATE INDEX idx_user_regions_country ON user_regions(country_code);
CREATE INDEX idx_user_regions_language ON user_regions(language_used);
CREATE INDEX idx_user_regions_visited ON user_regions(visited_at);
CREATE INDEX idx_user_regions_user ON user_regions(user_id) WHERE user_id IS NOT NULL;
