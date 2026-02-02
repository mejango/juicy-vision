import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.ts';
import { rateLimitByUser } from '../services/rateLimit.ts';
import {
  getReservesBalance,
  getReservesAddress,
} from '../services/wallet.ts';
import {
  getOrCreateSmartAccount,
  getUserSmartAccounts,
  getAccountBalances,
  syncAccountBalances,
  executeTransaction,
  requestWithdrawal,
  getUserWithdrawals,
  requestExport,
  confirmExport,
  retryExport,
  cancelExport,
  getExportStatus,
  getUserExports,
  checkExportBlockers,
  requestTransfer,
  cancelTransfer,
  getUserPendingTransfers,
} from '../services/smartAccounts.ts';
import { createRelayrBundle } from '../services/relayrBundle.ts';
import type { Address } from 'viem';

const walletRouter = new Hono();

// ============================================================================
// User Wallet Endpoints (Smart Accounts)
// ============================================================================

// GET /wallet/address - Get user's smart account address
// Creates deterministic address if not exists (does not deploy contract)
walletRouter.get('/address', requireAuth, async (c) => {
  const user = c.get('user');
  const chainId = Number(c.req.query('chainId')) || 1; // Default to mainnet

  try {
    const smartAccount = await getOrCreateSmartAccount(user.id, chainId);

    return c.json({
      success: true,
      data: {
        address: smartAccount.address,
        chainId: smartAccount.chainId,
        deployed: smartAccount.deployed,
        custodyStatus: smartAccount.custodyStatus,
      },
    });
  } catch (error) {
    console.error('Failed to get smart account address:', error);
    const message = error instanceof Error ? error.message : 'Failed to get address';
    return c.json({ success: false, error: message }, 500);
  }
});

// GET /wallet/accounts - Get all user's smart accounts across chains
walletRouter.get('/accounts', requireAuth, async (c) => {
  const user = c.get('user');

  try {
    const accounts = await getUserSmartAccounts(user.id);

    return c.json({
      success: true,
      data: { accounts },
    });
  } catch (error) {
    console.error('Failed to get smart accounts:', error);
    const message = error instanceof Error ? error.message : 'Failed to get accounts';
    return c.json({ success: false, error: message }, 500);
  }
});

// GET /wallet/balances - Get smart account token balances
const BalancesQuerySchema = z.object({
  chainId: z.coerce.number().optional(),
});

walletRouter.get('/balances', requireAuth, async (c) => {
  const user = c.get('user');
  const query = BalancesQuerySchema.parse({
    chainId: c.req.query('chainId'),
  });

  // Default to all supported chains
  const chainIds = query.chainId ? [query.chainId] : [1, 10, 8453, 42161];

  // Use Promise.allSettled to handle individual chain failures gracefully
  const settledResults = await Promise.allSettled(
    chainIds.map(async (chainId) => {
      // Ensure account exists (creates if needed)
      const account = await getOrCreateSmartAccount(user.id, chainId);
      const balances = await getAccountBalances(user.id, chainId);

      return {
        chainId,
        address: account.address,
        deployed: account.deployed,
        custodyStatus: account.custodyStatus,
        balances,
      };
    })
  );

  // Extract successful results and track errors
  const results: Array<{
    chainId: number;
    address: string;
    deployed: boolean;
    custodyStatus: string;
    balances: Array<{ tokenAddress: string; tokenSymbol: string; balance: string; decimals: number }>;
  }> = [];
  const errors: Array<{ chainId: number; error: string }> = [];

  settledResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      results.push(result.value);
    } else {
      const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error(`Failed to get account for chain ${chainIds[index]}:`, result.reason);
      errors.push({ chainId: chainIds[index], error: errorMsg });
    }
  });

  // Return partial success if at least one chain succeeded
  if (results.length > 0) {
    return c.json({
      success: true,
      data: { accounts: results },
      errors: errors.length > 0 ? errors : undefined,
    });
  }

  // All chains failed
  return c.json({
    success: false,
    error: 'Failed to get balances for all chains',
    errors,
  }, 500);
});

// ============================================================================
// Transaction Execution (Gas-sponsored for managed accounts)
// ============================================================================

// POST /wallet/execute - Execute a transaction via smart account
const ExecuteTransactionSchema = z.object({
  chainId: z.number(),
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  data: z.string().regex(/^0x[a-fA-F0-9]*$/),
  value: z.string().optional().default('0'), // BigInt as string
});

walletRouter.post(
  '/execute',
  requireAuth,
  zValidator('json', ExecuteTransactionSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    try {
      const result = await executeTransaction({
        userId: user.id,
        chainId: body.chainId,
        to: body.to as Address,
        data: body.data as `0x${string}`,
        value: BigInt(body.value),
      });

      return c.json({
        success: true,
        data: {
          txHash: result.txHash,
          accountAddress: result.accountAddress,
        },
      });
    } catch (error) {
      console.error('Transaction execution failed:', error);
      const message = error instanceof Error ? error.message : 'Transaction failed';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// ============================================================================
// Signing Key Storage (for passkey wallets - gasless signing)
// ============================================================================

import { storeSigningKey, getSigningKey } from '../services/encryption.ts';

// POST /wallet/signing-key - Store the user's signing key for server-side signing
const SigningKeySchema = z.object({
  signingKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

walletRouter.post(
  '/signing-key',
  requireAuth,
  zValidator('json', SigningKeySchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    try {
      await storeSigningKey(user.id, body.signingKey);

      return c.json({
        success: true,
        data: { stored: true },
      });
    } catch (error) {
      console.error('Failed to store signing key:', error);
      const message = error instanceof Error ? error.message : 'Failed to store signing key';
      return c.json({ success: false, error: message }, 500);
    }
  }
);

// ============================================================================
// Relayr Bundle (Server-side ERC-2771 signing for omnichain deployments)
// ============================================================================

// POST /wallet/relayr-bundle - Create a Relayr bundle with server-signed transactions
const RelayrBundleSchema = z.object({
  transactions: z.array(z.object({
    chainId: z.number(),
    target: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    data: z.string().regex(/^0x[a-fA-F0-9]*$/),
    value: z.string(),
  })),
  owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

walletRouter.post(
  '/relayr-bundle',
  requireAuth,
  zValidator('json', RelayrBundleSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    try {
      const result = await createRelayrBundle({
        userId: user.id,
        transactions: body.transactions,
        owner: body.owner,
      });

      return c.json({
        success: true,
        data: {
          bundleId: result.bundleId,
        },
      });
    } catch (error) {
      console.error('Relayr bundle creation failed:', error);
      const message = error instanceof Error ? error.message : 'Bundle creation failed';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// ============================================================================
// Withdrawals (Gas-sponsored for managed accounts)
// ============================================================================

// POST /wallet/withdraw - Request a gas-sponsored withdrawal from smart account
const WithdrawSchema = z.object({
  chainId: z.number(),
  tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string(), // BigInt as string
  toAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

walletRouter.post(
  '/withdraw',
  requireAuth,
  zValidator('json', WithdrawSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    try {
      const result = await requestWithdrawal({
        userId: user.id,
        chainId: body.chainId,
        tokenAddress: body.tokenAddress as Address,
        amount: BigInt(body.amount),
        toAddress: body.toAddress as Address,
      });

      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Withdrawal failed:', error);
      const message = error instanceof Error ? error.message : 'Withdrawal failed';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// GET /wallet/withdrawals - Get user's withdrawal history
walletRouter.get('/withdrawals', requireAuth, async (c) => {
  const user = c.get('user');

  try {
    const withdrawals = await getUserWithdrawals(user.id);
    return c.json({
      success: true,
      data: { withdrawals },
    });
  } catch (error) {
    console.error('Failed to get withdrawals:', error);
    const message = error instanceof Error ? error.message : 'Failed to get withdrawals';
    return c.json({ success: false, error: message }, 500);
  }
});

// ============================================================================
// Delayed Transfers (with 7-day hold for fraud protection)
// ============================================================================

// POST /wallet/transfer - Request a transfer with hold period
const TransferRequestSchema = z.object({
  chainId: z.number(),
  tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  tokenSymbol: z.string(),
  amount: z.string(), // BigInt as string
  toAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

walletRouter.post(
  '/transfer',
  requireAuth,
  rateLimitByUser('walletExport'), // Reuse export rate limit for sensitive operations
  zValidator('json', TransferRequestSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    try {
      const transfer = await requestTransfer({
        userId: user.id,
        chainId: body.chainId,
        tokenAddress: body.tokenAddress as Address,
        tokenSymbol: body.tokenSymbol,
        amount: BigInt(body.amount),
        toAddress: body.toAddress as Address,
      });

      return c.json({
        success: true,
        data: transfer,
      });
    } catch (error) {
      console.error('Transfer request failed:', error);
      const message = error instanceof Error ? error.message : 'Transfer request failed';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// GET /wallet/transfers - Get user's pending transfers
walletRouter.get('/transfers', requireAuth, async (c) => {
  const user = c.get('user');

  try {
    const transfers = await getUserPendingTransfers(user.id);
    return c.json({
      success: true,
      data: { transfers },
    });
  } catch (error) {
    console.error('Failed to get transfers:', error);
    const message = error instanceof Error ? error.message : 'Failed to get transfers';
    return c.json({ success: false, error: message }, 500);
  }
});

// DELETE /wallet/transfer/:id - Cancel a pending transfer
walletRouter.delete('/transfer/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const transferId = c.req.param('id');

  try {
    await cancelTransfer(transferId, user.id);
    return c.json({ success: true });
  } catch (error) {
    console.error('Transfer cancel failed:', error);
    const message = error instanceof Error ? error.message : 'Transfer cancel failed';
    return c.json({ success: false, error: message }, 400);
  }
});

// ============================================================================
// Export Endpoints (Transfer custody to self-custody EOA)
// ============================================================================

// GET /wallet/export/check - Check if user can export (no pending blockers)
walletRouter.get('/export/check', requireAuth, async (c) => {
  const user = c.get('user');

  try {
    const { canExport, blockers } = await checkExportBlockers(user.id);
    return c.json({
      success: true,
      data: { canExport, blockers },
    });
  } catch (error) {
    console.error('Failed to check export blockers:', error);
    const message = error instanceof Error ? error.message : 'Failed to check export status';
    return c.json({ success: false, error: message }, 500);
  }
});

// POST /wallet/export - Request export of all managed accounts to self-custody
const ExportRequestSchema = z.object({
  newOwnerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

walletRouter.post(
  '/export',
  requireAuth,
  rateLimitByUser('walletExport'),
  zValidator('json', ExportRequestSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    try {
      const result = await requestExport(user.id, body.newOwnerAddress as Address);

      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Export request failed:', error);
      const message = error instanceof Error ? error.message : 'Export request failed';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// POST /wallet/export/:id/confirm - Confirm and execute export
walletRouter.post('/export/:id/confirm', requireAuth, rateLimitByUser('walletExportConfirm'), async (c) => {
  const user = c.get('user');
  const exportId = c.req.param('id');

  try {
    // Verify ownership
    const exportReq = await getExportStatus(exportId);
    if (!exportReq) {
      return c.json({ success: false, error: 'Export not found' }, 404);
    }
    if (exportReq.userId !== user.id) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }

    const result = await confirmExport(exportId);
    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Export confirmation failed:', error);
    const message = error instanceof Error ? error.message : 'Export confirmation failed';
    return c.json({ success: false, error: message }, 400);
  }
});

// POST /wallet/export/:id/retry - Retry failed chains in partial export
walletRouter.post('/export/:id/retry', requireAuth, rateLimitByUser('walletExportConfirm'), async (c) => {
  const user = c.get('user');
  const exportId = c.req.param('id');

  try {
    // Verify ownership
    const exportReq = await getExportStatus(exportId);
    if (!exportReq) {
      return c.json({ success: false, error: 'Export not found' }, 404);
    }
    if (exportReq.userId !== user.id) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }

    const result = await retryExport(exportId);
    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Export retry failed:', error);
    const message = error instanceof Error ? error.message : 'Export retry failed';
    return c.json({ success: false, error: message }, 400);
  }
});

// DELETE /wallet/export/:id - Cancel a pending export
walletRouter.delete('/export/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const exportId = c.req.param('id');

  try {
    // Verify ownership
    const exportReq = await getExportStatus(exportId);
    if (!exportReq) {
      return c.json({ success: false, error: 'Export not found' }, 404);
    }
    if (exportReq.userId !== user.id) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }

    await cancelExport(exportId);
    return c.json({ success: true });
  } catch (error) {
    console.error('Export cancel failed:', error);
    const message = error instanceof Error ? error.message : 'Export cancel failed';
    return c.json({ success: false, error: message }, 400);
  }
});

// GET /wallet/export/:id - Get export status
walletRouter.get('/export/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const exportId = c.req.param('id');

  try {
    const status = await getExportStatus(exportId);
    if (!status) {
      return c.json({ success: false, error: 'Export not found' }, 404);
    }
    // Verify ownership
    if (status.userId !== user.id) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }
    return c.json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error('Failed to get export status:', error);
    const message = error instanceof Error ? error.message : 'Failed to get export status';
    return c.json({ success: false, error: message }, 500);
  }
});

// GET /wallet/exports - Get user's export history
walletRouter.get('/exports', requireAuth, async (c) => {
  const user = c.get('user');

  try {
    const exports = await getUserExports(user.id);
    return c.json({
      success: true,
      data: { exports },
    });
  } catch (error) {
    console.error('Failed to get exports:', error);
    const message = error instanceof Error ? error.message : 'Failed to get exports';
    return c.json({ success: false, error: message }, 500);
  }
});

// ============================================================================
// Admin: Reserves Monitoring
// ============================================================================

walletRouter.get('/admin/reserves', requireAuth, requireAdmin, async (c) => {
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
