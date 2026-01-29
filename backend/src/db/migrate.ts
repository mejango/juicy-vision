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

    // Schema not initialized - apply initial schema
    console.log('Initializing database schema...');

    // Read and execute schema.sql
    const schemaPath = new URL('./schema.sql', import.meta.url);
    const schemaSql = await Deno.readTextFile(schemaPath);

    // Filter out psql-specific commands that postgres doesn't understand
    const cleanedSql = schemaSql
      .split('\n')
      .filter(line => !line.startsWith('\\'))  // Remove psql meta-commands
      .join('\n');

    await conn.queryObject(cleanedSql);
    console.log('Database schema initialized successfully');
  } catch (error) {
    console.error('Migration error:', error);
    throw error;
  } finally {
    conn.release();
  }
}
