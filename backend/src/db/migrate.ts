import { getPool } from './index.ts';

const MIGRATION_LOCK_NAME = 'juicy-vision-schema-migrations-v1';
const SCHEMA_SNAPSHOT_BASELINE = '010_transaction_session_ownership.sql';
export const INITIAL_SCHEMA_MIGRATION = '001_initial_schema.sql';

export interface MigrationConnection {
  queryObject<T = Record<string, unknown>>(
    query: string,
    args?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export async function withMigrationTransaction<T>(
  connection: MigrationConnection,
  operation: () => Promise<T>,
): Promise<T> {
  await connection.queryObject('BEGIN');
  try {
    const result = await operation();
    await connection.queryObject('COMMIT');
    return result;
  } catch (error) {
    await connection.queryObject('ROLLBACK');
    throw error;
  }
}

export async function withMigrationLock<T>(
  connection: MigrationConnection,
  operation: () => Promise<T>,
): Promise<T> {
  await connection.queryObject(`SELECT pg_advisory_lock(hashtext($1))`, [MIGRATION_LOCK_NAME]);
  try {
    return await operation();
  } finally {
    await connection.queryObject(`SELECT pg_advisory_unlock(hashtext($1))`, [MIGRATION_LOCK_NAME]);
  }
}

export function snapshotBaseline(migrations: string[]): string[] {
  return migrations.filter((migration) => migration <= SCHEMA_SNAPSHOT_BASELINE);
}

export function pendingMigrations(
  migrations: string[],
  applied: ReadonlySet<string>,
  schemaExists: boolean,
): string[] {
  return migrations.filter((migration) =>
    !applied.has(migration) &&
    !(schemaExists && migration === INITIAL_SCHEMA_MIGRATION)
  );
}

async function migrationNames(): Promise<string[]> {
  const migrationsDir = new URL('./migrations/', import.meta.url);
  const migrations: string[] = [];
  for await (const entry of Deno.readDir(migrationsDir)) {
    if (entry.isFile && entry.name.endsWith('.sql')) migrations.push(entry.name);
  }
  return migrations.sort();
}

export async function runMigrations(): Promise<void> {
  const pool = getPool();
  const conn = await pool.connect();
  const connection = conn as unknown as MigrationConnection;

  try {
    await withMigrationLock(connection, async () => {
      await connection.queryObject('SET search_path TO public');

      // Check if schema is already initialized (by checking for users table)
      const { rows: tables } = await connection.queryObject<{ exists: boolean }>(
        `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
      ) AS exists`,
      );

      const migrations = await migrationNames();

      const schemaExists = tables[0]?.exists ?? false;

      if (!schemaExists) {
        console.log('Initializing database from the reviewed schema snapshot...');

        const schemaPath = new URL('./schema.sql', import.meta.url);
        const schemaSql = await Deno.readTextFile(schemaPath);

        // Filter out psql-specific commands that postgres doesn't understand
        const cleanedSql = schemaSql
          .split('\n')
          .filter((line) => !line.startsWith('\\'))
          .join('\n');

        await withMigrationTransaction(connection, async () => {
          await connection.queryObject(cleanedSql);
          // pg_dump snapshots deliberately clear search_path. Restore the
          // application schema before issuing unqualified migration queries.
          await connection.queryObject('SET search_path TO public');
          await connection.queryObject(`
            CREATE TABLE IF NOT EXISTS public._migrations (
              id SERIAL PRIMARY KEY,
              name VARCHAR(255) NOT NULL UNIQUE,
              applied_at TIMESTAMPTZ DEFAULT NOW()
            )
          `);

          // schema.sql is a reviewed snapshot through this migration. Recording
          // the baseline prevents the next boot from replaying non-idempotent ALTERs.
          for (const migration of snapshotBaseline(migrations)) {
            await connection.queryObject(
              `INSERT INTO public._migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
              [migration],
            );
          }
        });
        console.log(`Schema snapshot initialized through ${SCHEMA_SNAPSHOT_BASELINE}`);
      }

      await connection.queryObject(`
        CREATE TABLE IF NOT EXISTS public._migrations (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL UNIQUE,
          applied_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // The legacy runner deliberately skipped 001 and did not record the
      // snapshot baseline on first initialization. An existing Juicy schema
      // can therefore have 002+ recorded while 001 is absent. Record that
      // bootstrap as already present; replaying its CREATE TABLE statements is
      // non-idempotent and would break upgrades.
      if (schemaExists && migrations.includes(INITIAL_SCHEMA_MIGRATION)) {
        const { rows: seeded } = await connection.queryObject<{ name: string }>(
          `INSERT INTO public._migrations (name)
           VALUES ($1)
           ON CONFLICT (name) DO NOTHING
           RETURNING name`,
          [INITIAL_SCHEMA_MIGRATION],
        );
        if (seeded.length > 0) {
          console.log(`Recorded legacy schema baseline: ${INITIAL_SCHEMA_MIGRATION}`);
        }
      }

      const { rows: applied } = await connection.queryObject<{ name: string }>(
        `SELECT name FROM public._migrations ORDER BY name`,
      );
      const appliedSet = new Set(applied.map((row) => row.name));
      let appliedCount = 0;

      for (const migration of pendingMigrations(migrations, appliedSet, schemaExists)) {
        console.log(`Applying migration: ${migration}`);
        const migrationPath = new URL(`./migrations/${migration}`, import.meta.url);
        const migrationSql = await Deno.readTextFile(migrationPath);

        await withMigrationTransaction(connection, async () => {
          await connection.queryObject(migrationSql);
          await connection.queryObject(`INSERT INTO public._migrations (name) VALUES ($1)`, [
            migration,
          ]);
        });
        appliedCount++;
      }

      if (appliedCount > 0) console.log(`Applied ${appliedCount} migration(s)`);
      else console.log('No pending migrations');
    });
  } catch (error) {
    console.error('Migration error:', error);
    throw error;
  } finally {
    conn.release();
  }
}
