import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { timing } from 'hono/timing';

import { authRouter } from './src/routes/auth.ts';
import { chatRouter } from './src/routes/chat.ts';
import { walletRouter } from './src/routes/wallet.ts';
import { eventsRouter } from './src/routes/events.ts';
import { cronRouter } from './src/routes/cron.ts';
import { proxyRouter } from './src/routes/proxy.ts';
import { stripeWebhookRouter } from './src/routes/stripe-webhook.ts';
import { contextRouter } from './src/routes/context.ts';
import { getConfig } from './src/utils/config.ts';
import { cleanupRateLimits } from './src/services/claude.ts';
import { cleanupExpiredSessions } from './src/services/auth.ts';
import { executeReadyTransfers } from './src/services/wallet.ts';
import { runMigrations } from './src/db/migrate.ts';

// Run migrations before starting the server
await runMigrations();

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
      // Allow your production domain (update this)
      if (origin.includes('juicyvision')) {
        return origin;
      }
      return null;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

// Security headers
app.use('*', secureHeaders());

// Request logging
app.use('*', logger());

// Response timing
app.use('*', timing());

// ============================================================================
// Health Check
// ============================================================================

app.get('/', (c) => {
  return c.json({
    name: 'Juicy Vision API',
    version: '0.1.0',
    status: 'healthy',
  });
});

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

// ============================================================================
// API Routes
// ============================================================================

app.route('/api/auth', authRouter);
app.route('/api/chat', chatRouter);
app.route('/api/wallet', walletRouter);
app.route('/api/events', eventsRouter);
app.route('/api/cron', cronRouter);
app.route('/api/proxy', proxyRouter);
app.route('/api/stripe/webhook', stripeWebhookRouter);
app.route('/api/context', contextRouter);

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
║  Endpoints:                                               ║
║    POST /api/auth/register    - Register new user         ║
║    POST /api/auth/login       - Login                     ║
║    GET  /api/auth/me          - Get current user          ║
║    POST /api/chat/message     - Send chat message         ║
║    POST /api/chat/stream      - Stream chat (SSE)         ║
║    GET  /api/wallet/address   - Get custodial address     ║
║    GET  /api/wallet/balances  - Get token balances        ║
║    POST /api/wallet/transfer  - Request transfer          ║
║    POST /api/events/stream    - Log events                ║
║                                                           ║
║  Context Endpoints:                                       ║
║    GET  /api/context/omnichain - Omnichain knowledge      ║
║    GET  /api/context/tools     - Available AI tools       ║
║    GET  /api/context/chains    - Supported chains         ║
║                                                           ║
║  Proxy Endpoints:                                         ║
║    POST /api/proxy/bendystraw - Bendystraw GraphQL        ║
║    POST /api/proxy/thegraph/* - TheGraph subgraphs        ║
║    POST /api/proxy/rpc/:chain - JSON-RPC proxy            ║
║                                                           ║
║  Cron Endpoints (GCP Cloud Scheduler):                    ║
║    POST /api/cron/transfers   - Execute ready transfers   ║
║    POST /api/cron/maintenance - Run all maintenance jobs  ║
║                                                           ║
║  Webhooks:                                                ║
║    POST /api/stripe/webhook   - Stripe payment events     ║
╚═══════════════════════════════════════════════════════════╝
`);

Deno.serve({ port }, app.fetch);
