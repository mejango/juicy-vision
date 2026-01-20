import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.ts';
import {
  getCustodialAddress,
  getTokenBalance,
  getProjectTokenBalances,
  requestTransfer,
  getUserPendingTransfers,
  cancelTransfer,
  getReservesBalance,
  getReservesAddress,
  signAndBroadcast,
} from '../services/wallet.ts';

const walletRouter = new Hono();

// ============================================================================
// User Wallet Endpoints
// ============================================================================

// GET /wallet/address - Get user's custodial wallet address
walletRouter.get('/address', requireAuth, async (c) => {
  const user = c.get('user');

  if (user.custodialAddressIndex === undefined) {
    return c.json({ success: false, error: 'No custodial wallet assigned' }, 400);
  }

  const address = await getCustodialAddress(user.custodialAddressIndex);

  return c.json({
    success: true,
    data: { address },
  });
});

// GET /wallet/balances - Get all token balances
const BalancesQuerySchema = z.object({
  chainId: z.coerce.number().optional(),
});

walletRouter.get('/balances', requireAuth, async (c) => {
  const user = c.get('user');
  const query = BalancesQuerySchema.parse({
    chainId: c.req.query('chainId'),
  });

  if (user.custodialAddressIndex === undefined) {
    return c.json({ success: false, error: 'No custodial wallet assigned' }, 400);
  }

  const address = await getCustodialAddress(user.custodialAddressIndex);

  // Default to all supported chains
  const chainIds = query.chainId ? [query.chainId] : [1, 10, 8453, 42161];

  const balances = await Promise.all(
    chainIds.map(async (chainId) => {
      const projectTokens = await getProjectTokenBalances(address, chainId);
      return projectTokens;
    })
  );

  return c.json({
    success: true,
    data: {
      address,
      balances: balances.flat(),
    },
  });
});

// ============================================================================
// Transaction Execution (for managed mode users)
// ============================================================================

// POST /wallet/execute - Execute a transaction on behalf of managed user
const ExecuteTransactionSchema = z.object({
  chainId: z.number(),
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  data: z.string().regex(/^0x[a-fA-F0-9]*$/),
  value: z.string().optional().default('0'), // BigInt as string, defaults to 0
});

walletRouter.post(
  '/execute',
  requireAuth,
  zValidator('json', ExecuteTransactionSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    if (user.custodialAddressIndex === undefined) {
      return c.json({ success: false, error: 'No custodial wallet assigned' }, 400);
    }

    try {
      const txHash = await signAndBroadcast(
        user.custodialAddressIndex,
        body.chainId,
        body.to as `0x${string}`,
        body.data as `0x${string}`,
        BigInt(body.value)
      );

      return c.json({
        success: true,
        data: { txHash },
      });
    } catch (error) {
      console.error('Transaction execution failed:', error);
      const message = error instanceof Error ? error.message : 'Transaction failed';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// ============================================================================
// Transfer Endpoints (30-day hold)
// ============================================================================

// POST /wallet/transfer - Request a transfer to self-custody
const TransferRequestSchema = z.object({
  chainId: z.number(),
  tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string(), // BigInt as string
  toAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

walletRouter.post(
  '/transfer',
  requireAuth,
  zValidator('json', TransferRequestSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    if (user.custodialAddressIndex === undefined) {
      return c.json({ success: false, error: 'No custodial wallet assigned' }, 400);
    }

    try {
      const transfer = await requestTransfer(
        user.id,
        user.custodialAddressIndex,
        body.chainId,
        body.tokenAddress,
        body.amount,
        body.toAddress
      );

      return c.json({
        success: true,
        data: transfer,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transfer request failed';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// GET /wallet/transfers - Get all pending transfers
walletRouter.get('/transfers', requireAuth, async (c) => {
  const user = c.get('user');

  const transfers = await getUserPendingTransfers(user.id);

  return c.json({
    success: true,
    data: transfers,
  });
});

// DELETE /wallet/transfers/:id - Cancel a pending transfer
walletRouter.delete('/transfers/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const transferId = c.req.param('id');

  try {
    await cancelTransfer(transferId, user.id);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cancel failed';
    return c.json({ success: false, error: message }, 400);
  }
});

// ============================================================================
// Admin: Reserves Monitoring
// ============================================================================

walletRouter.get('/admin/reserves', requireAuth, async (c) => {
  // TODO: Add admin role check

  const chainIds = [1, 10, 8453, 42161];
  const address = getReservesAddress();

  const reserves = await Promise.all(
    chainIds.map(async (chainId) => {
      try {
        const { eth, usdc } = await getReservesBalance(chainId);
        return {
          chainId,
          eth: eth.toString(),
          usdc: usdc.toString(),
        };
      } catch {
        return {
          chainId,
          eth: '0',
          usdc: '0',
          error: 'Failed to fetch',
        };
      }
    })
  );

  return c.json({
    success: true,
    data: {
      address,
      reserves,
    },
  });
});

export { walletRouter };
