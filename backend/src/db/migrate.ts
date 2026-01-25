import { getPool } from './index.ts';

export async function runMigrations() {
  const pool = getPool();
  const conn = await pool.connect();

  try {
    // Check if schema is already initialized (by checking for users table)
    const { rows: tables } = await conn.queryObject<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users')`
    );

    if (tables[0]?.exists) {
      console.log('Schema already initialized, skipping migrations');
      return;
    }

    // Schema not initialized - this shouldn't happen in Docker since postgres init runs first
    // For local dev without Docker, we could run schema.sql here
    console.log('Warning: Schema not initialized. Run schema.sql manually or use Docker.');
  } finally {
    conn.release();
  }
}
