-- Seed test users for E2E testing
-- Run with: psql -U postgres -d juicyvision -f e2e/fixtures/seed-test-users.sql

BEGIN;

-- Clean up any existing test users first
DELETE FROM users WHERE email LIKE 'e2e-%@test.juicy.vision';

-- Test User 1: Standard verified user for general testing
INSERT INTO users (id, email, email_verified, privacy_mode, custodial_address_index)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'e2e-user@test.juicy.vision',
  true,
  'open_book',
  1000
) ON CONFLICT (email) DO UPDATE SET
  email_verified = true,
  updated_at = NOW();

-- Test User 2: Power user for advanced flow testing
INSERT INTO users (id, email, email_verified, privacy_mode, custodial_address_index)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  'e2e-power@test.juicy.vision',
  true,
  'open_book',
  1001
) ON CONFLICT (email) DO UPDATE SET
  email_verified = true,
  updated_at = NOW();

-- Test User 3: Anonymous user for privacy testing
INSERT INTO users (id, email, email_verified, privacy_mode, custodial_address_index)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  'e2e-anon@test.juicy.vision',
  true,
  'anonymous',
  1002
) ON CONFLICT (email) DO UPDATE SET
  email_verified = true,
  privacy_mode = 'anonymous',
  updated_at = NOW();

-- Test User 4: Ghost user (maximum privacy)
INSERT INTO users (id, email, email_verified, privacy_mode, custodial_address_index)
VALUES (
  '44444444-4444-4444-4444-444444444444',
  'e2e-ghost@test.juicy.vision',
  true,
  'ghost',
  1003
) ON CONFLICT (email) DO UPDATE SET
  email_verified = true,
  privacy_mode = 'ghost',
  updated_at = NOW();

-- Clean up old sessions for test users
DELETE FROM sessions WHERE user_id IN (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444'
);

-- Create long-lived sessions for test users (30 days)
INSERT INTO sessions (user_id, expires_at)
VALUES
  ('11111111-1111-1111-1111-111111111111', NOW() + INTERVAL '30 days'),
  ('22222222-2222-2222-2222-222222222222', NOW() + INTERVAL '30 days'),
  ('33333333-3333-3333-3333-333333333333', NOW() + INTERVAL '30 days'),
  ('44444444-4444-4444-4444-444444444444', NOW() + INTERVAL '30 days');

COMMIT;

-- Verify seeded users
SELECT
  u.id,
  u.email,
  u.email_verified,
  u.privacy_mode,
  s.id as session_id,
  s.expires_at
FROM users u
JOIN sessions s ON u.id = s.user_id
WHERE u.email LIKE 'e2e-%@test.juicy.vision'
ORDER BY u.email;
