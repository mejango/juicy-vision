import { Hono } from 'hono';
import { getConfig } from '../utils/config.ts';
import { executeReadyTransfers } from '../services/wallet.ts';
import { cleanupExpiredSessions } from '../services/auth.ts';
import { cleanupRateLimits } from '../services/claude.ts';
import { processSettlements } from '../services/settlement.ts';

export const cronRouter = new Hono();

// ============================================================================
// Cron Authentication Middleware
// ============================================================================

// GCP Cloud Scheduler sends requests with OIDC tokens or we can use a shared secret.
// This middleware validates either:
// 1. X-CloudScheduler-JobName header (present when called by Cloud Scheduler)
// 2. X-Cron-Secret header matching our configured secret
// 3. Authorization header with OIDC token (for production GCP setup)

async function verifyCronAuth(
  authHeader: string | undefined,
  cronSecret: string | undefined,
  jobName: string | undefined
): Promise<boolean> {
  const config = getConfig();

  // In development, accept the dev secret
  if (config.env === 'development') {
    if (cronSecret === config.cronSecret) {
      return true;
    }
  }

  // Accept X-CloudScheduler-JobName header (GCP sets this automatically)
  if (jobName) {
    // In production, you might want to verify the job name matches expected values
    console.log(`Cron request from Cloud Scheduler job: ${jobName}`);
    return true;
  }

  // Check shared secret
  if (cronSecret && cronSecret === config.cronSecret) {
    return true;
  }

  // Verify OIDC token from Cloud Scheduler
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      // In production, verify the OIDC token
      // This requires the google-auth-library or manual JWT verification
      // For now, we'll rely on Cloud Run's built-in IAM if the service is private
      // The Cloud Scheduler would have invoker permission on the Cloud Run service

      // Basic token presence check - in production with IAM-protected Cloud Run,
      // the request wouldn't reach here unless properly authenticated
      if (token && config.gcpServiceAccount) {
        // Could add full JWT verification here using google-auth-library
        // For Cloud Run with IAM, this is often unnecessary as Cloud Run validates
        return true;
      }
    } catch {
      console.error('OIDC token verification failed');
    }
  }

  return false;
}

// Cron auth middleware
cronRouter.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const cronSecret = c.req.header('X-Cron-Secret');
  const jobName = c.req.header('X-CloudScheduler-JobName');

  const isAuthorized = await verifyCronAuth(authHeader, cronSecret, jobName);

  if (!isAuthorized) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  await next();
});

// ============================================================================
// Cron Endpoints
// ============================================================================

// Execute transfers that have completed the 7-day hold period
cronRouter.post('/transfers', async (c) => {
  const startTime = Date.now();

  try {
    const count = await executeReadyTransfers();

    return c.json({
      success: true,
      data: {
        executedCount: count,
        durationMs: Date.now() - startTime,
      },
    });
  } catch (error) {
    console.error('Cron transfer execution failed:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      },
      500
    );
  }
});

// Cleanup expired sessions
cronRouter.post('/cleanup-sessions', async (c) => {
  const startTime = Date.now();

  try {
    const count = await cleanupExpiredSessions();

    return c.json({
      success: true,
      data: {
        cleanedCount: count,
        durationMs: Date.now() - startTime,
      },
    });
  } catch (error) {
    console.error('Cron session cleanup failed:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      },
      500
    );
  }
});

// Process fiat payment settlements (7-day hold complete)
cronRouter.post('/settlements', async (c) => {
  const startTime = Date.now();

  try {
    const result = await processSettlements();

    return c.json({
      success: true,
      data: {
        settled: result.settled,
        failed: result.failed,
        pending: result.pending,
        durationMs: Date.now() - startTime,
      },
    });
  } catch (error) {
    console.error('Cron settlement processing failed:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      },
      500
    );
  }
});

// Cleanup rate limit entries
cronRouter.post('/cleanup-ratelimits', async (c) => {
  const startTime = Date.now();

  try {
    cleanupRateLimits();

    return c.json({
      success: true,
      data: {
        durationMs: Date.now() - startTime,
      },
    });
  } catch (error) {
    console.error('Cron rate limit cleanup failed:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      },
      500
    );
  }
});

// Combined cleanup job (runs all maintenance tasks)
cronRouter.post('/maintenance', async (c) => {
  const startTime = Date.now();
  const results: Record<string, { success: boolean; count?: number; failed?: number; pending?: number; error?: string }> = {};

  // Execute ready transfers
  try {
    const transferCount = await executeReadyTransfers();
    results.transfers = { success: true, count: transferCount };
  } catch (error) {
    console.error('Transfer execution failed:', error);
    results.transfers = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Cleanup sessions
  try {
    const sessionCount = await cleanupExpiredSessions();
    results.sessions = { success: true, count: sessionCount };
  } catch (error) {
    console.error('Session cleanup failed:', error);
    results.sessions = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Cleanup rate limits
  try {
    cleanupRateLimits();
    results.rateLimits = { success: true };
  } catch (error) {
    console.error('Rate limit cleanup failed:', error);
    results.rateLimits = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Process fiat payment settlements
  try {
    const settlementResult = await processSettlements();
    results.settlements = {
      success: true,
      count: settlementResult.settled,
      failed: settlementResult.failed,
      pending: settlementResult.pending,
    };
  } catch (error) {
    console.error('Settlement processing failed:', error);
    results.settlements = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  const allSuccess = Object.values(results).every((r) => r.success);

  return c.json(
    {
      success: allSuccess,
      data: {
        results,
        durationMs: Date.now() - startTime,
      },
    },
    allSuccess ? 200 : 207 // 207 Multi-Status if partial success
  );
});

// Health check for cron system
cronRouter.get('/health', (c) => {
  return c.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    },
  });
});
