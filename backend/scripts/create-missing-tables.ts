// Quick script to create missing tables
import { Pool } from 'postgres';

const databaseUrl = Deno.env.get('DATABASE_URL');
if (!databaseUrl) {
  console.error('DATABASE_URL not set');
  Deno.exit(1);
}

const pool = new Pool(databaseUrl, 1);
const conn = await pool.connect();

try {
  console.log('Enabling uuid-ossp extension...');
  await conn.queryObject(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

  console.log('Creating passkey_challenges table...');
  await conn.queryObject(`
    CREATE TABLE IF NOT EXISTS passkey_challenges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      challenge BYTEA UNIQUE NOT NULL,
      challenge_b64 VARCHAR(128) NOT NULL,
      type VARCHAR(20) NOT NULL CHECK (type IN ('registration', 'authentication')),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      email VARCHAR(255),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await conn.queryObject(`
    CREATE INDEX IF NOT EXISTS idx_passkey_challenges_challenge ON passkey_challenges(challenge_b64);
  `);
  await conn.queryObject(`
    CREATE INDEX IF NOT EXISTS idx_passkey_challenges_expires ON passkey_challenges(expires_at);
  `);

  console.log('Creating juicy_identities table...');
  await conn.queryObject(`
    CREATE TABLE IF NOT EXISTS juicy_identities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      address VARCHAR(42) NOT NULL UNIQUE,
      emoji VARCHAR(10) NOT NULL,
      username VARCHAR(20) NOT NULL,
      username_lower VARCHAR(20) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(emoji, username_lower)
    );
  `);

  await conn.queryObject(`
    CREATE INDEX IF NOT EXISTS idx_juicy_identities_lookup ON juicy_identities(emoji, username_lower);
  `);
  await conn.queryObject(`
    CREATE INDEX IF NOT EXISTS idx_juicy_identities_address ON juicy_identities(address);
  `);

  console.log('Done! All tables created.');
} catch (err) {
  console.error('Error:', err);
  Deno.exit(1);
} finally {
  conn.release();
  await pool.end();
}
