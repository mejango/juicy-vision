// Test helpers for backend testing

import { getConfig } from '../utils/config.ts';

/**
 * Check if a database connection is available for integration tests.
 * Attempts an actual connection to verify the server is running.
 */
async function checkDatabaseAvailable(): Promise<boolean> {
  try {
    const config = getConfig();
    if (!config.databaseUrl) return false;

    // Try to import and connect
    const { Pool } = await import('postgres');
    const pool = new Pool(config.databaseUrl, 1);
    const conn = await pool.connect();
    await conn.queryObject('SELECT 1');
    conn.release();
    await pool.end();
    return true;
  } catch {
    return false;
  }
}

/** Convenience: true when DB is NOT available (use as `ignore` flag in Deno.test) */
// Evaluated once at module load via top-level await
export const SKIP_DB_TESTS = !(await checkDatabaseAvailable());
