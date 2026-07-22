// Test helpers for backend testing

import { getConfig } from '../utils/config.ts';

const requireTestDatabaseValue = Deno.env.get('REQUIRE_TEST_DATABASE') ?? 'false';
if (requireTestDatabaseValue !== 'true' && requireTestDatabaseValue !== 'false') {
  throw new Error('REQUIRE_TEST_DATABASE must be either true or false');
}
const requireTestDatabase = requireTestDatabaseValue === 'true';

function isDedicatedTestDatabase(databaseUrl: string): boolean {
  try {
    const parsed = new URL(databaseUrl);
    const databaseName = decodeURIComponent(parsed.pathname.slice(1));
    return ['postgres:', 'postgresql:'].includes(parsed.protocol) &&
      /(?:^|[_-])(test|ci)(?:$|[_-])/i.test(databaseName);
  } catch {
    return false;
  }
}

/**
 * Check if a dedicated database connection is available for integration tests.
 * Destructive fixtures never run against an ordinary development or production
 * database name.
 */
async function checkDatabaseAvailable(): Promise<boolean> {
  let releaseConnection: (() => void) | undefined;
  let closePool: (() => Promise<void>) | undefined;
  try {
    const config = getConfig();
    if (
      config.env === 'production' ||
      !config.databaseUrl ||
      !isDedicatedTestDatabase(config.databaseUrl)
    ) return false;

    // Try to import and connect
    const { Pool } = await import('postgres');
    const pool = new Pool(config.databaseUrl, 1);
    closePool = () => pool.end();
    const conn = await pool.connect();
    releaseConnection = () => conn.release();
    await conn.queryObject('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    releaseConnection?.();
    await closePool?.().catch(() => undefined);
  }
}

/** Convenience: true when DB is NOT available (use as `ignore` flag in Deno.test) */
// Evaluated once at module load via top-level await
const testDatabaseAvailable = await checkDatabaseAvailable();
if (requireTestDatabase && !testDatabaseAvailable) {
  throw new Error(
    'REQUIRE_TEST_DATABASE=true but a dedicated, reachable *_test or *_ci PostgreSQL database was not available',
  );
}

export const SKIP_DB_TESTS = !testDatabaseAvailable;
