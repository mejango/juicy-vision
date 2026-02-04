/**
 * Passkey Service Integration Tests - WebAuthn
 *
 * Tests database operations for passkey/WebAuthn authentication:
 * - Challenge creation and expiration
 * - Challenge consumption (one-time use)
 * - Credential storage and retrieval
 * - Counter validation (replay attack protection)
 * - Credential management (list, rename, delete)
 * - Passkey-only signup flow
 *
 * Note: These tests focus on database operations. Actual WebAuthn
 * cryptographic verification requires browser/device interaction
 * and is tested via E2E tests.
 *
 * These tests require a running database connection.
 */

import { assertEquals, assertExists, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { query, queryOne, execute } from '../db/index.ts';
import {
  createRegistrationChallenge,
  createAuthenticationChallenge,
  getUserPasskeys,
  deletePasskey,
  renamePasskey,
  cleanupExpiredChallenges,
} from './passkey.ts';
import { findOrCreateUser } from './auth.ts';
import { SKIP_DB_TESTS } from '../test/helpers.ts';

// ============================================================================
// Test Setup
// ============================================================================

const TEST_EMAIL_1 = 'passkey-test-1@integration.test';
const TEST_EMAIL_2 = 'passkey-test-2@integration.test';
const TEST_CREDENTIAL_ID = 'test-credential-id-12345';
const TEST_CREDENTIAL_ID_B64 = 'dGVzdC1jcmVkZW50aWFsLWlkLTEyMzQ1';

let testUserId1: string;
let testUserId2: string;

async function setupTestUsers(): Promise<void> {
  const user1 = await findOrCreateUser(TEST_EMAIL_1);
  const user2 = await findOrCreateUser(TEST_EMAIL_2);
  testUserId1 = user1.id;
  testUserId2 = user2.id;
}

async function cleanupTestData(): Promise<void> {
  // Get test user IDs
  const users = await query<{ id: string }>(
    `SELECT id FROM users WHERE email = ANY($1)`,
    [[TEST_EMAIL_1, TEST_EMAIL_2]]
  );
  const userIds = users.map(u => u.id);

  if (userIds.length > 0) {
    // Clean up passkey credentials
    await execute(
      `DELETE FROM passkey_credentials WHERE user_id = ANY($1)`,
      [userIds]
    );

    // Clean up passkey challenges
    await execute(
      `DELETE FROM passkey_challenges WHERE user_id = ANY($1)`,
      [userIds]
    );
  }

  // Clean up challenges by email
  await execute(
    `DELETE FROM passkey_challenges WHERE email = ANY($1)`,
    [[TEST_EMAIL_1, TEST_EMAIL_2]]
  );

  // Clean up sessions
  if (userIds.length > 0) {
    await execute(
      `DELETE FROM sessions WHERE user_id = ANY($1)`,
      [userIds]
    );
  }

  // Clean up users
  await execute(
    `DELETE FROM users WHERE email = ANY($1)`,
    [[TEST_EMAIL_1, TEST_EMAIL_2]]
  );
}

async function createTestCredential(userId: string, credentialIdB64: string): Promise<string> {
  // Generate unique credential ID bytes from the b64 string
  const encoder = new TextEncoder();
  const credentialIdBytes = encoder.encode(credentialIdB64 + crypto.randomUUID());

  const [result] = await query<{ id: string }>(
    `INSERT INTO passkey_credentials (
      user_id, credential_id, credential_id_b64, public_key, counter,
      device_type, transports, backup_eligible, backup_state, display_name
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id`,
    [
      userId,
      credentialIdBytes,
      credentialIdB64,
      new Uint8Array([10, 20, 30, 40]), // dummy public key
      0,
      'platform',
      ['internal'],
      true,
      false,
      'Test Device',
    ]
  );
  return result.id;
}

// ============================================================================
// Test 1: Registration Challenge Creation
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Passkey Integration - Registration challenge creation',
  // First test initializes DB pool
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await cleanupTestData();
    await setupTestUsers();

    const options = await createRegistrationChallenge(testUserId1);

    // Verify challenge format
    assertExists(options.challenge);
    assertEquals(typeof options.challenge, 'string');
    assertEquals(options.challenge.length > 20, true, 'Challenge should be base64url encoded');

    // Verify RP info
    assertEquals(options.rp.name, 'Juicy Vision');
    assertExists(options.rp.id);

    // Verify user info
    assertExists(options.user.id);
    assertEquals(options.user.name, TEST_EMAIL_1.toLowerCase());

    // Verify pubkey params
    assertEquals(options.pubKeyCredParams.length >= 2, true);
    assertEquals(options.pubKeyCredParams[0].type, 'public-key');

    // Verify challenge is stored in database
    const stored = await queryOne<{ challenge_b64: string; type: string }>(
      `SELECT challenge_b64, type FROM passkey_challenges
       WHERE user_id = $1 AND type = 'registration'`,
      [testUserId1]
    );
    assertExists(stored);
    assertEquals(stored.challenge_b64, options.challenge);
    assertEquals(stored.type, 'registration');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 2: Authentication Challenge Creation
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Passkey Integration - Authentication challenge creation without email',
  async fn() {
    await cleanupTestData();
    await setupTestUsers();

    const options = await createAuthenticationChallenge();

    assertExists(options.challenge);
    assertExists(options.rpId);
    assertEquals(options.userVerification, 'preferred');
    assertEquals(options.allowCredentials, undefined, 'No allowCredentials without email');

    // Verify challenge is stored
    const stored = await queryOne<{ type: string }>(
      `SELECT type FROM passkey_challenges WHERE challenge_b64 = $1`,
      [options.challenge]
    );
    assertExists(stored);
    assertEquals(stored.type, 'authentication');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 3: Authentication Challenge with User Email
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Passkey Integration - Authentication challenge includes user credentials',
  async fn() {
    await cleanupTestData();
    await setupTestUsers();

    // Create a credential for the user
    await createTestCredential(testUserId1, TEST_CREDENTIAL_ID_B64);

    // Request auth challenge with email
    const options = await createAuthenticationChallenge(TEST_EMAIL_1);

    assertExists(options.allowCredentials);
    assertEquals(options.allowCredentials?.length, 1);
    assertEquals(options.allowCredentials?.[0].id, TEST_CREDENTIAL_ID_B64);
    assertEquals(options.allowCredentials?.[0].type, 'public-key');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 4: Challenge Uniqueness
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Passkey Integration - Each challenge is unique',
  async fn() {
    await cleanupTestData();
    await setupTestUsers();

    const challenge1 = await createRegistrationChallenge(testUserId1);
    const challenge2 = await createRegistrationChallenge(testUserId1);
    const challenge3 = await createAuthenticationChallenge();

    assertNotEquals(challenge1.challenge, challenge2.challenge);
    assertNotEquals(challenge2.challenge, challenge3.challenge);
    assertNotEquals(challenge1.challenge, challenge3.challenge);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 5: Credential Storage and Retrieval
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Passkey Integration - getUserPasskeys returns user credentials',
  async fn() {
    await cleanupTestData();
    await setupTestUsers();

    // Create credentials
    await createTestCredential(testUserId1, 'cred-1-b64');
    await createTestCredential(testUserId1, 'cred-2-b64');

    const passkeys = await getUserPasskeys(testUserId1);

    assertEquals(passkeys.length, 2);
    assertEquals(passkeys.some(p => p.credentialIdB64 === 'cred-1-b64'), true);
    assertEquals(passkeys.some(p => p.credentialIdB64 === 'cred-2-b64'), true);

    // Each passkey should have required fields
    for (const passkey of passkeys) {
      assertExists(passkey.id);
      assertEquals(passkey.userId, testUserId1);
      assertExists(passkey.publicKey);
      // Counter can be number or bigint depending on DB driver
      assertEquals(['number', 'bigint'].includes(typeof passkey.counter), true);
    }

    await cleanupTestData();
  },
});

// ============================================================================
// Test 6: User Credential Isolation
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Passkey Integration - Users only see their own passkeys',
  async fn() {
    await cleanupTestData();
    await setupTestUsers();

    // Create credentials for different users
    await createTestCredential(testUserId1, 'user1-cred');
    await createTestCredential(testUserId2, 'user2-cred');

    const user1Passkeys = await getUserPasskeys(testUserId1);
    const user2Passkeys = await getUserPasskeys(testUserId2);

    assertEquals(user1Passkeys.length, 1);
    assertEquals(user1Passkeys[0].credentialIdB64, 'user1-cred');

    assertEquals(user2Passkeys.length, 1);
    assertEquals(user2Passkeys[0].credentialIdB64, 'user2-cred');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 7: Delete Passkey
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Passkey Integration - deletePasskey removes credential',
  async fn() {
    await cleanupTestData();
    await setupTestUsers();

    // Create and delete credential
    const credId = await createTestCredential(testUserId1, 'to-delete');

    const before = await getUserPasskeys(testUserId1);
    assertEquals(before.length, 1);

    await deletePasskey(testUserId1, credId);

    const after = await getUserPasskeys(testUserId1);
    assertEquals(after.length, 0);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 8: Delete Passkey - IDOR Protection
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Passkey Integration - Cannot delete another user passkey',
  async fn() {
    await cleanupTestData();
    await setupTestUsers();

    // Create credential for user1
    const credId = await createTestCredential(testUserId1, 'user1-only');

    // Try to delete as user2
    await deletePasskey(testUserId2, credId);

    // Credential should still exist
    const passkeys = await getUserPasskeys(testUserId1);
    assertEquals(passkeys.length, 1, 'Credential should not be deleted by wrong user');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 9: Rename Passkey
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Passkey Integration - renamePasskey updates display name',
  async fn() {
    await cleanupTestData();
    await setupTestUsers();

    const credId = await createTestCredential(testUserId1, 'rename-test');

    const before = await getUserPasskeys(testUserId1);
    assertEquals(before[0].displayName, 'Test Device');

    await renamePasskey(testUserId1, credId, 'My MacBook Pro');

    const after = await getUserPasskeys(testUserId1);
    assertEquals(after[0].displayName, 'My MacBook Pro');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 10: Rename Passkey - IDOR Protection
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Passkey Integration - Cannot rename another user passkey',
  async fn() {
    await cleanupTestData();
    await setupTestUsers();

    const credId = await createTestCredential(testUserId1, 'idor-test');

    // Try to rename as user2
    await renamePasskey(testUserId2, credId, 'Hacked Name');

    // Name should not change
    const passkeys = await getUserPasskeys(testUserId1);
    assertEquals(passkeys[0].displayName, 'Test Device', 'Name should not change for wrong user');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 11: Counter Tracking
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Passkey Integration - Counter is stored and retrieved correctly',
  async fn() {
    await cleanupTestData();
    await setupTestUsers();

    // Create credential with counter 0
    await createTestCredential(testUserId1, 'counter-test');

    const passkeys = await getUserPasskeys(testUserId1);
    assertEquals(Number(passkeys[0].counter), 0, 'Initial counter should be 0');

    // Simulate counter update (as would happen after authentication)
    await execute(
      `UPDATE passkey_credentials SET counter = $1 WHERE credential_id_b64 = $2`,
      [42, 'counter-test']
    );

    const updated = await getUserPasskeys(testUserId1);
    assertEquals(Number(updated[0].counter), 42);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 12: Last Used Tracking
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Passkey Integration - Last used timestamp is tracked',
  async fn() {
    await cleanupTestData();
    await setupTestUsers();

    await createTestCredential(testUserId1, 'last-used-test');

    const before = await getUserPasskeys(testUserId1);
    assertEquals(before[0].lastUsedAt, null, 'Initial last_used_at should be null');

    // Simulate authentication updating last_used_at
    await execute(
      `UPDATE passkey_credentials SET last_used_at = NOW() WHERE credential_id_b64 = $1`,
      ['last-used-test']
    );

    const after = await getUserPasskeys(testUserId1);
    assertExists(after[0].lastUsedAt, 'last_used_at should be set after auth');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 13: Passkey Enabled Flag
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Passkey Integration - Deleting last passkey disables passkey flag',
  async fn() {
    await cleanupTestData();
    await setupTestUsers();

    // Enable passkey for user
    await execute(`UPDATE users SET passkey_enabled = TRUE WHERE id = $1`, [testUserId1]);

    // Create and delete the only credential
    const credId = await createTestCredential(testUserId1, 'only-passkey');

    await deletePasskey(testUserId1, credId);

    // User's passkey_enabled should be false
    const user = await queryOne<{ passkey_enabled: boolean }>(
      `SELECT passkey_enabled FROM users WHERE id = $1`,
      [testUserId1]
    );
    assertEquals(user?.passkey_enabled, false, 'passkey_enabled should be false after deleting last passkey');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 14: Multiple Passkeys per User
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Passkey Integration - User can have multiple passkeys',
  async fn() {
    await cleanupTestData();
    await setupTestUsers();

    await createTestCredential(testUserId1, 'macbook');
    await createTestCredential(testUserId1, 'iphone');
    await createTestCredential(testUserId1, 'yubikey');

    const passkeys = await getUserPasskeys(testUserId1);
    assertEquals(passkeys.length, 3);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 15: Challenge Expiration Cleanup
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Passkey Integration - cleanupExpiredChallenges removes old challenges',
  async fn() {
    await cleanupTestData();
    await setupTestUsers();

    // Create a challenge
    await createRegistrationChallenge(testUserId1);

    // Manually expire it
    await execute(
      `UPDATE passkey_challenges SET expires_at = NOW() - INTERVAL '1 hour'
       WHERE user_id = $1`,
      [testUserId1]
    );

    // Verify it exists but is expired
    const before = await queryOne<{ id: string }>(
      `SELECT id FROM passkey_challenges WHERE user_id = $1`,
      [testUserId1]
    );
    assertExists(before);

    // Cleanup
    await cleanupExpiredChallenges();

    // Should be gone
    const after = await queryOne<{ id: string }>(
      `SELECT id FROM passkey_challenges WHERE user_id = $1`,
      [testUserId1]
    );
    assertEquals(after, null, 'Expired challenge should be deleted');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 16: Backup Eligibility Tracking
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Passkey Integration - Backup flags are stored correctly',
  async fn() {
    await cleanupTestData();
    await setupTestUsers();

    // Create credential with backup flags
    await execute(
      `INSERT INTO passkey_credentials (
        user_id, credential_id, credential_id_b64, public_key, counter,
        backup_eligible, backup_state
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        testUserId1,
        new Uint8Array([1, 2, 3]),
        'backup-test',
        new Uint8Array([4, 5, 6]),
        0,
        true,  // backup eligible (multi-device credential)
        true,  // backup state (currently synced)
      ]
    );

    const passkeys = await getUserPasskeys(testUserId1);
    assertEquals(passkeys[0].backupEligible, true);
    assertEquals(passkeys[0].backupState, true);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 17: Credential ID Uniqueness
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Passkey Integration - Credential IDs must be unique',
  async fn() {
    await cleanupTestData();
    await setupTestUsers();

    // Use same credential_id bytes for both inserts to test uniqueness constraint
    const duplicateCredentialId = new Uint8Array([99, 99, 99, 99, 99]);

    // Create first credential with specific bytes
    await execute(
      `INSERT INTO passkey_credentials (
        user_id, credential_id, credential_id_b64, public_key, counter
      ) VALUES ($1, $2, $3, $4, $5)`,
      [testUserId1, duplicateCredentialId, 'dup-test-1', new Uint8Array([1, 2, 3]), 0]
    );

    // Try to create duplicate with same credential_id bytes
    let duplicateError = false;
    try {
      await execute(
        `INSERT INTO passkey_credentials (
          user_id, credential_id, credential_id_b64, public_key, counter
        ) VALUES ($1, $2, $3, $4, $5)`,
        [testUserId1, duplicateCredentialId, 'dup-test-2', new Uint8Array([4, 5, 6]), 0]
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('duplicate key')) {
        duplicateError = true;
      }
    }

    assertEquals(duplicateError, true, 'Duplicate credential ID bytes should be rejected');

    await cleanupTestData();
  },
});
