-- Add private mode for chats
-- When is_private = true, backend should not store chat data for study/improvement
-- Default is false (open) - chats can be studied to improve the product

ALTER TABLE multi_chats
ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;

-- Index for filtering private vs shareable chats
CREATE INDEX IF NOT EXISTS idx_multi_chats_private ON multi_chats(is_private);

COMMENT ON COLUMN multi_chats.is_private IS 'When true, chat data should not be stored for study/improvement. Default false allows backend to study chats.';
