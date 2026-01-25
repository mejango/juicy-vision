/**
 * Juice API Routes
 *
 * Endpoints for the Juice stored-value system.
 * All endpoints require authentication.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import Stripe from 'npm:stripe';
import { requireAuth } from '../middleware/auth.ts';
import { getConfig, validateConfigForStripe } from '../utils/config.ts';
import {
  getBalance,
  spendJuice,
  initiateCashOut,
  cancelCashOut,
  getTransactions,
  getUserPurchases,
  getUserSpends,
  getUserCashOuts,
} from '../services/juice.ts';
import { rateLimitByUser } from '../services/rateLimit.ts';

export const juiceRouter = new Hono();

// ============================================================================
// Balance
// ============================================================================

// GET /api/juice/balance - Get current Juice balance
juiceRouter.get('/balance', requireAuth, async (c) => {
  const user = c.get('user');

  try {
    const balance = await getBalance(user.id);

    return c.json({
      success: true,
      data: {
        balance: balance.balance,
        lifetimePurchased: balance.lifetimePurchased,
        lifetimeSpent: balance.lifetimeSpent,
        lifetimeCashedOut: balance.lifetimeCashedOut,
        expiresAt: balance.expiresAt.toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get balance';
    return c.json({ success: false, error: message }, 500);
  }
});

// ============================================================================
// Purchases
// ============================================================================

// POST /api/juice/purchase - Create Stripe PaymentIntent for Juice purchase
const PurchaseSchema = z.object({
  amount: z.number().min(1).max(10000), // $1 - $10,000
});

juiceRouter.post(
  '/purchase',
  requireAuth,
  rateLimitByUser('juicePurchase'),
  zValidator('json', PurchaseSchema),
  async (c) => {
    const user = c.get('user');
    const { amount } = c.req.valid('json');
    const config = getConfig();

    try {
      validateConfigForStripe(config);
    } catch {
      return c.json({ success: false, error: 'Payments not configured' }, 503);
    }

    try {
      const stripe = new Stripe(config.stripeSecretKey);

      // Create PaymentIntent with Juice-specific metadata
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: 'usd',
        metadata: {
          type: 'juice_purchase',
          userId: user.id,
          juiceAmount: amount.toString(),
        },
        // Request Radar risk assessment
        payment_method_options: {
          card: {
            request_extended_authorization: 'if_available',
          },
        },
      });

      return c.json({
        success: true,
        data: {
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id,
          amount,
        },
      });
    } catch (error) {
      console.error('Failed to create payment intent:', error);
      const message = error instanceof Error ? error.message : 'Payment creation failed';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// GET /api/juice/purchases - Get user's purchase history
juiceRouter.get('/purchases', requireAuth, async (c) => {
  const user = c.get('user');

  try {
    const purchases = await getUserPurchases(user.id);

    return c.json({
      success: true,
      data: purchases.map(p => ({
        id: p.id,
        amount: p.juiceAmount,
        status: p.status,
        clearsAt: p.clearsAt?.toISOString() || null,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get purchases';
    return c.json({ success: false, error: message }, 500);
  }
});

// ============================================================================
// Spends
// ============================================================================

// Supported chains for Juice operations
const SUPPORTED_CHAINS = [1, 10, 42161, 8453] as const;

// POST /api/juice/spend - Spend Juice on a Juicebox project
const SpendSchema = z.object({
  amount: z.number().min(1).max(50000), // Max $50k single spend
  projectId: z.number().int().positive(),
  chainId: z.number().int().refine(
    (val): val is (typeof SUPPORTED_CHAINS)[number] =>
      SUPPORTED_CHAINS.includes(val as (typeof SUPPORTED_CHAINS)[number]),
    { message: 'Unsupported chain. Supported: mainnet (1), optimism (10), arbitrum (42161), base (8453)' }
  ),
  beneficiaryAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  memo: z.string().max(500).optional(),
});

juiceRouter.post(
  '/spend',
  requireAuth,
  rateLimitByUser('juiceSpend'),
  zValidator('json', SpendSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    try {
      const spendId = await spendJuice({
        userId: user.id,
        amount: body.amount,
        projectId: body.projectId,
        chainId: body.chainId,
        beneficiaryAddress: body.beneficiaryAddress,
        memo: body.memo,
      });

      return c.json({
        success: true,
        data: {
          spendId,
          amount: body.amount,
          projectId: body.projectId,
          chainId: body.chainId,
          status: 'pending',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Spend failed';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// GET /api/juice/spends - Get user's spend history
juiceRouter.get('/spends', requireAuth, async (c) => {
  const user = c.get('user');

  try {
    const spends = await getUserSpends(user.id);

    return c.json({
      success: true,
      data: spends.map(s => ({
        id: s.id,
        amount: s.juiceAmount,
        projectId: s.projectId,
        chainId: s.chainId,
        status: s.status,
        txHash: s.txHash,
        tokensReceived: s.tokensReceived,
        createdAt: s.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get spends';
    return c.json({ success: false, error: message }, 500);
  }
});

// ============================================================================
// Cash Outs
// ============================================================================

// POST /api/juice/cash-out - Initiate crypto cash out
const CashOutSchema = z.object({
  amount: z.number().min(1).max(10000), // Max $10k single cash out
  destinationAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.number().int().refine(
    (val): val is (typeof SUPPORTED_CHAINS)[number] =>
      SUPPORTED_CHAINS.includes(val as (typeof SUPPORTED_CHAINS)[number]),
    { message: 'Unsupported chain. Supported: mainnet (1), optimism (10), arbitrum (42161), base (8453)' }
  ).optional(),
});

juiceRouter.post(
  '/cash-out',
  requireAuth,
  rateLimitByUser('juiceCashOut'),
  zValidator('json', CashOutSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    try {
      const cashOutId = await initiateCashOut({
        userId: user.id,
        amount: body.amount,
        destinationAddress: body.destinationAddress,
        chainId: body.chainId,
      });

      // Get the created cash out for response
      const cashOuts = await getUserCashOuts(user.id);
      const cashOut = cashOuts.find(c => c.id === cashOutId);

      return c.json({
        success: true,
        data: {
          cashOutId,
          amount: body.amount,
          destinationAddress: body.destinationAddress,
          chainId: body.chainId || 1,
          status: 'pending',
          availableAt: cashOut?.availableAt.toISOString(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cash out failed';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// DELETE /api/juice/cash-out/:id - Cancel a pending cash out
juiceRouter.delete('/cash-out/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const cashOutId = c.req.param('id');

  try {
    await cancelCashOut(cashOutId, user.id);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cancel failed';
    return c.json({ success: false, error: message }, 400);
  }
});

// GET /api/juice/cash-outs - Get user's cash out history
juiceRouter.get('/cash-outs', requireAuth, async (c) => {
  const user = c.get('user');

  try {
    const cashOuts = await getUserCashOuts(user.id);

    return c.json({
      success: true,
      data: cashOuts.map(co => ({
        id: co.id,
        amount: co.juiceAmount,
        destinationAddress: co.destinationAddress,
        chainId: co.chainId,
        status: co.status,
        availableAt: co.availableAt.toISOString(),
        txHash: co.txHash,
        createdAt: co.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get cash outs';
    return c.json({ success: false, error: message }, 500);
  }
});

// ============================================================================
// Transactions
// ============================================================================

// GET /api/juice/transactions - Get all Juice transactions
const TransactionsQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

juiceRouter.get('/transactions', requireAuth, async (c) => {
  const user = c.get('user');
  const query = TransactionsQuerySchema.parse({
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
  });

  try {
    const transactions = await getTransactions(
      user.id,
      query.limit || 50,
      query.offset || 0
    );

    return c.json({
      success: true,
      data: transactions.map(t => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        status: t.status,
        projectId: t.projectId,
        chainId: t.chainId,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get transactions';
    return c.json({ success: false, error: message }, 500);
  }
});
