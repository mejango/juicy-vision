-- Chat Invites Table
-- Shareable invite links with customizable permissions

CREATE TABLE IF NOT EXISTS chat_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL UNIQUE,
  created_by VARCHAR(255) NOT NULL, -- Can be user ID or wallet address

  -- Permissions granted to users who join via this invite
  can_send_messages BOOLEAN NOT NULL DEFAULT true,
  can_invite_others BOOLEAN NOT NULL DEFAULT false,
  role VARCHAR(20) NOT NULL DEFAULT 'member', -- 'member', 'admin'

  -- Usage tracking
  uses INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER, -- NULL = unlimited

  -- No expiry by default (expires_at NULL = never expires)
  expires_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- System events table for inline chat events
CREATE TABLE IF NOT EXISTS chat_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL, -- 'invite_created', 'user_joined', 'user_left', etc.
  actor_id VARCHAR(255), -- Who triggered the event (user ID or wallet address)
  target_id VARCHAR(255), -- Who was affected (for joins, kicks, etc.)
  metadata JSONB, -- Extra data (invite code, permissions, etc.)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_chat_invites_chat ON chat_invites(chat_id);
CREATE INDEX idx_chat_invites_code ON chat_invites(code);
CREATE INDEX idx_chat_events_chat ON chat_events(chat_id);
CREATE INDEX idx_chat_events_created ON chat_events(created_at);
