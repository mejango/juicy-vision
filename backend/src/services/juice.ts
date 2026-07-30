/**
 * Juice Service - Stored Value System
 *
 * Enables non-crypto users to pay Juicebox projects with fiat.
 * 1 Juice = $1 USD. Non-refundable, non-transferable.
 *
 * Flow: Purchase (Stripe) → Balance → Spend (Project) or Cash Out (Crypto)
 */

import { execute, query, queryOne, transaction } from '../db/index.ts';
import { logger } from '../utils/logger.ts';
import { getConfig } from '../utils/config.ts';
import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  encodeFunctionData,
  formatEther,
  type Hex,
  http,
  isAddressEqual,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum, base, mainnet, optimism } from '../constants/chains.ts';
import { CONTRACTS, NATIVE_TOKEN as SHARED_NATIVE_TOKEN } from '@shared/chains.ts';
import { resolvePayPreviewOutcome, TERMINAL_PREVIEW_PAY_ABI } from '@shared/terminalPreview.ts';
import { fetchPrimaryTerminal, getPublicClient } from './chainReader.ts';
import {
  requireRecognizedProjectPayConfiguration,
  requireRecognizedRuntimeHook,
} from './projectTrust.ts';
import { verifyProtectedPaymentReceipt } from './paymentReceipt.ts';

// Maximum retries before marking as failed
const MAX_RETRIES = 5;

// Default cash out delay in hours (fraud protection)
const CASH_OUT_DELAY_HOURS = 24;

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

const NATIVE_TOKEN = SHARED_NATIVE_TOKEN;
const RECOGNIZED_MULTI_TERMINAL = CONTRACTS.JBMultiTerminal as Address;
const RECOGNIZED_PAYMENT_ENTRYPOINTS = new Set([
  RECOGNIZED_MULTI_TERMINAL.toLowerCase(),
  CONTRACTS.JBRouterTerminal.toLowerCase(),
  CONTRACTS.JBRouterTerminalRegistry.toLowerCase(),
]);

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

export async function assertJuiceProjectPaymentRoute(
  chainId: number,
  projectId: number,
): Promise<Address> {
  const terminal = await fetchPrimaryTerminal(chainId, projectId, NATIVE_TOKEN);
  await requireRecognizedProjectPayConfiguration({
    client: getPublicClient(chainId),
    projectId: BigInt(projectId),
  });
  return terminal;
}

export async function executeJuiceProjectPayment(params: {
  privateKey: Hex;
  chainId: number;
  projectId: number;
  beneficiary: Address;
  amountWei: bigint;
  memo: string;
  onSubmitted?: (txHash: Hex) => Promise<void>;
}): Promise<{ txHash: Hex; tokensReceived: string }> {
  const chainConfig = CHAINS[params.chainId];
  if (!chainConfig) throw new Error(`Unsupported chain: ${params.chainId}`);

  const account = privateKeyToAccount(params.privateKey);
  const walletClient = createWalletClient({
    account,
    chain: chainConfig.chain,
    transport: http(chainConfig.rpcUrl),
  });
  const publicClient = getPublicClient(params.chainId);
  const terminal = await assertJuiceProjectPaymentRoute(params.chainId, params.projectId);
  const preview = await publicClient.readContract({
    account: account.address,
    address: terminal,
    abi: TERMINAL_PREVIEW_PAY_ABI,
    functionName: 'previewPayFor',
    args: [
      BigInt(params.projectId),
      NATIVE_TOKEN,
      params.amountWei,
      params.beneficiary,
      '0x',
    ],
  });
  for (const specification of preview[3]) {
    if (!specification.noop) {
      await requireRecognizedRuntimeHook({
        client: publicClient,
        projectId: BigInt(params.projectId),
        rulesetId: preview[0].id,
        hook: specification.hook,
      });
    }
  }

  const previewOutcome = resolvePayPreviewOutcome({
    beneficiaryTokenCount: preview[1],
    reservedTokenCount: preview[2],
    hookSpecifications: preview[3],
  });
  if (previewOutcome.beneficiaryTokenCount <= 0n) {
    throw new Error('The payment quote returns no project tokens');
  }
  const minReturnedTokens = previewOutcome.minReturnedTokens;
  const data = encodeFunctionData({
    abi: TERMINAL_ABI,
    functionName: 'pay',
    args: [
      BigInt(params.projectId),
      NATIVE_TOKEN,
      params.amountWei,
      params.beneficiary,
      minReturnedTokens,
      params.memo,
      '0x',
    ],
  });
  await publicClient.call({
    account: account.address,
    to: terminal,
    data,
    value: params.amountWei,
  });
  const txHash = await walletClient.sendTransaction({
    account,
    chain: chainConfig.chain,
    to: terminal,
    data,
    value: params.amountWei,
  });
  await params.onSubmitted?.(txHash);
  const tokensReceived = await verifyJuiceProjectPayment({
    client: publicClient,
    txHash,
    payer: account.address,
    projectId: params.projectId,
    beneficiary: params.beneficiary,
    amountWei: params.amountWei,
    memo: params.memo,
  });
  return { txHash, tokensReceived: tokensReceived.toString() };
}

export async function verifyJuiceProjectPayment(params: {
  client: ReturnType<typeof getPublicClient>;
  txHash: Hex;
  payer: Address;
  projectId: number;
  beneficiary: Address;
  amountWei: bigint;
  memo: string;
}): Promise<bigint> {
  const [chainTransaction, receipt] = await Promise.all([
    params.client.getTransaction({ hash: params.txHash }),
    params.client.getTransactionReceipt({ hash: params.txHash }),
  ]);
  if (receipt.status !== 'success') throw new Error('Project payment reverted');
  if (
    !chainTransaction.to ||
    !RECOGNIZED_PAYMENT_ENTRYPOINTS.has(chainTransaction.to.toLowerCase())
  ) {
    throw new Error('Project payment target is not recognized');
  }
  if (!isAddressEqual(chainTransaction.from, params.payer)) {
    throw new Error('Project payment was sent by a different wallet');
  }
  const decodedCall = decodeFunctionData({ abi: TERMINAL_ABI, data: chainTransaction.input });
  if (decodedCall.functionName !== 'pay') throw new Error('Transaction is not a project payment');
  const [projectId, token, amount, beneficiary, minimum, memo, metadata] = decodedCall.args;
  if (
    projectId !== BigInt(params.projectId) ||
    !isAddressEqual(token, NATIVE_TOKEN) ||
    amount !== params.amountWei ||
    !isAddressEqual(beneficiary, params.beneficiary) ||
    minimum <= 0n ||
    memo !== params.memo ||
    metadata !== '0x' ||
    chainTransaction.value !== params.amountWei
  ) {
    throw new Error('Project payment does not match the reviewed request');
  }

  return verifyProtectedPaymentReceipt({
    logs: receipt.logs,
    entrypoint: chainTransaction.to,
    projectId: BigInt(params.projectId),
    payer: params.payer,
    beneficiary: params.beneficiary,
    amount: params.amountWei,
    memo: params.memo,
    metadata: '0x',
    minimum,
  });
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
    [userId],
  );

  // Create if doesn't exist
  if (!row) {
    await execute(
      `INSERT INTO juice_balances (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );

    row = await queryOne(
      `SELECT user_id, balance, lifetime_purchased, lifetime_spent,
              lifetime_cashed_out, expires_at
       FROM juice_balances WHERE user_id = $1`,
      [userId],
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
  purchaseId: string,
): Promise<boolean> {
  return await transaction(async (client) => {
    const { rows: purchases } = await client.queryObject<{ juice_amount: string }>(
      `UPDATE juice_purchases
       SET status = 'credited', credited_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'clearing'
       RETURNING juice_amount`,
      [purchaseId, userId],
    );
    if (!purchases[0]) return false;
    const amount = purchases[0].juice_amount;

    // Ensure balance record exists
    await client.queryObject(
      `INSERT INTO juice_balances (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );

    // Credit the balance and update activity timestamp
    await client.queryObject(
      `UPDATE juice_balances
       SET balance = balance + $1,
           lifetime_purchased = lifetime_purchased + $1,
           last_activity_at = NOW(),
           updated_at = NOW()
       WHERE user_id = $2`,
      [amount, userId],
    );

    logger.info('Juice credited', { userId, amount, purchaseId });
    return true;
  });
}

/**
 * Refund Juice to user's balance (when spend/cash-out fails)
 */
async function refundJuice(
  userId: string,
  amount: number,
  type: 'spend' | 'cash_out',
): Promise<void> {
  const lifetimeColumn = type === 'spend' ? 'lifetime_spent' : 'lifetime_cashed_out';

  await execute(
    `UPDATE juice_balances
     SET balance = balance + $1,
         ${lifetimeColumn} = ${lifetimeColumn} - $1,
         updated_at = NOW()
     WHERE user_id = $2`,
    [amount, userId],
  );

  logger.info('Juice refunded', { userId, amount, type });
}

async function refundSubmittedSpend(spendId: string, errorMessage: string): Promise<boolean> {
  return await transaction(async (client) => {
    const { rows } = await client.queryObject<{
      user_id: string;
      juice_amount: string;
    }>(
      `UPDATE juice_spends
       SET status = 'failed', error_message = $1, updated_at = NOW()
       WHERE id = $2 AND status = 'executing' AND tx_hash IS NOT NULL
       RETURNING user_id, juice_amount`,
      [errorMessage, spendId],
    );
    if (!rows[0]) return false;
    await client.queryObject(
      `UPDATE juice_balances
       SET balance = balance + $1,
           lifetime_spent = lifetime_spent - $1,
           updated_at = NOW()
       WHERE user_id = $2`,
      [rows[0].juice_amount, rows[0].user_id],
    );
    return true;
  });
}

async function refundSubmittedCashOut(cashOutId: string, errorMessage: string): Promise<boolean> {
  return await transaction(async (client) => {
    const { rows } = await client.queryObject<{
      user_id: string;
      juice_amount: string;
    }>(
      `UPDATE juice_cash_outs
       SET status = 'failed', error_message = $1, updated_at = NOW()
       WHERE id = $2 AND status = 'processing' AND tx_hash IS NOT NULL
       RETURNING user_id, juice_amount`,
      [errorMessage, cashOutId],
    );
    if (!rows[0]) return false;
    await client.queryObject(
      `UPDATE juice_balances
       SET balance = balance + $1,
           lifetime_cashed_out = lifetime_cashed_out - $1,
           updated_at = NOW()
       WHERE user_id = $2`,
      [rows[0].juice_amount, rows[0].user_id],
    );
    return true;
  });
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
    ],
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
  stripePaymentIntentId: string,
): Promise<boolean> {
  const count = await execute(
    `UPDATE juice_purchases
     SET status = 'disputed'
     WHERE stripe_payment_intent_id = $1
     AND status IN ('pending', 'clearing')`,
    [stripePaymentIntentId],
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
  stripePaymentIntentId: string,
): Promise<boolean> {
  const count = await execute(
    `UPDATE juice_purchases
     SET status = 'refunded'
     WHERE stripe_payment_intent_id = $1
     AND status IN ('pending', 'clearing')`,
    [stripePaymentIntentId],
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
    [userId],
  );

  return rows.map((r) => ({
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
  chainId: number;
  beneficiaryAddress: string;
  memo?: string;
}): Promise<string> {
  const chainId = params.chainId;
  if (!CHAINS[chainId]) throw new Error(`Unsupported chain: ${chainId}`);

  return await transaction(async (client) => {
    // Deduct from balance first and update activity timestamp
    const debitResult = await client.queryObject(
      `UPDATE juice_balances
       SET balance = balance - $1,
           lifetime_spent = lifetime_spent + $1,
           last_activity_at = NOW(),
           updated_at = NOW()
       WHERE user_id = $2
       AND balance >= $1`,
      [params.amount, params.userId],
    );

    if ((debitResult.rowCount ?? 0) === 0) {
      throw new Error('Insufficient Juice balance');
    }

    // Create spend record
    const { rows } = await client.queryObject<{ id: string }>(
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
      ],
    );

    logger.info('Juice spend created', {
      spendId: rows[0].id,
      userId: params.userId,
      amount: params.amount,
      projectId: params.projectId,
      chainId,
    });

    return rows[0].id;
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
    [userId],
  );

  return rows.map((r) => ({
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
  chainId: number;
}): Promise<string> {
  const chainId = params.chainId;
  if (!CHAINS[chainId]) throw new Error(`Unsupported chain: ${chainId}`);
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new Error('Cash-out amount must be greater than zero');
  }
  const destination = params.destinationAddress.toLowerCase();
  if (
    !/^0x[a-f0-9]{40}$/.test(destination) ||
    destination === '0x0000000000000000000000000000000000000000' ||
    destination === '0x000000000000000000000000000000000000dead'
  ) {
    throw new Error('Cash-out destination must be an explicit wallet address');
  }
  const availableAt = new Date();
  availableAt.setHours(availableAt.getHours() + CASH_OUT_DELAY_HOURS);

  return await transaction(async (client) => {
    // Deduct from balance first and update activity timestamp
    const debitResult = await client.queryObject(
      `UPDATE juice_balances
       SET balance = balance - $1,
           lifetime_cashed_out = lifetime_cashed_out + $1,
           last_activity_at = NOW(),
           updated_at = NOW()
       WHERE user_id = $2
       AND balance >= $1`,
      [params.amount, params.userId],
    );

    if ((debitResult.rowCount ?? 0) === 0) {
      throw new Error('Insufficient Juice balance');
    }

    // Create cash out record
    const { rows } = await client.queryObject<{ id: string }>(
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
      ],
    );

    logger.info('Cash out initiated', {
      cashOutId: rows[0].id,
      userId: params.userId,
      amount: params.amount,
      destinationAddress: params.destinationAddress,
      chainId,
      availableAt: availableAt.toISOString(),
    });

    return rows[0].id;
  });
}

/**
 * Cancel a pending cash out
 */
export async function cancelCashOut(
  cashOutId: string,
  userId: string,
): Promise<void> {
  await transaction(async (client) => {
    // Get the cash out
    const { rows: cashOuts } = await client.queryObject<{ juice_amount: string; status: string }>(
      `SELECT juice_amount, status FROM juice_cash_outs
       WHERE id = $1 AND user_id = $2`,
      [cashOutId, userId],
    );

    if (!cashOuts[0]) {
      throw new Error('Cash out not found');
    }

    if (cashOuts[0].status !== 'pending') {
      throw new Error(`Cannot cancel cash out with status: ${cashOuts[0].status}`);
    }

    const amount = parseFloat(cashOuts[0].juice_amount);

    // Refund the balance
    await client.queryObject(
      `UPDATE juice_balances
       SET balance = balance + $1,
           lifetime_cashed_out = lifetime_cashed_out - $1,
           updated_at = NOW()
       WHERE user_id = $2`,
      [amount, userId],
    );

    // Mark as cancelled
    await client.queryObject(
      `UPDATE juice_cash_outs
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1`,
      [cashOutId],
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
    [userId],
  );

  return rows.map((r) => ({
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
  offset = 0,
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
    [userId, limit, offset],
  );

  return rows.map((r) => ({
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

  if (updatedAt <= 0 || age < 0 || age > CHAINLINK_MAX_STALENESS_SECONDS) {
    throw new Error(
      `Chainlink price data is stale (${age}s old, max ${CHAINLINK_MAX_STALENESS_SECONDS}s)`,
    );
  }
  if (data[0] <= 0n || data[4] < data[0] || data[1] <= 0n) {
    throw new Error('Chainlink returned an incomplete ETH/USD round');
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
  // creditJuice performs the authoritative conditional transition and balance
  // update in one transaction, so overlapping workers remain idempotent.
  const purchases = await query<{
    id: string;
    user_id: string;
  }>(
    `SELECT id, user_id
     FROM juice_purchases
     WHERE status = 'clearing'
     AND clears_at <= NOW()
     LIMIT 50`,
  );

  let credited = 0;
  let failed = 0;

  for (const purchase of purchases) {
    try {
      if (await creditJuice(purchase.user_id, purchase.id)) credited++;
    } catch (error) {
      logger.error('Failed to credit Juice', error as Error, {
        purchaseId: purchase.id,
      });
      failed++;
    }
  }

  // Get remaining pending count
  const [{ count }] = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM juice_purchases WHERE status = 'clearing'`,
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

  let executed = 0;
  let failed = 0;
  const payer = privateKeyToAccount(privateKey).address;

  const submittedSpends = await query<{
    id: string;
    project_id: number;
    chain_id: number;
    beneficiary_address: string;
    memo: string | null;
    juice_amount: string;
    crypto_amount: string;
    tx_hash: string;
  }>(
    `SELECT id, project_id, chain_id, beneficiary_address, memo,
            juice_amount, crypto_amount, tx_hash
     FROM juice_spends
     WHERE status = 'executing' AND tx_hash IS NOT NULL AND crypto_amount IS NOT NULL
     LIMIT 50`,
  );
  for (const spend of submittedSpends) {
    const client = getPublicClient(spend.chain_id);
    try {
      const receipt = await client.getTransactionReceipt({ hash: spend.tx_hash as Hex });
      if (receipt.status === 'reverted') {
        if (await refundSubmittedSpend(spend.id, 'Project payment reverted')) failed++;
        continue;
      }
      const amountUsd = parseFloat(spend.juice_amount);
      const tokensReceived = await verifyJuiceProjectPayment({
        client,
        txHash: spend.tx_hash as Hex,
        payer,
        projectId: spend.project_id,
        beneficiary: spend.beneficiary_address as Address,
        amountWei: BigInt(spend.crypto_amount),
        memo: spend.memo || `Juice payment: $${amountUsd}`,
      });
      const count = await execute(
        `UPDATE juice_spends
         SET status = 'completed', tokens_received = $1, updated_at = NOW()
         WHERE id = $2 AND status = 'executing' AND tx_hash = $3`,
        [tokensReceived.toString(), spend.id, spend.tx_hash],
      );
      if (count === 1) executed++;
    } catch {
      // Pending transactions and temporary RPC failures remain non-retryable.
    }
  }

  // Claim work atomically. A SELECT ... FOR UPDATE through the pooled query
  // helper would release its lock before the later status update.
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
    `WITH candidates AS (
       SELECT id
       FROM juice_spends
       WHERE status = 'pending' AND retry_count < $1
       ORDER BY created_at ASC
       LIMIT 20
       FOR UPDATE SKIP LOCKED
     )
     UPDATE juice_spends AS spend
     SET status = 'executing', updated_at = NOW()
     FROM candidates
     WHERE spend.id = candidates.id
     RETURNING spend.id, spend.user_id, spend.project_id, spend.chain_id,
               spend.beneficiary_address, spend.memo, spend.juice_amount,
               spend.retry_count`,
    [MAX_RETRIES],
  );

  for (const spend of spends) {
    let submittedTxHash: Hex | null = null;
    try {
      // Get ETH/USD rate
      const ethUsdRate = await getEthUsdRate();
      const amountUsd = parseFloat(spend.juice_amount);
      const amountEth = amountUsd / ethUsdRate;
      const amountWei = BigInt(Math.floor(amountEth * 1e18));
      if (amountWei <= 0n) throw new Error('Project payment amount is too small to transfer');

      logger.info('Executing Juice spend', {
        spendId: spend.id,
        amountUsd,
        ethUsdRate,
        amountEth: formatEther(amountWei),
      });

      const { txHash, tokensReceived } = await executeJuiceProjectPayment({
        privateKey,
        chainId: spend.chain_id,
        projectId: spend.project_id,
        beneficiary: spend.beneficiary_address as Address,
        amountWei,
        memo: spend.memo || `Juice payment: $${amountUsd}`,
        onSubmitted: async (hash) => {
          submittedTxHash = hash;
          const recorded = await execute(
            `UPDATE juice_spends
             SET tx_hash = $1, crypto_amount = $2, eth_usd_rate = $3, updated_at = NOW()
             WHERE id = $4 AND status = 'executing' AND tx_hash IS NULL`,
            [hash, amountWei.toString(), ethUsdRate, spend.id],
          );
          if (recorded !== 1) throw new Error('Could not bind submitted project payment');
        },
      });

      // Mark as completed
      await execute(
        `UPDATE juice_spends SET
          status = 'completed',
          tx_hash = $1,
          crypto_amount = $2,
          eth_usd_rate = $3,
          tokens_received = $4,
          updated_at = NOW()
         WHERE id = $5 AND status = 'executing' AND tx_hash = $1`,
        [txHash, amountWei.toString(), ethUsdRate, tokensReceived, spend.id],
      );

      logger.info('Juice spend completed', {
        spendId: spend.id,
        txHash,
        projectId: spend.project_id,
      });

      executed++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (submittedTxHash) {
        await execute(
          `UPDATE juice_spends
           SET error_message = $1, updated_at = NOW()
           WHERE id = $2 AND status = 'executing' AND tx_hash = $3`,
          [errorMessage, spend.id, submittedTxHash],
        );
        logger.error('Submitted Juice spend awaits reconciliation', error as Error, {
          spendId: spend.id,
          txHash: submittedTxHash,
        });
        continue;
      }

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
          [errorMessage, spend.id],
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
          [errorMessage, spend.id],
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
    `SELECT COUNT(*) as count FROM juice_spends WHERE status = 'pending'`,
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

  let processed = 0;
  let failed = 0;
  const payer = privateKeyToAccount(privateKey).address;

  const submittedCashOuts = await query<{
    id: string;
    destination_address: string;
    chain_id: number;
    crypto_amount: string;
    tx_hash: string;
  }>(
    `SELECT id, destination_address, chain_id, crypto_amount, tx_hash
     FROM juice_cash_outs
     WHERE status = 'processing' AND tx_hash IS NOT NULL AND crypto_amount IS NOT NULL
     LIMIT 50`,
  );
  for (const cashOut of submittedCashOuts) {
    try {
      const chainConfig = CHAINS[cashOut.chain_id];
      if (!chainConfig) throw new Error(`Unsupported chain: ${cashOut.chain_id}`);
      const client = createPublicClient({
        chain: chainConfig.chain,
        transport: http(chainConfig.rpcUrl),
      });
      const hash = cashOut.tx_hash as Hex;
      const [receipt, chainTransaction] = await Promise.all([
        client.getTransactionReceipt({ hash }),
        client.getTransaction({ hash }),
      ]);
      if (receipt.status === 'reverted') {
        if (await refundSubmittedCashOut(cashOut.id, 'Cash-out transfer reverted')) failed++;
        continue;
      }
      if (
        !chainTransaction.to ||
        !isAddressEqual(chainTransaction.from, payer) ||
        !isAddressEqual(chainTransaction.to, cashOut.destination_address as Address) ||
        chainTransaction.value !== BigInt(cashOut.crypto_amount) ||
        chainTransaction.input !== '0x'
      ) {
        throw new Error('Confirmed cash-out transaction does not match the withdrawal');
      }
      const count = await execute(
        `UPDATE juice_cash_outs
         SET status = 'completed', updated_at = NOW()
         WHERE id = $1 AND status = 'processing' AND tx_hash = $2`,
        [cashOut.id, cashOut.tx_hash],
      );
      if (count === 1) processed++;
    } catch {
      // Pending transactions and temporary RPC failures remain non-retryable.
    }
  }

  // Claim withdrawals atomically before doing any rate lookup or broadcast.
  const cashOuts = await query<{
    id: string;
    user_id: string;
    destination_address: string;
    chain_id: number;
    juice_amount: string;
    retry_count: number;
  }>(
    `WITH candidates AS (
       SELECT id
       FROM juice_cash_outs
       WHERE status = 'pending'
         AND available_at <= NOW()
         AND retry_count < $1
       ORDER BY available_at ASC
       LIMIT 20
       FOR UPDATE SKIP LOCKED
     )
     UPDATE juice_cash_outs AS cash_out
     SET status = 'processing', updated_at = NOW()
     FROM candidates
     WHERE cash_out.id = candidates.id
     RETURNING cash_out.id, cash_out.user_id, cash_out.destination_address,
               cash_out.chain_id, cash_out.juice_amount, cash_out.retry_count`,
    [MAX_RETRIES],
  );

  for (const cashOut of cashOuts) {
    let submittedTxHash: Hex | null = null;
    try {
      // Get ETH/USD rate
      const ethUsdRate = await getEthUsdRate();
      const amountUsd = parseFloat(cashOut.juice_amount);
      const amountEth = amountUsd / ethUsdRate;
      const amountWei = BigInt(Math.floor(amountEth * 1e18));
      if (amountWei <= 0n) throw new Error('Cash-out amount is too small to transfer');

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

      const destination = cashOut.destination_address as Address;
      await publicClient.call({
        account: account.address,
        to: destination,
        value: amountWei,
      });
      const txHash = await walletClient.sendTransaction({
        to: destination,
        value: amountWei,
      });
      submittedTxHash = txHash;
      const recorded = await execute(
        `UPDATE juice_cash_outs
         SET tx_hash = $1, crypto_amount = $2, eth_usd_rate = $3, updated_at = NOW()
         WHERE id = $4 AND status = 'processing' AND tx_hash IS NULL`,
        [txHash, amountWei.toString(), ethUsdRate, cashOut.id],
      );
      if (recorded !== 1) throw new Error('Could not bind submitted cash-out transfer');

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') throw new Error('Cash-out transfer reverted');

      // Mark as completed
      await execute(
        `UPDATE juice_cash_outs SET
          status = 'completed',
          tx_hash = $1,
          crypto_amount = $2,
          eth_usd_rate = $3,
          updated_at = NOW()
         WHERE id = $4 AND status = 'processing' AND tx_hash = $1`,
        [txHash, amountWei.toString(), ethUsdRate, cashOut.id],
      );

      logger.info('Cash out completed', {
        cashOutId: cashOut.id,
        txHash,
        destination: cashOut.destination_address,
      });

      processed++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (submittedTxHash) {
        await execute(
          `UPDATE juice_cash_outs
           SET error_message = $1, updated_at = NOW()
           WHERE id = $2 AND status = 'processing' AND tx_hash = $3`,
          [errorMessage, cashOut.id, submittedTxHash],
        );
        logger.error('Submitted cash out awaits reconciliation', error as Error, {
          cashOutId: cashOut.id,
          txHash: submittedTxHash,
        });
        continue;
      }

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
          [errorMessage, cashOut.id],
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
          [errorMessage, cashOut.id],
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
    `SELECT COUNT(*) as count FROM juice_cash_outs WHERE status = 'pending'`,
  );

  return {
    processed,
    failed,
    pending: parseInt(count),
  };
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
    [userId],
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
  status: 'completed' | 'submitted' | 'failed';
  txHash?: string;
  error?: string;
}> {
  const config = getConfig();
  const privateKey = config.reservesPrivateKey as `0x${string}`;

  if (!privateKey) {
    throw new Error('RESERVES_PRIVATE_KEY not configured');
  }

  // Atomically claim only an untouched pending spend. Failed spends have already
  // been refunded and must never be sent later by an admin retry.
  const [spend] = await query<{
    id: string;
    user_id: string;
    project_id: number;
    chain_id: number;
    beneficiary_address: string;
    memo: string | null;
    juice_amount: string;
    retry_count: number;
  }>(
    `UPDATE juice_spends
     SET status = 'executing', updated_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING id, user_id, project_id, chain_id, beneficiary_address,
               memo, juice_amount, retry_count`,
    [spendId],
  );

  if (!spend) {
    throw new Error('Spend is not pending and cannot be executed');
  }

  let submittedTxHash: Hex | null = null;
  try {
    // Get ETH/USD rate
    const ethUsdRate = await getEthUsdRate();
    const amountUsd = parseFloat(spend.juice_amount);
    const amountEth = amountUsd / ethUsdRate;
    const amountWei = BigInt(Math.floor(amountEth * 1e18));
    if (amountWei <= 0n) throw new Error('Project payment amount is too small to transfer');

    logger.info('Processing single spend', {
      spendId: spend.id,
      amountUsd,
      ethUsdRate,
      amountEth: formatEther(amountWei),
    });

    const { txHash, tokensReceived } = await executeJuiceProjectPayment({
      privateKey,
      chainId: spend.chain_id,
      projectId: spend.project_id,
      beneficiary: spend.beneficiary_address as Address,
      amountWei,
      memo: spend.memo || `Juice payment: $${amountUsd}`,
      onSubmitted: async (hash) => {
        submittedTxHash = hash;
        const recorded = await execute(
          `UPDATE juice_spends
           SET tx_hash = $1, crypto_amount = $2, eth_usd_rate = $3, updated_at = NOW()
           WHERE id = $4 AND status = 'executing' AND tx_hash IS NULL`,
          [hash, amountWei.toString(), ethUsdRate, spend.id],
        );
        if (recorded !== 1) throw new Error('Could not bind submitted project payment');
      },
    });

    // Mark as completed
    await execute(
      `UPDATE juice_spends SET
        status = 'completed',
        tx_hash = $1,
        crypto_amount = $2,
        eth_usd_rate = $3,
        tokens_received = $4,
        updated_at = NOW()
       WHERE id = $5 AND status = 'executing' AND tx_hash = $1`,
      [txHash, amountWei.toString(), ethUsdRate, tokensReceived, spend.id],
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

    if (submittedTxHash) {
      await execute(
        `UPDATE juice_spends
         SET error_message = $1, updated_at = NOW()
         WHERE id = $2 AND status = 'executing' AND tx_hash = $3`,
        [errorMessage, spend.id, submittedTxHash],
      );
      return {
        spendId: spend.id,
        status: 'submitted',
        txHash: submittedTxHash,
        error: 'Payment submitted and awaiting receipt verification',
      };
    }

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
        [errorMessage, spend.id],
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
        [errorMessage, spend.id],
      );

      logger.error('Single spend failed, will retry', error as Error, {
        spendId: spend.id,
        retryCount: spend.retry_count + 1,
      });

      throw new Error(
        `Spend failed (attempt ${spend.retry_count + 1}/${MAX_RETRIES}): ${errorMessage}`,
      );
    }
  }
}
