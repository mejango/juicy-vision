/**
 * Chat Organization Service
 *
 * Handles folders, pinning, and AI-powered title generation for chats.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../utils/config.ts';
import { queryOne, query, execute } from '../db/index.ts';

// ============================================================================
// Types
// ============================================================================

export interface ChatFolder {
  id: string;
  userAddress: string;
  userId?: string;
  name: string;
  parentFolderId?: string;
  isPinned: boolean;
  pinOrder?: number;
  createdAt: Date;
  updatedAt: Date;
}

interface DbChatFolder {
  id: string;
  user_address: string;
  user_id: string | null;
  name: string;
  parent_folder_id: string | null;
  is_pinned: boolean;
  pin_order: number | null;
  created_at: Date;
  updated_at: Date;
}

function dbToFolder(db: DbChatFolder): ChatFolder {
  return {
    id: db.id,
    userAddress: db.user_address,
    userId: db.user_id ?? undefined,
    name: db.name,
    parentFolderId: db.parent_folder_id ?? undefined,
    isPinned: db.is_pinned,
    pinOrder: db.pin_order ?? undefined,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

// ============================================================================
// Claude Client (for title generation)
// ============================================================================

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const config = getConfig();
    if (!config.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }
    anthropicClient = new Anthropic({
      apiKey: config.anthropicApiKey,
    });
  }
  return anthropicClient;
}

const TITLE_GENERATION_PROMPT = `Generate a concise, descriptive title (3-6 words) for this conversation. The title should capture the main topic or purpose. Respond with ONLY the title text, no quotes or formatting.`;

// ============================================================================
// Title Generation
// ============================================================================

/**
 * Generate an AI-powered title for a chat
 */
export async function generateChatTitle(
  messages: Array<{ role: string; content: string }>
): Promise<string | null> {
  if (messages.length === 0) return null;

  const client = getAnthropicClient();

  const conversationText = messages
    .slice(0, 10) // First 10 messages for title context
    .map((m) => `[${m.role}]: ${m.content.slice(0, 300)}`)
    .join('\n\n');

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 50,
      temperature: 0.5,
      system: TITLE_GENERATION_PROMPT,
      messages: [{ role: 'user', content: conversationText }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') return null;

    // Clean and limit title
    return textBlock.text.trim().slice(0, 100);
  } catch (error) {
    console.error('Title generation failed:', error);
    return null;
  }
}

/**
 * Check if a name is generic and should be replaced with auto-generated title
 */
export function isGenericName(name: string | null | undefined): boolean {
  if (!name) return true;
  const genericPatterns = [
    /^new chat$/i,
    /^untitled$/i,
    /^chat$/i,
    /^conversation$/i,
    /^\d{4}-\d{2}-\d{2}/,  // Date-based names
    /^chat #?\d+$/i,
  ];
  return genericPatterns.some((pattern) => pattern.test(name.trim()));
}

// ============================================================================
// Folder CRUD
// ============================================================================

export async function createFolder(
  userAddress: string,
  name: string,
  parentFolderId?: string,
  userId?: string
): Promise<ChatFolder> {
  const result = await queryOne<DbChatFolder>(
    `INSERT INTO chat_folders (user_address, user_id, name, parent_folder_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userAddress, userId ?? null, name, parentFolderId ?? null]
  );
  return dbToFolder(result!);
}

export async function getFolder(folderId: string): Promise<ChatFolder | null> {
  const result = await queryOne<DbChatFolder>(
    'SELECT * FROM chat_folders WHERE id = $1',
    [folderId]
  );
  return result ? dbToFolder(result) : null;
}

export async function getFoldersForUser(userAddress: string): Promise<ChatFolder[]> {
  const results = await query<DbChatFolder>(
    'SELECT * FROM chat_folders WHERE user_address = $1 ORDER BY is_pinned DESC, pin_order ASC, name ASC',
    [userAddress]
  );
  return results.map(dbToFolder);
}

export async function updateFolder(
  folderId: string,
  updates: Partial<Pick<ChatFolder, 'name' | 'parentFolderId' | 'isPinned' | 'pinOrder'>>
): Promise<ChatFolder | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) {
    setClauses.push(`name = $${paramIndex++}`);
    values.push(updates.name);
  }
  if (updates.parentFolderId !== undefined) {
    setClauses.push(`parent_folder_id = $${paramIndex++}`);
    values.push(updates.parentFolderId || null);
  }
  if (updates.isPinned !== undefined) {
    setClauses.push(`is_pinned = $${paramIndex++}`);
    values.push(updates.isPinned);
  }
  if (updates.pinOrder !== undefined) {
    setClauses.push(`pin_order = $${paramIndex++}`);
    values.push(updates.pinOrder);
  }

  if (setClauses.length === 0) return getFolder(folderId);

  values.push(folderId);
  const result = await queryOne<DbChatFolder>(
    `UPDATE chat_folders SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );
  return result ? dbToFolder(result) : null;
}

export async function deleteFolder(folderId: string): Promise<void> {
  await execute('DELETE FROM chat_folders WHERE id = $1', [folderId]);
}

// ============================================================================
// Chat Pinning & Folder Assignment
// ============================================================================

export async function pinChat(chatId: string, pinOrder?: number): Promise<void> {
  await execute(
    'UPDATE multi_chats SET is_pinned = TRUE, pin_order = $1 WHERE id = $2',
    [pinOrder ?? null, chatId]
  );
}

export async function unpinChat(chatId: string): Promise<void> {
  await execute(
    'UPDATE multi_chats SET is_pinned = FALSE, pin_order = NULL WHERE id = $1',
    [chatId]
  );
}

export async function setChatPinOrder(chatId: string, pinOrder: number): Promise<void> {
  await execute(
    'UPDATE multi_chats SET pin_order = $1 WHERE id = $2',
    [pinOrder, chatId]
  );
}

export async function moveChatToFolder(chatId: string, folderId: string | null): Promise<void> {
  await execute(
    'UPDATE multi_chats SET folder_id = $1 WHERE id = $2',
    [folderId, chatId]
  );
}

export async function setAutoGeneratedTitle(chatId: string, title: string): Promise<void> {
  await execute(
    'UPDATE multi_chats SET auto_generated_title = $1 WHERE id = $2',
    [title, chatId]
  );
}

// ============================================================================
// Folder Pinning
// ============================================================================

export async function pinFolder(folderId: string, pinOrder?: number): Promise<void> {
  await execute(
    'UPDATE chat_folders SET is_pinned = TRUE, pin_order = $1 WHERE id = $2',
    [pinOrder ?? null, folderId]
  );
}

export async function unpinFolder(folderId: string): Promise<void> {
  await execute(
    'UPDATE chat_folders SET is_pinned = FALSE, pin_order = NULL WHERE id = $1',
    [folderId]
  );
}

export async function setFolderPinOrder(folderId: string, pinOrder: number): Promise<void> {
  await execute(
    'UPDATE chat_folders SET pin_order = $1 WHERE id = $2',
    [pinOrder, folderId]
  );
}

// ============================================================================
// Reordering helpers
// ============================================================================

/**
 * Reorder pinned items (chats or folders) for a user
 * Takes an array of IDs in the desired order
 */
export async function reorderPinnedChats(
  userAddress: string,
  chatIds: string[]
): Promise<void> {
  for (let i = 0; i < chatIds.length; i++) {
    await execute(
      'UPDATE multi_chats SET pin_order = $1 WHERE id = $2 AND founder_address = $3',
      [i, chatIds[i], userAddress]
    );
  }
}

export async function reorderPinnedFolders(
  userAddress: string,
  folderIds: string[]
): Promise<void> {
  for (let i = 0; i < folderIds.length; i++) {
    await execute(
      'UPDATE chat_folders SET pin_order = $1 WHERE id = $2 AND user_address = $3',
      [i, folderIds[i], userAddress]
    );
  }
}
