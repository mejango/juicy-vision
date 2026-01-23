-- Chat Permissions Enhancement
-- Add can_send_messages to member table and set chats to private by default

-- 1. Add can_send_messages column to multi_chat_members
ALTER TABLE multi_chat_members
ADD COLUMN IF NOT EXISTS can_send_messages BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Change default for is_public on multi_chats to FALSE (private by default)
ALTER TABLE multi_chats
ALTER COLUMN is_public SET DEFAULT FALSE;

-- 3. Add can_pass_on_roles to chat_invites table
-- This controls whether users joining via this invite can create invites that grant invite permissions
ALTER TABLE chat_invites
ADD COLUMN IF NOT EXISTS can_pass_on_roles BOOLEAN NOT NULL DEFAULT FALSE;

-- 4. Add index for permission queries
CREATE INDEX IF NOT EXISTS idx_multi_chat_members_permissions
ON multi_chat_members(chat_id, member_address, can_send_messages, can_invite);
