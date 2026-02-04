-- Add attachments column to multi_chat_messages
-- Stores IPFS-pinned attachment metadata as JSONB: [{type, name, mimeType, cid}]
ALTER TABLE public.multi_chat_messages ADD COLUMN attachments JSONB DEFAULT NULL;
