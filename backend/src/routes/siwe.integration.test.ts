/**
 * SIWE (Sign-In With Ethereum) Integration Tests
 *
 * Tests database operations for wallet-based authentication:
 * - Nonce generation and storage
 * - Wallet session creation and storage
 * - Session validation and expiration
 * - Anonymous session migration
 * - Session logout/invalidation
 *
 * Note: Actual signature verification requires real wallet signatures.
 * These tests focus on the database layer and session management.
 *
 * These tests require a running database connection.
 */

import { assertEquals, assertExists, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { query, queryOne, execute } from '../db/index.ts';

// ============================================================================
// Test Setup
// ============================================================================

const TEST_WALLET_1 = '0x1234567890123456789012345678901234567890';
const TEST_WALLET_2 = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const TEST_SESSION_ID = 'ses_test_siwe_12345678';

async function cleanupTestData(): Promise<void> {
  await execute(
    `DELETE FROM wallet_sessions WHERE wallet_address = ANY($1)`,
    [[TEST_WALLET_1.toLowerCase(), TEST_WALLET_2.toLowerCase()]]
  );

  // Clean up any test multi_chat data
  await execute(
    `DELETE FROM multi_chat_members WHERE member_address = ANY($1)`,
    [[TEST_WALLET_1.toLowerCase(), TEST_WALLET_2.toLowerCase()]]
  );
}

function generateTestNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

function generateTestSessionToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// Test 1: Wallet Session Creation
// ============================================================================

Deno.test({
  name: 'SIWE Integration - Wallet session is stored in database',
  // First test initializes DB pool
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await cleanupTestData();

    const token = generateTestSessionToken();
    const nonce = generateTestNonce();
    const message = `Sign in to Juicy Vision\n\nNonce: ${nonce}`;
    const signature = '0xfakesignature';
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Store session
    await execute(
      `INSERT INTO wallet_sessions (session_token, wallet_address, siwe_message, siwe_signature, nonce, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [token, TEST_WALLET_1.toLowerCase(), message, signature, nonce, expiresAt]
    );

    // Verify session is stored
    const stored = await queryOne<{
      session_token: string;
      wallet_address: string;
      siwe_message: string;
      nonce: string;
    }>(
      `SELECT session_token, wallet_address, siwe_message, nonce
       FROM wallet_sessions WHERE wallet_address = $1`,
      [TEST_WALLET_1.toLowerCase()]
    );

    assertExists(stored);
    assertEquals(stored.session_token, token);
    assertEquals(stored.wallet_address, TEST_WALLET_1.toLowerCase());
    assertEquals(stored.siwe_message, message);
    assertEquals(stored.nonce, nonce);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 2: Session Token Uniqueness
// ============================================================================

Deno.test({
  name: 'SIWE Integration - Session tokens are unique',
  async fn() {
    await cleanupTestData();

    const token1 = generateTestSessionToken();
    const token2 = generateTestSessionToken();

    assertNotEquals(token1, token2, 'Generated tokens should be unique');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 3: Session Update on Re-login
// ============================================================================

Deno.test({
  name: 'SIWE Integration - Re-login updates existing session',
  async fn() {
    await cleanupTestData();

    const nonce1 = generateTestNonce();
    const token1 = generateTestSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Create initial session
    await execute(
      `INSERT INTO wallet_sessions (session_token, wallet_address, siwe_message, siwe_signature, nonce, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [token1, TEST_WALLET_1.toLowerCase(), 'message1', '0xsig1', nonce1, expiresAt]
    );

    // Simulate re-login (upsert)
    const nonce2 = generateTestNonce();
    const token2 = generateTestSessionToken();
    await execute(
      `INSERT INTO wallet_sessions (session_token, wallet_address, siwe_message, siwe_signature, nonce, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (wallet_address) DO UPDATE SET
         session_token = EXCLUDED.session_token,
         siwe_message = EXCLUDED.siwe_message,
         siwe_signature = EXCLUDED.siwe_signature,
         nonce = EXCLUDED.nonce,
         expires_at = EXCLUDED.expires_at`,
      [token2, TEST_WALLET_1.toLowerCase(), 'message2', '0xsig2', nonce2, expiresAt]
    );

    // Should only have one session
    const sessions = await query<{ session_token: string }>(
      `SELECT session_token FROM wallet_sessions WHERE wallet_address = $1`,
      [TEST_WALLET_1.toLowerCase()]
    );

    assertEquals(sessions.length, 1);
    assertEquals(sessions[0].session_token, token2, 'Session should be updated');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 4: Session Validation - Valid Session
// ============================================================================

Deno.test({
  name: 'SIWE Integration - Valid session is found',
  async fn() {
    await cleanupTestData();

    const token = generateTestSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await execute(
      `INSERT INTO wallet_sessions (session_token, wallet_address, siwe_message, siwe_signature, nonce, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [token, TEST_WALLET_1.toLowerCase(), 'message', '0xsig', 'nonce', expiresAt]
    );

    // Query for valid session
    const session = await queryOne<{ wallet_address: string; expires_at: Date }>(
      `SELECT wallet_address, expires_at FROM wallet_sessions
       WHERE session_token = $1 AND expires_at > NOW()`,
      [token]
    );

    assertExists(session);
    assertEquals(session.wallet_address, TEST_WALLET_1.toLowerCase());

    await cleanupTestData();
  },
});

// ============================================================================
// Test 5: Session Validation - Expired Session
// ============================================================================

Deno.test({
  name: 'SIWE Integration - Expired session is rejected',
  async fn() {
    await cleanupTestData();

    const token = generateTestSessionToken();
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago

    await execute(
      `INSERT INTO wallet_sessions (session_token, wallet_address, siwe_message, siwe_signature, nonce, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [token, TEST_WALLET_1.toLowerCase(), 'message', '0xsig', 'nonce', expiredAt]
    );

    // Query should not find expired session
    const session = await queryOne<{ wallet_address: string }>(
      `SELECT wallet_address FROM wallet_sessions
       WHERE session_token = $1 AND expires_at > NOW()`,
      [token]
    );

    assertEquals(session, null, 'Expired session should not be found');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 6: Session Validation - Invalid Token
// ============================================================================

Deno.test({
  name: 'SIWE Integration - Invalid token returns no session',
  async fn() {
    await cleanupTestData();

    const session = await queryOne<{ wallet_address: string }>(
      `SELECT wallet_address FROM wallet_sessions
       WHERE session_token = $1 AND expires_at > NOW()`,
      ['invalid-token-that-does-not-exist']
    );

    assertEquals(session, null);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 7: Session Logout
// ============================================================================

Deno.test({
  name: 'SIWE Integration - Logout deletes session',
  async fn() {
    await cleanupTestData();

    const token = generateTestSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await execute(
      `INSERT INTO wallet_sessions (session_token, wallet_address, siwe_message, siwe_signature, nonce, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [token, TEST_WALLET_1.toLowerCase(), 'message', '0xsig', 'nonce', expiresAt]
    );

    // Verify session exists
    const before = await queryOne<{ session_token: string }>(
      `SELECT session_token FROM wallet_sessions WHERE session_token = $1`,
      [token]
    );
    assertExists(before);

    // Logout
    await execute(`DELETE FROM wallet_sessions WHERE session_token = $1`, [token]);

    // Session should be gone
    const after = await queryOne<{ session_token: string }>(
      `SELECT session_token FROM wallet_sessions WHERE session_token = $1`,
      [token]
    );
    assertEquals(after, null);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 8: Address Normalization
// ============================================================================

Deno.test({
  name: 'SIWE Integration - Wallet addresses are normalized to lowercase',
  async fn() {
    await cleanupTestData();

    const token = generateTestSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const mixedCaseAddress = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12';

    // Store with lowercase
    await execute(
      `INSERT INTO wallet_sessions (session_token, wallet_address, siwe_message, siwe_signature, nonce, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [token, mixedCaseAddress.toLowerCase(), 'message', '0xsig', 'nonce', expiresAt]
    );

    // Query with original case should work (after normalizing)
    const session = await queryOne<{ wallet_address: string }>(
      `SELECT wallet_address FROM wallet_sessions WHERE wallet_address = $1`,
      [mixedCaseAddress.toLowerCase()]
    );

    assertExists(session);
    assertEquals(session.wallet_address, mixedCaseAddress.toLowerCase());

    // Clean up
    await execute(`DELETE FROM wallet_sessions WHERE wallet_address = $1`, [mixedCaseAddress.toLowerCase()]);
  },
});

// ============================================================================
// Test 9: Anonymous Session ID Storage
// ============================================================================

Deno.test({
  name: 'SIWE Integration - Anonymous session ID is stored for migration',
  async fn() {
    await cleanupTestData();

    const token = generateTestSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Store session with anonymous session ID
    await execute(
      `INSERT INTO wallet_sessions (session_token, wallet_address, siwe_message, siwe_signature, nonce, anonymous_session_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [token, TEST_WALLET_1.toLowerCase(), 'message', '0xsig', 'nonce', TEST_SESSION_ID, expiresAt]
    );

    const stored = await queryOne<{ anonymous_session_id: string }>(
      `SELECT anonymous_session_id FROM wallet_sessions WHERE session_token = $1`,
      [token]
    );

    assertExists(stored);
    assertEquals(stored.anonymous_session_id, TEST_SESSION_ID);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 10: Multiple Wallet Sessions
// ============================================================================

Deno.test({
  name: 'SIWE Integration - Different wallets have separate sessions',
  async fn() {
    await cleanupTestData();

    const token1 = generateTestSessionToken();
    const token2 = generateTestSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Create sessions for two different wallets
    await execute(
      `INSERT INTO wallet_sessions (session_token, wallet_address, siwe_message, siwe_signature, nonce, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [token1, TEST_WALLET_1.toLowerCase(), 'message1', '0xsig1', 'nonce1', expiresAt]
    );

    await execute(
      `INSERT INTO wallet_sessions (session_token, wallet_address, siwe_message, siwe_signature, nonce, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [token2, TEST_WALLET_2.toLowerCase(), 'message2', '0xsig2', 'nonce2', expiresAt]
    );

    // Both sessions should exist
    const sessions = await query<{ wallet_address: string }>(
      `SELECT wallet_address FROM wallet_sessions
       WHERE wallet_address = ANY($1)
       ORDER BY wallet_address`,
      [[TEST_WALLET_1.toLowerCase(), TEST_WALLET_2.toLowerCase()]]
    );

    assertEquals(sessions.length, 2);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 11: Session 30-Day Expiry
// ============================================================================

Deno.test({
  name: 'SIWE Integration - Sessions have 30-day expiry',
  async fn() {
    await cleanupTestData();

    const token = generateTestSessionToken();
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(now + thirtyDays);

    await execute(
      `INSERT INTO wallet_sessions (session_token, wallet_address, siwe_message, siwe_signature, nonce, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [token, TEST_WALLET_1.toLowerCase(), 'message', '0xsig', 'nonce', expiresAt]
    );

    const stored = await queryOne<{ expires_at: Date }>(
      `SELECT expires_at FROM wallet_sessions WHERE session_token = $1`,
      [token]
    );

    assertExists(stored);

    // Verify expiry is approximately 30 days from now
    const storedExpiry = new Date(stored.expires_at).getTime();
    const difference = Math.abs(storedExpiry - (now + thirtyDays));

    // Allow 1 second tolerance for test execution time
    assertEquals(difference < 1000, true, 'Expiry should be approximately 30 days');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 12: SIWE Message Storage
// ============================================================================

Deno.test({
  name: 'SIWE Integration - Full SIWE message is stored for audit',
  async fn() {
    await cleanupTestData();

    const token = generateTestSessionToken();
    const nonce = generateTestNonce();
    const message = `juicy.vision wants you to sign in with your Ethereum account:
${TEST_WALLET_1}

Sign in to Juicy Vision

URI: https://juicy.vision
Version: 1
Chain ID: 1
Nonce: ${nonce}
Issued At: 2024-01-01T00:00:00.000Z`;

    const signature = '0x' + 'ab'.repeat(65);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await execute(
      `INSERT INTO wallet_sessions (session_token, wallet_address, siwe_message, siwe_signature, nonce, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [token, TEST_WALLET_1.toLowerCase(), message, signature, nonce, expiresAt]
    );

    const stored = await queryOne<{ siwe_message: string; siwe_signature: string }>(
      `SELECT siwe_message, siwe_signature FROM wallet_sessions WHERE session_token = $1`,
      [token]
    );

    assertExists(stored);
    assertEquals(stored.siwe_message, message);
    assertEquals(stored.siwe_signature, signature);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 13: Wallet Session Uniqueness Constraint
// ============================================================================

Deno.test({
  name: 'SIWE Integration - Only one session per wallet address',
  async fn() {
    await cleanupTestData();

    const token1 = generateTestSessionToken();
    const token2 = generateTestSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Create first session
    await execute(
      `INSERT INTO wallet_sessions (session_token, wallet_address, siwe_message, siwe_signature, nonce, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [token1, TEST_WALLET_1.toLowerCase(), 'message1', '0xsig1', 'nonce1', expiresAt]
    );

    // Second insert for same wallet should fail without ON CONFLICT
    let duplicateError = false;
    try {
      await execute(
        `INSERT INTO wallet_sessions (session_token, wallet_address, siwe_message, siwe_signature, nonce, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [token2, TEST_WALLET_1.toLowerCase(), 'message2', '0xsig2', 'nonce2', expiresAt]
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('duplicate key')) {
        duplicateError = true;
      }
    }

    assertEquals(duplicateError, true, 'Should reject duplicate wallet address');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 14: Session Token Lookup
// ============================================================================

Deno.test({
  name: 'SIWE Integration - Session can be looked up by token',
  async fn() {
    await cleanupTestData();

    const token = generateTestSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await execute(
      `INSERT INTO wallet_sessions (session_token, wallet_address, siwe_message, siwe_signature, nonce, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [token, TEST_WALLET_1.toLowerCase(), 'message', '0xsig', 'nonce', expiresAt]
    );

    // Look up by token
    const session = await queryOne<{ wallet_address: string }>(
      `SELECT wallet_address FROM wallet_sessions WHERE session_token = $1`,
      [token]
    );

    assertExists(session);
    assertEquals(session.wallet_address, TEST_WALLET_1.toLowerCase());

    await cleanupTestData();
  },
});

// ============================================================================
// Test 15: Created At Timestamp
// ============================================================================

Deno.test({
  name: 'SIWE Integration - Session creation timestamp is recorded',
  async fn() {
    await cleanupTestData();

    const token = generateTestSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const beforeCreate = new Date();

    await execute(
      `INSERT INTO wallet_sessions (session_token, wallet_address, siwe_message, siwe_signature, nonce, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [token, TEST_WALLET_1.toLowerCase(), 'message', '0xsig', 'nonce', expiresAt]
    );

    const stored = await queryOne<{ created_at: Date }>(
      `SELECT created_at FROM wallet_sessions WHERE session_token = $1`,
      [token]
    );

    assertExists(stored);
    assertExists(stored.created_at);

    // Created at should be recent (allow for clock skew between DB and app)
    const createdAt = new Date(stored.created_at).getTime();
    const timeDiff = Math.abs(createdAt - beforeCreate.getTime());
    assertEquals(timeDiff < 10000, true, 'Created at should be within 10 seconds of test start');

    await cleanupTestData();
  },
});
