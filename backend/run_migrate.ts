import { closePool } from './src/db/index.ts';
import { runMigrations } from './src/db/migrate.ts';
import { getConfig, validateProductionConfig } from './src/utils/config.ts';

validateProductionConfig(getConfig());

try {
  await runMigrations();
} finally {
  await closePool();
}
