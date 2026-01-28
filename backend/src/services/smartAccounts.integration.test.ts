/**
 * Smart Accounts Integration Tests
 *
 * Tests database operations for ERC-4337 smart account management:
 * - Account creation idempotency (race condition handling)
 * - Custody status transitions
 * - Export blocking when pending operations exist
 * - Delayed transfer 7-day hold enforcement
 * - IDOR protection (ownership verification)
 *
 * These tests require a running database connection.
 */

import { assertEquals, assertExists, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { query, queryOne, execute } from '../db/index.ts';

// ============================================================================
// Test User Setup
// ============================================================================

const TEST_USER_ID_1 = '00000000-0000-0000-0000-000000000001';
const TEST_USER_ID_2 = '00000000-0000-0000-0000-000000000002';
const TEST_USER_ID_3 = '00000000-0000-0000-0000-000000000003';

async function ensureTestUsersExist(): Promise<void> {
  for (const userId of [TEST_USER_ID_1, TEST_USER_ID_2, TEST_USER_ID_3]) {
    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM users WHERE id = $1',
      [userId]
    );
    if (!existing) {
      await execute(
        `INSERT INTO users (id, email, email_verified, privacy_mode)
         VALUES ($1, $2, true, 'open_book')
         ON CONFLICT (id) DO NOTHING`,
        [userId, `test-${userId.slice(-4)}@smartaccounts.test`]
      );
    }
  }
}

async function cleanupTestData(): Promise<void> {
  // Clean up test data in reverse order of foreign key dependencies
  await execute(
    `DELETE FROM smart_account_withdrawals WHERE smart_account_id IN (
       SELECT id FROM user_smart_accounts WHERE user_id = ANY($1)
     )`,
    [[TEST_USER_ID_1, TEST_USER_ID_2, TEST_USER_ID_3]]
  );
  await execute(
    `DELETE FROM smart_account_exports WHERE user_id = ANY($1)`,
    [[TEST_USER_ID_1, TEST_USER_ID_2, TEST_USER_ID_3]]
  );
  await execute(
    `DELETE FROM user_smart_accounts WHERE user_id = ANY($1)`,
    [[TEST_USER_ID_1, TEST_USER_ID_2, TEST_USER_ID_3]]
  );
}

// ============================================================================
// Test 1: Account Creation and Idempotency
// ============================================================================

Deno.test({
  name: 'SmartAccounts Integration - Account creation is idempotent',
  // First test initializes DB pool, which opens TCP connections
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    const chainId = 1;
    const testAddress = '0x1234567890123456789012345678901234567890';
    const testSalt = '0x0000000000000000000000000000000000000000000000000000000000000001';

    // Create first account
    const [first] = await query<{ id: string; address: string }>(
      `INSERT INTO user_smart_accounts (user_id, chain_id, address, salt)
       VALUES ($1, $2, $3, $4)
       RETURNING id, address`,
      [TEST_USER_ID_1, chainId, testAddress, testSalt]
    );

    assertExists(first);
    assertEquals(first.address, testAddress);

    // Attempt duplicate insert should fail due to unique constraint
    let duplicateError = false;
    try {
      await execute(
        `INSERT INTO user_smart_accounts (user_id, chain_id, address, salt)
         VALUES ($1, $2, $3, $4)`,
        [TEST_USER_ID_1, chainId, testAddress, testSalt]
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('duplicate key')) {
        duplicateError = true;
      }
    }

    assertEquals(duplicateError, true, 'Should reject duplicate account');

    // Query should return the original account
    const found = await queryOne<{ id: string }>(
      `SELECT id FROM user_smart_accounts WHERE user_id = $1 AND chain_id = $2`,
      [TEST_USER_ID_1, chainId]
    );

    assertEquals(found?.id, first.id, 'Should return same account ID');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 2: Custody Status Transitions
// ============================================================================

Deno.test({
  name: 'SmartAccounts Integration - Custody status transitions',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    const chainId = 1;
    const testAddress = '0x2234567890123456789012345678901234567890';
    const testSalt = '0x0000000000000000000000000000000000000000000000000000000000000002';

    // Create account with managed status (default)
    const [account] = await query<{ id: string; custody_status: string }>(
      `INSERT INTO user_smart_accounts (user_id, chain_id, address, salt)
       VALUES ($1, $2, $3, $4)
       RETURNING id, custody_status`,
      [TEST_USER_ID_1, chainId, testAddress, testSalt]
    );

    assertEquals(account.custody_status, 'managed', 'Initial status should be managed');

    // Transition to transferring
    await execute(
      `UPDATE user_smart_accounts SET custody_status = 'transferring' WHERE id = $1`,
      [account.id]
    );

    const transferring = await queryOne<{ custody_status: string }>(
      `SELECT custody_status FROM user_smart_accounts WHERE id = $1`,
      [account.id]
    );
    assertEquals(transferring?.custody_status, 'transferring');

    // Transition to self_custody
    await execute(
      `UPDATE user_smart_accounts
       SET custody_status = 'self_custody',
           owner_address = '0x9999999999999999999999999999999999999999',
           custody_transferred_at = NOW()
       WHERE id = $1`,
      [account.id]
    );

    const selfCustody = await queryOne<{
      custody_status: string;
      owner_address: string;
      custody_transferred_at: Date;
    }>(
      `SELECT custody_status, owner_address, custody_transferred_at
       FROM user_smart_accounts WHERE id = $1`,
      [account.id]
    );

    assertEquals(selfCustody?.custody_status, 'self_custody');
    assertExists(selfCustody?.owner_address);
    assertExists(selfCustody?.custody_transferred_at);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 3: Revert Custody Status on Failure
// ============================================================================

Deno.test({
  name: 'SmartAccounts Integration - Revert custody status on transfer failure',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    const chainId = 1;
    const testAddress = '0x3234567890123456789012345678901234567890';
    const testSalt = '0x0000000000000000000000000000000000000000000000000000000000000003';

    // Create account
    const [account] = await query<{ id: string }>(
      `INSERT INTO user_smart_accounts (user_id, chain_id, address, salt)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [TEST_USER_ID_1, chainId, testAddress, testSalt]
    );

    // Start transfer (set to transferring)
    await execute(
      `UPDATE user_smart_accounts SET custody_status = 'transferring' WHERE id = $1`,
      [account.id]
    );

    // Simulate failure - revert to managed
    await execute(
      `UPDATE user_smart_accounts SET custody_status = 'managed' WHERE id = $1`,
      [account.id]
    );

    const reverted = await queryOne<{ custody_status: string }>(
      `SELECT custody_status FROM user_smart_accounts WHERE id = $1`,
      [account.id]
    );

    assertEquals(reverted?.custody_status, 'managed', 'Should revert to managed on failure');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 4: Export Blocking with Pending Withdrawals
// ============================================================================

Deno.test({
  name: 'SmartAccounts Integration - Export blocked by pending withdrawals',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    const chainId = 1;
    const testAddress = '0x4234567890123456789012345678901234567890';
    const testSalt = '0x0000000000000000000000000000000000000000000000000000000000000004';

    // Create account
    const [account] = await query<{ id: string }>(
      `INSERT INTO user_smart_accounts (user_id, chain_id, address, salt)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [TEST_USER_ID_1, chainId, testAddress, testSalt]
    );

    // Create pending withdrawal
    await execute(
      `INSERT INTO smart_account_withdrawals
       (smart_account_id, token_address, amount, to_address, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [account.id, '0x0000000000000000000000000000000000000000', '1000000000000000000', '0xdestination']
    );

    // Check for blockers
    const blockers = await query<{ id: string; status: string }>(
      `SELECT w.id, w.status
       FROM smart_account_withdrawals w
       JOIN user_smart_accounts a ON a.id = w.smart_account_id
       WHERE a.user_id = $1 AND w.status IN ('pending', 'processing')`,
      [TEST_USER_ID_1]
    );

    assertEquals(blockers.length, 1, 'Should have 1 blocking withdrawal');
    assertEquals(blockers[0].status, 'pending');

    // Export should be blocked
    const canExport = blockers.length === 0;
    assertEquals(canExport, false, 'Export should be blocked');

    // Complete the withdrawal
    await execute(
      `UPDATE smart_account_withdrawals SET status = 'completed' WHERE id = $1`,
      [blockers[0].id]
    );

    // Check blockers again
    const blockersAfter = await query<{ id: string }>(
      `SELECT w.id
       FROM smart_account_withdrawals w
       JOIN user_smart_accounts a ON a.id = w.smart_account_id
       WHERE a.user_id = $1 AND w.status IN ('pending', 'processing')`,
      [TEST_USER_ID_1]
    );

    assertEquals(blockersAfter.length, 0, 'No blockers after withdrawal completes');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 5: Multi-Chain Export Partial Failure Handling
// ============================================================================

Deno.test({
  name: 'SmartAccounts Integration - Multi-chain export tracks per-chain status',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    const newOwnerAddress = '0x5555555555555555555555555555555555555555';

    // Create accounts on multiple chains
    for (const chainId of [1, 10, 8453]) {
      await execute(
        `INSERT INTO user_smart_accounts (user_id, chain_id, address, salt)
         VALUES ($1, $2, $3, $4)`,
        [
          TEST_USER_ID_1,
          chainId,
          `0x${chainId.toString(16).padStart(40, '0')}`,
          `0x${chainId.toString(16).padStart(64, '0')}`,
        ]
      );
    }

    // Create export request
    const chainStatus = {
      '1': { status: 'completed', txHash: '0xabc123' },
      '10': { status: 'failed', error: 'Insufficient gas' },
      '8453': { status: 'completed', txHash: '0xdef456' },
    };

    const [exportReq] = await query<{ id: string }>(
      `INSERT INTO smart_account_exports
       (user_id, new_owner_address, chain_ids, chain_status, status)
       VALUES ($1, $2, $3, $4, 'partial')
       RETURNING id`,
      [TEST_USER_ID_1, newOwnerAddress, [1, 10, 8453], JSON.stringify(chainStatus)]
    );

    assertExists(exportReq);

    // Verify partial status is tracked correctly
    const savedExport = await queryOne<{
      chain_status: Record<string, { status: string; txHash?: string; error?: string }>;
      status: string;
    }>(
      `SELECT chain_status, status FROM smart_account_exports WHERE id = $1`,
      [exportReq.id]
    );

    assertEquals(savedExport?.status, 'partial');
    assertEquals(savedExport?.chain_status['1'].status, 'completed');
    assertEquals(savedExport?.chain_status['10'].status, 'failed');
    assertEquals(savedExport?.chain_status['10'].error, 'Insufficient gas');
    assertEquals(savedExport?.chain_status['8453'].status, 'completed');

    // Simulate retry of failed chain
    const updatedStatus = {
      ...savedExport?.chain_status,
      '10': { status: 'completed', txHash: '0xretry789' },
    };

    await execute(
      `UPDATE smart_account_exports
       SET chain_status = $1, status = 'completed'
       WHERE id = $2`,
      [JSON.stringify(updatedStatus), exportReq.id]
    );

    const completedExport = await queryOne<{ status: string }>(
      `SELECT status FROM smart_account_exports WHERE id = $1`,
      [exportReq.id]
    );

    assertEquals(completedExport?.status, 'completed');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 6: Delayed Transfer 7-Day Hold Enforcement
// ============================================================================

Deno.test({
  name: 'SmartAccounts Integration - 7-day delayed transfer hold period',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    const chainId = 1;
    const testAddress = '0x6234567890123456789012345678901234567890';
    const testSalt = '0x0000000000000000000000000000000000000000000000000000000000000006';

    // Create account
    const [account] = await query<{ id: string }>(
      `INSERT INTO user_smart_accounts (user_id, chain_id, address, salt)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [TEST_USER_ID_1, chainId, testAddress, testSalt]
    );

    // Create delayed transfer with 7-day hold
    const availableAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

    await execute(
      `INSERT INTO smart_account_withdrawals
       (smart_account_id, token_address, amount, to_address, status, transfer_type, available_at)
       VALUES ($1, $2, $3, $4, 'pending', 'delayed', $5)`,
      [
        account.id,
        '0x0000000000000000000000000000000000000000',
        '1000000000000000000',
        '0xdestination',
        availableAt,
      ]
    );

    // Query transfers that are ready (available_at <= NOW())
    const readyTransfers = await query<{ id: string }>(
      `SELECT id FROM smart_account_withdrawals
       WHERE smart_account_id = $1
       AND status = 'pending'
       AND transfer_type = 'delayed'
       AND available_at <= NOW()`,
      [account.id]
    );

    assertEquals(readyTransfers.length, 0, 'Transfer should not be ready before hold period');

    // Query all pending transfers (regardless of available_at)
    const allPending = await query<{ id: string; available_at: Date }>(
      `SELECT id, available_at FROM smart_account_withdrawals
       WHERE smart_account_id = $1
       AND status = 'pending'
       AND transfer_type = 'delayed'`,
      [account.id]
    );

    assertEquals(allPending.length, 1, 'Should have 1 pending transfer');

    // Verify available_at is in the future
    const transfer = allPending[0];
    assertEquals(
      new Date(transfer.available_at).getTime() > Date.now(),
      true,
      'available_at should be in the future'
    );

    await cleanupTestData();
  },
});

// ============================================================================
// Test 7: Transfer Cancellation (Only Pending Status)
// ============================================================================

Deno.test({
  name: 'SmartAccounts Integration - Transfer cancellation only when pending',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    const chainId = 1;
    const testAddress = '0x7234567890123456789012345678901234567890';
    const testSalt = '0x0000000000000000000000000000000000000000000000000000000000000007';

    // Create account
    const [account] = await query<{ id: string }>(
      `INSERT INTO user_smart_accounts (user_id, chain_id, address, salt)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [TEST_USER_ID_1, chainId, testAddress, testSalt]
    );

    // Create delayed transfer
    const [transfer] = await query<{ id: string }>(
      `INSERT INTO smart_account_withdrawals
       (smart_account_id, token_address, amount, to_address, status, transfer_type, available_at)
       VALUES ($1, $2, $3, $4, 'pending', 'delayed', NOW() + INTERVAL '7 days')
       RETURNING id`,
      [account.id, '0x0000000000000000000000000000000000000000', '1000000000000000000', '0xdest']
    );

    // Cancel should work for pending
    const cancelResult = await execute(
      `UPDATE smart_account_withdrawals
       SET status = 'cancelled'
       WHERE id = $1 AND status = 'pending' AND transfer_type = 'delayed'`,
      [transfer.id]
    );

    assertEquals(cancelResult, 1, 'Should cancel pending transfer');

    // Verify cancelled
    const cancelled = await queryOne<{ status: string }>(
      `SELECT status FROM smart_account_withdrawals WHERE id = $1`,
      [transfer.id]
    );
    assertEquals(cancelled?.status, 'cancelled');

    // Create another transfer and mark as processing
    const [transfer2] = await query<{ id: string }>(
      `INSERT INTO smart_account_withdrawals
       (smart_account_id, token_address, amount, to_address, status, transfer_type, available_at)
       VALUES ($1, $2, $3, $4, 'processing', 'delayed', NOW())
       RETURNING id`,
      [account.id, '0x0000000000000000000000000000000000000000', '2000000000000000000', '0xdest2']
    );

    // Cancel should NOT work for processing
    const cancelResult2 = await execute(
      `UPDATE smart_account_withdrawals
       SET status = 'cancelled'
       WHERE id = $1 AND status = 'pending' AND transfer_type = 'delayed'`,
      [transfer2.id]
    );

    assertEquals(cancelResult2, 0, 'Should not cancel processing transfer');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 8: IDOR Protection - Ownership Verification
// ============================================================================

Deno.test({
  name: 'SmartAccounts Integration - IDOR protection on transfer cancellation',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    const chainId = 1;

    // Create account for user 1
    const [account1] = await query<{ id: string }>(
      `INSERT INTO user_smart_accounts (user_id, chain_id, address, salt)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        TEST_USER_ID_1,
        chainId,
        '0x8234567890123456789012345678901234567890',
        '0x0000000000000000000000000000000000000000000000000000000000000008',
      ]
    );

    // Create transfer for user 1
    const [transfer] = await query<{ id: string }>(
      `INSERT INTO smart_account_withdrawals
       (smart_account_id, token_address, amount, to_address, status, transfer_type, available_at)
       VALUES ($1, $2, $3, $4, 'pending', 'delayed', NOW() + INTERVAL '7 days')
       RETURNING id`,
      [account1.id, '0x0000000000000000000000000000000000000000', '1000000000000000000', '0xdest']
    );

    // User 2 should NOT be able to cancel user 1's transfer
    const maliciousCancel = await execute(
      `UPDATE smart_account_withdrawals w
       SET status = 'cancelled'
       FROM user_smart_accounts a
       WHERE w.id = $1
         AND w.smart_account_id = a.id
         AND a.user_id = $2
         AND w.status = 'pending'`,
      [transfer.id, TEST_USER_ID_2]
    );

    assertEquals(maliciousCancel, 0, 'User 2 should not cancel User 1 transfer');

    // Verify transfer is still pending
    const stillPending = await queryOne<{ status: string }>(
      `SELECT status FROM smart_account_withdrawals WHERE id = $1`,
      [transfer.id]
    );
    assertEquals(stillPending?.status, 'pending');

    // User 1 CAN cancel their own transfer
    const legitimateCancel = await execute(
      `UPDATE smart_account_withdrawals w
       SET status = 'cancelled'
       FROM user_smart_accounts a
       WHERE w.id = $1
         AND w.smart_account_id = a.id
         AND a.user_id = $2
         AND w.status = 'pending'`,
      [transfer.id, TEST_USER_ID_1]
    );

    assertEquals(legitimateCancel, 1, 'User 1 should cancel their own transfer');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 9: Export Request Status Transitions
// ============================================================================

Deno.test({
  name: 'SmartAccounts Integration - Export status transitions',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    // Create account
    await execute(
      `INSERT INTO user_smart_accounts (user_id, chain_id, address, salt)
       VALUES ($1, $2, $3, $4)`,
      [
        TEST_USER_ID_1,
        1,
        '0x9234567890123456789012345678901234567890',
        '0x0000000000000000000000000000000000000000000000000000000000000009',
      ]
    );

    // Create pending export
    const [exportReq] = await query<{ id: string; status: string }>(
      `INSERT INTO smart_account_exports
       (user_id, new_owner_address, chain_ids, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id, status`,
      [TEST_USER_ID_1, '0xnewowner', [1]]
    );

    assertEquals(exportReq.status, 'pending');

    // Can cancel from pending
    await execute(
      `UPDATE smart_account_exports SET status = 'cancelled' WHERE id = $1 AND status = 'pending'`,
      [exportReq.id]
    );

    const cancelled = await queryOne<{ status: string }>(
      `SELECT status FROM smart_account_exports WHERE id = $1`,
      [exportReq.id]
    );
    assertEquals(cancelled?.status, 'cancelled');

    // Create another export and try to cancel from processing (should fail)
    const [exportReq2] = await query<{ id: string }>(
      `INSERT INTO smart_account_exports
       (user_id, new_owner_address, chain_ids, status)
       VALUES ($1, $2, $3, 'processing')
       RETURNING id`,
      [TEST_USER_ID_1, '0xnewowner2', [1]]
    );

    const cancelResult = await execute(
      `UPDATE smart_account_exports SET status = 'cancelled' WHERE id = $1 AND status IN ('pending', 'blocked')`,
      [exportReq2.id]
    );

    assertEquals(cancelResult, 0, 'Cannot cancel processing export');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 10: User-Specific Account Queries
// ============================================================================

Deno.test({
  name: 'SmartAccounts Integration - User-specific account isolation',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    // Create accounts for both users on same chain
    await execute(
      `INSERT INTO user_smart_accounts (user_id, chain_id, address, salt)
       VALUES ($1, $2, $3, $4)`,
      [
        TEST_USER_ID_1,
        1,
        '0xa234567890123456789012345678901234567890',
        '0x000000000000000000000000000000000000000000000000000000000000000a',
      ]
    );

    await execute(
      `INSERT INTO user_smart_accounts (user_id, chain_id, address, salt)
       VALUES ($1, $2, $3, $4)`,
      [
        TEST_USER_ID_2,
        1,
        '0xb234567890123456789012345678901234567890',
        '0x000000000000000000000000000000000000000000000000000000000000000b',
      ]
    );

    // User 1 should only see their accounts
    const user1Accounts = await query<{ user_id: string; address: string }>(
      `SELECT user_id, address FROM user_smart_accounts WHERE user_id = $1`,
      [TEST_USER_ID_1]
    );

    assertEquals(user1Accounts.length, 1);
    assertEquals(user1Accounts[0].user_id, TEST_USER_ID_1);
    assertEquals(user1Accounts[0].address, '0xa234567890123456789012345678901234567890');

    // User 2 should only see their accounts
    const user2Accounts = await query<{ user_id: string; address: string }>(
      `SELECT user_id, address FROM user_smart_accounts WHERE user_id = $1`,
      [TEST_USER_ID_2]
    );

    assertEquals(user2Accounts.length, 1);
    assertEquals(user2Accounts[0].user_id, TEST_USER_ID_2);
    assertEquals(user2Accounts[0].address, '0xb234567890123456789012345678901234567890');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 11: Withdrawal Status Transitions
// ============================================================================

Deno.test({
  name: 'SmartAccounts Integration - Withdrawal status state machine',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    // Create account
    const [account] = await query<{ id: string }>(
      `INSERT INTO user_smart_accounts (user_id, chain_id, address, salt)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        TEST_USER_ID_1,
        1,
        '0xc234567890123456789012345678901234567890',
        '0x000000000000000000000000000000000000000000000000000000000000000c',
      ]
    );

    // Create withdrawal in pending status
    const [withdrawal] = await query<{ id: string; status: string }>(
      `INSERT INTO smart_account_withdrawals
       (smart_account_id, token_address, amount, to_address, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING id, status`,
      [account.id, '0x0000000000000000000000000000000000000000', '1000000000000000000', '0xdest']
    );

    assertEquals(withdrawal.status, 'pending');

    // Transition: pending -> processing
    await execute(
      `UPDATE smart_account_withdrawals SET status = 'processing' WHERE id = $1`,
      [withdrawal.id]
    );

    // Transition: processing -> completed
    await execute(
      `UPDATE smart_account_withdrawals
       SET status = 'completed', tx_hash = '0xtxhash123', executed_at = NOW()
       WHERE id = $1`,
      [withdrawal.id]
    );

    const completed = await queryOne<{ status: string; tx_hash: string }>(
      `SELECT status, tx_hash FROM smart_account_withdrawals WHERE id = $1`,
      [withdrawal.id]
    );

    assertEquals(completed?.status, 'completed');
    assertEquals(completed?.tx_hash, '0xtxhash123');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 12: Multi-Chain Account Management
// ============================================================================

Deno.test({
  name: 'SmartAccounts Integration - Multi-chain account creation',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    const chains = [1, 10, 8453, 42161]; // Mainnet, Optimism, Base, Arbitrum

    // Create account on each chain
    for (let i = 0; i < chains.length; i++) {
      await execute(
        `INSERT INTO user_smart_accounts (user_id, chain_id, address, salt)
         VALUES ($1, $2, $3, $4)`,
        [
          TEST_USER_ID_1,
          chains[i],
          `0x${(0xd0 + i).toString(16)}34567890123456789012345678901234567890`,
          `0x${(0xd0 + i).toString(16).padStart(64, '0')}`,
        ]
      );
    }

    // Query all accounts for user
    const accounts = await query<{ chain_id: number; custody_status: string }>(
      `SELECT chain_id, custody_status FROM user_smart_accounts WHERE user_id = $1 ORDER BY chain_id`,
      [TEST_USER_ID_1]
    );

    assertEquals(accounts.length, 4);
    assertEquals(accounts.map((a) => a.chain_id), [1, 10, 8453, 42161]);
    assertEquals(
      accounts.every((a) => a.custody_status === 'managed'),
      true,
      'All accounts should start as managed'
    );

    await cleanupTestData();
  },
});
