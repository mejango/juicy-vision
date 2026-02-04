/**
 * Auth Service Integration Tests - Email OTP
 *
 * Tests database operations for email-based authentication:
 * - OTP code generation and invalidation
 * - OTP verification with timing-safe comparison
 * - User creation on first login
 * - Session management and expiration
 * - Email verification state
 *
 * These tests require a running database connection.
 */

import { assertEquals, assertExists, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { query, queryOne, execute } from '../db/index.ts';
import {
  createOtpCode,
  verifyOtpCode,
  findOrCreateUser,
  findUserByEmail,
  findUserById,
  markEmailVerified,
  createSession,
  findValidSession,
  deleteSession,
  deleteAllUserSessions,
  updateUserPrivacyMode,
} from './auth.ts';
import { SKIP_DB_TESTS } from '../test/helpers.ts';

// ============================================================================
// Test Setup
// ============================================================================

const TEST_EMAIL_1 = 'auth-test-1@integration.test';
const TEST_EMAIL_2 = 'auth-test-2@integration.test';
const TEST_EMAIL_3 = 'auth-test-3@integration.test';

async function cleanupTestData(): Promise<void> {
  // Get test user IDs
  const users = await query<{ id: string }>(
    `SELECT id FROM users WHERE email = ANY($1)`,
    [[TEST_EMAIL_1, TEST_EMAIL_2, TEST_EMAIL_3]]
  );
  const userIds = users.map(u => u.id);

  if (userIds.length > 0) {
    // Clean up sessions
    await execute(
      `DELETE FROM sessions WHERE user_id = ANY($1)`,
      [userIds]
    );
  }

  // Clean up OTP codes
  await execute(
    `DELETE FROM otp_codes WHERE email = ANY($1)`,
    [[TEST_EMAIL_1, TEST_EMAIL_2, TEST_EMAIL_3]]
  );

  // Clean up users
  await execute(
    `DELETE FROM users WHERE email = ANY($1)`,
    [[TEST_EMAIL_1, TEST_EMAIL_2, TEST_EMAIL_3]]
  );
}

// ============================================================================
// Test 1: OTP Code Generation
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Auth Integration - OTP code generation creates valid 6-digit code',
  // First test initializes DB pool
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await cleanupTestData();

    const code = await createOtpCode(TEST_EMAIL_1);

    // Verify code format
    assertEquals(code.length, 6);
    assertEquals(/^\d{6}$/.test(code), true, 'Code should be 6 digits');

    // Verify code is stored in database
    const stored = await queryOne<{ code: string; used: boolean }>(
      `SELECT code, used FROM otp_codes WHERE email = $1 AND used = FALSE`,
      [TEST_EMAIL_1]
    );

    assertExists(stored);
    assertEquals(stored.code, code);
    assertEquals(stored.used, false);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 2: OTP Code Invalidation
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Auth Integration - Creating new OTP invalidates previous codes',
  async fn() {
    await cleanupTestData();

    // Create first code
    const code1 = await createOtpCode(TEST_EMAIL_1);

    // Create second code (should invalidate first)
    const code2 = await createOtpCode(TEST_EMAIL_1);

    assertNotEquals(code1, code2, 'Codes should be different');

    // First code should be marked as used
    const firstCode = await queryOne<{ used: boolean }>(
      `SELECT used FROM otp_codes WHERE email = $1 AND code = $2`,
      [TEST_EMAIL_1, code1]
    );
    assertEquals(firstCode?.used, true, 'First code should be invalidated');

    // Second code should be valid
    const secondCode = await queryOne<{ used: boolean }>(
      `SELECT used FROM otp_codes WHERE email = $1 AND code = $2`,
      [TEST_EMAIL_1, code2]
    );
    assertEquals(secondCode?.used, false, 'Second code should be valid');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 3: OTP Verification Success
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Auth Integration - Valid OTP verification succeeds and marks code used',
  async fn() {
    await cleanupTestData();

    const code = await createOtpCode(TEST_EMAIL_1);
    const isValid = await verifyOtpCode(TEST_EMAIL_1, code);

    assertEquals(isValid, true);

    // Code should be marked as used
    const stored = await queryOne<{ used: boolean }>(
      `SELECT used FROM otp_codes WHERE email = $1 AND code = $2`,
      [TEST_EMAIL_1, code]
    );
    assertEquals(stored?.used, true, 'Code should be marked as used after verification');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 4: OTP Verification Failure - Wrong Code
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Auth Integration - Invalid OTP code is rejected',
  async fn() {
    await cleanupTestData();

    await createOtpCode(TEST_EMAIL_1);
    const isValid = await verifyOtpCode(TEST_EMAIL_1, '000000');

    assertEquals(isValid, false, 'Wrong code should be rejected');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 5: OTP Verification Failure - Already Used
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Auth Integration - Used OTP code cannot be reused',
  async fn() {
    await cleanupTestData();

    const code = await createOtpCode(TEST_EMAIL_1);

    // First verification succeeds
    const firstVerify = await verifyOtpCode(TEST_EMAIL_1, code);
    assertEquals(firstVerify, true);

    // Second verification fails
    const secondVerify = await verifyOtpCode(TEST_EMAIL_1, code);
    assertEquals(secondVerify, false, 'Used code should be rejected');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 6: OTP Verification - Case Insensitive Email
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Auth Integration - OTP verification is case-insensitive for email',
  async fn() {
    await cleanupTestData();

    // Create code with lowercase email
    const code = await createOtpCode(TEST_EMAIL_1.toLowerCase());

    // Verify with uppercase email
    const isValid = await verifyOtpCode(TEST_EMAIL_1.toUpperCase(), code);

    assertEquals(isValid, true, 'Email comparison should be case-insensitive');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 7: User Creation on First Login
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Auth Integration - findOrCreateUser creates new user on first login',
  async fn() {
    await cleanupTestData();

    // User should not exist
    const before = await findUserByEmail(TEST_EMAIL_1);
    assertEquals(before, null);

    // Create user
    const user = await findOrCreateUser(TEST_EMAIL_1);

    assertExists(user);
    assertEquals(user.email, TEST_EMAIL_1.toLowerCase());
    assertEquals(user.emailVerified, false, 'New user should not be verified');
    assertExists(user.custodialAddressIndex, 'User should have custodial address index');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 8: User Retrieval - Existing User
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Auth Integration - findOrCreateUser returns existing user',
  async fn() {
    await cleanupTestData();

    // Create user first
    const created = await findOrCreateUser(TEST_EMAIL_1);

    // Call again - should return same user
    const found = await findOrCreateUser(TEST_EMAIL_1);

    assertEquals(found.id, created.id, 'Should return same user');
    assertEquals(found.email, created.email);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 9: Custodial Address Index Uniqueness
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Auth Integration - Each user gets unique custodial address index',
  async fn() {
    await cleanupTestData();

    const user1 = await findOrCreateUser(TEST_EMAIL_1);
    const user2 = await findOrCreateUser(TEST_EMAIL_2);
    const user3 = await findOrCreateUser(TEST_EMAIL_3);

    assertNotEquals(user1.custodialAddressIndex, user2.custodialAddressIndex);
    assertNotEquals(user2.custodialAddressIndex, user3.custodialAddressIndex);
    assertNotEquals(user1.custodialAddressIndex, user3.custodialAddressIndex);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 10: Email Verification
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Auth Integration - markEmailVerified updates user state',
  async fn() {
    await cleanupTestData();

    const user = await findOrCreateUser(TEST_EMAIL_1);
    assertEquals(user.emailVerified, false);

    await markEmailVerified(user.id);

    const updated = await findUserById(user.id);
    assertEquals(updated?.emailVerified, true);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 11: Session Creation
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Auth Integration - createSession generates session and JWT token',
  async fn() {
    await cleanupTestData();

    const user = await findOrCreateUser(TEST_EMAIL_1);
    const { session, token } = await createSession(user.id);

    assertExists(session.id);
    assertEquals(session.userId, user.id);
    assertExists(session.expiresAt);
    assertExists(token);

    // Token should be a valid JWT format (header.payload.signature)
    const parts = token.split('.');
    assertEquals(parts.length, 3, 'Token should be valid JWT format');

    // Session should be in database
    const stored = await queryOne<{ user_id: string }>(
      `SELECT user_id FROM sessions WHERE id = $1`,
      [session.id]
    );
    assertEquals(stored?.user_id, user.id);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 12: Session Validation
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Auth Integration - findValidSession returns active sessions',
  async fn() {
    await cleanupTestData();

    const user = await findOrCreateUser(TEST_EMAIL_1);
    const { session: created } = await createSession(user.id);

    const found = await findValidSession(created.id);

    assertExists(found);
    assertEquals(found.id, created.id);
    assertEquals(found.userId, user.id);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 13: Session Deletion
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Auth Integration - deleteSession removes session',
  async fn() {
    await cleanupTestData();

    const user = await findOrCreateUser(TEST_EMAIL_1);
    const { session } = await createSession(user.id);

    // Session exists
    const before = await findValidSession(session.id);
    assertExists(before);

    // Delete session
    await deleteSession(session.id);

    // Session no longer exists
    const after = await findValidSession(session.id);
    assertEquals(after, null);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 14: Delete All User Sessions
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Auth Integration - deleteAllUserSessions removes all sessions for user',
  async fn() {
    await cleanupTestData();

    const user = await findOrCreateUser(TEST_EMAIL_1);

    // Create multiple sessions
    const { session: s1 } = await createSession(user.id);
    const { session: s2 } = await createSession(user.id);
    const { session: s3 } = await createSession(user.id);

    // All sessions exist
    assertEquals((await findValidSession(s1.id)) !== null, true);
    assertEquals((await findValidSession(s2.id)) !== null, true);
    assertEquals((await findValidSession(s3.id)) !== null, true);

    // Delete all
    await deleteAllUserSessions(user.id);

    // All sessions gone
    assertEquals(await findValidSession(s1.id), null);
    assertEquals(await findValidSession(s2.id), null);
    assertEquals(await findValidSession(s3.id), null);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 15: Privacy Mode Update
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Auth Integration - updateUserPrivacyMode changes user privacy setting',
  async fn() {
    await cleanupTestData();

    const user = await findOrCreateUser(TEST_EMAIL_1);
    assertEquals(user.privacyMode, 'open_book', 'Default should be open_book');

    // Update to ghost mode
    await updateUserPrivacyMode(user.id, 'ghost');

    const updated = await findUserById(user.id);
    assertEquals(updated?.privacyMode, 'ghost');

    // Update to anonymous
    await updateUserPrivacyMode(user.id, 'anonymous');
    const updated2 = await findUserById(user.id);
    assertEquals(updated2?.privacyMode, 'anonymous');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 16: User Lookup by ID
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Auth Integration - findUserById returns user or null',
  async fn() {
    await cleanupTestData();

    // Non-existent user
    const notFound = await findUserById('00000000-0000-0000-0000-000000000000');
    assertEquals(notFound, null);

    // Create and find user
    const created = await findOrCreateUser(TEST_EMAIL_1);
    const found = await findUserById(created.id);

    assertExists(found);
    assertEquals(found.id, created.id);
    assertEquals(found.email, created.email);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 17: OTP Verification - No Code Exists
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Auth Integration - OTP verification fails gracefully when no code exists',
  async fn() {
    await cleanupTestData();

    // No code created for this email
    const isValid = await verifyOtpCode(TEST_EMAIL_1, '123456');

    assertEquals(isValid, false, 'Should return false when no code exists');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 18: User Data Isolation
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Auth Integration - User queries are properly isolated',
  async fn() {
    await cleanupTestData();

    const user1 = await findOrCreateUser(TEST_EMAIL_1);
    const user2 = await findOrCreateUser(TEST_EMAIL_2);

    // Create sessions for both
    const { session: s1 } = await createSession(user1.id);
    const { session: s2 } = await createSession(user2.id);

    // Sessions are isolated
    const found1 = await findValidSession(s1.id);
    const found2 = await findValidSession(s2.id);

    assertEquals(found1?.userId, user1.id);
    assertEquals(found2?.userId, user2.id);

    // Delete user1's sessions doesn't affect user2
    await deleteAllUserSessions(user1.id);

    assertEquals(await findValidSession(s1.id), null);
    assertExists(await findValidSession(s2.id));

    await cleanupTestData();
  },
});
