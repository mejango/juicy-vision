// Build trigger: 2026-02-03
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { timing } from 'hono/timing';
import {
  globalBodyLimit,
  jsonBodyLimit,
  requireBoundedMultipart,
} from './src/middleware/bodyLimit.ts';
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
import { hooksRouter } from './src/routes/hooks.ts';
import projectConversationsRouter from './src/routes/projectConversations.ts';
import { imagesRouter } from './src/routes/images.ts';
import { terminalRouter } from './src/routes/terminal.ts';
import { rulesetsRouter } from './src/routes/rulesets.ts';
import { getConfig, isAllowedOrigin, validateProductionConfig } from './src/utils/config.ts';
import { cleanupRateLimits } from './src/services/claude.ts';
import { cleanupExpiredSessions } from './src/services/auth.ts';
import { executeReadySmartAccountTransfers } from './src/services/smartAccounts.ts';
import { cleanupExpiredChallenges } from './src/services/passkey.ts';
import {
  processCashOuts as processJuiceCashOuts,
  processCredits as processJuiceCredits,
  processSpends as processJuiceSpends,
} from './src/services/juice.ts';
import { expireSessions as expireTerminalSessions } from './src/services/terminal.ts';
import { cleanupExpiredCache as cleanupRulesetCache } from './src/services/rulesetCache.ts';
import { closePool, queryOne } from './src/db/index.ts';
import { recoverOrphanedJobs } from './src/services/forge.ts';

const bootConfig = getConfig();
validateProductionConfig(bootConfig);

// Recover any forge jobs that were running when we crashed
// Uses 2-min grace period to avoid killing jobs from quick restarts
try {
  const recovered = await recoverOrphanedJobs();
  if (recovered > 0) {
    console.log(`[Startup] Recovered ${recovered} orphaned forge jobs from previous run`);
  }
} catch (error) {
  console.error('[Startup] Failed to recover orphaned jobs:', error);
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
      return isAllowedOrigin(bootConfig, origin) ? origin : null;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Session-ID',
      'X-Wallet-Session',
      'X-Terminal-Key',
    ],
  }),
);

// Reject unframed multipart before any middleware can buffer it. JSON gets a
// focused ceiling; every other request body remains under the global ceiling.
app.use('*', requireBoundedMultipart);
app.use('*', jsonBodyLimit);
app.use('*', globalBodyLimit);

// Security headers - allow cross-origin resources for WalletConnect
app.use(
  '*',
  secureHeaders({
    crossOriginResourcePolicy: 'cross-origin',
  }),
);

// Request logging
app.use('*', logger());

// Response timing
app.use('*', timing());

// Debug event logging for API calls (dev only - logDebugEvent is a no-op in production)
if (bootConfig.env === 'development') {
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
}

// ============================================================================
// Health Check
// ============================================================================

const livenessPayload = () => ({
  name: 'Juicy Vision API',
  version: '0.1.0',
  revision: Deno.env.get('APP_REVISION') || 'development',
  status: 'alive',
});

app.get('/livez', (c) => c.json(livenessPayload()));

// Compatibility alias for platforms that conventionally probe /health.
app.get('/health', (c) => c.json(livenessPayload()));

app.get('/readyz', async (c) => {
  try {
    const result = await queryOne<{ ready: boolean }>(
      `SELECT
        to_regclass('public.users') IS NOT NULL
        AND to_regclass('public._migrations') IS NOT NULL AS ready`,
    );
    if (!result?.ready) return c.json({ status: 'not_ready' }, 503);
    return c.json({ status: 'ready' });
  } catch (error) {
    console.error('[Readiness] Database check failed:', error);
    return c.json({ status: 'not_ready' }, 503);
  }
});

// ============================================================================
// API Routes
// ============================================================================

app.route('/auth', authRouter);
app.route('/auth/siwe', siweRouter);
app.route('/chat', chatRouter);
app.route('/wallet', walletRouter);
app.route('/events', eventsRouter);
app.route('/cron', cronRouter);
app.route('/proxy', proxyRouter);
app.route('/stripe/webhook', stripeWebhookRouter);
app.route('/context', contextRouter);
app.route('/locale', localeRouter);
app.route('/chat', inviteRouter);
app.route('/passkey', passkeyRouter);
app.route('/transactions', transactionsRouter);
app.route('/projects', projectsRouter);
app.route('/debug', debugRouter);
app.route('/identity', identityRouter);
app.route('/juice', juiceRouter);
app.route('/admin', adminRouter);
app.route('/hooks', hooksRouter);
app.route('/project-conversations', projectConversationsRouter);
app.route('/images', imagesRouter);
app.route('/terminal', terminalRouter);
app.route('/rulesets', rulesetsRouter);

// ============================================================================
// Static File Serving (disabled - frontend served separately in production)
// For local dev, run: npm run dev (Vite) in the root directory
// ============================================================================

// ============================================================================
// Error Handling
// ============================================================================

import { isAppError } from './src/errors/AppError.ts';

app.onError((err, c) => {
  // Handle structured AppErrors
  if (isAppError(err)) {
    // Log all errors for debugging
    console.error(`[${err.code}] ${err.message}`, err.metadata);

    // Set rate limit headers if applicable
    if (err.code === 'RATE_LIMIT_EXCEEDED' && err.metadata?.retryAfter) {
      c.header('Retry-After', String(err.metadata.retryAfter));
    }

    return c.json(
      {
        success: false,
        ...err.toJSON(),
      },
      err.statusCode as 400 | 401 | 402 | 403 | 404 | 409 | 429 | 500 | 502 | 503,
    );
  }

  // Handle unknown errors
  console.error('Unhandled error:', err);

  // Don't expose internal errors in production
  const config = getConfig();
  const message = config.env === 'production'
    ? 'Internal server error'
    : err.message || 'Unknown error';

  return c.json(
    {
      success: false,
      error: 'INTERNAL_ERROR',
      message,
    },
    500,
  );
});

app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: 'Not found',
    },
    404,
  );
});

// ============================================================================
// Background Jobs (Development fallback - use /cron endpoints in production)
// ============================================================================

const config = bootConfig;

// In development, run background jobs via setInterval
// In production on GCP, use Cloud Scheduler to call /cron endpoints
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
      const count = await executeReadySmartAccountTransfers();
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

  // Expire old terminal payment sessions every minute
  setInterval(async () => {
    try {
      const count = await expireTerminalSessions();
      if (count > 0) {
        console.log(`[Dev] Expired ${count} terminal payment sessions`);
      }
    } catch (error) {
      console.error('[Dev] Failed to expire terminal sessions:', error);
    }
  }, 60 * 1000);

  // Cleanup expired ruleset cache every 5 minutes
  setInterval(async () => {
    try {
      const result = await cleanupRulesetCache();
      if (result.rulesets > 0 || result.splits > 0 || result.shop > 0) {
        console.log(
          `[Dev] Cleaned up ${result.rulesets} rulesets, ${result.splits} splits, ${result.shop} shop entries from cache`,
        );
      }
    } catch (error) {
      console.error('[Dev] Failed to cleanup ruleset cache:', error);
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
║    POST /auth/register    - Register new user         ║
║    POST /auth/login       - Login                     ║
║    GET  /auth/me          - Get current user          ║
║                                                           ║
║  Passkey (WebAuthn):                                      ║
║    GET  /passkey/register/options - Registration opts ║
║    POST /passkey/register/verify  - Complete register ║
║    GET  /passkey/authenticate/options - Auth options  ║
║    POST /passkey/authenticate/verify  - Complete auth ║
║                                                           ║
║  Chat:                                                    ║
║    POST /chat             - Create chat               ║
║    GET  /chat             - List user's chats         ║
║    GET  /chat/:id         - Get chat details          ║
║    POST /chat/:id/messages - Send message             ║
║    GET  /chat/:id/ws      - WebSocket connection      ║
║    POST /chat/:id/ai/invoke - Invoke AI response      ║
║                                                           ║
║  Wallet:                                                  ║
║    GET  /wallet/address   - Get custodial address     ║
║    GET  /wallet/balances  - Get token balances        ║
║    POST /wallet/transfer  - Request transfer          ║
║                                                           ║
║  Juice (Stored Value):                                    ║
║    GET  /juice/balance    - Get Juice balance         ║
║    POST /juice/purchase   - Buy Juice with fiat       ║
║    POST /juice/spend      - Pay a project with Juice  ║
║    POST /juice/cash-out   - Convert Juice to crypto   ║
║    GET  /juice/transactions - Transaction history     ║
║                                                           ║
║  Proxy Endpoints:                                         ║
║    POST /proxy/bendystraw - Bendystraw GraphQL        ║
║    POST /proxy/rpc/:chain - JSON-RPC proxy            ║
║                                                           ║
║  Debug (Development Only):                                ║
║    GET  /debug           - Debug dashboard            ║
║    GET  /debug/stream    - Real-time event stream     ║
╚═══════════════════════════════════════════════════════════╝
`);

// Import WebSocket handler functions
import {
  handleWsMessage,
  registerConnection,
  removeConnection,
  type WsClient,
} from './src/services/websocket.ts';

// Import Terminal WebSocket handler functions
import {
  handleTerminalWsMessage,
  registerSessionConnection,
  removeSessionConnection,
  type TerminalWsClient,
} from './src/services/terminalWs.ts';
import { getSession } from './src/services/terminal.ts';
import { checkPermission } from './src/services/chat.ts';
import { generatePseudoAddress } from './src/utils/crypto.ts';
import { extractWalletSession } from './src/middleware/walletSession.ts';

// Handle WebSocket requests at the server level to avoid Hono middleware interference
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // Check if this is a WebSocket upgrade request for chat
  const upgradeHeader = req.headers.get('upgrade');
  const isWsUpgrade = upgradeHeader?.toLowerCase() === 'websocket';
  const wsMatch = url.pathname.match(/^\/chat\/([^\/]+)\/ws$/);

  if (isWsUpgrade && wsMatch) {
    const chatId = wsMatch[1];
    const sessionToken = url.searchParams.get('session') || undefined;
    const sessionId = url.searchParams.get('sessionId') || undefined;

    // Perform WebSocket upgrade SYNCHRONOUSLY
    const { socket, response } = Deno.upgradeWebSocket(req);

    let client: WsClient | null = null;

    socket.onopen = async () => {
      try {
        // Try token-based auth first (shared JWT + SIWE session resolution)
        let walletSession = await extractWalletSession(undefined, sessionToken);

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
        const canRead = await checkPermission(chatId, walletSession.address, 'read');

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

  // Check if this is a WebSocket upgrade request for terminal sessions
  const terminalWsMatch = url.pathname.match(/^\/terminal\/session\/([^\/]+)\/ws$/);
  if (isWsUpgrade && terminalWsMatch) {
    const sessionId = terminalWsMatch[1];
    const role = url.searchParams.get('role') as 'terminal' | 'consumer' || 'consumer';

    // Verify session exists
    const session = await getSession(sessionId);
    if (!session) {
      return new Response('Session not found', { status: 404 });
    }

    // Only allow WebSocket for pending/paying sessions
    if (!['pending', 'paying'].includes(session.status)) {
      return new Response('Session not active', { status: 400 });
    }

    const { socket, response } = Deno.upgradeWebSocket(req);
    let client: TerminalWsClient | null = null;

    socket.onopen = () => {
      client = {
        socket,
        sessionId,
        role,
        connectedAt: new Date(),
      };
      registerSessionConnection(client);
      console.log(`[TerminalWS] ${role} connected to session ${sessionId}`);
    };

    socket.onmessage = (event) => {
      if (client) handleTerminalWsMessage(client, event.data.toString());
    };

    socket.onclose = () => {
      if (client) {
        removeSessionConnection(client);
        console.log(`[TerminalWS] ${role} disconnected from session ${sessionId}`);
      }
    };

    socket.onerror = (err) => {
      console.error('[TerminalWS] Error:', err);
      if (client) removeSessionConnection(client);
    };

    return response;
  }

  // For all other requests, use Hono
  return app.fetch(req);
}

const abortController = new AbortController();
const server = Deno.serve({ port, signal: abortController.signal }, handleRequest);

let shuttingDown = false;
async function shutdown(signal: Deno.Signal): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Shutdown] Received ${signal}; draining requests`);
  abortController.abort();
  await server.finished.catch(() => undefined);
  await closePool();
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  Deno.addSignalListener(signal, () => {
    void shutdown(signal);
  });
}
