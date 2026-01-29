import { getPool } from './index.ts';

export async function runMigrations() {
  const pool = getPool();
  const conn = await pool.connect();

  try {
    // Check if schema is already initialized (by checking for users table)
    const { rows: tables } = await conn.queryObject<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users')`
    );

    if (!tables[0]?.exists) {
      // Fresh database - apply initial schema
      console.log('Initializing database schema...');

      const schemaPath = new URL('./schema.sql', import.meta.url);
      const schemaSql = await Deno.readTextFile(schemaPath);

      // Filter out psql-specific commands that postgres doesn't understand
      const cleanedSql = schemaSql
        .split('\n')
        .filter(line => !line.startsWith('\\'))
        .join('\n');

      await conn.queryObject(cleanedSql);
      console.log('Database schema initialized successfully');
      return;
    }

    // Schema exists - check for and apply incremental migrations
    console.log('Schema exists, checking for migrations...');

    // Create migrations tracking table if it doesn't exist
    await conn.queryObject(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Get list of applied migrations
    const { rows: applied } = await conn.queryObject<{ name: string }>(
      `SELECT name FROM _migrations ORDER BY name`
    );
    const appliedSet = new Set(applied.map(r => r.name));

    // Scan migrations directory for .sql files
    const migrationsDir = new URL('./migrations/', import.meta.url);
    const migrations: string[] = [];

    try {
      for await (const entry of Deno.readDir(migrationsDir)) {
        if (entry.isFile && entry.name.endsWith('.sql') && !entry.name.startsWith('001_initial')) {
          migrations.push(entry.name);
        }
      }
    } catch {
      // No migrations directory or empty - that's fine
    }

    // Sort and apply pending migrations
    migrations.sort();
    let appliedCount = 0;

    for (const migration of migrations) {
      if (appliedSet.has(migration)) continue;

      console.log(`Applying migration: ${migration}`);
      const migrationPath = new URL(`./migrations/${migration}`, import.meta.url);
      const migrationSql = await Deno.readTextFile(migrationPath);

      await conn.queryObject(migrationSql);
      await conn.queryObject(
        `INSERT INTO _migrations (name) VALUES ($1)`,
        [migration]
      );
      appliedCount++;
    }

    if (appliedCount > 0) {
      console.log(`Applied ${appliedCount} migration(s)`);
    } else {
      console.log('No pending migrations');
    }
  } catch (error) {
    console.error('Migration error:', error);
    throw error;
  } finally {
    conn.release();
  }
}
