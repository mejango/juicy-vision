/**
 * Juice Service - Stored Value System
 *
 * Enables non-crypto users to pay Juicebox projects with fiat.
 * 1 Juice = $1 USD. Non-refundable, non-transferable.
 *
 * Flow: Purchase (Stripe) → Balance → Spend (Project) or Cash Out (Crypto)
 */

import { query, queryOne, execute, transaction } from '../db/index.ts';
import { logger } from '../utils/logger.ts';
import { getConfig } from '../utils/config.ts';
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, optimism, arbitrum, base } from 'viem/chains';

// Maximum retries before marking as failed
const MAX_RETRIES = 5;

// Default cash out delay in hours (fraud protection)
const CASH_OUT_DELAY_HOURS = 24;

// Preferred operating chain for Juice transactions
// Arbitrum has the lowest fees for JB operations
export const DEFAULT_OPERATING_CHAIN = 42161; // Arbitrum

// Chain configurations
const CHAINS: Record<number, { chain: Chain; rpcUrl: string }> = {
  1: { chain: mainnet, rpcUrl: 'https://eth.llamarpc.com' },
  10: { chain: optimism, rpcUrl: 'https://optimism.llamarpc.com' },
  42161: { chain: arbitrum, rpcUrl: 'https://arbitrum.llamarpc.com' },
  8453: { chain: base, rpcUrl: 'https://base.llamarpc.com' },
};

// JBMultiTerminal ABI (pay function)
const TERMINAL_ABI = [
  {
    name: 'pay',
    type: 'function',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'beneficiary', type: 'address' },
      { name: 'minReturnedTokens', type: 'uint256' },
      { name: 'memo', type: 'string' },
      { name: 'metadata', type: 'bytes' },
    ],
    outputs: [{ name: 'beneficiaryTokenCount', type: 'uint256' }],
    stateMutability: 'payable',
  },
] as const;

// JBMultiTerminal address (same on all chains)
const JB_MULTI_TERMINAL = '0x52869db3d61dde1e391967f2ce5039ad0ecd371c' as const;
const NATIVE_TOKEN = '0x000000000000000000000000000000000000EEEe' as const;

// Chainlink ETH/USD price feed (mainnet)
const CHAINLINK_ETH_USD = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419' as const;
const CHAINLINK_ABI = [
  {
    name: 'latestRoundData',
    type: 'function',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
  },
] as const;

// ============================================================================
// Types
// ============================================================================

export interface JuiceBalance {
  userId: string;
  balance: number;
  lifetimePurchased: number;
  lifetimeSpent: number;
  lifetimeCashedOut: number;
  expiresAt: Date;
}

export interface JuicePurchase {
  id: string;
  userId: string;
  stripePaymentIntentId: string;
  juiceAmount: number;
  status: string;
  clearsAt: Date | null;
  createdAt: Date;
}

export interface JuiceSpend {
  id: string;
  userId: string;
  projectId: number;
  chainId: number;
  juiceAmount: number;
  status: string;
  txHash: string | null;
  tokensReceived: string | null;
  createdAt: Date;
}

export interface JuiceCashOut {
  id: string;
  userId: string;
  destinationAddress: string;
  chainId: number;
  juiceAmount: number;
  status: string;
  availableAt: Date;
  txHash: string | null;
  createdAt: Date;
}

export interface JuiceTransaction {
  id: string;
  userId: string;
  type: 'purchase' | 'spend' | 'cash_out';
  amount: number;
  status: string;
  createdAt: Date;
  projectId: number | null;
  chainId: number | null;
}

// ============================================================================
// Balance Operations
// ============================================================================

/**
 * Get user's Juice balance (creates record if doesn't exist)
 */
export async function getBalance(userId: string): Promise<JuiceBalance> {
  // Try to get existing balance
  let row = await queryOne<{
    user_id: string;
    balance: string;
    lifetime_purchased: string;
    lifetime_spent: string;
    lifetime_cashed_out: string;
    expires_at: string;
  }>(
    `SELECT user_id, balance, lifetime_purchased, lifetime_spent,
            lifetime_cashed_out, expires_at
     FROM juice_balances WHERE user_id = $1`,
    [userId]
  );

  // Create if doesn't exist
  if (!row) {
    await execute(
      `INSERT INTO juice_balances (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );

    row = await queryOne(
      `SELECT user_id, balance, lifetime_purchased, lifetime_spent,
              lifetime_cashed_out, expires_at
       FROM juice_balances WHERE user_id = $1`,
      [userId]
    );
  }

  if (!row) {
    throw new Error('Failed to create balance record');
  }

  return {
    userId: row.user_id,
    balance: parseFloat(row.balance),
    lifetimePurchased: parseFloat(row.lifetime_purchased),
    lifetimeSpent: parseFloat(row.lifetime_spent),
    lifetimeCashedOut: parseFloat(row.lifetime_cashed_out),
    expiresAt: new Date(row.expires_at),
  };
}

/**
 * Credit Juice to user's balance (called after purchase clears)
 */
export async function creditJuice(
  userId: string,
  amount: number,
  purchaseId: string
): Promise<void> {
  await transaction(async (q, exec) => {
    // Verify purchase exists and is in clearing status
    const [purchase] = await q<{ status: string }>(
      `SELECT status FROM juice_purchases WHERE id = $1 AND user_id = $2`,
      [purchaseId, userId]
    );

    if (!purchase) {
      throw new Error('Purchase not found');
    }

    if (purchase.status !== 'clearing') {
      throw new Error(`Cannot credit purchase with status: ${purchase.status}`);
    }

    // Ensure balance record exists
    await exec(
      `INSERT INTO juice_balances (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );

    // Credit the balance and update activity timestamp
    await exec(
      `UPDATE juice_balances
       SET balance = balance + $1,
           lifetime_purchased = lifetime_purchased + $1,
           last_activity_at = NOW(),
           updated_at = NOW()
       WHERE user_id = $2`,
      [amount, userId]
    );

    // Mark purchase as credited
    await exec(
      `UPDATE juice_purchases
       SET status = 'credited', credited_at = NOW()
       WHERE id = $1`,
      [purchaseId]
    );

    logger.info('Juice credited', { userId, amount, purchaseId });
  });
}

/**
 * Debit Juice from user's balance (internal use)
 */
async function debitJuice(
  userId: string,
  amount: number,
  type: 'spend' | 'cash_out'
): Promise<void> {
  const lifetimeColumn = type === 'spend' ? 'lifetime_spent' : 'lifetime_cashed_out';

  const count = await execute(
    `UPDATE juice_balances
     SET balance = balance - $1,
         ${lifetimeColumn} = ${lifetimeColumn} + $1,
         updated_at = NOW()
     WHERE user_id = $2
     AND balance >= $1`,
    [amount, userId]
  );

  if (count === 0) {
    throw new Error('Insufficient Juice balance');
  }
}

/**
 * Refund Juice to user's balance (when spend/cash-out fails)
 */
async function refundJuice(
  userId: string,
  amount: number,
  type: 'spend' | 'cash_out'
): Promise<void> {
  const lifetimeColumn = type === 'spend' ? 'lifetime_spent' : 'lifetime_cashed_out';

  await execute(
    `UPDATE juice_balances
     SET balance = balance + $1,
         ${lifetimeColumn} = ${lifetimeColumn} - $1,
         updated_at = NOW()
     WHERE user_id = $2`,
    [amount, userId]
  );

  logger.info('Juice refunded', { userId, amount, type });
}

// ============================================================================
// Purchase Operations
// ============================================================================

/**
 * Create a pending Juice purchase (called from Stripe webhook)
 */
export async function createPurchase(params: {
  userId: string;
  stripePaymentIntentId: string;
  stripeChargeId?: string;
  fiatAmount: number;
  juiceAmount?: number; // If provided, use this; otherwise calculate from fiatAmount
  creditRate?: number; // Credit rate at time of purchase
  riskScore?: number;
  riskLevel?: string;
  settlementDelayDays: number;
}): Promise<string> {
  const clearsAt = new Date();
  clearsAt.setDate(clearsAt.getDate() + params.settlementDelayDays);

  // Use provided juiceAmount or fall back to fiatAmount (1:1 for legacy)
  const juiceAmount = params.juiceAmount ?? params.fiatAmount;

  const [row] = await query<{ id: string }>(
    `INSERT INTO juice_purchases (
      user_id, stripe_payment_intent_id, stripe_charge_id,
      radar_risk_score, radar_risk_level,
      fiat_amount, juice_amount, credit_rate, status, settlement_delay_days, clears_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id`,
    [
      params.userId,
      params.stripePaymentIntentId,
      params.stripeChargeId || null,
      params.riskScore ?? null,
      params.riskLevel || null,
      params.fiatAmount,
      juiceAmount,
      params.creditRate ?? null,
      params.settlementDelayDays === 0 ? 'clearing' : 'clearing',
      params.settlementDelayDays,
      clearsAt,
    ]
  );

  logger.info('Juice purchase created', {
    purchaseId: row.id,
    userId: params.userId,
    fiatAmount: params.fiatAmount,
    juiceAmount,
    creditRate: params.creditRate,
    settlementDelayDays: params.settlementDelayDays,
    clearsAt: clearsAt.toISOString(),
  });

  return row.id;
}

/**
 * Mark purchase as disputed (from Stripe webhook)
 */
export async function markPurchaseDisputed(
  stripePaymentIntentId: string
): Promise<boolean> {
  const count = await execute(
    `UPDATE juice_purchases
     SET status = 'disputed'
     WHERE stripe_payment_intent_id = $1
     AND status IN ('pending', 'clearing')`,
    [stripePaymentIntentId]
  );

  if (count > 0) {
    logger.warn('Juice purchase disputed', { stripePaymentIntentId });
    return true;
  }
  return false;
}

/**
 * Mark purchase as refunded (from Stripe webhook)
 */
export async function markPurchaseRefunded(
  stripePaymentIntentId: string
): Promise<boolean> {
  const count = await execute(
    `UPDATE juice_purchases
     SET status = 'refunded'
     WHERE stripe_payment_intent_id = $1
     AND status IN ('pending', 'clearing')`,
    [stripePaymentIntentId]
  );

  if (count > 0) {
    logger.info('Juice purchase refunded', { stripePaymentIntentId });
    return true;
  }
  return false;
}

/**
 * Get user's purchase history
 */
export async function getUserPurchases(userId: string): Promise<JuicePurchase[]> {
  const rows = await query<{
    id: string;
    user_id: string;
    stripe_payment_intent_id: string;
    juice_amount: string;
    status: string;
    clears_at: string | null;
    created_at: string;
  }>(
    `SELECT id, user_id, stripe_payment_intent_id, juice_amount,
            status, clears_at, created_at
     FROM juice_purchases
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  return rows.map(r => ({
    id: r.id,
    userId: r.user_id,
    stripePaymentIntentId: r.stripe_payment_intent_id,
    juiceAmount: parseFloat(r.juice_amount),
    status: r.status,
    clearsAt: r.clears_at ? new Date(r.clears_at) : null,
    createdAt: new Date(r.created_at),
  }));
}

// ============================================================================
// Spend Operations
// ============================================================================

/**
 * Spend Juice on a Juicebox project
 * Deducts immediately, queues for on-chain execution
 */
export async function spendJuice(params: {
  userId: string;
  amount: number;
  projectId: number;
  chainId?: number; // Defaults to Arbitrum
  beneficiaryAddress: string;
  memo?: string;
}): Promise<string> {
  const chainId = params.chainId || DEFAULT_OPERATING_CHAIN;

  return await transaction(async (q, exec) => {
    // Deduct from balance first and update activity timestamp
    const debitCount = await exec(
      `UPDATE juice_balances
       SET balance = balance - $1,
           lifetime_spent = lifetime_spent + $1,
           last_activity_at = NOW(),
           updated_at = NOW()
       WHERE user_id = $2
       AND balance >= $1`,
      [params.amount, params.userId]
    );

    if (debitCount === 0) {
      throw new Error('Insufficient Juice balance');
    }

    // Create spend record
    const [row] = await q<{ id: string }>(
      `INSERT INTO juice_spends (
        user_id, project_id, chain_id, beneficiary_address, memo, juice_amount
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id`,
      [
        params.userId,
        params.projectId,
        chainId,
        params.beneficiaryAddress,
        params.memo || null,
        params.amount,
      ]
    );

    logger.info('Juice spend created', {
      spendId: row.id,
      userId: params.userId,
      amount: params.amount,
      projectId: params.projectId,
      chainId,
    });

    return row.id;
  });
}

/**
 * Get user's spend history
 */
export async function getUserSpends(userId: string): Promise<JuiceSpend[]> {
  const rows = await query<{
    id: string;
    user_id: string;
    project_id: number;
    chain_id: number;
    juice_amount: string;
    status: string;
    tx_hash: string | null;
    tokens_received: string | null;
    created_at: string;
  }>(
    `SELECT id, user_id, project_id, chain_id, juice_amount,
            status, tx_hash, tokens_received, created_at
     FROM juice_spends
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  return rows.map(r => ({
    id: r.id,
    userId: r.user_id,
    projectId: r.project_id,
    chainId: r.chain_id,
    juiceAmount: parseFloat(r.juice_amount),
    status: r.status,
    txHash: r.tx_hash,
    tokensReceived: r.tokens_received,
    createdAt: new Date(r.created_at),
  }));
}

// ============================================================================
// Cash Out Operations
// ============================================================================

/**
 * Initiate cash out (Juice → Crypto)
 * Applies a delay for fraud protection
 */
export async function initiateCashOut(params: {
  userId: string;
  amount: number;
  destinationAddress: string;
  chainId?: number;
}): Promise<string> {
  const chainId = params.chainId || DEFAULT_OPERATING_CHAIN;
  const availableAt = new Date();
  availableAt.setHours(availableAt.getHours() + CASH_OUT_DELAY_HOURS);

  return await transaction(async (q, exec) => {
    // Deduct from balance first and update activity timestamp
    const debitCount = await exec(
      `UPDATE juice_balances
       SET balance = balance - $1,
           lifetime_cashed_out = lifetime_cashed_out + $1,
           last_activity_at = NOW(),
           updated_at = NOW()
       WHERE user_id = $2
       AND balance >= $1`,
      [params.amount, params.userId]
    );

    if (debitCount === 0) {
      throw new Error('Insufficient Juice balance');
    }

    // Create cash out record
    const [row] = await q<{ id: string }>(
      `INSERT INTO juice_cash_outs (
        user_id, destination_address, chain_id, juice_amount, available_at
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id`,
      [
        params.userId,
        params.destinationAddress,
        chainId,
        params.amount,
        availableAt,
      ]
    );

    logger.info('Cash out initiated', {
      cashOutId: row.id,
      userId: params.userId,
      amount: params.amount,
      destinationAddress: params.destinationAddress,
      chainId,
      availableAt: availableAt.toISOString(),
    });

    return row.id;
  });
}

/**
 * Cancel a pending cash out
 */
export async function cancelCashOut(
  cashOutId: string,
  userId: string
): Promise<void> {
  await transaction(async (q, exec) => {
    // Get the cash out
    const [cashOut] = await q<{ juice_amount: string; status: string }>(
      `SELECT juice_amount, status FROM juice_cash_outs
       WHERE id = $1 AND user_id = $2`,
      [cashOutId, userId]
    );

    if (!cashOut) {
      throw new Error('Cash out not found');
    }

    if (cashOut.status !== 'pending') {
      throw new Error(`Cannot cancel cash out with status: ${cashOut.status}`);
    }

    const amount = parseFloat(cashOut.juice_amount);

    // Refund the balance
    await exec(
      `UPDATE juice_balances
       SET balance = balance + $1,
           lifetime_cashed_out = lifetime_cashed_out - $1,
           updated_at = NOW()
       WHERE user_id = $2`,
      [amount, userId]
    );

    // Mark as cancelled
    await exec(
      `UPDATE juice_cash_outs
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1`,
      [cashOutId]
    );

    logger.info('Cash out cancelled', { cashOutId, userId, amount });
  });
}

/**
 * Get user's cash out history
 */
export async function getUserCashOuts(userId: string): Promise<JuiceCashOut[]> {
  const rows = await query<{
    id: string;
    user_id: string;
    destination_address: string;
    chain_id: number;
    juice_amount: string;
    status: string;
    available_at: string;
    tx_hash: string | null;
    created_at: string;
  }>(
    `SELECT id, user_id, destination_address, chain_id, juice_amount,
            status, available_at, tx_hash, created_at
     FROM juice_cash_outs
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  return rows.map(r => ({
    id: r.id,
    userId: r.user_id,
    destinationAddress: r.destination_address,
    chainId: r.chain_id,
    juiceAmount: parseFloat(r.juice_amount),
    status: r.status,
    availableAt: new Date(r.available_at),
    txHash: r.tx_hash,
    createdAt: new Date(r.created_at),
  }));
}

// ============================================================================
// Transaction History
// ============================================================================

/**
 * Get all Juice transactions for a user
 */
export async function getTransactions(
  userId: string,
  limit = 50,
  offset = 0
): Promise<JuiceTransaction[]> {
  const rows = await query<{
    id: string;
    user_id: string;
    type: string;
    amount: string;
    status: string;
    created_at: string;
    project_id: number | null;
    chain_id: number | null;
  }>(
    `SELECT * FROM juice_transactions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  return rows.map(r => ({
    id: r.id,
    userId: r.user_id,
    type: r.type as 'purchase' | 'spend' | 'cash_out',
    amount: parseFloat(r.amount),
    status: r.status,
    createdAt: new Date(r.created_at),
    projectId: r.project_id,
    chainId: r.chain_id,
  }));
}

// ============================================================================
// Cron Processing
// ============================================================================

// Maximum age for Chainlink price data (1 hour)
const CHAINLINK_MAX_STALENESS_SECONDS = 3600;

/**
 * Fetch current ETH/USD rate from Chainlink
 * Includes staleness check for security
 */
export async function getEthUsdRate(): Promise<number> {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(CHAINS[1].rpcUrl),
  });

  const data = await client.readContract({
    address: CHAINLINK_ETH_USD,
    abi: CHAINLINK_ABI,
    functionName: 'latestRoundData',
  });

  // data[3] is updatedAt timestamp
  const updatedAt = Number(data[3]);
  const now = Math.floor(Date.now() / 1000);
  const age = now - updatedAt;

  if (age > CHAINLINK_MAX_STALENESS_SECONDS) {
    throw new Error(`Chainlink price data is stale (${age}s old, max ${CHAINLINK_MAX_STALENESS_SECONDS}s)`);
  }

  // Chainlink returns price with 8 decimals
  const price = Number(data[1]) / 1e8;

  // Sanity check: ETH should be between $100 and $100,000
  if (price < 100 || price > 100000) {
    throw new Error(`ETH/USD price out of expected range: $${price}`);
  }

  logger.debug('Fetched ETH/USD rate', { rate: price, age });

  return price;
}

/**
 * Process pending Juice credits (purchases that have cleared)
 */
export async function processCredits(): Promise<{
  credited: number;
  failed: number;
  pending: number;
}> {
  // Get purchases ready to credit with row locking
  const purchases = await query<{
    id: string;
    user_id: string;
    juice_amount: string;
  }>(
    `SELECT id, user_id, juice_amount
     FROM juice_purchases
     WHERE status = 'clearing'
     AND clears_at <= NOW()
     LIMIT 50
     FOR UPDATE SKIP LOCKED`
  );

  let credited = 0;
  let failed = 0;

  for (const purchase of purchases) {
    try {
      await creditJuice(
        purchase.user_id,
        parseFloat(purchase.juice_amount),
        purchase.id
      );
      credited++;
    } catch (error) {
      logger.error('Failed to credit Juice', error as Error, {
        purchaseId: purchase.id,
      });
      failed++;
    }
  }

  // Get remaining pending count
  const [{ count }] = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM juice_purchases WHERE status = 'clearing'`
  );

  return {
    credited,
    failed,
    pending: parseInt(count),
  };
}

/**
 * Process pending Juice spends (execute on-chain payments)
 */
export async function processSpends(): Promise<{
  executed: number;
  failed: number;
  pending: number;
}> {
  const config = getConfig();
  const privateKey = config.reservesPrivateKey as `0x${string}`;

  if (!privateKey) {
    logger.warn('RESERVES_PRIVATE_KEY not configured, skipping spend processing');
    return { executed: 0, failed: 0, pending: 0 };
  }

  // Get pending spends with row locking to prevent race conditions
  // SKIP LOCKED ensures multiple workers don't process the same record
  const spends = await query<{
    id: string;
    user_id: string;
    project_id: number;
    chain_id: number;
    beneficiary_address: string;
    memo: string | null;
    juice_amount: string;
    retry_count: number;
  }>(
    `SELECT id, user_id, project_id, chain_id, beneficiary_address,
            memo, juice_amount, retry_count
     FROM juice_spends
     WHERE status = 'pending'
     AND retry_count < $1
     ORDER BY created_at ASC
     LIMIT 20
     FOR UPDATE SKIP LOCKED`,
    [MAX_RETRIES]
  );

  let executed = 0;
  let failed = 0;

  for (const spend of spends) {
    try {
      // Mark as executing
      await execute(
        `UPDATE juice_spends SET status = 'executing', updated_at = NOW()
         WHERE id = $1`,
        [spend.id]
      );

      // Get ETH/USD rate
      const ethUsdRate = await getEthUsdRate();
      const amountUsd = parseFloat(spend.juice_amount);
      const amountEth = amountUsd / ethUsdRate;
      const amountWei = BigInt(Math.floor(amountEth * 1e18));

      logger.info('Executing Juice spend', {
        spendId: spend.id,
        amountUsd,
        ethUsdRate,
        amountEth: formatEther(amountWei),
      });

      // Execute on-chain payment
      const chainConfig = CHAINS[spend.chain_id];
      if (!chainConfig) {
        throw new Error(`Unsupported chain: ${spend.chain_id}`);
      }

      const account = privateKeyToAccount(privateKey);
      const walletClient = createWalletClient({
        account,
        chain: chainConfig.chain,
        transport: http(chainConfig.rpcUrl),
      });

      const publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http(chainConfig.rpcUrl),
      });

      const txHash = await walletClient.writeContract({
        address: JB_MULTI_TERMINAL,
        abi: TERMINAL_ABI,
        functionName: 'pay',
        args: [
          BigInt(spend.project_id),
          NATIVE_TOKEN,
          amountWei,
          spend.beneficiary_address as `0x${string}`,
          0n, // minReturnedTokens
          spend.memo || `Juice payment: $${amountUsd}`,
          '0x',
        ],
        value: amountWei,
      });

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      // TODO: Parse logs to get tokens received
      const tokensReceived = '0';

      // Mark as completed
      await execute(
        `UPDATE juice_spends SET
          status = 'completed',
          tx_hash = $1,
          crypto_amount = $2,
          eth_usd_rate = $3,
          tokens_received = $4,
          updated_at = NOW()
         WHERE id = $5`,
        [txHash, amountWei.toString(), ethUsdRate, tokensReceived, spend.id]
      );

      logger.info('Juice spend completed', {
        spendId: spend.id,
        txHash,
        projectId: spend.project_id,
      });

      executed++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if we've hit max retries
      if (spend.retry_count + 1 >= MAX_RETRIES) {
        // Refund the Juice
        await refundJuice(spend.user_id, parseFloat(spend.juice_amount), 'spend');

        await execute(
          `UPDATE juice_spends SET
            status = 'failed',
            error_message = $1,
            retry_count = retry_count + 1,
            last_retry_at = NOW(),
            updated_at = NOW()
           WHERE id = $2`,
          [errorMessage, spend.id]
        );
      } else {
        // Reset to pending for retry
        await execute(
          `UPDATE juice_spends SET
            status = 'pending',
            error_message = $1,
            retry_count = retry_count + 1,
            last_retry_at = NOW(),
            updated_at = NOW()
           WHERE id = $2`,
          [errorMessage, spend.id]
        );
      }

      logger.error('Juice spend failed', error as Error, {
        spendId: spend.id,
        retryCount: spend.retry_count + 1,
      });

      failed++;
    }
  }

  // Get remaining pending count
  const [{ count }] = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM juice_spends WHERE status = 'pending'`
  );

  return {
    executed,
    failed,
    pending: parseInt(count),
  };
}

/**
 * Process pending cash outs (send crypto to users)
 */
// Credit expiration period (6 months)
const CREDIT_EXPIRATION_MONTHS = 6;

export async function processCashOuts(): Promise<{
  processed: number;
  failed: number;
  pending: number;
}> {
  const config = getConfig();
  const privateKey = config.reservesPrivateKey as `0x${string}`;

  if (!privateKey) {
    logger.warn('RESERVES_PRIVATE_KEY not configured, skipping cash out processing');
    return { processed: 0, failed: 0, pending: 0 };
  }

  // Get available cash outs with row locking to prevent race conditions
  const cashOuts = await query<{
    id: string;
    user_id: string;
    destination_address: string;
    chain_id: number;
    juice_amount: string;
    retry_count: number;
  }>(
    `SELECT id, user_id, destination_address, chain_id, juice_amount, retry_count
     FROM juice_cash_outs
     WHERE status = 'pending'
     AND available_at <= NOW()
     AND retry_count < $1
     ORDER BY available_at ASC
     LIMIT 20
     FOR UPDATE SKIP LOCKED`,
    [MAX_RETRIES]
  );

  let processed = 0;
  let failed = 0;

  for (const cashOut of cashOuts) {
    try {
      // Mark as processing
      await execute(
        `UPDATE juice_cash_outs SET status = 'processing', updated_at = NOW()
         WHERE id = $1`,
        [cashOut.id]
      );

      // Get ETH/USD rate
      const ethUsdRate = await getEthUsdRate();
      const amountUsd = parseFloat(cashOut.juice_amount);
      const amountEth = amountUsd / ethUsdRate;
      const amountWei = BigInt(Math.floor(amountEth * 1e18));

      logger.info('Processing cash out', {
        cashOutId: cashOut.id,
        amountUsd,
        ethUsdRate,
        amountEth: formatEther(amountWei),
        destination: cashOut.destination_address,
      });

      // Execute transfer
      const chainConfig = CHAINS[cashOut.chain_id];
      if (!chainConfig) {
        throw new Error(`Unsupported chain: ${cashOut.chain_id}`);
      }

      const account = privateKeyToAccount(privateKey);
      const walletClient = createWalletClient({
        account,
        chain: chainConfig.chain,
        transport: http(chainConfig.rpcUrl),
      });

      const publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http(chainConfig.rpcUrl),
      });

      const txHash = await walletClient.sendTransaction({
        to: cashOut.destination_address as `0x${string}`,
        value: amountWei,
      });

      // Wait for confirmation
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      // Mark as completed
      await execute(
        `UPDATE juice_cash_outs SET
          status = 'completed',
          tx_hash = $1,
          crypto_amount = $2,
          eth_usd_rate = $3,
          updated_at = NOW()
         WHERE id = $4`,
        [txHash, amountWei.toString(), ethUsdRate, cashOut.id]
      );

      logger.info('Cash out completed', {
        cashOutId: cashOut.id,
        txHash,
        destination: cashOut.destination_address,
      });

      processed++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if we've hit max retries
      if (cashOut.retry_count + 1 >= MAX_RETRIES) {
        // Refund the Juice
        await refundJuice(cashOut.user_id, parseFloat(cashOut.juice_amount), 'cash_out');

        await execute(
          `UPDATE juice_cash_outs SET
            status = 'failed',
            error_message = $1,
            retry_count = retry_count + 1,
            updated_at = NOW()
           WHERE id = $2`,
          [errorMessage, cashOut.id]
        );
      } else {
        // Reset to pending for retry
        await execute(
          `UPDATE juice_cash_outs SET
            status = 'pending',
            error_message = $1,
            retry_count = retry_count + 1,
            updated_at = NOW()
           WHERE id = $2`,
          [errorMessage, cashOut.id]
        );
      }

      logger.error('Cash out failed', error as Error, {
        cashOutId: cashOut.id,
        retryCount: cashOut.retry_count + 1,
      });

      failed++;
    }
  }

  // Get remaining pending count
  const [{ count }] = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM juice_cash_outs WHERE status = 'pending'`
  );

  return {
    processed,
    failed,
    pending: parseInt(count),
  };
}

/**
 * Process expired credits (users inactive for 6+ months)
 * Credits are zeroed and recorded for tracking.
 * Future: Send expired credits to JUICY revnet as beneficiary.
 */
export async function processExpiredCredits(): Promise<{
  expired: number;
  totalAmount: number;
  failed: number;
}> {
  const expirationDate = new Date();
  expirationDate.setMonth(expirationDate.getMonth() - CREDIT_EXPIRATION_MONTHS);

  // Find users with positive balance and last activity older than expiration period
  // Use row locking to prevent race conditions
  const expiredBalances = await query<{
    user_id: string;
    balance: string;
    last_activity_at: string;
  }>(
    `SELECT user_id, balance, last_activity_at
     FROM juice_balances
     WHERE balance > 0
     AND last_activity_at < $1
     LIMIT 100
     FOR UPDATE SKIP LOCKED`,
    [expirationDate.toISOString()]
  );

  let expired = 0;
  let totalAmount = 0;
  let failed = 0;

  for (const balance of expiredBalances) {
    try {
      const amount = parseFloat(balance.balance);

      await transaction(async (q, exec) => {
        // Record the expiration
        await exec(
          `INSERT INTO credit_expirations (user_id, amount, last_activity_at)
           VALUES ($1, $2, $3)`,
          [balance.user_id, amount, balance.last_activity_at]
        );

        // Zero the balance
        await exec(
          `UPDATE juice_balances
           SET balance = 0,
               updated_at = NOW()
           WHERE user_id = $1`,
          [balance.user_id]
        );
      });

      logger.info('Credits expired', {
        userId: balance.user_id,
        amount,
        lastActivityAt: balance.last_activity_at,
      });

      expired++;
      totalAmount += amount;
    } catch (error) {
      logger.error('Failed to expire credits', error as Error, {
        userId: balance.user_id,
      });
      failed++;
    }
  }

  if (expired > 0) {
    logger.info('Credit expiration batch complete', {
      expired,
      totalAmount,
      failed,
    });
  }

  return { expired, totalAmount, failed };
}

/**
 * Update last activity timestamp for a user
 * Called when user performs any balance-affecting action
 */
export async function updateLastActivity(userId: string): Promise<void> {
  await execute(
    `UPDATE juice_balances
     SET last_activity_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
}

// ============================================================================
// Admin Operations
// ============================================================================

/**
 * Process a single spend by ID (admin-triggered)
 * This is the manual version of the cron job's batch processing.
 */
export async function processSingleSpend(spendId: string): Promise<{
  spendId: string;
  status: 'completed' | 'failed';
  txHash?: string;
  error?: string;
}> {
  const config = getConfig();
  const privateKey = config.reservesPrivateKey as `0x${string}`;

  if (!privateKey) {
    throw new Error('RESERVES_PRIVATE_KEY not configured');
  }

  // Get the spend record with row locking
  const [spend] = await query<{
    id: string;
    user_id: string;
    project_id: number;
    chain_id: number;
    beneficiary_address: string;
    memo: string | null;
    juice_amount: string;
    status: string;
    retry_count: number;
  }>(
    `SELECT id, user_id, project_id, chain_id, beneficiary_address,
            memo, juice_amount, status, retry_count
     FROM juice_spends
     WHERE id = $1
     FOR UPDATE`,
    [spendId]
  );

  if (!spend) {
    throw new Error('Spend not found');
  }

  if (spend.status === 'completed') {
    throw new Error('Spend already completed');
  }

  if (spend.status === 'refunded') {
    throw new Error('Spend was refunded');
  }

  try {
    // Mark as executing
    await execute(
      `UPDATE juice_spends SET status = 'executing', updated_at = NOW()
       WHERE id = $1`,
      [spend.id]
    );

    // Get ETH/USD rate
    const ethUsdRate = await getEthUsdRate();
    const amountUsd = parseFloat(spend.juice_amount);
    const amountEth = amountUsd / ethUsdRate;
    const amountWei = BigInt(Math.floor(amountEth * 1e18));

    logger.info('Processing single spend', {
      spendId: spend.id,
      amountUsd,
      ethUsdRate,
      amountEth: formatEther(amountWei),
    });

    // Execute on-chain payment
    const chainConfig = CHAINS[spend.chain_id];
    if (!chainConfig) {
      throw new Error(`Unsupported chain: ${spend.chain_id}`);
    }

    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account,
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });

    const publicClient = createPublicClient({
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });

    const txHash = await walletClient.writeContract({
      address: JB_MULTI_TERMINAL,
      abi: TERMINAL_ABI,
      functionName: 'pay',
      args: [
        BigInt(spend.project_id),
        NATIVE_TOKEN,
        amountWei,
        spend.beneficiary_address as `0x${string}`,
        0n, // minReturnedTokens
        spend.memo || `Juice payment: $${amountUsd}`,
        '0x',
      ],
      value: amountWei,
    });

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    // TODO: Parse logs to get tokens received
    const tokensReceived = '0';

    // Mark as completed
    await execute(
      `UPDATE juice_spends SET
        status = 'completed',
        tx_hash = $1,
        crypto_amount = $2,
        eth_usd_rate = $3,
        tokens_received = $4,
        updated_at = NOW()
       WHERE id = $5`,
      [txHash, amountWei.toString(), ethUsdRate, tokensReceived, spend.id]
    );

    logger.info('Single spend completed', {
      spendId: spend.id,
      txHash,
      projectId: spend.project_id,
    });

    return {
      spendId: spend.id,
      status: 'completed',
      txHash,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if we've hit max retries
    if (spend.retry_count + 1 >= MAX_RETRIES) {
      // Refund the Juice
      await refundJuice(spend.user_id, parseFloat(spend.juice_amount), 'spend');

      await execute(
        `UPDATE juice_spends SET
          status = 'failed',
          error_message = $1,
          retry_count = retry_count + 1,
          last_retry_at = NOW(),
          updated_at = NOW()
         WHERE id = $2`,
        [errorMessage, spend.id]
      );

      logger.error('Single spend failed permanently', error as Error, {
        spendId: spend.id,
        retryCount: spend.retry_count + 1,
      });

      return {
        spendId: spend.id,
        status: 'failed',
        error: `Failed after ${spend.retry_count + 1} attempts: ${errorMessage}`,
      };
    } else {
      // Reset to pending for retry
      await execute(
        `UPDATE juice_spends SET
          status = 'pending',
          error_message = $1,
          retry_count = retry_count + 1,
          last_retry_at = NOW(),
          updated_at = NOW()
         WHERE id = $2`,
        [errorMessage, spend.id]
      );

      logger.error('Single spend failed, will retry', error as Error, {
        spendId: spend.id,
        retryCount: spend.retry_count + 1,
      });

      throw new Error(`Spend failed (attempt ${spend.retry_count + 1}/${MAX_RETRIES}): ${errorMessage}`);
    }
  }
}
