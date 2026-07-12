/**
 * Fiat Payment Settlement Service
 *
 * Handles the 7-day settlement delay for fiat payments to protect against chargebacks.
 * Payments are held in the database until the settlement period passes, then
 * executed on-chain at the current exchange rate.
 */

import { execute, query, queryOne, transaction } from '../db/index.ts';
import { logger } from '../utils/logger.ts';
import { getConfig } from '../utils/config.ts';
import { type Address, formatEther, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { executeJuiceProjectPayment, getEthUsdRate, verifyJuiceProjectPayment } from './juice.ts';
import { getPublicClient } from './chainReader.ts';

// Default settlement delay in days (used when no risk score provided)
const DEFAULT_SETTLEMENT_DELAY_DAYS = 7;

// Maximum retries before marking as failed
const MAX_RETRIES = 5;

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
  settlement_amount_wei?: string | null;
  settlement_tx_hash?: string | null;
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
    ],
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
  disputeReason?: string,
): Promise<boolean> {
  return await transaction(async (client) => {
    // Find the payment
    const { rows: payments } = await client.queryObject<{ id: string; status: string }>(
      `SELECT id, status FROM pending_fiat_payments
       WHERE stripe_payment_intent_id = $1`,
      [stripePaymentIntentId],
    );

    if (!payments[0]) {
      logger.warn('Dispute for unknown payment', { stripePaymentIntentId });
      return false;
    }

    const payment = payments[0];

    if (payment.status !== 'pending_settlement') {
      logger.error('Dispute received after settlement processing began', undefined, {
        paymentId: payment.id,
        stripePaymentIntentId,
      });
      // This is bad - we already paid out. Need manual intervention.
      return false;
    }

    // Mark as disputed
    const disputed = await client.queryObject(
      `UPDATE pending_fiat_payments
       SET status = 'disputed', updated_at = NOW()
       WHERE id = $1 AND status = 'pending_settlement'`,
      [payment.id],
    );
    if ((disputed.rowCount ?? 0) !== 1) return false;

    // Log the dispute
    await client.queryObject(
      `INSERT INTO fiat_payment_disputes (
        pending_payment_id, stripe_dispute_id, dispute_reason
      ) VALUES ($1, $2, $3)`,
      [payment.id, stripeDisputeId, disputeReason || null],
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
  stripePaymentIntentId: string,
): Promise<boolean> {
  const count = await execute(
    `UPDATE pending_fiat_payments
     SET status = 'refunded', updated_at = NOW()
     WHERE stripe_payment_intent_id = $1
     AND status = 'pending_settlement'`,
    [stripePaymentIntentId],
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
export function getPaymentsReadyForSettlement(): Promise<PendingPayment[]> {
  return query<PendingPayment>(
    `SELECT id, user_id, amount_usd, amount_cents, project_id, chain_id,
            memo, beneficiary_address, retry_count
     FROM pending_fiat_payments
     WHERE status = 'pending_settlement'
     AND settles_at <= NOW()
     AND retry_count < $1
     ORDER BY settles_at ASC
     LIMIT 50`,
    [MAX_RETRIES],
  );
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
    onSubmitted?: (txHash: Hex) => Promise<void>;
  },
): Promise<SettlementResult> {
  const result = await executeJuiceProjectPayment({
    privateKey,
    chainId: params.chainId,
    projectId: params.projectId,
    beneficiary: params.beneficiary,
    amountWei: params.amountWei,
    memo: params.memo,
    onSubmitted: params.onSubmitted,
  });
  return { txHash: result.txHash, tokensReceived: BigInt(result.tokensReceived) };
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

  const payment = await queryOne<PendingPayment>(
    `UPDATE pending_fiat_payments
     SET status = 'settling', updated_at = NOW()
     WHERE id = $1 AND status = 'pending_settlement'
       AND settles_at <= NOW() AND retry_count < $2
     RETURNING *`,
    [paymentId, MAX_RETRIES],
  );

  if (!payment) {
    throw new Error('Payment is not ready for settlement');
  }

  let submittedTxHash: Hex | null = null;
  try {
    // Get current exchange rate
    const ethUsdRate = await getEthUsdRate();

    // Convert USD to ETH
    const amountEth = payment.amount_usd / ethUsdRate;
    const amountWei = BigInt(Math.floor(amountEth * 1e18));
    if (amountWei <= 0n) throw new Error('Settlement amount is too small to transfer');

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
      onSubmitted: async (hash) => {
        submittedTxHash = hash;
        const recorded = await execute(
          `UPDATE pending_fiat_payments
           SET settlement_rate_eth_usd = $1, settlement_amount_wei = $2,
               settlement_tx_hash = $3, updated_at = NOW()
           WHERE id = $4 AND status = 'settling' AND settlement_tx_hash IS NULL`,
          [ethUsdRate, amountWei.toString(), hash, paymentId],
        );
        if (recorded !== 1) throw new Error('Could not bind submitted settlement payment');
      },
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
      WHERE id = $5 AND status = 'settling' AND settlement_tx_hash = $3`,
      [
        ethUsdRate,
        amountWei.toString(),
        txHash,
        tokensReceived.toString(),
        paymentId,
      ],
    );

    logger.info('Payment settled successfully', {
      paymentId,
      txHash,
      tokensReceived: tokensReceived.toString(),
    });

    return { txHash, tokensReceived };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (submittedTxHash) {
      await execute(
        `UPDATE pending_fiat_payments
         SET error_message = $1, updated_at = NOW()
         WHERE id = $2 AND status = 'settling' AND settlement_tx_hash = $3`,
        [errorMessage, paymentId, submittedTxHash],
      );
      logger.error('Submitted settlement awaits reconciliation', error as Error, {
        paymentId,
        txHash: submittedTxHash,
      });
      throw error;
    }

    // Only failures which happened before broadcast can be retried.
    await execute(
      `UPDATE pending_fiat_payments SET
        status = 'pending_settlement',
        retry_count = retry_count + 1,
        last_retry_at = NOW(),
        error_message = $1,
        updated_at = NOW()
      WHERE id = $2 AND status = 'settling' AND settlement_tx_hash IS NULL`,
      [errorMessage, paymentId],
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
  let settled = 0;
  let failed = 0;
  const privateKey = getConfig().reservesPrivateKey as Hex;
  if (privateKey) {
    const payer = privateKeyToAccount(privateKey).address;
    const submitted = await query<
      PendingPayment & {
        settlement_amount_wei: string;
        settlement_tx_hash: string;
      }
    >(
      `SELECT * FROM pending_fiat_payments
       WHERE status = 'settling'
         AND settlement_tx_hash IS NOT NULL
         AND settlement_amount_wei IS NOT NULL
       LIMIT 50`,
    );
    for (const payment of submitted) {
      const client = getPublicClient(payment.chain_id);
      const hash = payment.settlement_tx_hash as Hex;
      try {
        const receipt = await client.getTransactionReceipt({ hash });
        if (receipt.status === 'reverted') {
          const count = await execute(
            `UPDATE pending_fiat_payments
             SET status = 'pending_settlement', retry_count = retry_count + 1,
                 last_retry_at = NOW(), settlement_rate_eth_usd = NULL,
                 settlement_amount_wei = NULL, settlement_tx_hash = NULL,
                 error_message = 'Settlement transaction reverted', updated_at = NOW()
             WHERE id = $1 AND status = 'settling' AND settlement_tx_hash = $2`,
            [payment.id, hash],
          );
          if (count === 1) failed++;
          continue;
        }
        const tokensReceived = await verifyJuiceProjectPayment({
          client,
          txHash: hash,
          payer,
          projectId: payment.project_id,
          beneficiary: payment.beneficiary_address as Address,
          amountWei: BigInt(payment.settlement_amount_wei),
          memo: payment.memo || `Fiat payment: $${payment.amount_usd}`,
        });
        const count = await execute(
          `UPDATE pending_fiat_payments
           SET status = 'settled', settled_at = NOW(), tokens_received = $1,
               error_message = NULL, updated_at = NOW()
           WHERE id = $2 AND status = 'settling' AND settlement_tx_hash = $3`,
          [tokensReceived.toString(), payment.id, hash],
        );
        if (count === 1) settled++;
      } catch {
        // A pending receipt or temporary RPC failure remains non-retryable.
      }
    }
  }

  const payments = await getPaymentsReadyForSettlement();

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
    [],
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
  chainId: number,
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
    [projectId, chainId],
  );

  return {
    pendingUsd: row ? parseFloat(row.pending_usd || '0') : 0,
    pendingCount: row ? parseInt(row.pending_count) : 0,
    nextSettlement: row?.next_settlement_at ? new Date(row.next_settlement_at) : null,
  };
}

/**
 * Get user's pending payments
 */
export async function getUserPendingPayments(
  userId: string,
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
    [userId],
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
