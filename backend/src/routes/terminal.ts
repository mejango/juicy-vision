/**
 * Terminal API Routes
 *
 * Endpoints for managing payment terminals and payment sessions.
 * Supports both merchant auth (JWT) and terminal auth (API key).
 */

import { Hono, Context, Next } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth, optionalAuth } from '../middleware/auth.ts';
import { rateLimitByUser } from '../services/rateLimit.ts';
import {
  registerDevice,
  getDevice,
  getMerchantDevices,
  authenticateDevice,
  updateDevice,
  regenerateApiKey,
  deleteDevice,
  createSession,
  getSession,
  getSessionWithDetails,
  getDeviceSessions,
  getMerchantSessions,
  cancelSession,
  payWithJuice,
  getMerchantStats,
  getWalletPaymentParams,
  startWalletPayment,
  confirmWalletPayment,
  failWalletPayment,
  type TerminalDevice,
} from '../services/terminal.ts';
import { getOrCreateSmartAccount } from '../services/smartAccounts.ts';

export const terminalRouter = new Hono();

// ============================================================================
// Terminal Device Auth Middleware
// ============================================================================

// Extend context for terminal auth
declare module 'hono' {
  interface ContextVariableMap {
    terminalDevice?: TerminalDevice;
  }
}

// Extract API key from header
function extractApiKey(c: Context): string | null {
  const authHeader = c.req.header('X-Terminal-Key');
  return authHeader || null;
}

// Middleware that requires terminal API key auth
async function requireTerminalAuth(c: Context, next: Next) {
  const apiKey = extractApiKey(c);
  if (!apiKey) {
    return c.json({ success: false, error: 'Terminal API key required' }, 401);
  }

  const device = await authenticateDevice(apiKey);
  if (!device) {
    return c.json({ success: false, error: 'Invalid terminal API key' }, 401);
  }

  if (!device.isActive) {
    return c.json({ success: false, error: 'Terminal is deactivated' }, 403);
  }

  c.set('terminalDevice', device);
  await next();
}

// Middleware that accepts either user auth or terminal auth
async function requireUserOrTerminalAuth(c: Context, next: Next) {
  // Try terminal auth first (more specific)
  const apiKey = extractApiKey(c);
  if (apiKey) {
    const device = await authenticateDevice(apiKey);
    if (device && device.isActive) {
      c.set('terminalDevice', device);
      await next();
      return;
    }
  }

  // Fall back to user auth
  const authHeader = c.req.header('Authorization');
  if (authHeader) {
    // Let requireAuth handle it
    return requireAuth(c, next);
  }

  return c.json({ success: false, error: 'Authentication required' }, 401);
}

// ============================================================================
// Merchant Device Management (requires user auth)
// ============================================================================

// POST /api/terminal/devices - Register a new terminal device
const RegisterDeviceSchema = z.object({
  name: z.string().min(1).max(100),
  projectId: z.number().int().positive(),
  chainId: z.number().int().positive().optional(),
  acceptedTokens: z.array(z.string()).optional(),
});

terminalRouter.post(
  '/devices',
  requireAuth,
  rateLimitByUser('terminalRegister'),
  zValidator('json', RegisterDeviceSchema),
  async (c) => {
    const user = c.get('user');
    const data = c.req.valid('json');

    try {
      const { device, apiKey } = await registerDevice({
        merchantId: user.id,
        name: data.name,
        projectId: data.projectId,
        chainId: data.chainId,
        acceptedTokens: data.acceptedTokens,
      });

      return c.json({
        success: true,
        data: {
          device: formatDevice(device),
          apiKey, // Only returned once at creation
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to register device';
      return c.json({ success: false, error: message }, 500);
    }
  }
);

// GET /api/terminal/devices - List merchant's terminal devices
terminalRouter.get('/devices', requireAuth, async (c) => {
  const user = c.get('user');

  try {
    const devices = await getMerchantDevices(user.id);
    return c.json({
      success: true,
      data: {
        devices: devices.map(formatDevice),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list devices';
    return c.json({ success: false, error: message }, 500);
  }
});

// GET /api/terminal/devices/:id - Get a specific device
terminalRouter.get('/devices/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const deviceId = c.req.param('id');

  try {
    const device = await getDevice(deviceId);
    if (!device || device.merchantId !== user.id) {
      return c.json({ success: false, error: 'Device not found' }, 404);
    }

    return c.json({
      success: true,
      data: { device: formatDevice(device) },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get device';
    return c.json({ success: false, error: message }, 500);
  }
});

// PATCH /api/terminal/devices/:id - Update device settings
const UpdateDeviceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  projectId: z.number().int().positive().optional(),
  chainId: z.number().int().positive().optional(),
  acceptedTokens: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

terminalRouter.patch(
  '/devices/:id',
  requireAuth,
  zValidator('json', UpdateDeviceSchema),
  async (c) => {
    const user = c.get('user');
    const deviceId = c.req.param('id');
    const updates = c.req.valid('json');

    try {
      const device = await updateDevice(deviceId, user.id, updates);
      if (!device) {
        return c.json({ success: false, error: 'Device not found' }, 404);
      }

      return c.json({
        success: true,
        data: { device: formatDevice(device) },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update device';
      return c.json({ success: false, error: message }, 500);
    }
  }
);

// POST /api/terminal/devices/:id/regenerate-key - Regenerate API key
terminalRouter.post('/devices/:id/regenerate-key', requireAuth, async (c) => {
  const user = c.get('user');
  const deviceId = c.req.param('id');

  try {
    const apiKey = await regenerateApiKey(deviceId, user.id);
    if (!apiKey) {
      return c.json({ success: false, error: 'Device not found' }, 404);
    }

    return c.json({
      success: true,
      data: { apiKey },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to regenerate key';
    return c.json({ success: false, error: message }, 500);
  }
});

// DELETE /api/terminal/devices/:id - Delete a device
terminalRouter.delete('/devices/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const deviceId = c.req.param('id');

  try {
    const deleted = await deleteDevice(deviceId, user.id);
    if (!deleted) {
      return c.json({ success: false, error: 'Device not found' }, 404);
    }

    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete device';
    return c.json({ success: false, error: message }, 500);
  }
});

// GET /api/terminal/stats - Get merchant stats
terminalRouter.get('/stats', requireAuth, async (c) => {
  const user = c.get('user');

  try {
    const stats = await getMerchantStats(user.id);
    return c.json({ success: true, data: stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get stats';
    return c.json({ success: false, error: message }, 500);
  }
});

// ============================================================================
// Payment Sessions - Terminal Operations (requires terminal API key)
// ============================================================================

// POST /api/terminal/session - Create a new payment session
const CreateSessionSchema = z.object({
  amountUsd: z.number().positive().max(10000), // Max $10,000
  token: z.string().optional(), // Token address
  tokenSymbol: z.string().optional(), // e.g., "ETH", "USDC"
});

terminalRouter.post(
  '/session',
  requireTerminalAuth,
  zValidator('json', CreateSessionSchema),
  async (c) => {
    const device = c.get('terminalDevice')!;
    const data = c.req.valid('json');

    try {
      const session = await createSession({
        deviceId: device.id,
        amountUsd: data.amountUsd,
        token: data.token,
        tokenSymbol: data.tokenSymbol,
      });

      return c.json({
        success: true,
        data: {
          session: formatSession(session),
          paymentUrl: `https://pay.juicyvision.app/s/${session.id}`,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create session';
      return c.json({ success: false, error: message }, 500);
    }
  }
);

// GET /api/terminal/session/:id - Get session status (terminal or consumer)
terminalRouter.get('/session/:id', optionalAuth, async (c) => {
  const sessionId = c.req.param('id');

  try {
    const session = await getSessionWithDetails(sessionId);
    if (!session) {
      return c.json({ success: false, error: 'Session not found' }, 404);
    }

    return c.json({
      success: true,
      data: {
        session: formatSessionWithDetails(session),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get session';
    return c.json({ success: false, error: message }, 500);
  }
});

// DELETE /api/terminal/session/:id - Cancel a pending session
terminalRouter.delete('/session/:id', requireTerminalAuth, async (c) => {
  const device = c.get('terminalDevice')!;
  const sessionId = c.req.param('id');

  try {
    const cancelled = await cancelSession(sessionId, device.id);
    if (!cancelled) {
      return c.json({ success: false, error: 'Session not found or not cancellable' }, 404);
    }

    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to cancel session';
    return c.json({ success: false, error: message }, 500);
  }
});

// GET /api/terminal/session/:id/status - Poll session status (for terminals)
terminalRouter.get('/session/:id/status', async (c) => {
  const sessionId = c.req.param('id');

  try {
    const session = await getSession(sessionId);
    if (!session) {
      return c.json({ success: false, error: 'Session not found' }, 404);
    }

    return c.json({
      success: true,
      data: {
        id: session.id,
        status: session.status,
        txHash: session.txHash,
        tokensIssued: session.tokensIssued,
        completedAt: session.completedAt?.toISOString() || null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get status';
    return c.json({ success: false, error: message }, 500);
  }
});

// ============================================================================
// Payment Execution (requires user auth - consumer side)
// ============================================================================

// POST /api/terminal/session/:id/pay/juice - Pay with Juice credits
const PayWithJuiceSchema = z.object({
  memo: z.string().max(256).optional(),
});

terminalRouter.post(
  '/session/:id/pay/juice',
  requireAuth,
  rateLimitByUser('terminalPay'),
  zValidator('json', PayWithJuiceSchema),
  async (c) => {
    const user = c.get('user');
    const sessionId = c.req.param('id');
    const { memo } = c.req.valid('json');

    try {
      // Get user's smart account address as the beneficiary
      // Tokens will be sent to their managed wallet
      const session = await getSessionWithDetails(sessionId);
      if (!session) {
        return c.json({ success: false, error: 'Session not found' }, 404);
      }

      const smartAccount = await getOrCreateSmartAccount(user.id, session.chainId);
      const smartAccountAddress = smartAccount.address;

      const updatedSession = await payWithJuice({
        sessionId,
        consumerId: user.id,
        beneficiaryAddress: smartAccountAddress,
        memo,
      });

      return c.json({
        success: true,
        data: { session: formatSession(updatedSession) },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Payment failed';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// ============================================================================
// Wallet Payment Endpoints (for crypto-native users)
// ============================================================================

// GET /api/terminal/session/:id/pay/wallet - Get wallet payment params
terminalRouter.get('/session/:id/pay/wallet', async (c) => {
  const sessionId = c.req.param('id');

  try {
    const params = await getWalletPaymentParams(sessionId);
    if (!params) {
      return c.json({ success: false, error: 'Session not available for payment' }, 400);
    }

    return c.json({
      success: true,
      data: params,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get payment params';
    return c.json({ success: false, error: message }, 500);
  }
});

// POST /api/terminal/session/:id/pay/wallet/start - Consumer started wallet payment
const StartWalletPaymentSchema = z.object({
  payerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

terminalRouter.post(
  '/session/:id/pay/wallet/start',
  zValidator('json', StartWalletPaymentSchema),
  async (c) => {
    const sessionId = c.req.param('id');
    const { payerAddress } = c.req.valid('json');

    try {
      const session = await startWalletPayment(sessionId, payerAddress);
      if (!session) {
        return c.json({ success: false, error: 'Session not available for payment' }, 400);
      }

      return c.json({
        success: true,
        data: { session: formatSession(session) },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start payment';
      return c.json({ success: false, error: message }, 500);
    }
  }
);

// POST /api/terminal/session/:id/pay/wallet/confirm - Transaction confirmed
const ConfirmWalletPaymentSchema = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  tokensIssued: z.string().optional(),
});

terminalRouter.post(
  '/session/:id/pay/wallet/confirm',
  zValidator('json', ConfirmWalletPaymentSchema),
  async (c) => {
    const sessionId = c.req.param('id');
    const { txHash, tokensIssued } = c.req.valid('json');

    try {
      const session = await confirmWalletPayment(sessionId, txHash, tokensIssued);
      if (!session) {
        return c.json({ success: false, error: 'Session not in paying state' }, 400);
      }

      return c.json({
        success: true,
        data: { session: formatSession(session) },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to confirm payment';
      return c.json({ success: false, error: message }, 500);
    }
  }
);

// POST /api/terminal/session/:id/pay/wallet/fail - Transaction failed
const FailWalletPaymentSchema = z.object({
  errorMessage: z.string().optional(),
});

terminalRouter.post(
  '/session/:id/pay/wallet/fail',
  zValidator('json', FailWalletPaymentSchema),
  async (c) => {
    const sessionId = c.req.param('id');
    const { errorMessage } = c.req.valid('json');

    try {
      const session = await failWalletPayment(sessionId, errorMessage);
      if (!session) {
        return c.json({ success: false, error: 'Session not in paying state' }, 400);
      }

      return c.json({
        success: true,
        data: { session: formatSession(session) },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update session';
      return c.json({ success: false, error: message }, 500);
    }
  }
);

// ============================================================================
// Merchant Transaction History
// ============================================================================

// GET /api/terminal/transactions - Get merchant's transaction history
const TransactionsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
  status: z.enum(['pending', 'paying', 'completed', 'failed', 'expired', 'cancelled']).optional(),
});

terminalRouter.get(
  '/transactions',
  requireAuth,
  zValidator('query', TransactionsQuerySchema),
  async (c) => {
    const user = c.get('user');
    const { limit, status } = c.req.valid('query');

    try {
      const sessions = await getMerchantSessions(user.id, limit, status);
      return c.json({
        success: true,
        data: {
          transactions: sessions.map(formatSessionWithDetails),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list transactions';
      return c.json({ success: false, error: message }, 500);
    }
  }
);

// GET /api/terminal/devices/:id/sessions - Get device's session history
const DeviceSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
});

terminalRouter.get(
  '/devices/:id/sessions',
  requireUserOrTerminalAuth,
  zValidator('query', DeviceSessionsQuerySchema),
  async (c) => {
    const deviceId = c.req.param('id');
    const { limit } = c.req.valid('query');

    // Verify access
    const terminalDevice = c.get('terminalDevice');
    const user = c.get('user');

    if (terminalDevice) {
      // Terminal auth - must be the same device
      if (terminalDevice.id !== deviceId) {
        return c.json({ success: false, error: 'Access denied' }, 403);
      }
    } else if (user) {
      // User auth - must be the merchant
      const device = await getDevice(deviceId);
      if (!device || device.merchantId !== user.id) {
        return c.json({ success: false, error: 'Device not found' }, 404);
      }
    }

    try {
      const sessions = await getDeviceSessions(deviceId, limit);
      return c.json({
        success: true,
        data: {
          sessions: sessions.map(formatSession),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list sessions';
      return c.json({ success: false, error: message }, 500);
    }
  }
);

// ============================================================================
// Response Formatters
// ============================================================================

function formatDevice(device: TerminalDevice) {
  return {
    id: device.id,
    name: device.name,
    projectId: device.projectId,
    chainId: device.chainId,
    acceptedTokens: device.acceptedTokens,
    apiKeyPrefix: device.apiKeyPrefix,
    isActive: device.isActive,
    lastSeenAt: device.lastSeenAt?.toISOString() || null,
    createdAt: device.createdAt.toISOString(),
  };
}

function formatSession(session: {
  id: string;
  deviceId: string;
  amountUsd: number;
  token: string | null;
  tokenSymbol: string;
  status: string;
  consumerId: string | null;
  paymentMethod: string | null;
  txHash: string | null;
  tokensIssued: string | null;
  expiresAt: Date;
  completedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: session.id,
    deviceId: session.deviceId,
    amountUsd: session.amountUsd,
    token: session.token,
    tokenSymbol: session.tokenSymbol,
    status: session.status,
    consumerId: session.consumerId,
    paymentMethod: session.paymentMethod,
    txHash: session.txHash,
    tokensIssued: session.tokensIssued,
    expiresAt: session.expiresAt.toISOString(),
    completedAt: session.completedAt?.toISOString() || null,
    createdAt: session.createdAt.toISOString(),
  };
}

function formatSessionWithDetails(session: {
  id: string;
  deviceId: string;
  amountUsd: number;
  token: string | null;
  tokenSymbol: string;
  status: string;
  consumerId: string | null;
  paymentMethod: string | null;
  txHash: string | null;
  tokensIssued: string | null;
  expiresAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  merchantId: string;
  merchantName: string;
  projectId: number;
  chainId: number;
}) {
  return {
    ...formatSession(session),
    merchantId: session.merchantId,
    merchantName: session.merchantName,
    projectId: session.projectId,
    chainId: session.chainId,
  };
}
