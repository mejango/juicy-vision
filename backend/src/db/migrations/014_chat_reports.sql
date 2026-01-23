-- Chat reports table for flagging chats for review
CREATE TABLE IF NOT EXISTS chat_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,
  reporter_address TEXT NOT NULL,
  reason TEXT,
  metadata JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed', 'actioned')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX idx_chat_reports_chat_id ON chat_reports(chat_id);
CREATE INDEX idx_chat_reports_status ON chat_reports(status);
CREATE INDEX idx_chat_reports_created_at ON chat_reports(created_at DESC);

-- Prevent duplicate reports from same user on same chat (simple unique constraint)
ALTER TABLE chat_reports ADD CONSTRAINT chat_reports_unique_per_user UNIQUE (chat_id, reporter_address);
