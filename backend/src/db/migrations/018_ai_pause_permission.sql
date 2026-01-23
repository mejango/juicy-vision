-- AI Pause Permission
-- Adds global chat-level AI toggle and permission to control it

-- 1. Add ai_enabled to multi_chats (global setting for the chat)
ALTER TABLE multi_chats
ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Add can_pause_ai permission to members
ALTER TABLE multi_chat_members
ADD COLUMN IF NOT EXISTS can_pause_ai BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Add AI-related permissions to chat_invites
-- Controls whether users joining via this invite can use/pause AI
ALTER TABLE chat_invites
ADD COLUMN IF NOT EXISTS can_invoke_ai BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE chat_invites
ADD COLUMN IF NOT EXISTS can_pause_ai BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE chat_invites
ADD COLUMN IF NOT EXISTS can_grant_pause_ai BOOLEAN NOT NULL DEFAULT FALSE;

-- 4. Grant can_pause_ai to founders by default (run once)
UPDATE multi_chat_members
SET can_pause_ai = TRUE
WHERE role = 'founder' AND can_pause_ai = FALSE;

-- 5. Index for AI-enabled queries
CREATE INDEX IF NOT EXISTS idx_multi_chats_ai_enabled
ON multi_chats(ai_enabled);
