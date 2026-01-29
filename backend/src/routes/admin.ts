import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.ts';
import { query, queryOne } from '../db/index.ts';

const adminRouter = new Hono();

// Apply auth middleware to all admin routes
adminRouter.use('*', requireAuth, requireAdmin);

// ============================================================================
// GET /admin/analytics/dau - Daily Active Users for last 90 days
// ============================================================================

interface DauRow {
  date: Date;
  dau: number;
}

adminRouter.get('/analytics/dau', async (c) => {
  try {
    const rows = await query<DauRow>(`
      SELECT
        DATE(created_at) as date,
        COUNT(DISTINCT user_id)::int as dau
      FROM sessions
      WHERE created_at >= NOW() - INTERVAL '90 days'
        AND user_id IS NOT NULL
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);

    // Transform to array of { date: string, dau: number }
    const data = rows.map(row => ({
      date: row.date instanceof Date
        ? row.date.toISOString().split('T')[0]
        : String(row.date),
      dau: Number(row.dau),
    }));

    return c.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('[Admin] DAU query error:', error);
    return c.json({ success: false, error: 'Failed to fetch DAU data' }, 500);
  }
});

// ============================================================================
// GET /admin/chats - Paginated chat list
// ============================================================================

const ChatsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

interface ChatRow {
  id: string;
  name: string | null;
  founder_address: string;
  is_public: boolean;
  is_private: boolean;
  created_at: Date;
  updated_at: Date;
  message_count: number;
  member_count: number;
}

interface ChatCountRow {
  count: number;
}

adminRouter.get('/chats', zValidator('query', ChatsQuerySchema), async (c) => {
  const { page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;

  try {
    // Get total count for pagination
    const countResult = await queryOne<ChatCountRow>(`
      SELECT COUNT(*)::int as count FROM multi_chats
    `);
    const total = countResult?.count || 0;

    // Get paginated chats
    const rows = await query<ChatRow>(`
      SELECT
        mc.id, mc.name, mc.founder_address, mc.is_public, mc.is_private,
        mc.created_at, mc.updated_at,
        (SELECT COUNT(*)::int FROM multi_chat_messages WHERE chat_id = mc.id AND deleted_at IS NULL) as message_count,
        (SELECT COUNT(*)::int FROM multi_chat_members WHERE chat_id = mc.id AND is_active = TRUE) as member_count
      FROM multi_chats mc
      ORDER BY mc.updated_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const chats = rows.map(row => ({
      id: row.id,
      name: row.name,
      founderAddress: row.founder_address,
      isPublic: row.is_public,
      isPrivate: row.is_private,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
      messageCount: Number(row.message_count),
      memberCount: Number(row.member_count),
    }));

    return c.json({
      success: true,
      data: {
        chats,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error('[Admin] Chats query error:', error);
    return c.json({ success: false, error: 'Failed to fetch chats' }, 500);
  }
});

// ============================================================================
// GET /admin/chats/:chatId - Chat details with messages
// ============================================================================

const ChatMessagesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

interface ChatDetailRow {
  id: string;
  name: string | null;
  founder_address: string;
  is_public: boolean;
  is_private: boolean;
  created_at: Date;
  updated_at: Date;
}

interface MessageRow {
  id: string;
  sender_address: string | null;
  sender_user_id: string | null;
  role: string;
  content: string;
  ai_model: string | null;
  created_at: Date;
}

interface MemberRow {
  member_address: string;
  member_user_id: string | null;
  role: string;
  display_name: string | null;
  joined_at: Date;
}

interface MessageCountRow {
  count: number;
}

adminRouter.get('/chats/:chatId', zValidator('query', ChatMessagesQuerySchema), async (c) => {
  const chatId = c.req.param('chatId');
  const { page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;

  try {
    // Get chat details
    const chat = await queryOne<ChatDetailRow>(`
      SELECT id, name, founder_address, is_public, is_private, created_at, updated_at
      FROM multi_chats
      WHERE id = $1
    `, [chatId]);

    if (!chat) {
      return c.json({ success: false, error: 'Chat not found' }, 404);
    }

    // Get message count for pagination
    const countResult = await queryOne<MessageCountRow>(`
      SELECT COUNT(*)::int as count FROM multi_chat_messages WHERE chat_id = $1 AND deleted_at IS NULL
    `, [chatId]);
    const totalMessages = countResult?.count || 0;

    // Get messages
    const messages = await query<MessageRow>(`
      SELECT id, sender_address, sender_user_id, role, content, ai_model, created_at
      FROM multi_chat_messages
      WHERE chat_id = $1 AND deleted_at IS NULL
      ORDER BY created_at ASC
      LIMIT $2 OFFSET $3
    `, [chatId, limit, offset]);

    // Get members
    const members = await query<MemberRow>(`
      SELECT member_address, member_user_id, role, display_name, joined_at
      FROM multi_chat_members
      WHERE chat_id = $1 AND is_active = TRUE
    `, [chatId]);

    return c.json({
      success: true,
      data: {
        chat: {
          id: chat.id,
          name: chat.name,
          founderAddress: chat.founder_address,
          isPublic: chat.is_public,
          isPrivate: chat.is_private,
          createdAt: chat.created_at instanceof Date ? chat.created_at.toISOString() : chat.created_at,
          updatedAt: chat.updated_at instanceof Date ? chat.updated_at.toISOString() : chat.updated_at,
        },
        messages: messages.map(m => ({
          id: m.id,
          senderAddress: m.sender_address,
          senderUserId: m.sender_user_id,
          role: m.role,
          content: m.content,
          aiModel: m.ai_model,
          createdAt: m.created_at instanceof Date ? m.created_at.toISOString() : m.created_at,
        })),
        members: members.map(m => ({
          address: m.member_address,
          userId: m.member_user_id,
          role: m.role,
          displayName: m.display_name,
          joinedAt: m.joined_at instanceof Date ? m.joined_at.toISOString() : m.joined_at,
        })),
        pagination: {
          page,
          limit,
          total: totalMessages,
          totalPages: Math.ceil(totalMessages / limit),
        },
      },
    });
  } catch (error) {
    console.error('[Admin] Chat detail query error:', error);
    return c.json({ success: false, error: 'Failed to fetch chat details' }, 500);
  }
});

export { adminRouter };
