import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.ts';
import { query, queryOne } from '../db/index.ts';
import { processSingleSpend } from '../services/juice.ts';
import {
  getEscalationQueue,
  getEscalation,
  resolveEscalation,
  getEscalationStats,
} from '../services/escalation.ts';

const adminRouter = new Hono();

// Apply auth middleware to all admin routes
// TODO: Re-enable requireAdmin after testing
adminRouter.use('*', requireAuth);

// ============================================================================
// GET /admin/analytics/dau - Daily Active Users for last 90 days
// ============================================================================

const DauQuerySchema = z.object({
  includeAnonymous: z.coerce.boolean().default(false),
});

interface DauRow {
  date: Date;
  dau: number;
}

adminRouter.get('/analytics/dau', zValidator('query', DauQuerySchema), async (c) => {
  const { includeAnonymous } = c.req.valid('query');

  try {
    const rows = await query<DauRow>(`
      SELECT
        DATE(created_at) as date,
        COUNT(DISTINCT COALESCE(user_id::text, id::text))::int as dau
      FROM sessions
      WHERE created_at >= NOW() - INTERVAL '90 days'
        ${includeAnonymous ? '' : 'AND user_id IS NOT NULL'}
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);

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
// GET /admin/analytics/metrics - High-level success metrics
// ============================================================================

interface MetricRow {
  value: number;
}

interface ConversionRow {
  total_users: number;
  with_passkey: number;
}

adminRouter.get('/analytics/metrics', async (c) => {
  try {
    // Messages sent today
    const messagesResult = await queryOne<MetricRow>(`
      SELECT COUNT(*)::int as value
      FROM multi_chat_messages
      WHERE created_at >= CURRENT_DATE
        AND deleted_at IS NULL
    `);

    // AI responses today
    const aiResponsesResult = await queryOne<MetricRow>(`
      SELECT COUNT(*)::int as value
      FROM multi_chat_messages
      WHERE created_at >= CURRENT_DATE
        AND deleted_at IS NULL
        AND role = 'assistant'
    `);

    // Chats created today
    const chatsCreatedResult = await queryOne<MetricRow>(`
      SELECT COUNT(*)::int as value
      FROM multi_chats
      WHERE created_at >= CURRENT_DATE
    `);

    // Chats created this week
    const chatsWeekResult = await queryOne<MetricRow>(`
      SELECT COUNT(*)::int as value
      FROM multi_chats
      WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
    `);

    // Unique visitors today (distinct addresses that created chats)
    // This includes both anonymous session users and registered users
    const newUsersResult = await queryOne<MetricRow>(`
      SELECT COUNT(DISTINCT founder_address)::int as value
      FROM multi_chats
      WHERE created_at >= CURRENT_DATE
    `);

    // Unique visitors this week
    const newUsersWeekResult = await queryOne<MetricRow>(`
      SELECT COUNT(DISTINCT founder_address)::int as value
      FROM multi_chats
      WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
    `);

    // Returning users (users with sessions on 2+ different days in last 7 days)
    const returningUsersResult = await queryOne<MetricRow>(`
      SELECT COUNT(*)::int as value
      FROM (
        SELECT user_id
        FROM sessions
        WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
          AND user_id IS NOT NULL
        GROUP BY user_id
        HAVING COUNT(DISTINCT DATE(created_at)) >= 2
      ) returning_users
    `);

    // Conversion rate: users who have passkeys (signed up) vs total users
    const conversionResult = await queryOne<ConversionRow>(`
      SELECT
        COUNT(*)::int as total_users,
        COUNT(CASE WHEN EXISTS (
          SELECT 1 FROM passkey_credentials pc WHERE pc.user_id = u.id
        ) THEN 1 END)::int as with_passkey
      FROM users u
      WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    `);

    // Average messages per chat (last 7 days)
    const avgMessagesResult = await queryOne<{ value: number }>(`
      SELECT COALESCE(AVG(msg_count), 0)::numeric(10,1) as value
      FROM (
        SELECT chat_id, COUNT(*) as msg_count
        FROM multi_chat_messages
        WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
          AND deleted_at IS NULL
        GROUP BY chat_id
      ) chat_messages
    `);

    // Total active chats (with activity in last 24h)
    const activeChatsResult = await queryOne<MetricRow>(`
      SELECT COUNT(DISTINCT chat_id)::int as value
      FROM multi_chat_messages
      WHERE created_at >= NOW() - INTERVAL '24 hours'
        AND deleted_at IS NULL
    `);

    return c.json({
      success: true,
      data: {
        today: {
          messages: messagesResult?.value || 0,
          aiResponses: aiResponsesResult?.value || 0,
          chatsCreated: chatsCreatedResult?.value || 0,
          newUsers: newUsersResult?.value || 0,
        },
        week: {
          chatsCreated: chatsWeekResult?.value || 0,
          newUsers: newUsersWeekResult?.value || 0,
          returningUsers: returningUsersResult?.value || 0,
        },
        engagement: {
          avgMessagesPerChat: Number(avgMessagesResult?.value || 0),
          activeChats24h: activeChatsResult?.value || 0,
          passkeyConversionRate: conversionResult?.total_users
            ? Math.round((conversionResult.with_passkey / conversionResult.total_users) * 100)
            : 0,
        },
      },
    });
  } catch (error) {
    console.error('[Admin] Metrics query error:', error);
    return c.json({ success: false, error: 'Failed to fetch metrics' }, 500);
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

// ============================================================================
// GET /admin/juice/pending-spends - Paginated pending juice spends
// ============================================================================

const PendingSpendsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['pending', 'executing', 'completed', 'failed', 'refunded']).optional(),
});

interface SpendRow {
  id: string;
  user_id: string;
  user_email: string | null;
  project_id: number;
  chain_id: number;
  beneficiary_address: string;
  memo: string | null;
  juice_amount: string;
  crypto_amount: string | null;
  eth_usd_rate: string | null;
  status: string;
  tx_hash: string | null;
  tokens_received: string | null;
  error_message: string | null;
  retry_count: number;
  last_retry_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface SpendCountRow {
  count: number;
}

adminRouter.get('/juice/pending-spends', zValidator('query', PendingSpendsQuerySchema), async (c) => {
  const { page, limit, status } = c.req.valid('query');
  const offset = (page - 1) * limit;

  try {
    // Default to pending if no status filter
    const statusFilter = status || 'pending';

    // Get total count
    const countResult = await queryOne<SpendCountRow>(`
      SELECT COUNT(*)::int as count
      FROM juice_spends
      WHERE status = $1
    `, [statusFilter]);
    const total = countResult?.count || 0;

    // Get paginated spends with user info
    const rows = await query<SpendRow>(`
      SELECT
        js.id, js.user_id, u.email as user_email,
        js.project_id, js.chain_id, js.beneficiary_address, js.memo,
        js.juice_amount, js.crypto_amount, js.eth_usd_rate,
        js.status, js.tx_hash, js.tokens_received, js.error_message,
        js.retry_count, js.last_retry_at, js.created_at, js.updated_at
      FROM juice_spends js
      LEFT JOIN users u ON u.id = js.user_id
      WHERE js.status = $1
      ORDER BY js.created_at DESC
      LIMIT $2 OFFSET $3
    `, [statusFilter, limit, offset]);

    const spends = rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      userEmail: row.user_email,
      projectId: row.project_id,
      chainId: row.chain_id,
      beneficiaryAddress: row.beneficiary_address,
      memo: row.memo,
      juiceAmount: parseFloat(row.juice_amount),
      cryptoAmount: row.crypto_amount,
      ethUsdRate: row.eth_usd_rate ? parseFloat(row.eth_usd_rate) : null,
      status: row.status,
      txHash: row.tx_hash,
      tokensReceived: row.tokens_received,
      errorMessage: row.error_message,
      retryCount: row.retry_count,
      lastRetryAt: row.last_retry_at instanceof Date ? row.last_retry_at.toISOString() : row.last_retry_at,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    }));

    return c.json({
      success: true,
      data: {
        spends,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error('[Admin] Pending spends query error:', error);
    return c.json({ success: false, error: 'Failed to fetch pending spends' }, 500);
  }
});

// ============================================================================
// POST /admin/juice/spends/:id/process - Process a single spend on-chain
// ============================================================================

adminRouter.post('/juice/spends/:id/process', async (c) => {
  const spendId = c.req.param('id');

  try {
    const result = await processSingleSpend(spendId);

    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[Admin] Process spend error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to process spend';
    return c.json({ success: false, error: errorMessage }, 500);
  }
});

// ============================================================================
// GET /admin/juice/stats - Dashboard stats for juice system
// ============================================================================

interface JuiceStatsRow {
  pending_count: number;
  pending_total_usd: string;
  executing_count: number;
  today_completed_count: number;
  today_completed_usd: string;
  week_completed_count: number;
  week_completed_usd: string;
  failed_count: number;
}

adminRouter.get('/juice/stats', async (c) => {
  try {
    const stats = await queryOne<JuiceStatsRow>(`
      SELECT
        (SELECT COUNT(*)::int FROM juice_spends WHERE status = 'pending') as pending_count,
        (SELECT COALESCE(SUM(juice_amount), 0) FROM juice_spends WHERE status = 'pending') as pending_total_usd,
        (SELECT COUNT(*)::int FROM juice_spends WHERE status = 'executing') as executing_count,
        (SELECT COUNT(*)::int FROM juice_spends WHERE status = 'completed' AND created_at >= CURRENT_DATE) as today_completed_count,
        (SELECT COALESCE(SUM(juice_amount), 0) FROM juice_spends WHERE status = 'completed' AND created_at >= CURRENT_DATE) as today_completed_usd,
        (SELECT COUNT(*)::int FROM juice_spends WHERE status = 'completed' AND created_at >= CURRENT_DATE - INTERVAL '7 days') as week_completed_count,
        (SELECT COALESCE(SUM(juice_amount), 0) FROM juice_spends WHERE status = 'completed' AND created_at >= CURRENT_DATE - INTERVAL '7 days') as week_completed_usd,
        (SELECT COUNT(*)::int FROM juice_spends WHERE status = 'failed') as failed_count
    `);

    return c.json({
      success: true,
      data: {
        pending: {
          count: stats?.pending_count || 0,
          totalUsd: parseFloat(stats?.pending_total_usd || '0'),
        },
        executing: {
          count: stats?.executing_count || 0,
        },
        today: {
          completedCount: stats?.today_completed_count || 0,
          completedUsd: parseFloat(stats?.today_completed_usd || '0'),
        },
        week: {
          completedCount: stats?.week_completed_count || 0,
          completedUsd: parseFloat(stats?.week_completed_usd || '0'),
        },
        failed: {
          count: stats?.failed_count || 0,
        },
      },
    });
  } catch (error) {
    console.error('[Admin] Juice stats query error:', error);
    return c.json({ success: false, error: 'Failed to fetch juice stats' }, 500);
  }
});

// ============================================================================
// AI Escalations
// ============================================================================

const EscalationsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'corrected']).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

adminRouter.get('/escalations', zValidator('query', EscalationsQuerySchema), async (c) => {
  try {
    const params = c.req.valid('query');
    const result = await getEscalationQueue(params);

    return c.json({
      success: true,
      data: result.escalations,
      total: result.total,
    });
  } catch (error) {
    console.error('[Admin] Escalations query error:', error);
    return c.json({ success: false, error: 'Failed to fetch escalations' }, 500);
  }
});

adminRouter.get('/escalations/stats', async (c) => {
  try {
    const stats = await getEscalationStats();

    return c.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('[Admin] Escalation stats error:', error);
    return c.json({ success: false, error: 'Failed to fetch escalation stats' }, 500);
  }
});

adminRouter.get('/escalations/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const result = await getEscalation(id);

    if (!result.escalation) {
      return c.json({ success: false, error: 'Escalation not found' }, 404);
    }

    return c.json({
      success: true,
      data: {
        escalation: result.escalation,
        context: result.context,
      },
    });
  } catch (error) {
    console.error('[Admin] Get escalation error:', error);
    return c.json({ success: false, error: 'Failed to fetch escalation' }, 500);
  }
});

const ResolveEscalationSchema = z.object({
  status: z.enum(['approved', 'corrected']),
  adminCorrection: z.string().optional(),
  reviewNotes: z.string().optional(),
});

adminRouter.post('/escalations/:id/resolve', zValidator('json', ResolveEscalationSchema), async (c) => {
  try {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const user = c.get('user');

    const result = await resolveEscalation({
      id,
      status: body.status,
      reviewedBy: user?.address || 'admin',
      adminCorrection: body.adminCorrection,
      reviewNotes: body.reviewNotes,
    });

    if (!result) {
      return c.json({ success: false, error: 'Escalation not found' }, 404);
    }

    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[Admin] Resolve escalation error:', error);
    return c.json({ success: false, error: 'Failed to resolve escalation' }, 500);
  }
});

export { adminRouter };
