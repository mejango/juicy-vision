import { closePool, query, queryOne, transaction } from '../src/db/index.ts';
import { INITIAL_SCHEMA_MIGRATION, runMigrations } from '../src/db/migrate.ts';
import { getConfig } from '../src/utils/config.ts';

const LEGACY_APPLIED_MIGRATIONS = [
  '002_add_message_attachments.sql',
  '002_terminal_tables.sql',
  '003_ruleset_cache.sql',
  '004_escalation.sql',
  '005_intent_embeddings.sql',
  '006_intent_metrics.sql',
  '007_add_users_is_admin.sql',
  '008_terminal_wallet_integrity.sql',
  '009_relayr_bundle_idempotency.sql',
  '010_transaction_session_ownership.sql',
] as const;
const WITHDRAWAL_REPAIR_MIGRATION = '011_smart_account_withdrawal_delay.sql';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Legacy migration integration failed: ${message}`);
}

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

async function migrationState(): Promise<Array<{ name: string; applied_at: string }>> {
  return await query<{ name: string; applied_at: string }>(
    `SELECT name, applied_at::text AS applied_at
     FROM public._migrations
     ORDER BY name`,
  );
}

async function withdrawalColumns(): Promise<
  Array<{ column_name: string; is_nullable: string; column_default: string | null }>
> {
  return await query<{ column_name: string; is_nullable: string; column_default: string | null }>(
    `SELECT column_name, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'smart_account_withdrawals'
       AND column_name IN ('transfer_type', 'available_at')
     ORDER BY column_name`,
  );
}

const config = getConfig();
assert(config.env !== 'production', 'the destructive fixture cannot run in production');
assert(
  isDedicatedTestDatabase(config.databaseUrl),
  'DATABASE_URL must name a dedicated *_test or *_ci PostgreSQL database',
);

try {
  // Recreate the exact metadata/schema gap left by the legacy migration runner:
  // the snapshot exists, migrations 002-010 are recorded, 001 is not recorded,
  // and the delayed-withdrawal repair has not yet been applied.
  await transaction(async (connection) => {
    await connection.queryObject(
      `DELETE FROM public._migrations WHERE name IN ($1, $2)`,
      [INITIAL_SCHEMA_MIGRATION, WITHDRAWAL_REPAIR_MIGRATION],
    );
    await connection.queryObject(
      `DROP INDEX IF EXISTS public.idx_withdrawals_available_at`,
    );
    await connection.queryObject(
      `ALTER TABLE public.smart_account_withdrawals
       DROP CONSTRAINT IF EXISTS smart_account_withdrawals_transfer_type_check`,
    );
    await connection.queryObject(
      `ALTER TABLE public.smart_account_withdrawals
       DROP COLUMN IF EXISTS available_at,
       DROP COLUMN IF EXISTS transfer_type`,
    );
  });

  const legacyMigrations = new Set((await migrationState()).map((row) => row.name));
  assert(!legacyMigrations.has(INITIAL_SCHEMA_MIGRATION), 'legacy 001 must start unrecorded');
  for (const migration of LEGACY_APPLIED_MIGRATIONS) {
    assert(legacyMigrations.has(migration), `legacy fixture must retain applied ${migration}`);
  }
  assert(
    legacyMigrations.size === LEGACY_APPLIED_MIGRATIONS.length,
    'legacy fixture migration inventory must contain exactly 002 through 010',
  );
  assert(
    !legacyMigrations.has(WITHDRAWAL_REPAIR_MIGRATION),
    'legacy 011 must start unapplied',
  );
  assert((await withdrawalColumns()).length === 0, 'legacy withdrawal columns must be absent');

  await runMigrations();

  const upgradedMigrations = new Set((await migrationState()).map((row) => row.name));
  assert(upgradedMigrations.has(INITIAL_SCHEMA_MIGRATION), 'legacy 001 must be safely recorded');
  assert(
    upgradedMigrations.has(WITHDRAWAL_REPAIR_MIGRATION),
    'withdrawal repair migration must be applied',
  );

  const columns = await withdrawalColumns();
  const transferType = columns.find((column) => column.column_name === 'transfer_type');
  assert(transferType, 'transfer_type must be restored');
  assert(transferType.is_nullable === 'NO', 'transfer_type must remain NOT NULL');
  assert(
    transferType.column_default?.includes('immediate'),
    'transfer_type must retain its immediate default',
  );
  assert(
    columns.some((column) => column.column_name === 'available_at'),
    'available_at must be restored',
  );

  const constraint = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'smart_account_withdrawals_transfer_type_check'
         AND conrelid = 'public.smart_account_withdrawals'::regclass
     ) AS exists`,
  );
  assert(constraint?.exists, 'transfer_type check constraint must be restored');

  const index = await queryOne<{ exists: boolean }>(
    `SELECT to_regclass('public.idx_withdrawals_available_at') IS NOT NULL AS exists`,
  );
  assert(index?.exists, 'delayed-withdrawal availability index must be restored');

  const stateAfterUpgrade = JSON.stringify(await migrationState());
  await runMigrations();
  assert(
    JSON.stringify(await migrationState()) === stateAfterUpgrade,
    'a second migration run must leave migration state unchanged',
  );

  console.log('Legacy 001 baseline, 011 upgrade, and second-run idempotency verified.');
} finally {
  await closePool();
}
