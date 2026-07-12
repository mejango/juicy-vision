import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  createTransaction,
  getTransactionById,
  getTransactionsBySession,
  getTransactionsByUser,
  updateTransaction,
} from '../services/transactions.ts';
import { optionalAuth, requireAuth } from '../middleware/auth.ts';

const transactionsRouter = new Hono();

// =============================================================================
// Validation Schemas
// =============================================================================

const CreateTransactionSchema = z.object({
  chainId: z.number().int().positive(),
  fromAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  toAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address').optional(),
  amount: z.string().max(78).regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/, 'Invalid amount'),
  projectId: z.string().regex(/^[1-9]\d{0,19}$/, 'Invalid project ID').optional(),
});

const SESSION_ID_PATTERN = /^ses_[a-z0-9]+_[a-f0-9]{12}$/i;

function requestSessionId(c: Parameters<typeof optionalAuth>[0]): string | undefined {
  const sessionId = c.req.header('X-Session-ID');
  return sessionId && SESSION_ID_PATTERN.test(sessionId) ? sessionId : undefined;
}

function canAccessTransaction(
  transaction: { userId: string | null; sessionId: string | null },
  userId: string | undefined,
  sessionId: string | undefined,
): boolean {
  // Authenticated records are user-owned even if legacy rows also carry a
  // session ID. Anonymous session ownership applies only to userless rows.
  if (transaction.userId) return transaction.userId === userId;
  return !!sessionId && transaction.sessionId === sessionId;
}

function boundedLimit(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '50', 10);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(1, parsed)) : 50;
}

const UpdateTransactionSchema = z.object({
  status: z.enum(['pending', 'submitted', 'confirmed', 'failed', 'cancelled']).optional(),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash').optional(),
  errorMessage: z.string().max(500).optional(),
  receipt: z.object({
    blockNumber: z.number().int().nonnegative(),
    blockHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid block hash'),
    gasUsed: z.string().regex(/^\d{1,78}$/, 'Invalid gas used'),
    effectiveGasPrice: z.string().regex(/^\d{1,78}$/, 'Invalid gas price'),
    status: z.enum(['success', 'reverted']),
  }).optional(),
});

// =============================================================================
// Routes
// =============================================================================

// POST /transactions - Create a new transaction record
transactionsRouter.post(
  '/',
  optionalAuth,
  zValidator('json', CreateTransactionSchema),
  async (c) => {
    const data = c.req.valid('json');
    const user = c.get('user');
    const sessionId = requestSessionId(c);
    if (!user && !sessionId) {
      return c.json(
        { success: false, error: 'Authentication or a valid session is required' },
        401,
      );
    }

    try {
      const transaction = await createTransaction({
        userId: user?.id,
        sessionId: user ? undefined : sessionId,
        chainId: data.chainId,
        fromAddress: data.fromAddress,
        toAddress: data.toAddress,
        tokenAddress: data.tokenAddress,
        amount: data.amount,
        projectId: data.projectId,
      });

      return c.json({
        success: true,
        data: transaction,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create transaction';
      return c.json({ success: false, error: message }, 400);
    }
  },
);

// PATCH /transactions/:id - Update transaction status/hash/receipt
transactionsRouter.patch(
  '/:id',
  optionalAuth,
  zValidator('json', UpdateTransactionSchema),
  async (c) => {
    const id = c.req.param('id');
    if (!z.string().uuid().safeParse(id).success) {
      return c.json({ success: false, error: 'Invalid transaction ID' }, 400);
    }
    const data = c.req.valid('json');
    const user = c.get('user');
    const sessionId = requestSessionId(c);

    try {
      // First check if transaction exists
      const existing = await getTransactionById(id);
      if (!existing) {
        return c.json({ success: false, error: 'Transaction not found' }, 404);
      }
      if (!canAccessTransaction(existing, user?.id, sessionId)) {
        return c.json({ success: false, error: 'Transaction access denied' }, 403);
      }

      const transaction = await updateTransaction(id, {
        status: data.status,
        txHash: data.txHash,
        errorMessage: data.errorMessage,
        receipt: data.receipt,
      });

      return c.json({
        success: true,
        data: transaction,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update transaction';
      return c.json({ success: false, error: message }, 400);
    }
  },
);

// GET /transactions/:id - Get a specific transaction
transactionsRouter.get(
  '/:id',
  optionalAuth,
  async (c) => {
    const id = c.req.param('id');
    if (!z.string().uuid().safeParse(id).success) {
      return c.json({ success: false, error: 'Invalid transaction ID' }, 400);
    }
    const user = c.get('user');
    const sessionId = requestSessionId(c);

    try {
      const transaction = await getTransactionById(id);
      if (!transaction) {
        return c.json({ success: false, error: 'Transaction not found' }, 404);
      }
      if (!canAccessTransaction(transaction, user?.id, sessionId)) {
        return c.json({ success: false, error: 'Transaction access denied' }, 403);
      }

      return c.json({
        success: true,
        data: transaction,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get transaction';
      return c.json({ success: false, error: message }, 400);
    }
  },
);

// GET /transactions/session/:sessionId - Get transactions for a session
transactionsRouter.get(
  '/session/:sessionId',
  optionalAuth,
  async (c) => {
    const sessionId = c.req.param('sessionId');
    const requesterSessionId = requestSessionId(c);
    if (!requesterSessionId || requesterSessionId !== sessionId) {
      return c.json({ success: false, error: 'Session access denied' }, 403);
    }
    const limit = boundedLimit(c.req.query('limit'));

    try {
      const transactions = await getTransactionsBySession(sessionId, limit);

      return c.json({
        success: true,
        data: transactions,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get transactions';
      return c.json({ success: false, error: message }, 400);
    }
  },
);

// GET /transactions - Get authenticated user's transactions
transactionsRouter.get(
  '/',
  requireAuth,
  async (c) => {
    const user = c.get('user');
    const limit = boundedLimit(c.req.query('limit'));
    const parsedOffset = Number.parseInt(c.req.query('offset') || '0', 10);
    const offset = Number.isFinite(parsedOffset) ? Math.min(10_000, Math.max(0, parsedOffset)) : 0;

    try {
      const transactions = await getTransactionsByUser(user.id, limit, offset);

      return c.json({
        success: true,
        data: transactions,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get transactions';
      return c.json({ success: false, error: message }, 400);
    }
  },
);

export { transactionsRouter };
