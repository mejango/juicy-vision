-- Migration: Project Conversations
-- Enables direct messaging between project owners and supporters

-- Project conversations link supporters to projects via a chat
-- One conversation per (project, supporter) pair
CREATE TABLE IF NOT EXISTS project_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The underlying chat for this conversation
  chat_id UUID NOT NULL REFERENCES multi_chats(id) ON DELETE CASCADE,

  -- Project identification (matches Juicebox on-chain data)
  project_id INTEGER NOT NULL,
  chain_id INTEGER NOT NULL,

  -- The supporter's address (payer)
  supporter_address VARCHAR(42) NOT NULL,

  -- Project owner address (cached for quick lookups)
  owner_address VARCHAR(42) NOT NULL,

  -- Cached payment stats (updated periodically or on payment events)
  total_paid_wei VARCHAR(78) DEFAULT '0',
  payment_count INTEGER DEFAULT 0,
  last_payment_at TIMESTAMPTZ,

  -- Conversation state
  is_archived_by_owner BOOLEAN DEFAULT FALSE,
  is_archived_by_supporter BOOLEAN DEFAULT FALSE,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- One conversation per project+supporter
  UNIQUE(project_id, chain_id, supporter_address)
);

-- Index for project owners: find all conversations for their projects
CREATE INDEX idx_project_conversations_owner
  ON project_conversations(owner_address, updated_at DESC);

-- Index for supporters: find all their project conversations
CREATE INDEX idx_project_conversations_supporter
  ON project_conversations(supporter_address, updated_at DESC);

-- Index for project lookup
CREATE INDEX idx_project_conversations_project
  ON project_conversations(project_id, chain_id, updated_at DESC);

-- Index for unarchived conversations (most common query)
CREATE INDEX idx_project_conversations_owner_active
  ON project_conversations(owner_address, is_archived_by_owner, updated_at DESC)
  WHERE is_archived_by_owner = FALSE;

CREATE INDEX idx_project_conversations_supporter_active
  ON project_conversations(supporter_address, is_archived_by_supporter, updated_at DESC)
  WHERE is_archived_by_supporter = FALSE;

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_project_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER project_conversations_updated_at
  BEFORE UPDATE ON project_conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_project_conversation_timestamp();

-- Also update project_conversation when the underlying chat gets a new message
CREATE OR REPLACE FUNCTION sync_project_conversation_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE project_conversations
  SET updated_at = NOW()
  WHERE chat_id = NEW.chat_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_conversations_message_sync
  AFTER INSERT ON multi_chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION sync_project_conversation_on_message();

-- Comments for documentation
COMMENT ON TABLE project_conversations IS 'Links Juicebox project supporters to project owners via chat conversations';
COMMENT ON COLUMN project_conversations.chat_id IS 'Reference to the multi_chats table for actual messaging';
COMMENT ON COLUMN project_conversations.project_id IS 'Juicebox project ID (on-chain)';
COMMENT ON COLUMN project_conversations.chain_id IS 'Chain ID where the project exists';
COMMENT ON COLUMN project_conversations.supporter_address IS 'Wallet address of the supporter who paid the project';
COMMENT ON COLUMN project_conversations.owner_address IS 'Wallet address of the project owner (cached)';
COMMENT ON COLUMN project_conversations.total_paid_wei IS 'Total amount paid by supporter (cached, in wei)';
