-- Seed comprehensive test data for E2E testing
-- Run with: psql -U postgres -d juicyvision -f e2e/fixtures/seed-test-data.sql
--
-- This creates:
-- - Test users with different states
-- - Sample projects with tiers
-- - Transaction history
-- - Chat sessions
-- - Activity data

BEGIN;

-- ============================================================================
-- CLEAN UP OLD TEST DATA
-- ============================================================================

DELETE FROM users WHERE email LIKE 'e2e-%@test.juicy.vision';

-- ============================================================================
-- TEST USERS
-- ============================================================================

-- User 1: Standard user with some activity
INSERT INTO users (id, email, email_verified, privacy_mode, custodial_address_index)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'e2e-user@test.juicy.vision',
  true,
  'open_book',
  1000
) ON CONFLICT (email) DO UPDATE SET email_verified = true, updated_at = NOW();

-- User 2: Power user with lots of activity
INSERT INTO users (id, email, email_verified, privacy_mode, custodial_address_index)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  'e2e-power@test.juicy.vision',
  true,
  'open_book',
  1001
) ON CONFLICT (email) DO UPDATE SET email_verified = true, updated_at = NOW();

-- User 3: Anonymous user
INSERT INTO users (id, email, email_verified, privacy_mode, custodial_address_index)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  'e2e-anon@test.juicy.vision',
  true,
  'anonymous',
  1002
) ON CONFLICT (email) DO UPDATE SET email_verified = true, updated_at = NOW();

-- User 4: Ghost user
INSERT INTO users (id, email, email_verified, privacy_mode, custodial_address_index)
VALUES (
  '44444444-4444-4444-4444-444444444444',
  'e2e-ghost@test.juicy.vision',
  true,
  'ghost',
  1003
) ON CONFLICT (email) DO UPDATE SET email_verified = true, updated_at = NOW();

-- User 5: New user (no activity)
INSERT INTO users (id, email, email_verified, privacy_mode, custodial_address_index)
VALUES (
  '55555555-5555-5555-5555-555555555555',
  'e2e-new@test.juicy.vision',
  true,
  'open_book',
  1004
) ON CONFLICT (email) DO UPDATE SET email_verified = true, updated_at = NOW();

-- User 6: Project owner
INSERT INTO users (id, email, email_verified, privacy_mode, custodial_address_index)
VALUES (
  '66666666-6666-6666-6666-666666666666',
  'e2e-owner@test.juicy.vision',
  true,
  'open_book',
  1005
) ON CONFLICT (email) DO UPDATE SET email_verified = true, updated_at = NOW();

-- ============================================================================
-- SESSIONS FOR ALL USERS
-- ============================================================================

DELETE FROM sessions WHERE user_id IN (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
  '66666666-6666-6666-6666-666666666666'
);

INSERT INTO sessions (user_id, expires_at)
VALUES
  ('11111111-1111-1111-1111-111111111111', NOW() + INTERVAL '30 days'),
  ('22222222-2222-2222-2222-222222222222', NOW() + INTERVAL '30 days'),
  ('33333333-3333-3333-3333-333333333333', NOW() + INTERVAL '30 days'),
  ('44444444-4444-4444-4444-444444444444', NOW() + INTERVAL '30 days'),
  ('55555555-5555-5555-5555-555555555555', NOW() + INTERVAL '30 days'),
  ('66666666-6666-6666-6666-666666666666', NOW() + INTERVAL '30 days');

-- ============================================================================
-- CHAT SESSIONS (if table exists)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_sessions') THEN
    -- Clean up test chat sessions
    DELETE FROM chat_sessions WHERE user_id IN (
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222'
    );

    -- Create some chat sessions
    INSERT INTO chat_sessions (id, user_id, title, created_at)
    VALUES
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Project Planning', NOW() - INTERVAL '1 day'),
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'Store Setup Help', NOW() - INTERVAL '2 hours'),
      ('cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 'Payment Questions', NOW() - INTERVAL '30 minutes')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ============================================================================
-- CREATED PROJECTS (if table exists)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'created_projects') THEN
    -- Clean up test projects
    DELETE FROM created_projects WHERE user_id = '66666666-6666-6666-6666-666666666666';

    -- Create test projects for the owner
    INSERT INTO created_projects (id, user_id, project_id, chain_id, name, description, created_at)
    VALUES
      ('proj-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666666', 1, 1, 'E2E Test Store', 'A test store for E2E testing', NOW() - INTERVAL '7 days'),
      ('proj-2222-2222-2222-222222222222', '66666666-6666-6666-6666-666666666666', 2, 1, 'NFT Collection', 'Test NFT collection', NOW() - INTERVAL '3 days'),
      ('proj-3333-3333-3333-333333333333', '66666666-6666-6666-6666-666666666666', 3, 10, 'Optimism Project', 'Test project on Optimism', NOW() - INTERVAL '1 day')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ============================================================================
-- JUICE BALANCES (if table exists)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'juice_balances') THEN
    -- Clean up test balances
    DELETE FROM juice_balances WHERE user_id IN (
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222'
    );

    -- Give test users some juice
    INSERT INTO juice_balances (user_id, balance)
    VALUES
      ('11111111-1111-1111-1111-111111111111', 1000),
      ('22222222-2222-2222-2222-222222222222', 5000)
    ON CONFLICT (user_id) DO UPDATE SET balance = EXCLUDED.balance;
  END IF;
END $$;

-- ============================================================================
-- EVENTS / ACTIVITY (if table exists)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events') THEN
    -- Clean up test events
    DELETE FROM events WHERE user_id IN (
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      '66666666-6666-6666-6666-666666666666'
    );

    -- Add some activity events
    INSERT INTO events (user_id, event_type, event_data, created_at)
    VALUES
      ('11111111-1111-1111-1111-111111111111', 'login', '{"method": "passkey"}', NOW() - INTERVAL '1 hour'),
      ('11111111-1111-1111-1111-111111111111', 'view_project', '{"projectId": 1}', NOW() - INTERVAL '30 minutes'),
      ('22222222-2222-2222-2222-222222222222', 'purchase', '{"projectId": 1, "tierId": 1, "amount": "0.1"}', NOW() - INTERVAL '2 hours'),
      ('66666666-6666-6666-6666-666666666666', 'create_project', '{"projectId": 1, "name": "E2E Test Store"}', NOW() - INTERVAL '7 days'),
      ('66666666-6666-6666-6666-666666666666', 'add_tier', '{"projectId": 1, "tierName": "Gold"}', NOW() - INTERVAL '6 days')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- VERIFY SEEDED DATA
-- ============================================================================

SELECT 'Users:' AS section;
SELECT id, email, privacy_mode, email_verified FROM users WHERE email LIKE 'e2e-%@test.juicy.vision' ORDER BY email;

SELECT 'Sessions:' AS section;
SELECT u.email, s.expires_at
FROM sessions s
JOIN users u ON s.user_id = u.id
WHERE u.email LIKE 'e2e-%@test.juicy.vision'
ORDER BY u.email;
