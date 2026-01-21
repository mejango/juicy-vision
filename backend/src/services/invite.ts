/**
 * Chat Invite Service
 *
 * Generate shareable invite links with customizable permissions
 */

import { query, execute } from '../db/index.ts';

export interface ChatInvite {
  id: string;
  chatId: string;
  code: string;
  createdBy: string;
  canSendMessages: boolean;
  canInviteOthers: boolean;
  role: 'member' | 'admin';
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface ChatEvent {
  id: string;
  chatId: string;
  eventType: string;
  actorId: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface CreateInviteParams {
  chatId: string;
  createdBy: string;
  canSendMessages?: boolean;
  canInviteOthers?: boolean;
  role?: 'member' | 'admin';
  maxUses?: number | null;
  expiresAt?: string | null;
}

/**
 * Generate a random invite code
 */
function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Create a new invite link for a chat
 */
export async function createInvite(params: CreateInviteParams): Promise<ChatInvite> {
  const {
    chatId,
    createdBy,
    canSendMessages = true,
    canInviteOthers = false,
    role = 'member',
    maxUses = null,
    expiresAt = null,
  } = params;

  const code = generateInviteCode();

  const result = await query<{
    id: string;
    chat_id: string;
    code: string;
    created_by: string;
    can_send_messages: boolean;
    can_invite_others: boolean;
    role: string;
    uses: number;
    max_uses: number | null;
    expires_at: string | null;
    created_at: string;
  }>(
    `INSERT INTO chat_invites (
      chat_id, code, created_by, can_send_messages, can_invite_others, role, max_uses, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    [chatId, code, createdBy, canSendMessages, canInviteOthers, role, maxUses, expiresAt]
  );

  const row = result[0];
  return {
    id: row.id,
    chatId: row.chat_id,
    code: row.code,
    createdBy: row.created_by,
    canSendMessages: row.can_send_messages,
    canInviteOthers: row.can_invite_others,
    role: row.role as 'member' | 'admin',
    uses: row.uses,
    maxUses: row.max_uses,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/**
 * Get invite by code
 */
export async function getInviteByCode(code: string): Promise<ChatInvite | null> {
  const result = await query<{
    id: string;
    chat_id: string;
    code: string;
    created_by: string;
    can_send_messages: boolean;
    can_invite_others: boolean;
    role: string;
    uses: number;
    max_uses: number | null;
    expires_at: string | null;
    created_at: string;
  }>(
    `SELECT * FROM chat_invites WHERE code = $1`,
    [code]
  );

  if (result.length === 0) return null;

  const row = result[0];
  return {
    id: row.id,
    chatId: row.chat_id,
    code: row.code,
    createdBy: row.created_by,
    canSendMessages: row.can_send_messages,
    canInviteOthers: row.can_invite_others,
    role: row.role as 'member' | 'admin',
    uses: row.uses,
    maxUses: row.max_uses,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/**
 * Get all invites for a chat
 */
export async function getInvitesForChat(chatId: string): Promise<ChatInvite[]> {
  const result = await query<{
    id: string;
    chat_id: string;
    code: string;
    created_by: string;
    can_send_messages: boolean;
    can_invite_others: boolean;
    role: string;
    uses: number;
    max_uses: number | null;
    expires_at: string | null;
    created_at: string;
  }>(
    `SELECT * FROM chat_invites WHERE chat_id = $1 ORDER BY created_at DESC`,
    [chatId]
  );

  return result.map((row) => ({
    id: row.id,
    chatId: row.chat_id,
    code: row.code,
    createdBy: row.created_by,
    canSendMessages: row.can_send_messages,
    canInviteOthers: row.can_invite_others,
    role: row.role as 'member' | 'admin',
    uses: row.uses,
    maxUses: row.max_uses,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

/**
 * Check if invite is valid (not expired, not maxed out)
 */
export function isInviteValid(invite: ChatInvite): boolean {
  // Check expiry
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return false;
  }

  // Check max uses
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
    return false;
  }

  return true;
}

/**
 * Use an invite (increment uses count)
 */
export async function useInvite(inviteId: string): Promise<void> {
  await execute(
    `UPDATE chat_invites SET uses = uses + 1 WHERE id = $1`,
    [inviteId]
  );
}

/**
 * Revoke (delete) an invite
 */
export async function revokeInvite(inviteId: string): Promise<void> {
  await execute(`DELETE FROM chat_invites WHERE id = $1`, [inviteId]);
}

/**
 * Create a chat event (system message)
 */
export async function createChatEvent(
  chatId: string,
  eventType: string,
  actorId?: string,
  targetId?: string,
  metadata?: Record<string, unknown>
): Promise<ChatEvent> {
  const result = await query<{
    id: string;
    chat_id: string;
    event_type: string;
    actor_id: string | null;
    target_id: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>(
    `INSERT INTO chat_events (chat_id, event_type, actor_id, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [chatId, eventType, actorId || null, targetId || null, metadata ? JSON.stringify(metadata) : null]
  );

  const row = result[0];
  return {
    id: row.id,
    chatId: row.chat_id,
    eventType: row.event_type,
    actorId: row.actor_id,
    targetId: row.target_id,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

/**
 * Get chat events for a chat
 */
export async function getChatEvents(chatId: string, limit = 100): Promise<ChatEvent[]> {
  const result = await query<{
    id: string;
    chat_id: string;
    event_type: string;
    actor_id: string | null;
    target_id: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>(
    `SELECT * FROM chat_events WHERE chat_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [chatId, limit]
  );

  return result.map((row) => ({
    id: row.id,
    chatId: row.chat_id,
    eventType: row.event_type,
    actorId: row.actor_id,
    targetId: row.target_id,
    metadata: row.metadata,
    createdAt: row.created_at,
  }));
}
