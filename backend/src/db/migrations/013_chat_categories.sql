-- Chat Organization: Folders and Pinning
-- Users can pin chats/folders and organize chats into nested folders

-- ============================================================================
-- Chat Folders (supports nesting)
-- ============================================================================

CREATE TABLE IF NOT EXISTS chat_folders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Owner
  user_address VARCHAR(42) NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Folder info
  name VARCHAR(255) NOT NULL DEFAULT 'New Folder',

  -- Nesting (NULL = root level)
  parent_folder_id UUID REFERENCES chat_folders(id) ON DELETE CASCADE,

  -- Pinning
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  pin_order INTEGER, -- Order among pinned items (lower = higher)

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_folders_user ON chat_folders(user_address);
CREATE INDEX idx_chat_folders_parent ON chat_folders(parent_folder_id);
CREATE INDEX idx_chat_folders_pinned ON chat_folders(user_address, is_pinned) WHERE is_pinned = TRUE;

-- ============================================================================
-- Add organization columns to multi_chats
-- ============================================================================

ALTER TABLE multi_chats
  ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN pin_order INTEGER,
  ADD COLUMN folder_id UUID REFERENCES chat_folders(id) ON DELETE SET NULL,
  ADD COLUMN auto_generated_title VARCHAR(255);

CREATE INDEX idx_multi_chats_pinned ON multi_chats(founder_address, is_pinned) WHERE is_pinned = TRUE;
CREATE INDEX idx_multi_chats_folder ON multi_chats(folder_id);

-- ============================================================================
-- Triggers
-- ============================================================================

CREATE TRIGGER update_chat_folders_updated_at
  BEFORE UPDATE ON chat_folders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
