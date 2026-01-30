import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { timing } from 'hono/timing';
// Static file serving disabled - frontend deployed separately

import { authRouter } from './src/routes/auth.ts';
import { chatRouter } from './src/routes/chat.ts';
import { walletRouter } from './src/routes/wallet.ts';
import { eventsRouter } from './src/routes/events.ts';
import { cronRouter } from './src/routes/cron.ts';
import { proxyRouter } from './src/routes/proxy.ts';
import { stripeWebhookRouter } from './src/routes/stripe-webhook.ts';
import { contextRouter } from './src/routes/context.ts';
import { localeRouter } from './src/routes/locale.ts';
import { inviteRouter } from './src/routes/invite.ts';
import { passkeyRouter } from './src/routes/passkey.ts';
import { siweRouter } from './src/routes/siwe.ts';
import { transactionsRouter } from './src/routes/transactions.ts';
import { projectsRouter } from './src/routes/projects.ts';
import { debugRouter, logDebugEvent } from './src/routes/debug.ts';
import { identityRouter } from './src/routes/identity.ts';
import { juiceRouter } from './src/routes/juice.ts';
import { adminRouter } from './src/routes/admin.ts';
import { subscriptionRouter } from './src/routes/subscription.ts';
import { getConfig, validateConfigForAuth, validateConfigForEncryption, validateConfigForReserves } from './src/utils/config.ts';
import { cleanupRateLimits } from './src/services/claude.ts';
import { cleanupExpiredSessions } from './src/services/auth.ts';
import { executeReadyTransfers } from './src/services/wallet.ts';
import { cleanupExpiredChallenges } from './src/services/passkey.ts';
import {
  processCredits as processJuiceCredits,
  processSpends as processJuiceSpends,
  processCashOuts as processJuiceCashOuts,
} from './src/services/juice.ts';
import { runMigrations } from './src/db/migrate.ts';

// Run migrations before starting the server
await runMigrations();

// Validate critical config in production
const bootConfig = getConfig();
if (bootConfig.env === 'production') {
  validateConfigForAuth(bootConfig);
  validateConfigForEncryption(bootConfig);
  validateConfigForReserves(bootConfig);
}

const app = new Hono();

// ============================================================================
// Middleware
// ============================================================================

// CORS - allow frontend origins
app.use(
  '*',
  cors({
    origin: (origin) => {
      // Allow localhost for development
      if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        return origin;
      }
      // Allow IPFS gateways
      if (origin.includes('ipfs.io') || origin.includes('dweb.link')) {
        return origin;
      }
      // Allow your production domain
      if (origin.includes('juicyvision') || origin.includes('juicy.vision')) {
        return origin;
      }
      return null;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Session-ID', 'X-Wallet-Session'],
  })
);

// Security headers - allow cross-origin resources for WalletConnect
app.use('*', secureHeaders({
  crossOriginResourcePolicy: 'cross-origin',
}));

// Request logging
app.use('*', logger());

// Response timing
app.use('*', timing());

// Debug event logging for API calls
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;

  // Log to debug dashboard
  logDebugEvent('api_call', 'api', {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration,
  });
});

// ============================================================================
// Health Check
// ============================================================================

app.get('/health', (c) => {
  return c.json({
    name: 'Juicy Vision API',
    version: '0.1.0',
    status: 'healthy',
  });
});

// ============================================================================
// API Routes (with /api prefix for local development)
// ============================================================================

app.route('/api/auth', authRouter);
app.route('/api/auth/siwe', siweRouter);
app.route('/api/chat', chatRouter);
app.route('/api/wallet', walletRouter);
app.route('/api/events', eventsRouter);
app.route('/api/cron', cronRouter);
app.route('/api/proxy', proxyRouter);
app.route('/api/stripe/webhook', stripeWebhookRouter);
app.route('/api/context', contextRouter);
app.route('/api/locale', localeRouter);
app.route('/api/chat', inviteRouter);
app.route('/api/passkey', passkeyRouter);
app.route('/api/transactions', transactionsRouter);
app.route('/api/projects', projectsRouter);
app.route('/api/debug', debugRouter);
app.route('/api/identity', identityRouter);
app.route('/api/juice', juiceRouter);
app.route('/api/admin', adminRouter);
app.route('/api/subscription', subscriptionRouter);

// ============================================================================
// Static File Serving (disabled - frontend served separately in production)
// For local dev, run: npm run dev (Vite) in the root directory
// ============================================================================

// ============================================================================
// Error Handling
// ============================================================================

app.onError((err, c) => {
  console.error('Unhandled error:', err);

  // Don't expose internal errors in production
  const config = getConfig();
  const message =
    config.env === 'production'
      ? 'Internal server error'
      : err.message || 'Unknown error';

  return c.json(
    {
      success: false,
      error: message,
    },
    500
  );
});

app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: 'Not found',
    },
    404
  );
});

// ============================================================================
// Background Jobs (Development fallback - use /api/cron endpoints in production)
// ============================================================================

const config = getConfig();

// In development, run background jobs via setInterval
// In production on GCP, use Cloud Scheduler to call /api/cron endpoints
if (config.env === 'development') {
  console.log('Starting development background jobs...');

  // Cleanup rate limit entries every hour
  setInterval(cleanupRateLimits, 60 * 60 * 1000);

  // Cleanup expired sessions every hour
  setInterval(async () => {
    try {
      const count = await cleanupExpiredSessions();
      if (count > 0) {
        console.log(`[Dev] Cleaned up ${count} expired sessions`);
      }
    } catch (error) {
      console.error('[Dev] Failed to cleanup sessions:', error);
    }
  }, 60 * 60 * 1000);

  // Execute ready transfers every hour
  setInterval(async () => {
    try {
      const count = await executeReadyTransfers();
      if (count > 0) {
        console.log(`[Dev] Executed ${count} ready transfers`);
      }
    } catch (error) {
      console.error('[Dev] Failed to execute transfers:', error);
    }
  }, 60 * 60 * 1000);

  // Cleanup expired passkey challenges every 10 minutes
  setInterval(async () => {
    try {
      await cleanupExpiredChallenges();
    } catch (error) {
      console.error('[Dev] Failed to cleanup passkey challenges:', error);
    }
  }, 10 * 60 * 1000);

  // Process Juice credits every 5 minutes
  setInterval(async () => {
    try {
      const result = await processJuiceCredits();
      if (result.credited > 0) {
        console.log(`[Dev] Credited ${result.credited} Juice purchases`);
      }
    } catch (error) {
      console.error('[Dev] Failed to process Juice credits:', error);
    }
  }, 5 * 60 * 1000);

  // Process Juice spends every 2 minutes
  setInterval(async () => {
    try {
      const result = await processJuiceSpends();
      if (result.executed > 0) {
        console.log(`[Dev] Executed ${result.executed} Juice spends`);
      }
    } catch (error) {
      console.error('[Dev] Failed to process Juice spends:', error);
    }
  }, 2 * 60 * 1000);

  // Process Juice cash outs every 5 minutes
  setInterval(async () => {
    try {
      const result = await processJuiceCashOuts();
      if (result.processed > 0) {
        console.log(`[Dev] Processed ${result.processed} Juice cash outs`);
      }
    } catch (error) {
      console.error('[Dev] Failed to process Juice cash outs:', error);
    }
  }, 5 * 60 * 1000);
} else {
  console.log('Production mode: Use GCP Cloud Scheduler for cron jobs');
}

// ============================================================================
// Start Server
// ============================================================================

const port = config.port;

console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    JUICY VISION API                       ║
╠═══════════════════════════════════════════════════════════╣
║  Environment: ${config.env.padEnd(42)}║
║  Port: ${port.toString().padEnd(49)}║
║                                                           ║
║  Auth & User:                                             ║
║    POST /api/auth/register    - Register new user         ║
║    POST /api/auth/login       - Login                     ║
║    GET  /api/auth/me          - Get current user          ║
║                                                           ║
║  Passkey (WebAuthn):                                      ║
║    GET  /api/passkey/register/options - Registration opts ║
║    POST /api/passkey/register/verify  - Complete register ║
║    GET  /api/passkey/authenticate/options - Auth options  ║
║    POST /api/passkey/authenticate/verify  - Complete auth ║
║                                                           ║
║  Chat:                                                    ║
║    POST /api/chat             - Create chat               ║
║    GET  /api/chat             - List user's chats         ║
║    GET  /api/chat/:id         - Get chat details          ║
║    POST /api/chat/:id/messages - Send message             ║
║    GET  /api/chat/:id/ws      - WebSocket connection      ║
║    POST /api/chat/:id/ai/invoke - Invoke AI response      ║
║                                                           ║
║  Wallet:                                                  ║
║    GET  /api/wallet/address   - Get custodial address     ║
║    GET  /api/wallet/balances  - Get token balances        ║
║    POST /api/wallet/transfer  - Request transfer          ║
║                                                           ║
║  Juice (Stored Value):                                    ║
║    GET  /api/juice/balance    - Get Juice balance         ║
║    POST /api/juice/purchase   - Buy Juice with fiat       ║
║    POST /api/juice/spend      - Pay a project with Juice  ║
║    POST /api/juice/cash-out   - Convert Juice to crypto   ║
║    GET  /api/juice/transactions - Transaction history     ║
║                                                           ║
║  Proxy Endpoints:                                         ║
║    POST /api/proxy/bendystraw - Bendystraw GraphQL        ║
║    POST /api/proxy/rpc/:chain - JSON-RPC proxy            ║
║                                                           ║
║  Debug (Development Only):                                ║
║    GET  /api/debug           - Debug dashboard            ║
║    GET  /api/debug/stream    - Real-time event stream     ║
╚═══════════════════════════════════════════════════════════╝
`);

// Import WebSocket handler functions
import {
  registerConnection,
  removeConnection,
  handleWsMessage,
  type WsClient,
} from './src/services/websocket.ts';
import { checkPermission } from './src/services/chat.ts';
import { queryOne } from './src/db/index.ts';
import { generatePseudoAddress } from './src/utils/crypto.ts';

// WebSocket authentication helper (duplicated from chat.ts for use at server level)
async function extractWalletSessionForWs(
  sessionToken: string | undefined
): Promise<{ address: string; userId?: string; sessionId?: string; isAnonymous?: boolean } | null> {
  if (!sessionToken) return null;

  // Try JWT token validation
  const { validateSession } = await import('./src/services/auth.ts');
  const { getOrCreateSmartAccount } = await import('./src/services/smartAccounts.ts');

  const jwtResult = await validateSession(sessionToken);
  if (jwtResult) {
    const smartAccount = await getOrCreateSmartAccount(jwtResult.user.id, 1);
    return { address: smartAccount.address, userId: jwtResult.user.id };
  }

  // Try SIWE session token
  const session = await queryOne<{ wallet_address: string; expires_at: Date }>(
    `SELECT wallet_address, expires_at FROM wallet_sessions WHERE session_token = $1 AND expires_at > NOW()`,
    [sessionToken]
  );

  if (session) {
    const user = await queryOne<{ id: string }>(
      `SELECT u.id FROM users u JOIN multi_chat_members mcm ON mcm.member_user_id = u.id WHERE mcm.member_address = $1 LIMIT 1`,
      [session.wallet_address]
    );
    return { address: session.wallet_address, userId: user?.id };
  }

  return null;
}

// Handle WebSocket requests at the server level to avoid Hono middleware interference
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // Check if this is a WebSocket upgrade request for chat
  const upgradeHeader = req.headers.get('upgrade');
  const isWsUpgrade = upgradeHeader?.toLowerCase() === 'websocket';
  const wsMatch = url.pathname.match(/^\/api\/chat\/([^\/]+)\/ws$/);

  if (isWsUpgrade && wsMatch) {
    const chatId = wsMatch[1];
    const sessionToken = url.searchParams.get('session') || undefined;
    const sessionId = url.searchParams.get('sessionId') || undefined;

    // Perform WebSocket upgrade SYNCHRONOUSLY
    const { socket, response } = Deno.upgradeWebSocket(req);

    let client: WsClient | null = null;

    socket.onopen = async () => {
      try {
        // Try token-based auth first
        let walletSession = await extractWalletSessionForWs(sessionToken);

        // Fall back to anonymous session
        if (!walletSession && sessionId && sessionId.startsWith('ses_')) {
          const pseudoAddress = await generatePseudoAddress(sessionId);
          walletSession = { address: pseudoAddress, sessionId, isAnonymous: true };
        }

        if (!walletSession) {
          socket.close(4001, 'Authentication required');
          return;
        }

        // Check permission
        let canRead = await checkPermission(chatId, walletSession.address, 'read');

        // Fallback to session pseudo-address (already using correct address from generatePseudoAddress)

        if (!canRead) {
          socket.close(4003, 'Access denied');
          return;
        }

        client = {
          socket,
          address: walletSession.address,
          userId: walletSession.userId,
          chatId,
          connectedAt: new Date(),
        };
        registerConnection(client);
        console.log(`[WS] Connected: ${walletSession.address} to chat ${chatId}`);
      } catch (err) {
        console.error('[WS] Auth error:', err);
        socket.close(4000, 'Authentication failed');
      }
    };

    socket.onmessage = (event) => {
      if (client) handleWsMessage(client, event.data.toString());
    };

    socket.onclose = () => {
      if (client) {
        removeConnection(client);
        console.log(`[WS] Disconnected: ${client.address} from chat ${client.chatId}`);
      }
    };

    socket.onerror = (err) => {
      console.error('[WS] Error:', err);
      if (client) removeConnection(client);
    };

    return response;
  }

  // For all other requests, use Hono
  return app.fetch(req);
}

Deno.serve({ port }, handleRequest);
