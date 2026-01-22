import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  createTransaction,
  updateTransaction,
  getTransactionById,
  getTransactionsBySession,
  getTransactionsByUser,
} from '../services/transactions.ts';
import { optionalAuth, requireAuth } from '../middleware/auth.ts';

const transactionsRouter = new Hono();

// =============================================================================
// Validation Schemas
// =============================================================================

const CreateTransactionSchema = z.object({
  sessionId: z.string().uuid().optional(),
  chainId: z.number().int().positive(),
  fromAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  toAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address').optional(),
  amount: z.string().min(1),
  projectId: z.string().optional(),
});

const UpdateTransactionSchema = z.object({
  status: z.enum(['pending', 'submitted', 'confirmed', 'failed', 'cancelled']).optional(),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash').optional(),
  errorMessage: z.string().optional(),
  receipt: z.object({
    blockNumber: z.number(),
    blockHash: z.string(),
    gasUsed: z.string(),
    effectiveGasPrice: z.string(),
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

    try {
      const transaction = await createTransaction({
        userId: user?.id,
        sessionId: data.sessionId,
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
  }
);

// PATCH /transactions/:id - Update transaction status/hash/receipt
transactionsRouter.patch(
  '/:id',
  optionalAuth,
  zValidator('json', UpdateTransactionSchema),
  async (c) => {
    const id = c.req.param('id');
    const data = c.req.valid('json');

    try {
      // First check if transaction exists
      const existing = await getTransactionById(id);
      if (!existing) {
        return c.json({ success: false, error: 'Transaction not found' }, 404);
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
  }
);

// GET /transactions/:id - Get a specific transaction
transactionsRouter.get(
  '/:id',
  optionalAuth,
  async (c) => {
    const id = c.req.param('id');

    try {
      const transaction = await getTransactionById(id);
      if (!transaction) {
        return c.json({ success: false, error: 'Transaction not found' }, 404);
      }

      return c.json({
        success: true,
        data: transaction,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get transaction';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// GET /transactions/session/:sessionId - Get transactions for a session
transactionsRouter.get(
  '/session/:sessionId',
  optionalAuth,
  async (c) => {
    const sessionId = c.req.param('sessionId');
    const limit = parseInt(c.req.query('limit') || '50');

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
  }
);

// GET /transactions - Get authenticated user's transactions
transactionsRouter.get(
  '/',
  requireAuth,
  async (c) => {
    const user = c.get('user');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

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
  }
);

export { transactionsRouter };
