import { assertEquals, assertRejects } from 'std/assert/mod.ts';
import {
  INITIAL_SCHEMA_MIGRATION,
  type MigrationConnection,
  pendingMigrations,
  snapshotBaseline,
  withMigrationLock,
  withMigrationTransaction,
} from './migrate.ts';

function recordingConnection(queries: string[]): MigrationConnection {
  return {
    queryObject<T>(query: string): Promise<{ rows: T[] }> {
      queries.push(query.trim().replaceAll(/\s+/g, ' '));
      return Promise.resolve({ rows: [] });
    },
  };
}

Deno.test('migration transaction commits successful work', async () => {
  const queries: string[] = [];
  const connection = recordingConnection(queries);
  await withMigrationTransaction(connection, async () => {
    await connection.queryObject('ALTER TABLE example ADD COLUMN value text');
  });
  assertEquals(queries, [
    'BEGIN',
    'ALTER TABLE example ADD COLUMN value text',
    'COMMIT',
  ]);
});

Deno.test('migration failure rolls back before releasing the advisory lock', async () => {
  const queries: string[] = [];
  const connection = recordingConnection(queries);

  await assertRejects(
    () =>
      withMigrationLock(connection, () =>
        withMigrationTransaction(connection, async () => {
          await connection.queryObject('BROKEN MIGRATION');
          throw new Error('migration failed');
        })),
    Error,
    'migration failed',
  );

  assertEquals(queries.map((query) => query.split('(')[0]), [
    'SELECT pg_advisory_lock',
    'BEGIN',
    'BROKEN MIGRATION',
    'ROLLBACK',
    'SELECT pg_advisory_unlock',
  ]);
});

Deno.test('fresh schema snapshot records only its reviewed migration baseline', () => {
  assertEquals(
    snapshotBaseline([
      '001_initial_schema.sql',
      '010_transaction_session_ownership.sql',
      '011_smart_account_withdrawal_delay.sql',
    ]),
    ['001_initial_schema.sql', '010_transaction_session_ownership.sql'],
  );
});

Deno.test('legacy schemas never replay the non-idempotent initial migration', () => {
  assertEquals(
    pendingMigrations(
      [INITIAL_SCHEMA_MIGRATION, '010_transaction_session_ownership.sql', '011_next.sql'],
      new Set(['010_transaction_session_ownership.sql']),
      true,
    ),
    ['011_next.sql'],
  );
});
