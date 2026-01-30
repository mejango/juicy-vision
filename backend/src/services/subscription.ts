/**
 * Subscription Service
 *
 * Handles subscription tiers, credit rate calculations, and bot message rate limiting.
 *
 * Tier Overview:
 * - Free: $0/mo, $1.10/credit, 20 AI messages/day
 * - Pro: $25/mo ($210/yr), $1.02/credit, unlimited AI
 * - Boss: $500/mo ($4,200/yr), $1.005/credit, unlimited + priority
 * - Enterprise: Custom pricing
 */

import { query, queryOne, execute, transaction } from '../db/index.ts';
import { logger } from '../utils/logger.ts';

// Default credit rate for users without a subscription (free tier)
const DEFAULT_CREDIT_RATE = 1.10;
const DEFAULT_DAILY_BOT_LIMIT = 20;

// ============================================================================
// Types
// ============================================================================

export interface SubscriptionPlan {
  id: string;
  name: string;
  displayName: string;
  monthlyPriceCents: number | null;
  yearlyPriceCents: number | null;
  creditRate: number;
  dailyBotMessages: number | null;
  stripeMonthlyPriceId: string | null;
  stripeYearlyPriceId: string | null;
  isActive: boolean;
  createdAt: Date;
}

export interface UserSubscription {
  id: string;
  userId: string;
  planId: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  billingInterval: 'monthly' | 'yearly' | null;
  status: 'active' | 'past_due' | 'canceled' | 'incomplete' | 'trialing';
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
  plan?: SubscriptionPlan;
}

export interface DailyUsage {
  userId: string;
  usageDate: Date;
  messageCount: number;
  limit: number | null;
  remaining: number | null;
}

// ============================================================================
// Plan Operations
// ============================================================================

/**
 * Get all active subscription plans
 */
export async function getPlans(): Promise<SubscriptionPlan[]> {
  const rows = await query<{
    id: string;
    name: string;
    display_name: string;
    monthly_price_cents: number | null;
    yearly_price_cents: number | null;
    credit_rate: string;
    daily_bot_messages: number | null;
    stripe_monthly_price_id: string | null;
    stripe_yearly_price_id: string | null;
    is_active: boolean;
    created_at: string;
  }>(
    `SELECT id, name, display_name, monthly_price_cents, yearly_price_cents,
            credit_rate, daily_bot_messages, stripe_monthly_price_id,
            stripe_yearly_price_id, is_active, created_at
     FROM subscription_plans
     WHERE is_active = TRUE
     ORDER BY monthly_price_cents ASC NULLS FIRST`
  );

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    displayName: r.display_name,
    monthlyPriceCents: r.monthly_price_cents,
    yearlyPriceCents: r.yearly_price_cents,
    creditRate: parseFloat(r.credit_rate),
    dailyBotMessages: r.daily_bot_messages,
    stripeMonthlyPriceId: r.stripe_monthly_price_id,
    stripeYearlyPriceId: r.stripe_yearly_price_id,
    isActive: r.is_active,
    createdAt: new Date(r.created_at),
  }));
}

/**
 * Get a specific plan by name
 */
export async function getPlanByName(name: string): Promise<SubscriptionPlan | null> {
  const row = await queryOne<{
    id: string;
    name: string;
    display_name: string;
    monthly_price_cents: number | null;
    yearly_price_cents: number | null;
    credit_rate: string;
    daily_bot_messages: number | null;
    stripe_monthly_price_id: string | null;
    stripe_yearly_price_id: string | null;
    is_active: boolean;
    created_at: string;
  }>(
    `SELECT id, name, display_name, monthly_price_cents, yearly_price_cents,
            credit_rate, daily_bot_messages, stripe_monthly_price_id,
            stripe_yearly_price_id, is_active, created_at
     FROM subscription_plans
     WHERE name = $1`,
    [name]
  );

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    monthlyPriceCents: row.monthly_price_cents,
    yearlyPriceCents: row.yearly_price_cents,
    creditRate: parseFloat(row.credit_rate),
    dailyBotMessages: row.daily_bot_messages,
    stripeMonthlyPriceId: row.stripe_monthly_price_id,
    stripeYearlyPriceId: row.stripe_yearly_price_id,
    isActive: row.is_active,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Get plan by Stripe price ID
 */
export async function getPlanByStripePriceId(priceId: string): Promise<SubscriptionPlan | null> {
  const row = await queryOne<{
    id: string;
    name: string;
    display_name: string;
    monthly_price_cents: number | null;
    yearly_price_cents: number | null;
    credit_rate: string;
    daily_bot_messages: number | null;
    stripe_monthly_price_id: string | null;
    stripe_yearly_price_id: string | null;
    is_active: boolean;
    created_at: string;
  }>(
    `SELECT id, name, display_name, monthly_price_cents, yearly_price_cents,
            credit_rate, daily_bot_messages, stripe_monthly_price_id,
            stripe_yearly_price_id, is_active, created_at
     FROM subscription_plans
     WHERE stripe_monthly_price_id = $1 OR stripe_yearly_price_id = $1`,
    [priceId]
  );

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    monthlyPriceCents: row.monthly_price_cents,
    yearlyPriceCents: row.yearly_price_cents,
    creditRate: parseFloat(row.credit_rate),
    dailyBotMessages: row.daily_bot_messages,
    stripeMonthlyPriceId: row.stripe_monthly_price_id,
    stripeYearlyPriceId: row.stripe_yearly_price_id,
    isActive: row.is_active,
    createdAt: new Date(row.created_at),
  };
}

// ============================================================================
// Subscription Operations
// ============================================================================

/**
 * Get user's current subscription with plan details
 */
export async function getUserSubscription(userId: string): Promise<UserSubscription | null> {
  const row = await queryOne<{
    id: string;
    user_id: string;
    plan_id: string;
    stripe_subscription_id: string | null;
    stripe_customer_id: string | null;
    billing_interval: string | null;
    status: string;
    current_period_start: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    created_at: string;
    updated_at: string;
    // Plan fields
    plan_name: string;
    display_name: string;
    monthly_price_cents: number | null;
    yearly_price_cents: number | null;
    credit_rate: string;
    daily_bot_messages: number | null;
    stripe_monthly_price_id: string | null;
    stripe_yearly_price_id: string | null;
  }>(
    `SELECT us.id, us.user_id, us.plan_id, us.stripe_subscription_id,
            us.stripe_customer_id, us.billing_interval, us.status,
            us.current_period_start, us.current_period_end,
            us.cancel_at_period_end, us.created_at, us.updated_at,
            sp.name as plan_name, sp.display_name, sp.monthly_price_cents,
            sp.yearly_price_cents, sp.credit_rate, sp.daily_bot_messages,
            sp.stripe_monthly_price_id, sp.stripe_yearly_price_id
     FROM user_subscriptions us
     JOIN subscription_plans sp ON us.plan_id = sp.id
     WHERE us.user_id = $1`,
    [userId]
  );

  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripeCustomerId: row.stripe_customer_id,
    billingInterval: row.billing_interval as 'monthly' | 'yearly' | null,
    status: row.status as UserSubscription['status'],
    currentPeriodStart: row.current_period_start ? new Date(row.current_period_start) : null,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end) : null,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    plan: {
      id: row.plan_id,
      name: row.plan_name,
      displayName: row.display_name,
      monthlyPriceCents: row.monthly_price_cents,
      yearlyPriceCents: row.yearly_price_cents,
      creditRate: parseFloat(row.credit_rate),
      dailyBotMessages: row.daily_bot_messages,
      stripeMonthlyPriceId: row.stripe_monthly_price_id,
      stripeYearlyPriceId: row.stripe_yearly_price_id,
      isActive: true,
      createdAt: new Date(row.created_at),
    },
  };
}

/**
 * Get user's subscription by Stripe subscription ID
 */
export async function getSubscriptionByStripeId(stripeSubscriptionId: string): Promise<UserSubscription | null> {
  const row = await queryOne<{
    id: string;
    user_id: string;
    plan_id: string;
    stripe_subscription_id: string | null;
    stripe_customer_id: string | null;
    billing_interval: string | null;
    status: string;
    current_period_start: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, user_id, plan_id, stripe_subscription_id, stripe_customer_id,
            billing_interval, status, current_period_start, current_period_end,
            cancel_at_period_end, created_at, updated_at
     FROM user_subscriptions
     WHERE stripe_subscription_id = $1`,
    [stripeSubscriptionId]
  );

  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripeCustomerId: row.stripe_customer_id,
    billingInterval: row.billing_interval as 'monthly' | 'yearly' | null,
    status: row.status as UserSubscription['status'],
    currentPeriodStart: row.current_period_start ? new Date(row.current_period_start) : null,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end) : null,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Get user's subscription by Stripe customer ID
 */
export async function getSubscriptionByStripeCustomerId(stripeCustomerId: string): Promise<UserSubscription | null> {
  const row = await queryOne<{
    id: string;
    user_id: string;
    plan_id: string;
    stripe_subscription_id: string | null;
    stripe_customer_id: string | null;
    billing_interval: string | null;
    status: string;
    current_period_start: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, user_id, plan_id, stripe_subscription_id, stripe_customer_id,
            billing_interval, status, current_period_start, current_period_end,
            cancel_at_period_end, created_at, updated_at
     FROM user_subscriptions
     WHERE stripe_customer_id = $1`,
    [stripeCustomerId]
  );

  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripeCustomerId: row.stripe_customer_id,
    billingInterval: row.billing_interval as 'monthly' | 'yearly' | null,
    status: row.status as UserSubscription['status'],
    currentPeriodStart: row.current_period_start ? new Date(row.current_period_start) : null,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end) : null,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Create or update a subscription from Stripe webhook
 */
export async function upsertSubscription(params: {
  userId: string;
  planId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  billingInterval: 'monthly' | 'yearly';
  status: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
}): Promise<string> {
  const [row] = await query<{ id: string }>(
    `INSERT INTO user_subscriptions (
      user_id, plan_id, stripe_subscription_id, stripe_customer_id,
      billing_interval, status, current_period_start, current_period_end,
      cancel_at_period_end
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (user_id) DO UPDATE SET
      plan_id = EXCLUDED.plan_id,
      stripe_subscription_id = EXCLUDED.stripe_subscription_id,
      stripe_customer_id = EXCLUDED.stripe_customer_id,
      billing_interval = EXCLUDED.billing_interval,
      status = EXCLUDED.status,
      current_period_start = EXCLUDED.current_period_start,
      current_period_end = EXCLUDED.current_period_end,
      cancel_at_period_end = EXCLUDED.cancel_at_period_end,
      updated_at = NOW()
    RETURNING id`,
    [
      params.userId,
      params.planId,
      params.stripeSubscriptionId,
      params.stripeCustomerId,
      params.billingInterval,
      params.status,
      params.currentPeriodStart || null,
      params.currentPeriodEnd || null,
      params.cancelAtPeriodEnd ?? false,
    ]
  );

  logger.info('Subscription upserted', {
    subscriptionId: row.id,
    userId: params.userId,
    planId: params.planId,
    status: params.status,
  });

  return row.id;
}

/**
 * Update subscription status
 */
export async function updateSubscriptionStatus(
  stripeSubscriptionId: string,
  status: string,
  cancelAtPeriodEnd?: boolean
): Promise<boolean> {
  const count = await execute(
    `UPDATE user_subscriptions SET
      status = $1,
      cancel_at_period_end = COALESCE($2, cancel_at_period_end),
      updated_at = NOW()
     WHERE stripe_subscription_id = $3`,
    [status, cancelAtPeriodEnd ?? null, stripeSubscriptionId]
  );

  return count > 0;
}

/**
 * Cancel subscription (set to canceled status)
 */
export async function cancelSubscription(stripeSubscriptionId: string): Promise<boolean> {
  const count = await execute(
    `UPDATE user_subscriptions SET
      status = 'canceled',
      updated_at = NOW()
     WHERE stripe_subscription_id = $1`,
    [stripeSubscriptionId]
  );

  if (count > 0) {
    logger.info('Subscription canceled', { stripeSubscriptionId });
  }

  return count > 0;
}

/**
 * Delete subscription record (for downgrades to free)
 */
export async function deleteSubscription(userId: string): Promise<boolean> {
  const count = await execute(
    `DELETE FROM user_subscriptions WHERE user_id = $1`,
    [userId]
  );

  return count > 0;
}

// ============================================================================
// Credit Rate Operations
// ============================================================================

/**
 * Get user's credit rate based on their subscription tier
 */
export async function getCreditRate(userId: string): Promise<number> {
  const subscription = await getUserSubscription(userId);

  // If no subscription or canceled, use free tier rate
  if (!subscription || subscription.status === 'canceled') {
    return DEFAULT_CREDIT_RATE;
  }

  // Return plan's credit rate
  return subscription.plan?.creditRate ?? DEFAULT_CREDIT_RATE;
}

/**
 * Get user's plan name (for display purposes)
 */
export async function getUserPlanName(userId: string): Promise<string> {
  const subscription = await getUserSubscription(userId);

  if (!subscription || subscription.status === 'canceled') {
    return 'free';
  }

  return subscription.plan?.name ?? 'free';
}

// ============================================================================
// Daily Bot Usage Operations
// ============================================================================

/**
 * Check if user can send a bot message (rate limit check)
 */
export async function canSendBotMessage(userId: string): Promise<{ allowed: boolean; remaining: number | null; limit: number | null }> {
  const subscription = await getUserSubscription(userId);
  const dailyLimit = subscription?.plan?.dailyBotMessages ?? DEFAULT_DAILY_BOT_LIMIT;

  // Unlimited messages for paid tiers (dailyBotMessages = NULL)
  if (dailyLimit === null) {
    return { allowed: true, remaining: null, limit: null };
  }

  // Check today's usage
  const today = new Date().toISOString().split('T')[0];
  const usage = await queryOne<{ message_count: number }>(
    `SELECT message_count FROM daily_bot_usage
     WHERE user_id = $1 AND usage_date = $2`,
    [userId, today]
  );

  const currentCount = usage?.message_count ?? 0;
  const remaining = Math.max(0, dailyLimit - currentCount);

  return {
    allowed: currentCount < dailyLimit,
    remaining,
    limit: dailyLimit,
  };
}

/**
 * Record a bot message (increment daily counter)
 */
export async function recordBotMessage(userId: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  await execute(
    `INSERT INTO daily_bot_usage (user_id, usage_date, message_count)
     VALUES ($1, $2, 1)
     ON CONFLICT (user_id, usage_date) DO UPDATE SET
       message_count = daily_bot_usage.message_count + 1`,
    [userId, today]
  );

  // Also update last_activity_at on juice_balances
  await execute(
    `UPDATE juice_balances SET last_activity_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
}

/**
 * Get daily usage stats for a user
 */
export async function getDailyUsage(userId: string): Promise<DailyUsage> {
  const subscription = await getUserSubscription(userId);
  const dailyLimit = subscription?.plan?.dailyBotMessages ?? DEFAULT_DAILY_BOT_LIMIT;

  const today = new Date().toISOString().split('T')[0];
  const usage = await queryOne<{ message_count: number }>(
    `SELECT message_count FROM daily_bot_usage
     WHERE user_id = $1 AND usage_date = $2`,
    [userId, today]
  );

  const currentCount = usage?.message_count ?? 0;

  return {
    userId,
    usageDate: new Date(today),
    messageCount: currentCount,
    limit: dailyLimit,
    remaining: dailyLimit !== null ? Math.max(0, dailyLimit - currentCount) : null,
  };
}

/**
 * Cleanup old daily usage records (for cron job)
 */
export async function cleanupOldDailyUsage(): Promise<number> {
  // Keep 7 days of history
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);

  const count = await execute(
    `DELETE FROM daily_bot_usage WHERE usage_date < $1`,
    [cutoff.toISOString().split('T')[0]]
  );

  if (count > 0) {
    logger.info('Cleaned up old daily usage records', { deleted: count });
  }

  return count;
}
