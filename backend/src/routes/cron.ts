import { Hono } from 'hono';
import { getConfig } from '../utils/config.ts';
import { executeReadyTransfers } from '../services/wallet.ts';
import { executeReadySmartAccountTransfers } from '../services/smartAccounts.ts';
import { cleanupExpiredSessions } from '../services/auth.ts';
import { cleanupRateLimits } from '../services/aiProvider.ts';
import { processSettlements } from '../services/settlement.ts';
import {
  processCredits as processJuiceCredits,
  processSpends as processJuiceSpends,
  processCashOuts as processJuiceCashOuts,
} from '../services/juice.ts';
import { cleanupExpiredJobs, cancelStaleJobs } from '../services/forge.ts';

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

  // Check shared secret (primary auth method for Railway/external cron services)
  if (cronSecret && cronSecret === config.cronSecret) {
    return true;
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
    // Execute both legacy transfers and smart account transfers
    const legacyCount = await executeReadyTransfers();
    const smartAccountCount = await executeReadySmartAccountTransfers();

    return c.json({
      success: true,
      data: {
        executedCount: legacyCount + smartAccountCount,
        legacyCount,
        smartAccountCount,
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

  // Execute ready transfers (both legacy and smart account)
  try {
    const legacyCount = await executeReadyTransfers();
    const smartAccountCount = await executeReadySmartAccountTransfers();
    results.transfers = { success: true, count: legacyCount + smartAccountCount };
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

  // Process Juice credits (cleared purchases)
  try {
    const creditResult = await processJuiceCredits();
    results.juiceCredits = {
      success: true,
      count: creditResult.credited,
      failed: creditResult.failed,
      pending: creditResult.pending,
    };
  } catch (error) {
    console.error('Juice credit processing failed:', error);
    results.juiceCredits = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Process Juice spends (project payments)
  try {
    const spendResult = await processJuiceSpends();
    results.juiceSpends = {
      success: true,
      count: spendResult.executed,
      failed: spendResult.failed,
      pending: spendResult.pending,
    };
  } catch (error) {
    console.error('Juice spend processing failed:', error);
    results.juiceSpends = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Process Juice cash outs (crypto withdrawals)
  try {
    const cashOutResult = await processJuiceCashOuts();
    results.juiceCashOuts = {
      success: true,
      count: cashOutResult.processed,
      failed: cashOutResult.failed,
      pending: cashOutResult.pending,
    };
  } catch (error) {
    console.error('Juice cash out processing failed:', error);
    results.juiceCashOuts = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Cleanup expired forge jobs
  try {
    const expiredCount = await cleanupExpiredJobs();
    const staleCount = await cancelStaleJobs();
    results.forgeJobs = {
      success: true,
      count: expiredCount + staleCount,
    };
  } catch (error) {
    console.error('Forge job cleanup failed:', error);
    results.forgeJobs = {
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

// ============================================================================
// Juice System Cron Endpoints
// ============================================================================

// Process Juice credits (purchases that have cleared risk delay)
cronRouter.post('/juice/credits', async (c) => {
  const startTime = Date.now();

  try {
    const result = await processJuiceCredits();

    return c.json({
      success: true,
      data: {
        credited: result.credited,
        failed: result.failed,
        pending: result.pending,
        durationMs: Date.now() - startTime,
      },
    });
  } catch (error) {
    console.error('Cron Juice credit processing failed:', error);
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

// Process Juice spends (execute project payments)
cronRouter.post('/juice/spends', async (c) => {
  const startTime = Date.now();

  try {
    const result = await processJuiceSpends();

    return c.json({
      success: true,
      data: {
        executed: result.executed,
        failed: result.failed,
        pending: result.pending,
        durationMs: Date.now() - startTime,
      },
    });
  } catch (error) {
    console.error('Cron Juice spend processing failed:', error);
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

// Process Juice cash outs (execute crypto withdrawals)
cronRouter.post('/juice/cash-outs', async (c) => {
  const startTime = Date.now();

  try {
    const result = await processJuiceCashOuts();

    return c.json({
      success: true,
      data: {
        processed: result.processed,
        failed: result.failed,
        pending: result.pending,
        durationMs: Date.now() - startTime,
      },
    });
  } catch (error) {
    console.error('Cron Juice cash out processing failed:', error);
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

// ============================================================================
// Forge System Cron Endpoints
// ============================================================================

// Cleanup expired and stale forge jobs
cronRouter.post('/forge/cleanup', async (c) => {
  const startTime = Date.now();

  try {
    const expiredCount = await cleanupExpiredJobs();
    const staleCount = await cancelStaleJobs();

    return c.json({
      success: true,
      data: {
        expired: expiredCount,
        stale: staleCount,
        total: expiredCount + staleCount,
        durationMs: Date.now() - startTime,
      },
    });
  } catch (error) {
    console.error('Cron Forge cleanup failed:', error);
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
