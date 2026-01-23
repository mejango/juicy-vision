-- Add custom emoji column to multi_chat_members
-- Allows users to pick their own fruit/icon that appears in chats

ALTER TABLE multi_chat_members
ADD COLUMN custom_emoji VARCHAR(10);

-- Add display name column if not exists (for user-chosen display names)
ALTER TABLE multi_chat_members
ADD COLUMN IF NOT EXISTS display_name VARCHAR(100);

COMMENT ON COLUMN multi_chat_members.custom_emoji IS 'User-selected emoji/icon (e.g., 🍊, 🍉) - synced across all their chats';
