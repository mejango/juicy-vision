import { getPool } from './index.ts';

export async function runMigrations() {
  const pool = getPool();
  const conn = await pool.connect();

  try {
    // Create migrations tracking table
    await conn.queryObject(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Get applied migrations
    const { rows } = await conn.queryObject<{ name: string }>('SELECT name FROM _migrations');
    const applied = new Set(rows.map((r) => r.name));

    // Read and sort migration files
    const dir = new URL('./migrations/', import.meta.url);
    const files: string[] = [];
    for await (const entry of Deno.readDir(dir)) {
      if (entry.name.endsWith('.sql')) files.push(entry.name);
    }
    files.sort();

    // Apply pending migrations
    for (const file of files) {
      if (applied.has(file)) continue;

      console.log(`Applying migration: ${file}`);
      const sql = await Deno.readTextFile(new URL(file, dir));

      await conn.queryObject('BEGIN');
      try {
        await conn.queryObject(sql);
        await conn.queryObject('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await conn.queryObject('COMMIT');
        console.log(`Applied: ${file}`);
      } catch (err) {
        await conn.queryObject('ROLLBACK');
        throw err;
      }
    }

    console.log('Migrations complete');
  } finally {
    conn.release();
  }
}
