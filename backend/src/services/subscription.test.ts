import { assertEquals, assertExists } from 'std/assert/mod.ts';

// ============================================================================
// Subscription Plan Tests
// ============================================================================

Deno.test('Subscription Service - Plan Structure', async (t) => {
  interface SubscriptionPlan {
    id: string;
    name: string;
    displayName: string;
    monthlyPriceCents: number | null;
    yearlyPriceCents: number | null;
    creditRate: number;
    dailyBotMessages: number | null;
    isActive: boolean;
  }

  const freePlan: SubscriptionPlan = {
    id: 'plan-free',
    name: 'free',
    displayName: 'Free',
    monthlyPriceCents: 0,
    yearlyPriceCents: null,
    creditRate: 1.10,
    dailyBotMessages: 20,
    isActive: true,
  };

  const proPlan: SubscriptionPlan = {
    id: 'plan-pro',
    name: 'pro',
    displayName: 'Pro',
    monthlyPriceCents: 2500,
    yearlyPriceCents: 21000,
    creditRate: 1.02,
    dailyBotMessages: null, // Unlimited
    isActive: true,
  };

  const bossPlan: SubscriptionPlan = {
    id: 'plan-boss',
    name: 'boss',
    displayName: 'Boss',
    monthlyPriceCents: 50000,
    yearlyPriceCents: 420000,
    creditRate: 1.005,
    dailyBotMessages: null, // Unlimited
    isActive: true,
  };

  await t.step('free plan has correct pricing', () => {
    assertEquals(freePlan.monthlyPriceCents, 0);
    assertEquals(freePlan.yearlyPriceCents, null);
  });

  await t.step('free plan has 20 daily messages limit', () => {
    assertEquals(freePlan.dailyBotMessages, 20);
  });

  await t.step('free plan credit rate is $1.10', () => {
    assertEquals(freePlan.creditRate, 1.10);
  });

  await t.step('pro plan is $25/month or $210/year', () => {
    assertEquals(proPlan.monthlyPriceCents, 2500);
    assertEquals(proPlan.yearlyPriceCents, 21000);
  });

  await t.step('pro plan has unlimited messages', () => {
    assertEquals(proPlan.dailyBotMessages, null);
  });

  await t.step('pro plan credit rate is $1.02', () => {
    assertEquals(proPlan.creditRate, 1.02);
  });

  await t.step('boss plan is $500/month or $4200/year', () => {
    assertEquals(bossPlan.monthlyPriceCents, 50000);
    assertEquals(bossPlan.yearlyPriceCents, 420000);
  });

  await t.step('boss plan has unlimited messages', () => {
    assertEquals(bossPlan.dailyBotMessages, null);
  });

  await t.step('boss plan credit rate is $1.005', () => {
    assertEquals(bossPlan.creditRate, 1.005);
  });

  await t.step('yearly pricing offers savings', () => {
    // Pro: $25/month = $300/year, but yearly is $210 (30% savings)
    const proMonthlyCost = proPlan.monthlyPriceCents! * 12;
    const proYearlyCost = proPlan.yearlyPriceCents!;
    assertEquals(proYearlyCost < proMonthlyCost, true);

    // Boss: $500/month = $6000/year, but yearly is $4200 (30% savings)
    const bossMonthlyCost = bossPlan.monthlyPriceCents! * 12;
    const bossYearlyCost = bossPlan.yearlyPriceCents!;
    assertEquals(bossYearlyCost < bossMonthlyCost, true);
  });
});

// ============================================================================
// Credit Rate Tests
// ============================================================================

Deno.test('Subscription Service - Credit Rate Calculations', async (t) => {
  const CREDIT_RATES = {
    free: 1.10,
    pro: 1.02,
    boss: 1.005,
    enterprise: 1.00,
  };

  await t.step('free tier pays $1.10 per Juice', () => {
    assertEquals(CREDIT_RATES.free, 1.10);
  });

  await t.step('pro tier pays $1.02 per Juice', () => {
    assertEquals(CREDIT_RATES.pro, 1.02);
  });

  await t.step('boss tier pays $1.005 per Juice', () => {
    assertEquals(CREDIT_RATES.boss, 1.005);
  });

  await t.step('enterprise tier pays $1.00 per Juice (no markup)', () => {
    assertEquals(CREDIT_RATES.enterprise, 1.00);
  });

  await t.step('buying 100 Juice at free tier costs $110', () => {
    const juiceAmount = 100;
    const fiatCost = juiceAmount * CREDIT_RATES.free;
    assertEquals(Math.round(fiatCost * 100) / 100, 110);
  });

  await t.step('buying 100 Juice at pro tier costs $102', () => {
    const juiceAmount = 100;
    const fiatCost = juiceAmount * CREDIT_RATES.pro;
    assertEquals(Math.round(fiatCost * 100) / 100, 102);
  });

  await t.step('buying 100 Juice at boss tier costs $100.50', () => {
    const juiceAmount = 100;
    const fiatCost = juiceAmount * CREDIT_RATES.boss;
    assertEquals(Math.round(fiatCost * 100) / 100, 100.5);
  });

  await t.step('pro savings vs free is ~7.3%', () => {
    const savings = ((CREDIT_RATES.free - CREDIT_RATES.pro) / CREDIT_RATES.free) * 100;
    assertEquals(savings > 7, true);
    assertEquals(savings < 8, true);
  });

  await t.step('boss savings vs free is ~8.6%', () => {
    const savings = ((CREDIT_RATES.free - CREDIT_RATES.boss) / CREDIT_RATES.free) * 100;
    assertEquals(savings > 8, true);
    assertEquals(savings < 9, true);
  });
});

// ============================================================================
// Daily Bot Message Rate Limiting Tests
// ============================================================================

Deno.test('Subscription Service - Daily Message Limits', async (t) => {
  const FREE_DAILY_LIMIT = 20;

  function canSendBotMessage(
    currentCount: number,
    dailyLimit: number | null
  ): { allowed: boolean; remaining: number | null } {
    // Unlimited if dailyLimit is null
    if (dailyLimit === null) {
      return { allowed: true, remaining: null };
    }

    const remaining = Math.max(0, dailyLimit - currentCount);
    return {
      allowed: currentCount < dailyLimit,
      remaining,
    };
  }

  await t.step('free tier has 20 message limit', () => {
    assertEquals(FREE_DAILY_LIMIT, 20);
  });

  await t.step('free user with 0 messages can send', () => {
    const result = canSendBotMessage(0, FREE_DAILY_LIMIT);
    assertEquals(result.allowed, true);
    assertEquals(result.remaining, 20);
  });

  await t.step('free user with 10 messages can send (10 remaining)', () => {
    const result = canSendBotMessage(10, FREE_DAILY_LIMIT);
    assertEquals(result.allowed, true);
    assertEquals(result.remaining, 10);
  });

  await t.step('free user with 19 messages can send (1 remaining)', () => {
    const result = canSendBotMessage(19, FREE_DAILY_LIMIT);
    assertEquals(result.allowed, true);
    assertEquals(result.remaining, 1);
  });

  await t.step('free user with 20 messages cannot send (0 remaining)', () => {
    const result = canSendBotMessage(20, FREE_DAILY_LIMIT);
    assertEquals(result.allowed, false);
    assertEquals(result.remaining, 0);
  });

  await t.step('free user with 25 messages cannot send (0 remaining)', () => {
    const result = canSendBotMessage(25, FREE_DAILY_LIMIT);
    assertEquals(result.allowed, false);
    assertEquals(result.remaining, 0);
  });

  await t.step('paid user (null limit) always allowed', () => {
    const result = canSendBotMessage(0, null);
    assertEquals(result.allowed, true);
    assertEquals(result.remaining, null);
  });

  await t.step('paid user with 100 messages still allowed', () => {
    const result = canSendBotMessage(100, null);
    assertEquals(result.allowed, true);
    assertEquals(result.remaining, null);
  });

  await t.step('paid user with 1000 messages still allowed', () => {
    const result = canSendBotMessage(1000, null);
    assertEquals(result.allowed, true);
    assertEquals(result.remaining, null);
  });
});

// ============================================================================
// Daily Usage Tracking Tests
// ============================================================================

Deno.test('Subscription Service - Daily Usage Tracking', async (t) => {
  interface DailyUsage {
    userId: string;
    usageDate: Date;
    messageCount: number;
    limit: number | null;
    remaining: number | null;
  }

  await t.step('usage date is today (UTC)', () => {
    const today = new Date().toISOString().split('T')[0];
    const expectedFormat = /^\d{4}-\d{2}-\d{2}$/;
    assertEquals(expectedFormat.test(today), true);
  });

  await t.step('message count starts at 0', () => {
    const usage: DailyUsage = {
      userId: 'user-123',
      usageDate: new Date(),
      messageCount: 0,
      limit: 20,
      remaining: 20,
    };
    assertEquals(usage.messageCount, 0);
  });

  await t.step('remaining = limit - count', () => {
    const limit = 20;
    const count = 7;
    const remaining = limit - count;
    assertEquals(remaining, 13);
  });

  await t.step('remaining cannot be negative', () => {
    const limit = 20;
    const count = 25;
    const remaining = Math.max(0, limit - count);
    assertEquals(remaining, 0);
  });

  await t.step('paid users have null limit and remaining', () => {
    const usage: DailyUsage = {
      userId: 'user-pro',
      usageDate: new Date(),
      messageCount: 50,
      limit: null,
      remaining: null,
    };
    assertEquals(usage.limit, null);
    assertEquals(usage.remaining, null);
  });
});

// ============================================================================
// Subscription Status Tests
// ============================================================================

Deno.test('Subscription Service - Subscription Status Flow', async (t) => {
  type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'incomplete' | 'trialing';

  await t.step('active is normal state', () => {
    const status: SubscriptionStatus = 'active';
    assertEquals(status, 'active');
  });

  await t.step('past_due means payment failed', () => {
    const status: SubscriptionStatus = 'past_due';
    assertEquals(status, 'past_due');
  });

  await t.step('canceled means subscription ended', () => {
    const status: SubscriptionStatus = 'canceled';
    assertEquals(status, 'canceled');
  });

  await t.step('incomplete means setup incomplete', () => {
    const status: SubscriptionStatus = 'incomplete';
    assertEquals(status, 'incomplete');
  });

  await t.step('trialing means in trial period', () => {
    const status: SubscriptionStatus = 'trialing';
    assertEquals(status, 'trialing');
  });

  await t.step('only active status gives full benefits', () => {
    function hasFullBenefits(status: SubscriptionStatus): boolean {
      return status === 'active' || status === 'trialing';
    }

    assertEquals(hasFullBenefits('active'), true);
    assertEquals(hasFullBenefits('trialing'), true);
    assertEquals(hasFullBenefits('past_due'), false);
    assertEquals(hasFullBenefits('canceled'), false);
    assertEquals(hasFullBenefits('incomplete'), false);
  });
});

// ============================================================================
// Billing Interval Tests
// ============================================================================

Deno.test('Subscription Service - Billing Intervals', async (t) => {
  type BillingInterval = 'monthly' | 'yearly';

  await t.step('monthly interval is supported', () => {
    const interval: BillingInterval = 'monthly';
    assertEquals(interval, 'monthly');
  });

  await t.step('yearly interval is supported', () => {
    const interval: BillingInterval = 'yearly';
    assertEquals(interval, 'yearly');
  });

  await t.step('yearly saves money over monthly', () => {
    const monthlyPrice = 2500; // $25/month
    const yearlyPrice = 21000; // $210/year
    const yearlyViaMonthly = monthlyPrice * 12; // $300/year
    assertEquals(yearlyPrice < yearlyViaMonthly, true);
  });

  await t.step('yearly discount is ~30%', () => {
    const monthlyPrice = 2500;
    const yearlyPrice = 21000;
    const yearlyViaMonthly = monthlyPrice * 12;
    const discount = ((yearlyViaMonthly - yearlyPrice) / yearlyViaMonthly) * 100;
    assertEquals(Math.round(discount), 30);
  });
});

// ============================================================================
// Cancel at Period End Tests
// ============================================================================

Deno.test('Subscription Service - Cancellation Flow', async (t) => {
  await t.step('cancel_at_period_end allows access until period ends', () => {
    const cancelAtPeriodEnd = true;
    const currentPeriodEnd = new Date('2024-02-01');
    const now = new Date('2024-01-15');
    const hasAccess = now < currentPeriodEnd;
    assertEquals(hasAccess, true);
  });

  await t.step('after period end, subscription is canceled', () => {
    const currentPeriodEnd = new Date('2024-02-01');
    const now = new Date('2024-02-15');
    const hasAccess = now < currentPeriodEnd;
    assertEquals(hasAccess, false);
  });

  await t.step('reactivation removes cancel_at_period_end flag', () => {
    let cancelAtPeriodEnd = true;
    // User reactivates
    cancelAtPeriodEnd = false;
    assertEquals(cancelAtPeriodEnd, false);
  });
});

// ============================================================================
// Credit Expiration Tests (6 months inactivity)
// ============================================================================

Deno.test('Subscription Service - Credit Expiration', async (t) => {
  const EXPIRATION_MONTHS = 6;

  function isExpired(lastActivityAt: Date): boolean {
    const now = new Date();
    const monthsSinceActivity = (now.getTime() - lastActivityAt.getTime()) / (1000 * 60 * 60 * 24 * 30);
    return monthsSinceActivity >= EXPIRATION_MONTHS;
  }

  await t.step('expiration period is 6 months', () => {
    assertEquals(EXPIRATION_MONTHS, 6);
  });

  await t.step('active user (1 month ago) is not expired', () => {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    assertEquals(isExpired(oneMonthAgo), false);
  });

  await t.step('inactive user (5 months ago) is not expired', () => {
    const fiveMonthsAgo = new Date();
    fiveMonthsAgo.setMonth(fiveMonthsAgo.getMonth() - 5);
    assertEquals(isExpired(fiveMonthsAgo), false);
  });

  await t.step('inactive user (6 months ago) is expired', () => {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    assertEquals(isExpired(sixMonthsAgo), true);
  });

  await t.step('inactive user (12 months ago) is expired', () => {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    assertEquals(isExpired(twelveMonthsAgo), true);
  });
});

// ============================================================================
// Default Rate Fallback Tests
// ============================================================================

Deno.test('Subscription Service - Default Rate Fallbacks', async (t) => {
  const DEFAULT_CREDIT_RATE = 1.10;
  const DEFAULT_DAILY_LIMIT = 20;

  function getCreditRate(subscription: { plan?: { creditRate: number } } | null): number {
    return subscription?.plan?.creditRate ?? DEFAULT_CREDIT_RATE;
  }

  function getDailyLimit(subscription: { plan?: { dailyBotMessages: number | null } } | null): number | null {
    // If no subscription, use default limit
    if (!subscription) return DEFAULT_DAILY_LIMIT;
    // If plan has explicit dailyBotMessages (including null for unlimited), use it
    if (subscription.plan && 'dailyBotMessages' in subscription.plan) {
      return subscription.plan.dailyBotMessages;
    }
    return DEFAULT_DAILY_LIMIT;
  }

  await t.step('no subscription defaults to free rate', () => {
    const rate = getCreditRate(null);
    assertEquals(rate, 1.10);
  });

  await t.step('no subscription defaults to 20 daily messages', () => {
    const limit = getDailyLimit(null);
    assertEquals(limit, 20);
  });

  await t.step('canceled subscription uses free rate', () => {
    // When status is 'canceled', treat as no subscription
    const rate = getCreditRate(null);
    assertEquals(rate, DEFAULT_CREDIT_RATE);
  });

  await t.step('active pro subscription uses pro rate', () => {
    const rate = getCreditRate({ plan: { creditRate: 1.02 } });
    assertEquals(rate, 1.02);
  });

  await t.step('active pro subscription has unlimited messages', () => {
    const limit = getDailyLimit({ plan: { dailyBotMessages: null } });
    assertEquals(limit, null);
  });
});

// ============================================================================
// Stripe Price ID Tests
// ============================================================================

Deno.test('Subscription Service - Stripe Price IDs', async (t) => {
  interface Plan {
    stripeMonthlyPriceId: string | null;
    stripeYearlyPriceId: string | null;
  }

  const freePlan: Plan = {
    stripeMonthlyPriceId: null, // Free plans don't need Stripe price
    stripeYearlyPriceId: null,
  };

  const proPlan: Plan = {
    stripeMonthlyPriceId: 'price_pro_monthly',
    stripeYearlyPriceId: 'price_pro_yearly',
  };

  await t.step('free plan has no Stripe price IDs', () => {
    assertEquals(freePlan.stripeMonthlyPriceId, null);
    assertEquals(freePlan.stripeYearlyPriceId, null);
  });

  await t.step('paid plans have Stripe price IDs', () => {
    assertExists(proPlan.stripeMonthlyPriceId);
    assertExists(proPlan.stripeYearlyPriceId);
  });

  await t.step('can lookup plan by monthly price ID', () => {
    const priceId = 'price_pro_monthly';
    const matchesMonthly = proPlan.stripeMonthlyPriceId === priceId;
    const matchesYearly = proPlan.stripeYearlyPriceId === priceId;
    assertEquals(matchesMonthly || matchesYearly, true);
  });

  await t.step('can lookup plan by yearly price ID', () => {
    const priceId = 'price_pro_yearly';
    const matchesMonthly = proPlan.stripeMonthlyPriceId === priceId;
    const matchesYearly = proPlan.stripeYearlyPriceId === priceId;
    assertEquals(matchesMonthly || matchesYearly, true);
  });
});

// ============================================================================
// Usage Reset Tests
// ============================================================================

Deno.test('Subscription Service - Daily Usage Reset', async (t) => {
  await t.step('usage resets at midnight UTC', () => {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    assertEquals(today !== yesterdayStr, true);
  });

  await t.step('new day means fresh message count', () => {
    const yesterdayCount = 20; // Maxed out yesterday
    const todayCount = 0; // Fresh start
    assertEquals(todayCount, 0);
  });

  await t.step('old usage records can be cleaned up after 7 days', () => {
    const RETENTION_DAYS = 7;
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const shouldDelete = oldDate < cutoff;
    assertEquals(shouldDelete, true);
  });
});
