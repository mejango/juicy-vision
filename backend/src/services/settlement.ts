/**
 * Fiat Payment Settlement Service
 *
 * Handles the 7-day settlement delay for fiat payments to protect against chargebacks.
 * Payments are held in the database until the settlement period passes, then
 * executed on-chain at the current exchange rate.
 */

import { query, queryOne, execute, transaction } from '../db/index.ts';
import { logger } from '../utils/logger.ts';
import { getConfig } from '../utils/config.ts';
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseEther,
  formatEther,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, optimism, arbitrum, base } from 'viem/chains';

// Default settlement delay in days (used when no risk score provided)
const DEFAULT_SETTLEMENT_DELAY_DAYS = 7;

// Maximum retries before marking as failed
const MAX_RETRIES = 5;

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

interface PendingPayment {
  id: string;
  user_id: string | null;
  amount_usd: number;
  amount_cents: number;
  project_id: number;
  chain_id: number;
  memo: string | null;
  beneficiary_address: string;
  retry_count: number;
}

interface SettlementResult {
  txHash: string;
  tokensReceived: bigint;
}

/**
 * Create a pending fiat payment after Stripe payment succeeds
 * Settlement delay is calculated based on Stripe Radar risk score:
 * - Low risk (0-20): Immediate settlement (0 days)
 * - Medium risk (21-40): 7 days
 * - Higher risk (41-60): 30 days
 * - High risk (61-80): 60 days
 * - Very high risk (81-100): 120 days
 */
export async function createPendingPayment(params: {
  userId: string | null;
  stripePaymentIntentId: string;
  stripeChargeId?: string;
  amountUsd: number;
  amountCents: number;
  projectId: number;
  chainId: number;
  memo?: string;
  beneficiaryAddress: string;
  riskScore?: number;
  settlementDelayDays?: number;
}): Promise<string> {
  // Use provided delay or default
  const delayDays = params.settlementDelayDays ?? DEFAULT_SETTLEMENT_DELAY_DAYS;

  const settlesAt = new Date();
  settlesAt.setDate(settlesAt.getDate() + delayDays);

  const [row] = await query<{ id: string }>(
    `INSERT INTO pending_fiat_payments (
      user_id, stripe_payment_intent_id, stripe_charge_id,
      amount_usd, amount_cents, project_id, chain_id, memo,
      beneficiary_address, settles_at, risk_score, settlement_delay_days
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id`,
    [
      params.userId,
      params.stripePaymentIntentId,
      params.stripeChargeId || null,
      params.amountUsd,
      params.amountCents,
      params.projectId,
      params.chainId,
      params.memo || null,
      params.beneficiaryAddress,
      settlesAt,
      params.riskScore ?? null,
      delayDays,
    ]
  );

  logger.info('Created pending fiat payment', {
    paymentId: row.id,
    amountUsd: params.amountUsd,
    projectId: params.projectId,
    chainId: params.chainId,
    riskScore: params.riskScore,
    settlementDelayDays: delayDays,
    settlesAt: settlesAt.toISOString(),
  });

  return row.id;
}

/**
 * Mark payment as disputed (chargeback received)
 * This prevents the payment from ever being settled
 */
export async function markPaymentDisputed(
  stripePaymentIntentId: string,
  stripeDisputeId: string,
  disputeReason?: string
): Promise<boolean> {
  return await transaction(async (client) => {
    // Find the payment
    const { rows: payments } = await client.queryObject<{ id: string; status: string }>(
      `SELECT id, status FROM pending_fiat_payments
       WHERE stripe_payment_intent_id = $1`,
      [stripePaymentIntentId]
    );

    if (!payments[0]) {
      logger.warn('Dispute for unknown payment', { stripePaymentIntentId });
      return false;
    }

    const payment = payments[0];

    if (payment.status === 'settled') {
      logger.error('Dispute received for already settled payment', undefined, {
        paymentId: payment.id,
        stripePaymentIntentId,
      });
      // This is bad - we already paid out. Need manual intervention.
      return false;
    }

    // Mark as disputed
    await client.queryObject(
      `UPDATE pending_fiat_payments
       SET status = 'disputed', updated_at = NOW()
       WHERE id = $1`,
      [payment.id]
    );

    // Log the dispute
    await client.queryObject(
      `INSERT INTO fiat_payment_disputes (
        pending_payment_id, stripe_dispute_id, dispute_reason
      ) VALUES ($1, $2, $3)`,
      [payment.id, stripeDisputeId, disputeReason || null]
    );

    logger.warn('Payment marked as disputed', {
      paymentId: payment.id,
      stripePaymentIntentId,
      stripeDisputeId,
    });

    return true;
  });
}

/**
 * Mark payment as refunded (manual refund via Stripe)
 */
export async function markPaymentRefunded(
  stripePaymentIntentId: string
): Promise<boolean> {
  const count = await execute(
    `UPDATE pending_fiat_payments
     SET status = 'refunded', updated_at = NOW()
     WHERE stripe_payment_intent_id = $1
     AND status = 'pending_settlement'`,
    [stripePaymentIntentId]
  );

  if (count > 0) {
    logger.info('Payment marked as refunded', { stripePaymentIntentId });
    return true;
  }
  return false;
}

/**
 * Get payments ready for settlement (past 7-day hold)
 */
export async function getPaymentsReadyForSettlement(): Promise<PendingPayment[]> {
  return query<PendingPayment>(
    `SELECT id, user_id, amount_usd, amount_cents, project_id, chain_id,
            memo, beneficiary_address, retry_count
     FROM pending_fiat_payments
     WHERE status = 'pending_settlement'
     AND settles_at <= NOW()
     AND retry_count < $1
     ORDER BY settles_at ASC
     LIMIT 50`,
    [MAX_RETRIES]
  );
}

/**
 * Fetch current ETH/USD rate from Chainlink
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

  // Chainlink returns price with 8 decimals
  const price = Number(data[1]) / 1e8;

  logger.debug('Fetched ETH/USD rate', { rate: price });

  return price;
}

/**
 * Execute a payment to a Juicebox project
 */
async function executeJuiceboxPayment(
  privateKey: `0x${string}`,
  params: {
    projectId: number;
    chainId: number;
    amountWei: bigint;
    beneficiary: `0x${string}`;
    memo: string;
  }
): Promise<SettlementResult> {
  const chainConfig = CHAINS[params.chainId];
  if (!chainConfig) {
    throw new Error(`Unsupported chain: ${params.chainId}`);
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

  // Execute pay transaction
  const txHash = await walletClient.writeContract({
    address: JB_MULTI_TERMINAL,
    abi: TERMINAL_ABI,
    functionName: 'pay',
    args: [
      BigInt(params.projectId),
      NATIVE_TOKEN,
      params.amountWei,
      params.beneficiary,
      0n, // minReturnedTokens - accept any
      params.memo,
      '0x', // metadata
    ],
    value: params.amountWei,
  });

  // Wait for confirmation
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  // TODO: Parse logs to get actual tokens received
  // For now, return 0 (would need to decode Pay event)
  const tokensReceived = 0n;

  return { txHash, tokensReceived };
}

/**
 * Settle a single payment
 */
export async function settlePayment(paymentId: string): Promise<SettlementResult> {
  const config = getConfig();
  const privateKey = config.reservesPrivateKey as `0x${string}`;

  if (!privateKey) {
    throw new Error('RESERVES_PRIVATE_KEY not configured');
  }

  // Mark as settling
  await execute(
    `UPDATE pending_fiat_payments
     SET status = 'settling', updated_at = NOW()
     WHERE id = $1`,
    [paymentId]
  );

  const payment = await queryOne<PendingPayment>(
    `SELECT * FROM pending_fiat_payments WHERE id = $1`,
    [paymentId]
  );

  if (!payment) {
    throw new Error(`Payment not found: ${paymentId}`);
  }

  try {
    // Get current exchange rate
    const ethUsdRate = await getEthUsdRate();

    // Convert USD to ETH
    const amountEth = payment.amount_usd / ethUsdRate;
    const amountWei = BigInt(Math.floor(amountEth * 1e18));

    logger.info('Settling payment', {
      paymentId,
      amountUsd: payment.amount_usd,
      ethUsdRate,
      amountEth: formatEther(amountWei),
      amountWei: amountWei.toString(),
    });

    // Execute on-chain payment
    const { txHash, tokensReceived } = await executeJuiceboxPayment(privateKey, {
      projectId: payment.project_id,
      chainId: payment.chain_id,
      amountWei,
      beneficiary: payment.beneficiary_address as `0x${string}`,
      memo: payment.memo || `Fiat payment: $${payment.amount_usd}`,
    });

    // Mark as settled
    await execute(
      `UPDATE pending_fiat_payments SET
        status = 'settled',
        settled_at = NOW(),
        settlement_rate_eth_usd = $1,
        settlement_amount_wei = $2,
        settlement_tx_hash = $3,
        tokens_received = $4,
        updated_at = NOW()
      WHERE id = $5`,
      [
        ethUsdRate,
        amountWei.toString(),
        txHash,
        tokensReceived.toString(),
        paymentId,
      ]
    );

    logger.info('Payment settled successfully', {
      paymentId,
      txHash,
      tokensReceived: tokensReceived.toString(),
    });

    return { txHash, tokensReceived };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Mark as failed but allow retry
    await execute(
      `UPDATE pending_fiat_payments SET
        status = 'pending_settlement',
        retry_count = retry_count + 1,
        last_retry_at = NOW(),
        error_message = $1,
        updated_at = NOW()
      WHERE id = $2`,
      [errorMessage, paymentId]
    );

    logger.error('Payment settlement failed', error as Error, {
      paymentId,
      retryCount: payment.retry_count + 1,
    });

    throw error;
  }
}

/**
 * Process all ready settlements (called by cron)
 */
export async function processSettlements(): Promise<{
  settled: number;
  failed: number;
  pending: number;
}> {
  const payments = await getPaymentsReadyForSettlement();

  let settled = 0;
  let failed = 0;

  for (const payment of payments) {
    try {
      await settlePayment(payment.id);
      settled++;
    } catch (error) {
      logger.error('Settlement failed', error as Error, {
        paymentId: payment.id,
      });
      failed++;
    }
  }

  // Get remaining pending count
  const [{ count }] = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM pending_fiat_payments
     WHERE status = 'pending_settlement'`,
    []
  );

  return {
    settled,
    failed,
    pending: parseInt(count),
  };
}

/**
 * Get pending balance for a project (for UI display)
 */
export async function getProjectPendingBalance(
  projectId: number,
  chainId: number
): Promise<{
  pendingUsd: number;
  pendingCount: number;
  nextSettlement: Date | null;
}> {
  const row = await queryOne<{
    pending_usd: string | null;
    pending_count: string;
    next_settlement_at: string | null;
  }>(
    `SELECT
      COALESCE(SUM(amount_usd), 0) as pending_usd,
      COUNT(*) as pending_count,
      MIN(settles_at) as next_settlement_at
    FROM pending_fiat_payments
    WHERE project_id = $1 AND chain_id = $2
    AND status = 'pending_settlement'`,
    [projectId, chainId]
  );

  return {
    pendingUsd: row ? parseFloat(row.pending_usd || '0') : 0,
    pendingCount: row ? parseInt(row.pending_count) : 0,
    nextSettlement: row?.next_settlement_at
      ? new Date(row.next_settlement_at)
      : null,
  };
}

/**
 * Get user's pending payments
 */
export async function getUserPendingPayments(
  userId: string
): Promise<
  Array<{
    id: string;
    projectId: number;
    chainId: number;
    amountUsd: number;
    status: string;
    settlesAt: Date;
  }>
> {
  const rows = await query<{
    id: string;
    project_id: number;
    chain_id: number;
    amount_usd: number;
    status: string;
    settles_at: string;
  }>(
    `SELECT id, project_id, chain_id, amount_usd, status, settles_at
     FROM pending_fiat_payments
     WHERE user_id = $1
     AND status IN ('pending_settlement', 'settling')
     ORDER BY settles_at ASC`,
    [userId]
  );

  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    chainId: r.chain_id,
    amountUsd: parseFloat(String(r.amount_usd)),
    status: r.status,
    settlesAt: new Date(r.settles_at),
  }));
}
