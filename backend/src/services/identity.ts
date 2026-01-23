/**
 * Juicy Identity Service
 *
 * Manages unique [emoji]username identities that resolve to addresses.
 * Each address has at most one identity.
 * Emoji + username combo must be unique (case-insensitive on username).
 */

import { query, queryOne, execute } from '../db/index.ts';
import { updateUserEmoji } from './chat.ts';
import { broadcastMemberUpdate } from './websocket.ts';

// ============================================================================
// Types
// ============================================================================

export interface JuicyIdentity {
  id: string;
  address: string;
  emoji: string;
  username: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface JuicyIdentityHistory {
  id: string;
  address: string;
  emoji: string;
  username: string;
  startedAt: Date;
  endedAt: Date;
  changeType: 'created' | 'updated' | 'deleted';
}

interface DbJuicyIdentity {
  id: string;
  address: string;
  emoji: string;
  username: string;
  username_lower: string;
  created_at: Date;
  updated_at: Date;
}

interface DbJuicyIdentityHistory {
  id: string;
  address: string;
  emoji: string;
  username: string;
  started_at: Date;
  ended_at: Date;
  change_type: 'created' | 'updated' | 'deleted';
}

// ============================================================================
// Validation
// ============================================================================

// Valid username: 3-20 chars, alphanumeric + underscore, must start with letter
const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/;

// Valid fruit/juice emojis (same as FRUIT_EMOJIS in frontend)
export const VALID_EMOJIS = [
  '🍊', '🍋', '🍎', '🍇', '🍓', '🍒', '🍑', '🍉',
  '🍈', '🍍', '🥝', '🥭', '🍐', '🍌', '🧃', '🥤',
];

export function validateUsername(username: string): { valid: boolean; error?: string } {
  if (!username) {
    return { valid: false, error: 'Username is required' };
  }
  if (username.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters' };
  }
  if (username.length > 20) {
    return { valid: false, error: 'Username must be at most 20 characters' };
  }
  if (!USERNAME_REGEX.test(username)) {
    return { valid: false, error: 'Username must start with a letter and contain only letters, numbers, and underscores' };
  }
  return { valid: true };
}

export function validateEmoji(emoji: string): { valid: boolean; error?: string } {
  if (!emoji) {
    return { valid: false, error: 'Emoji is required' };
  }
  if (!VALID_EMOJIS.includes(emoji)) {
    return { valid: false, error: 'Invalid emoji. Must be a fruit or juice emoji.' };
  }
  return { valid: true };
}

// ============================================================================
// Database Operations
// ============================================================================

function dbToIdentity(db: DbJuicyIdentity): JuicyIdentity {
  return {
    id: db.id,
    address: db.address,
    emoji: db.emoji,
    username: db.username,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

function dbToHistoryEntry(db: DbJuicyIdentityHistory): JuicyIdentityHistory {
  return {
    id: db.id,
    address: db.address,
    emoji: db.emoji,
    username: db.username,
    startedAt: db.started_at,
    endedAt: db.ended_at,
    changeType: db.change_type,
  };
}

/**
 * Get identity by address
 */
export async function getIdentityByAddress(address: string): Promise<JuicyIdentity | null> {
  const db = await queryOne<DbJuicyIdentity>(
    `SELECT * FROM juicy_identities WHERE LOWER(address) = LOWER($1)`,
    [address]
  );
  return db ? dbToIdentity(db) : null;
}

/**
 * Resolve [emoji]username to address
 */
export async function resolveIdentity(emoji: string, username: string): Promise<string | null> {
  const db = await queryOne<{ address: string }>(
    `SELECT address FROM juicy_identities WHERE emoji = $1 AND username_lower = $2`,
    [emoji, username.toLowerCase()]
  );
  return db?.address ?? null;
}

/**
 * Check if an [emoji]username combo is available
 */
export async function isIdentityAvailable(emoji: string, username: string, excludeAddress?: string): Promise<boolean> {
  const params: (string | undefined)[] = [emoji, username.toLowerCase()];
  let query_str = `SELECT 1 FROM juicy_identities WHERE emoji = $1 AND username_lower = $2`;

  if (excludeAddress) {
    query_str += ` AND LOWER(address) != LOWER($3)`;
    params.push(excludeAddress);
  }

  const db = await queryOne<{ '1': number }>(query_str, params);
  return !db;
}

/**
 * Set or update identity for an address
 */
export async function setIdentity(
  address: string,
  emoji: string,
  username: string
): Promise<JuicyIdentity> {
  // Validate inputs
  const emojiValidation = validateEmoji(emoji);
  if (!emojiValidation.valid) {
    throw new Error(emojiValidation.error);
  }

  const usernameValidation = validateUsername(username);
  if (!usernameValidation.valid) {
    throw new Error(usernameValidation.error);
  }

  const usernameLower = username.toLowerCase();

  // Check availability (excluding current address for updates)
  const available = await isIdentityAvailable(emoji, username, address);
  if (!available) {
    throw new Error(`${emoji}${username} is already taken`);
  }

  // Check if this is an update (existing identity)
  const existing = await getIdentityByAddress(address);
  const isUpdate = !!existing;
  const hasChanged = existing && (existing.emoji !== emoji || existing.username.toLowerCase() !== usernameLower);

  // Record history if updating and something changed
  if (existing && hasChanged) {
    await execute(
      `INSERT INTO juicy_identity_history (address, emoji, username, started_at, ended_at, change_type)
       VALUES ($1, $2, $3, $4, NOW(), 'updated')`,
      [address, existing.emoji, existing.username, existing.createdAt]
    );
  }

  // Upsert: insert or update if address already has an identity
  const result = await queryOne<DbJuicyIdentity>(
    `INSERT INTO juicy_identities (address, emoji, username, username_lower)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (address) DO UPDATE SET
       emoji = EXCLUDED.emoji,
       username = EXCLUDED.username,
       username_lower = EXCLUDED.username_lower,
       updated_at = NOW()
     RETURNING *`,
    [address, emoji, username, usernameLower]
  );

  if (!result) {
    throw new Error('Failed to set identity');
  }

  // Sync the emoji to all chat memberships for this address
  await updateUserEmoji(address, emoji);

  // Broadcast identity update to all chats this user is in
  broadcastMemberUpdate(address, { displayName: username, customEmoji: emoji });

  return dbToIdentity(result);
}

/**
 * Delete identity for an address
 */
export async function deleteIdentity(address: string): Promise<void> {
  // Record in history before deleting
  const existing = await getIdentityByAddress(address);
  if (existing) {
    await execute(
      `INSERT INTO juicy_identity_history (address, emoji, username, started_at, ended_at, change_type)
       VALUES ($1, $2, $3, $4, NOW(), 'deleted')`,
      [address, existing.emoji, existing.username, existing.createdAt]
    );
  }

  await execute(
    `DELETE FROM juicy_identities WHERE LOWER(address) = LOWER($1)`,
    [address]
  );
}

/**
 * Get identity history for an address
 */
export async function getIdentityHistory(address: string): Promise<JuicyIdentityHistory[]> {
  const results = await query<DbJuicyIdentityHistory>(
    `SELECT * FROM juicy_identity_history
     WHERE LOWER(address) = LOWER($1)
     ORDER BY ended_at DESC`,
    [address]
  );
  return results.map(dbToHistoryEntry);
}

/**
 * Search identities by username prefix (for autocomplete)
 */
export async function searchIdentities(searchQuery: string, limit = 10): Promise<JuicyIdentity[]> {
  const results = await query<DbJuicyIdentity>(
    `SELECT * FROM juicy_identities
     WHERE username_lower LIKE $1
     ORDER BY username_lower ASC
     LIMIT $2`,
    [`${searchQuery.toLowerCase()}%`, limit]
  );
  return results.map(dbToIdentity);
}

/**
 * Get all identities (for admin/debug)
 */
export async function getAllIdentities(): Promise<JuicyIdentity[]> {
  const results = await query<DbJuicyIdentity>(
    `SELECT * FROM juicy_identities ORDER BY created_at DESC`
  );
  return results.map(dbToIdentity);
}

// ============================================================================
// Resolution Utilities
// ============================================================================

/**
 * Parse a juicy identity string like "@🍉jango" or "🍉jango"
 * Returns { emoji, username } or null if invalid format
 */
export function parseIdentityString(input: string): { emoji: string; username: string } | null {
  // Remove @ prefix if present
  const cleaned = input.startsWith('@') ? input.slice(1) : input;

  if (!cleaned) return null;

  // Try to match emoji at start
  for (const emoji of VALID_EMOJIS) {
    if (cleaned.startsWith(emoji)) {
      const username = cleaned.slice(emoji.length);
      if (username && validateUsername(username).valid) {
        return { emoji, username };
      }
    }
  }

  return null;
}

/**
 * Format an identity for display
 */
export function formatIdentity(emoji: string, username: string): string {
  return `${emoji}${username}`;
}

/**
 * Format an identity for use in text (with @ prefix)
 */
export function formatIdentityMention(emoji: string, username: string): string {
  return `@${emoji}${username}`;
}

/**
 * Find all identity mentions in a text string
 * Returns array of { match, emoji, username, start, end }
 */
export function findIdentityMentions(text: string): Array<{
  match: string;
  emoji: string;
  username: string;
  start: number;
  end: number;
}> {
  const mentions: Array<{
    match: string;
    emoji: string;
    username: string;
    start: number;
    end: number;
  }> = [];

  // Build regex pattern for all valid emojis
  const emojiPattern = VALID_EMOJIS.map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pattern = new RegExp(`@(${emojiPattern})([a-zA-Z][a-zA-Z0-9_]{2,19})`, 'g');

  let match;
  while ((match = pattern.exec(text)) !== null) {
    mentions.push({
      match: match[0],
      emoji: match[1],
      username: match[2],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return mentions;
}

/**
 * Resolve all identity mentions in a text to addresses
 * Returns a map of mention -> address (or null if not found)
 */
export async function resolveAllMentions(text: string): Promise<Map<string, string | null>> {
  const mentions = findIdentityMentions(text);
  const results = new Map<string, string | null>();

  for (const mention of mentions) {
    if (!results.has(mention.match)) {
      const address = await resolveIdentity(mention.emoji, mention.username);
      results.set(mention.match, address);
    }
  }

  return results;
}
