/**
 * Subscription API Routes
 *
 * Endpoints for managing subscription tiers and billing.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import Stripe from 'npm:stripe';
import { requireAuth } from '../middleware/auth.ts';
import { getConfig, validateConfigForStripe } from '../utils/config.ts';
import {
  getPlans,
  getPlanByName,
  getUserSubscription,
  getDailyUsage,
  getCreditRate,
  getUserPlanName,
} from '../services/subscription.ts';
import { rateLimitByUser } from '../services/rateLimit.ts';
import { queryOne } from '../db/index.ts';

export const subscriptionRouter = new Hono();

// ============================================================================
// Public Endpoints
// ============================================================================

// GET /subscription/plans - List available subscription plans
subscriptionRouter.get('/plans', async (c) => {
  try {
    const plans = await getPlans();

    return c.json({
      success: true,
      data: plans.map(p => ({
        id: p.id,
        name: p.name,
        displayName: p.displayName,
        monthlyPrice: p.monthlyPriceCents ? p.monthlyPriceCents / 100 : null,
        yearlyPrice: p.yearlyPriceCents ? p.yearlyPriceCents / 100 : null,
        creditRate: p.creditRate,
        dailyBotMessages: p.dailyBotMessages, // null = unlimited
        features: getPlanFeatures(p.name),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get plans';
    return c.json({ success: false, error: message }, 500);
  }
});

// ============================================================================
// Authenticated Endpoints
// ============================================================================

// GET /subscription/current - Get user's current subscription and usage
subscriptionRouter.get('/current', requireAuth, async (c) => {
  const user = c.get('user');

  try {
    const subscription = await getUserSubscription(user.id);
    const dailyUsage = await getDailyUsage(user.id);
    const creditRate = await getCreditRate(user.id);

    // If no subscription, user is on free tier
    if (!subscription) {
      const freePlan = await getPlanByName('free');
      return c.json({
        success: true,
        data: {
          plan: {
            name: 'free',
            displayName: 'Free',
            creditRate: freePlan?.creditRate ?? 1.10,
            dailyBotMessages: freePlan?.dailyBotMessages ?? 20,
          },
          billing: null,
          usage: {
            messagesUsed: dailyUsage.messageCount,
            messagesLimit: dailyUsage.limit,
            messagesRemaining: dailyUsage.remaining,
          },
          creditRate,
        },
      });
    }

    return c.json({
      success: true,
      data: {
        plan: {
          name: subscription.plan?.name,
          displayName: subscription.plan?.displayName,
          creditRate: subscription.plan?.creditRate,
          dailyBotMessages: subscription.plan?.dailyBotMessages,
        },
        billing: {
          interval: subscription.billingInterval,
          status: subscription.status,
          currentPeriodStart: subscription.currentPeriodStart?.toISOString(),
          currentPeriodEnd: subscription.currentPeriodEnd?.toISOString(),
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        },
        usage: {
          messagesUsed: dailyUsage.messageCount,
          messagesLimit: dailyUsage.limit,
          messagesRemaining: dailyUsage.remaining,
        },
        creditRate,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get subscription';
    return c.json({ success: false, error: message }, 500);
  }
});

// POST /subscription/checkout - Create Stripe subscription checkout session
const CheckoutSchema = z.object({
  planName: z.enum(['pro', 'boss']),
  interval: z.enum(['monthly', 'yearly']),
});

subscriptionRouter.post(
  '/checkout',
  requireAuth,
  rateLimitByUser('subscriptionCheckout'),
  zValidator('json', CheckoutSchema),
  async (c) => {
    const user = c.get('user');
    const { planName, interval } = c.req.valid('json');
    const config = getConfig();

    try {
      validateConfigForStripe(config);
    } catch {
      return c.json({ success: false, error: 'Payments not configured' }, 503);
    }

    try {
      const plan = await getPlanByName(planName);
      if (!plan) {
        return c.json({ success: false, error: 'Invalid plan' }, 400);
      }

      // Check if user already has an active subscription
      const existingSubscription = await getUserSubscription(user.id);
      if (existingSubscription && existingSubscription.status === 'active') {
        return c.json({
          success: false,
          error: 'You already have an active subscription. Use the customer portal to manage it.',
        }, 400);
      }

      // Get the appropriate Stripe price ID
      const priceId = interval === 'monthly'
        ? plan.stripeMonthlyPriceId
        : plan.stripeYearlyPriceId;

      if (!priceId) {
        return c.json({
          success: false,
          error: `${interval} billing is not available for this plan`,
        }, 400);
      }

      const stripe = new Stripe(config.stripeSecretKey);

      // Get or create Stripe customer
      let customerId: string | undefined;
      if (existingSubscription?.stripeCustomerId) {
        customerId = existingSubscription.stripeCustomerId;
      } else {
        // Check if user has email
        const userData = await queryOne<{ email: string }>(
          `SELECT email FROM users WHERE id = $1`,
          [user.id]
        );

        if (userData?.email) {
          // Search for existing customer by email
          const customers = await stripe.customers.list({
            email: userData.email,
            limit: 1,
          });

          if (customers.data.length > 0) {
            customerId = customers.data[0].id;
          }
        }
      }

      // Create checkout session
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        ui_mode: 'embedded',
        customer: customerId,
        customer_email: customerId ? undefined : user.email,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        metadata: {
          type: 'subscription',
          userId: user.id,
          planName,
          interval,
        },
        subscription_data: {
          metadata: {
            userId: user.id,
            planName,
          },
        },
        return_url: `${c.req.header('origin') || 'https://juicy.vision'}/settings/subscription?session_id={CHECKOUT_SESSION_ID}`,
      });

      return c.json({
        success: true,
        data: {
          clientSecret: session.client_secret,
          sessionId: session.id,
        },
      });
    } catch (error) {
      console.error('Failed to create subscription checkout:', error);
      const message = error instanceof Error ? error.message : 'Checkout creation failed';
      return c.json({ success: false, error: message }, 400);
    }
  }
);

// POST /subscription/portal - Create Stripe Customer Portal session
subscriptionRouter.post('/portal', requireAuth, async (c) => {
  const user = c.get('user');
  const config = getConfig();

  try {
    validateConfigForStripe(config);
  } catch {
    return c.json({ success: false, error: 'Payments not configured' }, 503);
  }

  try {
    const subscription = await getUserSubscription(user.id);
    if (!subscription?.stripeCustomerId) {
      return c.json({
        success: false,
        error: 'No billing account found. Please subscribe first.',
      }, 400);
    }

    const stripe = new Stripe(config.stripeSecretKey);

    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${c.req.header('origin') || 'https://juicy.vision'}/settings/subscription`,
    });

    return c.json({
      success: true,
      data: {
        url: session.url,
      },
    });
  } catch (error) {
    console.error('Failed to create portal session:', error);
    const message = error instanceof Error ? error.message : 'Portal creation failed';
    return c.json({ success: false, error: message }, 400);
  }
});

// POST /subscription/cancel - Cancel subscription at period end
subscriptionRouter.post('/cancel', requireAuth, async (c) => {
  const user = c.get('user');
  const config = getConfig();

  try {
    validateConfigForStripe(config);
  } catch {
    return c.json({ success: false, error: 'Payments not configured' }, 503);
  }

  try {
    const subscription = await getUserSubscription(user.id);
    if (!subscription?.stripeSubscriptionId) {
      return c.json({ success: false, error: 'No active subscription found' }, 400);
    }

    const stripe = new Stripe(config.stripeSecretKey);

    // Cancel at period end (user keeps access until period ends)
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    return c.json({
      success: true,
      data: {
        message: 'Subscription will be canceled at the end of the current billing period',
        endsAt: subscription.currentPeriodEnd?.toISOString(),
      },
    });
  } catch (error) {
    console.error('Failed to cancel subscription:', error);
    const message = error instanceof Error ? error.message : 'Cancellation failed';
    return c.json({ success: false, error: message }, 400);
  }
});

// POST /subscription/reactivate - Reactivate a canceled subscription
subscriptionRouter.post('/reactivate', requireAuth, async (c) => {
  const user = c.get('user');
  const config = getConfig();

  try {
    validateConfigForStripe(config);
  } catch {
    return c.json({ success: false, error: 'Payments not configured' }, 503);
  }

  try {
    const subscription = await getUserSubscription(user.id);
    if (!subscription?.stripeSubscriptionId) {
      return c.json({ success: false, error: 'No subscription found' }, 400);
    }

    if (!subscription.cancelAtPeriodEnd) {
      return c.json({ success: false, error: 'Subscription is not set to cancel' }, 400);
    }

    const stripe = new Stripe(config.stripeSecretKey);

    // Remove cancellation
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    return c.json({
      success: true,
      data: {
        message: 'Subscription reactivated',
      },
    });
  } catch (error) {
    console.error('Failed to reactivate subscription:', error);
    const message = error instanceof Error ? error.message : 'Reactivation failed';
    return c.json({ success: false, error: message }, 400);
  }
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get feature list for a plan (for display purposes)
 */
function getPlanFeatures(planName: string): string[] {
  switch (planName) {
    case 'free':
      return [
        '20 AI messages per day',
        '$1.10 per Juice credit',
        'Basic support',
      ];
    case 'pro':
      return [
        'Unlimited AI messages',
        '$1.02 per Juice credit (7% savings)',
        'Priority support',
        'Advanced features',
      ];
    case 'boss':
      return [
        'Unlimited AI messages',
        '$1.005 per Juice credit (9% savings)',
        'Priority AI processing',
        'Dedicated support',
        'Early access to new features',
      ];
    case 'enterprise':
      return [
        'Unlimited AI messages',
        'Custom credit rate',
        'Custom integrations',
        'Dedicated account manager',
        'SLA guarantees',
      ];
    default:
      return [];
  }
}
