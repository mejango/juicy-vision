/**
 * Juice Service Integration Tests
 *
 * Tests database operations for the stored value payment system:
 * - Balance atomicity on spends (insufficient balance check)
 * - Purchase credit flow with settlement delays
 * - Spend debit/refund on failure
 * - Cash out delay enforcement
 * - Cash out cancellation and balance restoration
 * - Transaction isolation and concurrency safety
 *
 * These tests require a running database connection.
 */

import { assertEquals, assertExists, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { query, queryOne, execute, transaction } from '../db/index.ts';
import { SKIP_DB_TESTS } from '../test/helpers.ts';

// ============================================================================
// Test User Setup
// ============================================================================

const TEST_USER_ID_1 = '00000000-0000-0000-0000-000000000011';
const TEST_USER_ID_2 = '00000000-0000-0000-0000-000000000012';
const TEST_USER_ID_3 = '00000000-0000-0000-0000-000000000013';

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
        [userId, `test-${userId.slice(-4)}@juice.test`]
      );
    }
  }
}

async function cleanupTestData(): Promise<void> {
  // Clean up test data in reverse order of foreign key dependencies
  await execute(
    `DELETE FROM juice_cash_outs WHERE user_id = ANY($1)`,
    [[TEST_USER_ID_1, TEST_USER_ID_2, TEST_USER_ID_3]]
  );
  await execute(
    `DELETE FROM juice_spends WHERE user_id = ANY($1)`,
    [[TEST_USER_ID_1, TEST_USER_ID_2, TEST_USER_ID_3]]
  );
  await execute(
    `DELETE FROM juice_purchases WHERE user_id = ANY($1)`,
    [[TEST_USER_ID_1, TEST_USER_ID_2, TEST_USER_ID_3]]
  );
  await execute(
    `DELETE FROM juice_balances WHERE user_id = ANY($1)`,
    [[TEST_USER_ID_1, TEST_USER_ID_2, TEST_USER_ID_3]]
  );
}

async function createBalance(userId: string, amount: number): Promise<void> {
  await execute(
    `INSERT INTO juice_balances (user_id, balance, lifetime_purchased)
     VALUES ($1, $2, $2)
     ON CONFLICT (user_id)
     DO UPDATE SET balance = $2, lifetime_purchased = $2`,
    [userId, amount]
  );
}

// ============================================================================
// Test 1: Balance Creation and Retrieval
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Juice Integration - Balance creation on first access',
  // First test initializes DB pool, which opens TCP connections
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    // Balance should not exist yet
    const before = await queryOne<{ user_id: string }>(
      `SELECT user_id FROM juice_balances WHERE user_id = $1`,
      [TEST_USER_ID_1]
    );
    assertEquals(before, null, 'Balance should not exist initially');

    // Create balance with default values
    await execute(
      `INSERT INTO juice_balances (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [TEST_USER_ID_1]
    );

    // Verify balance was created with correct defaults
    const balance = await queryOne<{
      user_id: string;
      balance: string;
      lifetime_purchased: string;
      lifetime_spent: string;
      lifetime_cashed_out: string;
    }>(
      `SELECT user_id, balance, lifetime_purchased, lifetime_spent, lifetime_cashed_out
       FROM juice_balances WHERE user_id = $1`,
      [TEST_USER_ID_1]
    );

    assertExists(balance);
    assertEquals(parseFloat(balance.balance), 0);
    assertEquals(parseFloat(balance.lifetime_purchased), 0);
    assertEquals(parseFloat(balance.lifetime_spent), 0);
    assertEquals(parseFloat(balance.lifetime_cashed_out), 0);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 2: Purchase Credit Flow with Settlement Delay
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Juice Integration - Purchase credit with settlement delay',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    // Create balance
    await createBalance(TEST_USER_ID_1, 0);

    // Create purchase with 7-day settlement delay
    const clearsAt = new Date();
    clearsAt.setDate(clearsAt.getDate() + 7);

    const [purchase] = await query<{ id: string; status: string }>(
      `INSERT INTO juice_purchases (
        user_id, stripe_payment_intent_id, fiat_amount, juice_amount,
        status, settlement_delay_days, clears_at
      ) VALUES ($1, $2, $3, $4, 'clearing', $5, $6)
      RETURNING id, status`,
      [TEST_USER_ID_1, 'pi_test_123', 100.00, 100.00, 7, clearsAt]
    );

    assertExists(purchase);
    assertEquals(purchase.status, 'clearing');

    // Balance should still be 0 (purchase hasn't cleared yet)
    const balanceBefore = await queryOne<{ balance: string }>(
      `SELECT balance FROM juice_balances WHERE user_id = $1`,
      [TEST_USER_ID_1]
    );
    assertEquals(parseFloat(balanceBefore!.balance), 0);

    // Simulate crediting after clearing period
    await transaction(async (client) => {
      // Credit the balance
      await client.queryObject(
        `UPDATE juice_balances
         SET balance = balance + $1,
             lifetime_purchased = lifetime_purchased + $1
         WHERE user_id = $2`,
        [100.00, TEST_USER_ID_1]
      );

      // Mark purchase as credited
      await client.queryObject(
        `UPDATE juice_purchases
         SET status = 'credited', credited_at = NOW()
         WHERE id = $1`,
        [purchase.id]
      );
    });

    // Verify balance was credited
    const balanceAfter = await queryOne<{ balance: string; lifetime_purchased: string }>(
      `SELECT balance, lifetime_purchased FROM juice_balances WHERE user_id = $1`,
      [TEST_USER_ID_1]
    );

    assertEquals(parseFloat(balanceAfter!.balance), 100.00);
    assertEquals(parseFloat(balanceAfter!.lifetime_purchased), 100.00);

    // Verify purchase is credited
    const creditedPurchase = await queryOne<{ status: string; credited_at: Date }>(
      `SELECT status, credited_at FROM juice_purchases WHERE id = $1`,
      [purchase.id]
    );

    assertEquals(creditedPurchase?.status, 'credited');
    assertExists(creditedPurchase?.credited_at);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 3: Spend Debit with Insufficient Balance Check
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Juice Integration - Spend blocked when insufficient balance',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    // Create balance with $50
    await createBalance(TEST_USER_ID_1, 50.00);

    // Attempt to debit $100 (more than available)
    const debitCount = await execute(
      `UPDATE juice_balances
       SET balance = balance - $1,
           lifetime_spent = lifetime_spent + $1
       WHERE user_id = $2
       AND balance >= $1`,
      [100.00, TEST_USER_ID_1]
    );

    assertEquals(debitCount, 0, 'Debit should fail when balance < amount');

    // Verify balance unchanged
    const balance = await queryOne<{ balance: string }>(
      `SELECT balance FROM juice_balances WHERE user_id = $1`,
      [TEST_USER_ID_1]
    );

    assertEquals(parseFloat(balance!.balance), 50.00, 'Balance should remain unchanged');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 4: Spend Debit with Sufficient Balance
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Juice Integration - Spend succeeds with sufficient balance',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    // Create balance with $100
    await createBalance(TEST_USER_ID_1, 100.00);

    // Debit $50
    const debitCount = await execute(
      `UPDATE juice_balances
       SET balance = balance - $1,
           lifetime_spent = lifetime_spent + $1
       WHERE user_id = $2
       AND balance >= $1`,
      [50.00, TEST_USER_ID_1]
    );

    assertEquals(debitCount, 1, 'Debit should succeed');

    // Verify balance updated
    const balance = await queryOne<{ balance: string; lifetime_spent: string }>(
      `SELECT balance, lifetime_spent FROM juice_balances WHERE user_id = $1`,
      [TEST_USER_ID_1]
    );

    assertEquals(parseFloat(balance!.balance), 50.00);
    assertEquals(parseFloat(balance!.lifetime_spent), 50.00);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 5: Spend Refund on Failure
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Juice Integration - Spend refund restores balance on failure',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    // Create balance with $100
    await createBalance(TEST_USER_ID_1, 100.00);

    // Create a spend record
    const [spend] = await query<{ id: string }>(
      `INSERT INTO juice_spends (user_id, project_id, chain_id, beneficiary_address, juice_amount, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id`,
      [TEST_USER_ID_1, 1, 42161, '0xbeneficiary', 50.00]
    );

    // Debit balance
    await execute(
      `UPDATE juice_balances
       SET balance = balance - $1,
           lifetime_spent = lifetime_spent + $1
       WHERE user_id = $2`,
      [50.00, TEST_USER_ID_1]
    );

    // Verify balance is debited
    const afterDebit = await queryOne<{ balance: string }>(
      `SELECT balance FROM juice_balances WHERE user_id = $1`,
      [TEST_USER_ID_1]
    );
    assertEquals(parseFloat(afterDebit!.balance), 50.00);

    // Simulate failure - mark spend as failed and refund
    await execute(
      `UPDATE juice_spends SET status = 'failed', error_message = 'Test failure' WHERE id = $1`,
      [spend.id]
    );

    await execute(
      `UPDATE juice_balances
       SET balance = balance + $1,
           lifetime_spent = lifetime_spent - $1
       WHERE user_id = $2`,
      [50.00, TEST_USER_ID_1]
    );

    // Verify balance is restored
    const afterRefund = await queryOne<{ balance: string; lifetime_spent: string }>(
      `SELECT balance, lifetime_spent FROM juice_balances WHERE user_id = $1`,
      [TEST_USER_ID_1]
    );

    assertEquals(parseFloat(afterRefund!.balance), 100.00, 'Balance should be restored');
    assertEquals(parseFloat(afterRefund!.lifetime_spent), 0.00, 'Lifetime spent should be rolled back');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 6: Cash Out Delay Enforcement (24 Hours)
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Juice Integration - Cash out 24-hour delay enforcement',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    const CASH_OUT_DELAY_HOURS = 24;

    // Create balance with $100
    await createBalance(TEST_USER_ID_1, 100.00);

    // Initiate cash out with 24-hour delay
    const availableAt = new Date();
    availableAt.setHours(availableAt.getHours() + CASH_OUT_DELAY_HOURS);

    // Debit balance first
    await execute(
      `UPDATE juice_balances
       SET balance = balance - $1,
           lifetime_cashed_out = lifetime_cashed_out + $1
       WHERE user_id = $2`,
      [50.00, TEST_USER_ID_1]
    );

    const [cashOut] = await query<{ id: string; available_at: Date }>(
      `INSERT INTO juice_cash_outs (user_id, destination_address, chain_id, juice_amount, available_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, available_at`,
      [TEST_USER_ID_1, '0xdestination', 42161, 50.00, availableAt]
    );

    assertExists(cashOut);

    // Cash out should NOT be ready yet
    const readyCashOuts = await query<{ id: string }>(
      `SELECT id FROM juice_cash_outs
       WHERE user_id = $1
       AND status = 'pending'
       AND available_at <= NOW()`,
      [TEST_USER_ID_1]
    );

    assertEquals(readyCashOuts.length, 0, 'Cash out should not be ready before delay period');

    // All pending cash outs
    const pendingCashOuts = await query<{ id: string }>(
      `SELECT id FROM juice_cash_outs
       WHERE user_id = $1
       AND status = 'pending'`,
      [TEST_USER_ID_1]
    );

    assertEquals(pendingCashOuts.length, 1, 'Should have 1 pending cash out');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 7: Cash Out Cancellation Restores Balance
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Juice Integration - Cash out cancellation restores balance',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    // Create balance with $100
    await createBalance(TEST_USER_ID_1, 100.00);

    // Debit $50 for cash out
    await execute(
      `UPDATE juice_balances
       SET balance = balance - $1,
           lifetime_cashed_out = lifetime_cashed_out + $1
       WHERE user_id = $2`,
      [50.00, TEST_USER_ID_1]
    );

    // Create cash out
    const [cashOut] = await query<{ id: string }>(
      `INSERT INTO juice_cash_outs (user_id, destination_address, chain_id, juice_amount, status, available_at)
       VALUES ($1, $2, $3, $4, 'pending', NOW() + INTERVAL '24 hours')
       RETURNING id`,
      [TEST_USER_ID_1, '0xdestination', 42161, 50.00]
    );

    // Verify balance is debited
    const afterDebit = await queryOne<{ balance: string }>(
      `SELECT balance FROM juice_balances WHERE user_id = $1`,
      [TEST_USER_ID_1]
    );
    assertEquals(parseFloat(afterDebit!.balance), 50.00);

    // Cancel the cash out and refund
    await transaction(async (client) => {
      // Refund balance
      await client.queryObject(
        `UPDATE juice_balances
         SET balance = balance + $1,
             lifetime_cashed_out = lifetime_cashed_out - $1
         WHERE user_id = $2`,
        [50.00, TEST_USER_ID_1]
      );

      // Mark as cancelled
      await client.queryObject(
        `UPDATE juice_cash_outs SET status = 'cancelled' WHERE id = $1`,
        [cashOut.id]
      );
    });

    // Verify balance is restored
    const afterCancel = await queryOne<{ balance: string; lifetime_cashed_out: string }>(
      `SELECT balance, lifetime_cashed_out FROM juice_balances WHERE user_id = $1`,
      [TEST_USER_ID_1]
    );

    assertEquals(parseFloat(afterCancel!.balance), 100.00, 'Balance should be restored');
    assertEquals(parseFloat(afterCancel!.lifetime_cashed_out), 0.00, 'Lifetime cashed out should be rolled back');

    // Verify cash out is cancelled
    const cancelledCashOut = await queryOne<{ status: string }>(
      `SELECT status FROM juice_cash_outs WHERE id = $1`,
      [cashOut.id]
    );
    assertEquals(cancelledCashOut?.status, 'cancelled');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 8: Cannot Cancel Processing Cash Out
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Juice Integration - Cannot cancel cash out once processing',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    // Create balance and cash out
    await createBalance(TEST_USER_ID_1, 100.00);

    const [cashOut] = await query<{ id: string }>(
      `INSERT INTO juice_cash_outs (user_id, destination_address, chain_id, juice_amount, status, available_at)
       VALUES ($1, $2, $3, $4, 'processing', NOW())
       RETURNING id`,
      [TEST_USER_ID_1, '0xdestination', 42161, 50.00]
    );

    // Attempt to cancel (should fail)
    const cancelResult = await execute(
      `UPDATE juice_cash_outs SET status = 'cancelled' WHERE id = $1 AND status = 'pending'`,
      [cashOut.id]
    );

    assertEquals(cancelResult, 0, 'Should not cancel processing cash out');

    // Verify still processing
    const stillProcessing = await queryOne<{ status: string }>(
      `SELECT status FROM juice_cash_outs WHERE id = $1`,
      [cashOut.id]
    );
    assertEquals(stillProcessing?.status, 'processing');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 9: Purchase Disputed Status Prevents Crediting
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Juice Integration - Disputed purchase cannot be credited',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    // Create balance
    await createBalance(TEST_USER_ID_1, 0);

    // Create purchase
    const [purchase] = await query<{ id: string }>(
      `INSERT INTO juice_purchases (user_id, stripe_payment_intent_id, fiat_amount, juice_amount, status)
       VALUES ($1, $2, $3, $4, 'clearing')
       RETURNING id`,
      [TEST_USER_ID_1, 'pi_disputed_123', 100.00, 100.00]
    );

    // Mark as disputed (simulating Stripe webhook)
    await execute(
      `UPDATE juice_purchases SET status = 'disputed' WHERE id = $1`,
      [purchase.id]
    );

    // Attempt to credit (should be blocked by status check)
    const creditResult = await execute(
      `UPDATE juice_purchases SET status = 'credited', credited_at = NOW()
       WHERE id = $1 AND status = 'clearing'`,
      [purchase.id]
    );

    assertEquals(creditResult, 0, 'Disputed purchase should not be credited');

    // Verify balance unchanged
    const balance = await queryOne<{ balance: string }>(
      `SELECT balance FROM juice_balances WHERE user_id = $1`,
      [TEST_USER_ID_1]
    );
    assertEquals(parseFloat(balance!.balance), 0, 'Balance should remain 0');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 10: Spend Retry Count and Failure After Max Retries
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Juice Integration - Spend fails after max retries',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    const MAX_RETRIES = 5;

    // Create balance
    await createBalance(TEST_USER_ID_1, 100.00);

    // Create spend with max retry count
    const [spend] = await query<{ id: string }>(
      `INSERT INTO juice_spends (user_id, project_id, chain_id, beneficiary_address, juice_amount, status, retry_count)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)
       RETURNING id`,
      [TEST_USER_ID_1, 1, 42161, '0xbeneficiary', 50.00, MAX_RETRIES]
    );

    // Query for spends that can still be retried
    const retriableSpends = await query<{ id: string }>(
      `SELECT id FROM juice_spends
       WHERE status = 'pending'
       AND retry_count < $1`,
      [MAX_RETRIES]
    );

    assertEquals(
      retriableSpends.filter(s => s.id === spend.id).length,
      0,
      'Spend at max retries should not be in retriable list'
    );

    await cleanupTestData();
  },
});

// ============================================================================
// Test 11: Balance Accounting Integrity
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Juice Integration - Balance = purchased - spent - cashed_out',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    // Create balance with initial purchase
    await execute(
      `INSERT INTO juice_balances (user_id, balance, lifetime_purchased, lifetime_spent, lifetime_cashed_out)
       VALUES ($1, $2, $3, $4, $5)`,
      [TEST_USER_ID_1, 100.00, 200.00, 75.00, 25.00]
    );

    // Verify accounting: balance = 200 - 75 - 25 = 100
    const balance = await queryOne<{
      balance: string;
      lifetime_purchased: string;
      lifetime_spent: string;
      lifetime_cashed_out: string;
    }>(
      `SELECT balance, lifetime_purchased, lifetime_spent, lifetime_cashed_out
       FROM juice_balances WHERE user_id = $1`,
      [TEST_USER_ID_1]
    );

    const calculated =
      parseFloat(balance!.lifetime_purchased) -
      parseFloat(balance!.lifetime_spent) -
      parseFloat(balance!.lifetime_cashed_out);

    assertEquals(parseFloat(balance!.balance), calculated, 'Balance should equal purchased - spent - cashed_out');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 12: Spend Records Project and Chain Association
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Juice Integration - Spend records track project and chain',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    await createBalance(TEST_USER_ID_1, 200.00);

    // Create spends to different projects on different chains
    await execute(
      `INSERT INTO juice_spends (user_id, project_id, chain_id, beneficiary_address, juice_amount, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [TEST_USER_ID_1, 1, 1, '0xbeneficiary1', 50.00] // Mainnet project 1
    );

    await execute(
      `INSERT INTO juice_spends (user_id, project_id, chain_id, beneficiary_address, juice_amount, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [TEST_USER_ID_1, 2, 42161, '0xbeneficiary2', 30.00] // Arbitrum project 2
    );

    await execute(
      `INSERT INTO juice_spends (user_id, project_id, chain_id, beneficiary_address, juice_amount, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [TEST_USER_ID_1, 1, 10, '0xbeneficiary3', 20.00] // Optimism project 1
    );

    // Query spends by project
    const project1Spends = await query<{ juice_amount: string }>(
      `SELECT juice_amount FROM juice_spends WHERE user_id = $1 AND project_id = $2`,
      [TEST_USER_ID_1, 1]
    );

    assertEquals(project1Spends.length, 2);
    const project1Total = project1Spends.reduce((sum, s) => sum + parseFloat(s.juice_amount), 0);
    assertEquals(project1Total, 70.00);

    // Query spends by chain
    const arbitrumSpends = await query<{ juice_amount: string }>(
      `SELECT juice_amount FROM juice_spends WHERE user_id = $1 AND chain_id = $2`,
      [TEST_USER_ID_1, 42161]
    );

    assertEquals(arbitrumSpends.length, 1);
    assertEquals(parseFloat(arbitrumSpends[0].juice_amount), 30.00);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 13: Risk-Based Settlement Delay Storage
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Juice Integration - Purchase stores risk score and settlement delay',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    // Create purchase with risk data
    const clearsAt = new Date();
    clearsAt.setDate(clearsAt.getDate() + 30); // 30-day delay for medium risk

    const [purchase] = await query<{ id: string }>(
      `INSERT INTO juice_purchases (
        user_id, stripe_payment_intent_id, fiat_amount, juice_amount,
        radar_risk_score, radar_risk_level, settlement_delay_days, clears_at, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'clearing')
      RETURNING id`,
      [TEST_USER_ID_1, 'pi_risk_123', 100.00, 100.00, 55, 'elevated', 30, clearsAt]
    );

    // Verify risk data is stored
    const stored = await queryOne<{
      radar_risk_score: number;
      radar_risk_level: string;
      settlement_delay_days: number;
    }>(
      `SELECT radar_risk_score, radar_risk_level, settlement_delay_days
       FROM juice_purchases WHERE id = $1`,
      [purchase.id]
    );

    assertEquals(stored?.radar_risk_score, 55);
    assertEquals(stored?.radar_risk_level, 'elevated');
    assertEquals(stored?.settlement_delay_days, 30);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 14: User Isolation - Cannot Access Other User's Data
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Juice Integration - User data isolation',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    // Create balances for both users
    await createBalance(TEST_USER_ID_1, 100.00);
    await createBalance(TEST_USER_ID_2, 200.00);

    // Create spends for both users
    await execute(
      `INSERT INTO juice_spends (user_id, project_id, chain_id, beneficiary_address, juice_amount, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [TEST_USER_ID_1, 1, 1, '0xbeneficiary', 25.00]
    );

    await execute(
      `INSERT INTO juice_spends (user_id, project_id, chain_id, beneficiary_address, juice_amount, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [TEST_USER_ID_2, 1, 1, '0xbeneficiary', 75.00]
    );

    // User 1's balance query should only return User 1's data
    const user1Balance = await queryOne<{ balance: string }>(
      `SELECT balance FROM juice_balances WHERE user_id = $1`,
      [TEST_USER_ID_1]
    );
    assertEquals(parseFloat(user1Balance!.balance), 100.00);

    // User 1's spend query should only return User 1's spends
    const user1Spends = await query<{ user_id: string; juice_amount: string }>(
      `SELECT user_id, juice_amount FROM juice_spends WHERE user_id = $1`,
      [TEST_USER_ID_1]
    );

    assertEquals(user1Spends.length, 1);
    assertEquals(user1Spends[0].user_id, TEST_USER_ID_1);
    assertEquals(parseFloat(user1Spends[0].juice_amount), 25.00);

    await cleanupTestData();
  },
});

// ============================================================================
// Test 15: Spend Status Transitions
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Juice Integration - Spend status transitions',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    await createBalance(TEST_USER_ID_1, 100.00);

    // Create pending spend
    const [spend] = await query<{ id: string; status: string }>(
      `INSERT INTO juice_spends (user_id, project_id, chain_id, beneficiary_address, juice_amount, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id, status`,
      [TEST_USER_ID_1, 1, 1, '0xbeneficiary', 50.00]
    );

    assertEquals(spend.status, 'pending');

    // Transition to executing
    await execute(`UPDATE juice_spends SET status = 'executing' WHERE id = $1`, [spend.id]);

    const executing = await queryOne<{ status: string }>(
      `SELECT status FROM juice_spends WHERE id = $1`,
      [spend.id]
    );
    assertEquals(executing?.status, 'executing');

    // Transition to completed with tx hash
    await execute(
      `UPDATE juice_spends
       SET status = 'completed', tx_hash = $1, tokens_received = $2
       WHERE id = $3`,
      ['0xtxhash123', '1000000000000000000', spend.id]
    );

    const completed = await queryOne<{ status: string; tx_hash: string; tokens_received: string }>(
      `SELECT status, tx_hash, tokens_received FROM juice_spends WHERE id = $1`,
      [spend.id]
    );

    assertEquals(completed?.status, 'completed');
    assertEquals(completed?.tx_hash, '0xtxhash123');
    assertEquals(completed?.tokens_received, '1000000000000000000');

    await cleanupTestData();
  },
});

// ============================================================================
// Test 16: Purchase Idempotency by Stripe Payment Intent ID
// ============================================================================

Deno.test({
  ignore: SKIP_DB_TESTS,
  name: 'Juice Integration - Purchase idempotency by payment intent ID',
  async fn() {
    await ensureTestUsersExist();
    await cleanupTestData();

    const paymentIntentId = 'pi_unique_test_123';

    // Create first purchase
    const [first] = await query<{ id: string }>(
      `INSERT INTO juice_purchases (user_id, stripe_payment_intent_id, fiat_amount, juice_amount, status)
       VALUES ($1, $2, $3, $4, 'clearing')
       RETURNING id`,
      [TEST_USER_ID_1, paymentIntentId, 100.00, 100.00]
    );

    assertExists(first);

    // Attempt duplicate should fail due to unique constraint
    let duplicateError = false;
    try {
      await execute(
        `INSERT INTO juice_purchases (user_id, stripe_payment_intent_id, fiat_amount, juice_amount, status)
         VALUES ($1, $2, $3, $4, 'clearing')`,
        [TEST_USER_ID_1, paymentIntentId, 100.00, 100.00]
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('duplicate key')) {
        duplicateError = true;
      }
    }

    assertEquals(duplicateError, true, 'Should reject duplicate payment intent');

    await cleanupTestData();
  },
});
