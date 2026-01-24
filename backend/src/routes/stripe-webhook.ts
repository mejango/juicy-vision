import { Hono } from 'hono';
import Stripe from 'npm:stripe';
import { getConfig, validateConfigForStripe } from '../utils/config.ts';
import { logger } from '../utils/logger.ts';
import {
  createPendingPayment,
  markPaymentDisputed,
  markPaymentRefunded,
  settlePayment,
} from '../services/settlement.ts';
import {
  createPurchase as createJuicePurchase,
  creditJuice,
  markPurchaseDisputed as markJuicePurchaseDisputed,
  markPurchaseRefunded as markJuicePurchaseRefunded,
} from '../services/juice.ts';

export const stripeWebhookRouter = new Hono();

// Risk score thresholds for settlement delay
// Stripe Radar risk_score ranges 0-100 (higher = riskier)
const RISK_THRESHOLDS = {
  IMMEDIATE: 20,     // 0-20: settle immediately
  SHORT_DELAY: 40,   // 21-40: 7 days
  MEDIUM_DELAY: 60,  // 41-60: 30 days
  LONG_DELAY: 80,    // 61-80: 60 days
  MAX_DELAY: 100,    // 81-100: 120 days
};

/**
 * Calculate settlement delay in days based on Stripe Radar risk score
 * Lower risk = faster settlement, higher risk = longer delay
 */
export function calculateSettlementDelayDays(riskScore: number): number {
  if (riskScore <= RISK_THRESHOLDS.IMMEDIATE) {
    return 0; // Immediate settlement
  }
  if (riskScore <= RISK_THRESHOLDS.SHORT_DELAY) {
    return 7;
  }
  if (riskScore <= RISK_THRESHOLDS.MEDIUM_DELAY) {
    return 30;
  }
  if (riskScore <= RISK_THRESHOLDS.LONG_DELAY) {
    return 60;
  }
  return 120; // Maximum protection
}

/**
 * Extract Stripe Radar risk score from payment intent or charge
 */
function extractRiskScore(paymentIntent: Stripe.PaymentIntent): number {
  // Radar risk score is on the charge's outcome
  const charge = paymentIntent.latest_charge;

  if (typeof charge === 'object' && charge?.outcome?.risk_score !== undefined) {
    return charge.outcome.risk_score;
  }

  // Default to medium-high risk if score unavailable
  return 50;
}

/**
 * Extract payment metadata for Juicebox payment
 */
function extractPaymentMetadata(paymentIntent: Stripe.PaymentIntent): {
  projectId: number;
  chainId: number;
  beneficiaryAddress: string;
  memo?: string;
  userId?: string;
} | null {
  const metadata = paymentIntent.metadata;

  if (!metadata.projectId || !metadata.chainId || !metadata.beneficiaryAddress) {
    return null;
  }

  return {
    projectId: parseInt(metadata.projectId, 10),
    chainId: parseInt(metadata.chainId, 10),
    beneficiaryAddress: metadata.beneficiaryAddress,
    memo: metadata.memo,
    userId: metadata.userId,
  };
}

// Stripe webhook endpoint - raw body required for signature verification
stripeWebhookRouter.post('/', async (c) => {
  const config = getConfig();
  validateConfigForStripe(config);

  const stripe = new Stripe(config.stripeSecretKey);
  const signature = c.req.header('stripe-signature');

  if (!signature) {
    return c.json({ error: 'Missing stripe-signature header' }, 400);
  }

  // Get raw body for signature verification
  const rawBody = await c.req.text();

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      config.stripeWebhookSecret
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.warn('Stripe webhook signature verification failed', { error: message });
    return c.json({ error: 'Invalid signature' }, 400);
  }

  logger.info('Stripe webhook received', { type: event.type, id: event.id });

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentSucceeded(stripe, paymentIntent);
        break;
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute;
        await handleDisputeCreated(dispute);
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        await handleChargeRefunded(charge);
        break;
      }

      default:
        logger.debug('Unhandled webhook event type', { type: event.type });
    }

    return c.json({ received: true });

  } catch (error) {
    logger.error('Stripe webhook handler error', error as Error, {
      eventType: event.type,
      eventId: event.id,
    });
    // Return 200 to prevent Stripe retries for non-retryable errors
    // Stripe will retry on 5xx but not 2xx
    return c.json({ received: true, error: 'Handler error logged' });
  }
});

/**
 * Handle successful payment - route to appropriate handler based on type
 */
async function handlePaymentSucceeded(
  stripe: Stripe,
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  const metadata = paymentIntent.metadata;

  // Check if this is a Juice purchase
  if (metadata.type === 'juice_purchase') {
    await handleJuicePurchaseSucceeded(stripe, paymentIntent);
    return;
  }

  // Otherwise, handle as direct project payment
  await handleDirectPaymentSucceeded(stripe, paymentIntent);
}

/**
 * Handle successful Juice purchase - credit after risk-based delay
 */
async function handleJuicePurchaseSucceeded(
  stripe: Stripe,
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  const metadata = paymentIntent.metadata;

  if (!metadata.userId || !metadata.juiceAmount) {
    logger.warn('Juice purchase missing required metadata', {
      paymentIntentId: paymentIntent.id,
    });
    return;
  }

  // Get risk score
  let riskScore = extractRiskScore(paymentIntent);
  let riskLevel: string | undefined;

  if (typeof paymentIntent.latest_charge === 'string') {
    try {
      const charge = await stripe.charges.retrieve(paymentIntent.latest_charge);
      riskScore = charge.outcome?.risk_score ?? 50;
      riskLevel = charge.outcome?.risk_level;
    } catch {
      logger.warn('Failed to fetch charge for risk score', {
        chargeId: paymentIntent.latest_charge,
      });
    }
  } else if (paymentIntent.latest_charge) {
    riskLevel = paymentIntent.latest_charge.outcome?.risk_level;
  }

  const delayDays = calculateSettlementDelayDays(riskScore);
  const fiatAmount = paymentIntent.amount / 100;

  logger.info('Processing Juice purchase', {
    paymentIntentId: paymentIntent.id,
    userId: metadata.userId,
    fiatAmount,
    riskScore,
    riskLevel,
    delayDays,
  });

  // Create the purchase record
  const purchaseId = await createJuicePurchase({
    userId: metadata.userId,
    stripePaymentIntentId: paymentIntent.id,
    stripeChargeId: typeof paymentIntent.latest_charge === 'string'
      ? paymentIntent.latest_charge
      : paymentIntent.latest_charge?.id,
    fiatAmount,
    riskScore,
    riskLevel,
    settlementDelayDays: delayDays,
  });

  // If low risk, credit immediately
  if (delayDays === 0) {
    logger.info('Low risk Juice purchase - crediting immediately', {
      purchaseId,
      riskScore,
    });

    try {
      await creditJuice(metadata.userId, fiatAmount, purchaseId);
      logger.info('Immediate Juice credit successful', {
        purchaseId,
        amount: fiatAmount,
      });
    } catch (error) {
      // Credit failed but purchase is recorded - cron will retry
      logger.error('Immediate Juice credit failed, will retry via cron', error as Error, {
        purchaseId,
      });
    }
  }
}

/**
 * Handle successful direct project payment - create pending payment with risk-based delay
 */
async function handleDirectPaymentSucceeded(
  stripe: Stripe,
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  // Extract Juicebox payment metadata
  const paymentData = extractPaymentMetadata(paymentIntent);

  if (!paymentData) {
    logger.warn('Payment intent missing Juicebox metadata', {
      paymentIntentId: paymentIntent.id,
    });
    return;
  }

  // Expand charge to get risk score if not already expanded
  let riskScore = extractRiskScore(paymentIntent);

  if (typeof paymentIntent.latest_charge === 'string') {
    // Charge not expanded, fetch it
    try {
      const charge = await stripe.charges.retrieve(paymentIntent.latest_charge);
      riskScore = charge.outcome?.risk_score ?? 50;
    } catch {
      logger.warn('Failed to fetch charge for risk score', {
        chargeId: paymentIntent.latest_charge,
      });
    }
  }

  const delayDays = calculateSettlementDelayDays(riskScore);
  const amountCents = paymentIntent.amount;
  const amountUsd = amountCents / 100;

  logger.info('Processing payment with risk-based settlement', {
    paymentIntentId: paymentIntent.id,
    riskScore,
    delayDays,
    amountUsd,
    projectId: paymentData.projectId,
    chainId: paymentData.chainId,
  });

  // Create pending payment record
  const paymentId = await createPendingPayment({
    userId: paymentData.userId || null,
    stripePaymentIntentId: paymentIntent.id,
    stripeChargeId: typeof paymentIntent.latest_charge === 'string'
      ? paymentIntent.latest_charge
      : paymentIntent.latest_charge?.id,
    amountUsd,
    amountCents,
    projectId: paymentData.projectId,
    chainId: paymentData.chainId,
    memo: paymentData.memo,
    beneficiaryAddress: paymentData.beneficiaryAddress,
    riskScore,
    settlementDelayDays: delayDays,
  });

  // If low risk, settle immediately
  if (delayDays === 0) {
    logger.info('Low risk payment - settling immediately', {
      paymentId,
      riskScore,
    });

    try {
      const result = await settlePayment(paymentId);
      logger.info('Immediate settlement successful', {
        paymentId,
        txHash: result.txHash,
      });
    } catch (error) {
      // Settlement failed but payment is recorded - cron will retry
      logger.error('Immediate settlement failed, will retry via cron', error as Error, {
        paymentId,
      });
    }
  }
}

/**
 * Handle chargeback/dispute - prevent settlement for both direct payments and Juice purchases
 */
async function handleDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
  const paymentIntentId = dispute.payment_intent;

  if (typeof paymentIntentId !== 'string') {
    logger.warn('Dispute missing payment_intent', { disputeId: dispute.id });
    return;
  }

  // Try to mark as disputed in both systems
  // (only one will match based on where the payment was recorded)
  const directSuccess = await markPaymentDisputed(
    paymentIntentId,
    dispute.id,
    dispute.reason ?? undefined
  );

  const juiceSuccess = await markJuicePurchaseDisputed(paymentIntentId);

  if (directSuccess) {
    logger.warn('Direct payment marked as disputed', {
      paymentIntentId,
      disputeId: dispute.id,
      reason: dispute.reason,
    });
  }

  if (juiceSuccess) {
    logger.warn('Juice purchase marked as disputed', {
      paymentIntentId,
      disputeId: dispute.id,
      reason: dispute.reason,
    });
  }
}

/**
 * Handle refund - prevent settlement for both direct payments and Juice purchases
 */
async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const paymentIntentId = charge.payment_intent;

  if (typeof paymentIntentId !== 'string') {
    logger.warn('Refunded charge missing payment_intent', { chargeId: charge.id });
    return;
  }

  // Only handle full refunds
  if (charge.amount_refunded >= charge.amount) {
    // Try to mark as refunded in both systems
    const directSuccess = await markPaymentRefunded(paymentIntentId);
    const juiceSuccess = await markJuicePurchaseRefunded(paymentIntentId);

    if (directSuccess) {
      logger.info('Direct payment marked as refunded', {
        paymentIntentId,
        chargeId: charge.id,
      });
    }

    if (juiceSuccess) {
      logger.info('Juice purchase marked as refunded', {
        paymentIntentId,
        chargeId: charge.id,
      });
    }
  }
}
