-- Migration: Subscription Tiers System
-- Adds tiered subscription plans with tier-based credit pricing

-- ============================================================================
-- Subscription Plans Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) NOT NULL UNIQUE,  -- 'free', 'pro', 'boss', 'enterprise'
  display_name VARCHAR(100) NOT NULL,
  monthly_price_cents INTEGER,  -- NULL for free tier
  yearly_price_cents INTEGER,   -- NULL for free/enterprise
  credit_rate DECIMAL(6, 4) NOT NULL,  -- 1.10, 1.02, 1.005, 1.00
  daily_bot_messages INTEGER,  -- NULL = unlimited
  stripe_monthly_price_id VARCHAR(100),
  stripe_yearly_price_id VARCHAR(100),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE subscription_plans IS 'Subscription tier definitions with pricing and limits';
COMMENT ON COLUMN subscription_plans.credit_rate IS 'USD cost per 1 Juice credit (e.g., 1.10 means $1.10 per credit)';
COMMENT ON COLUMN subscription_plans.daily_bot_messages IS 'Daily AI message limit (NULL = unlimited)';

-- ============================================================================
-- User Subscriptions Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES subscription_plans(id),
  stripe_subscription_id VARCHAR(100),
  stripe_customer_id VARCHAR(100),
  billing_interval VARCHAR(10),  -- 'monthly', 'yearly'
  status VARCHAR(30) DEFAULT 'active',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT user_subscriptions_billing_interval_check CHECK (
    billing_interval IS NULL OR billing_interval IN ('monthly', 'yearly')
  ),
  CONSTRAINT user_subscriptions_status_check CHECK (
    status IN ('active', 'past_due', 'canceled', 'incomplete', 'trialing')
  )
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_stripe_subscription_id ON user_subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_stripe_customer_id ON user_subscriptions(stripe_customer_id);

COMMENT ON TABLE user_subscriptions IS 'User subscription records linked to Stripe subscriptions';

-- ============================================================================
-- Daily Bot Usage Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS daily_bot_usage (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  message_count INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_bot_usage_date ON daily_bot_usage(usage_date);

COMMENT ON TABLE daily_bot_usage IS 'Daily AI message usage tracking for rate limiting';

-- ============================================================================
-- Modify Existing Tables
-- ============================================================================

-- Add last_activity_at to juice_balances for credit expiration tracking
ALTER TABLE juice_balances
ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW();

COMMENT ON COLUMN juice_balances.last_activity_at IS 'Last activity timestamp for 6-month credit expiration';

-- Add credit_rate to juice_purchases to track the rate at purchase time
ALTER TABLE juice_purchases
ADD COLUMN IF NOT EXISTS credit_rate DECIMAL(6, 4);

COMMENT ON COLUMN juice_purchases.credit_rate IS 'Credit rate applied at time of purchase (e.g., 1.10)';

-- ============================================================================
-- Seed Data - Subscription Plans
-- ============================================================================

INSERT INTO subscription_plans (name, display_name, monthly_price_cents, yearly_price_cents, credit_rate, daily_bot_messages) VALUES
  ('free', 'Free', 0, NULL, 1.10, 20),
  ('pro', 'Pro', 2500, 21000, 1.02, NULL),
  ('boss', 'Boss', 50000, 420000, 1.005, NULL),
  ('enterprise', 'Enterprise', NULL, NULL, 1.00, NULL)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  monthly_price_cents = EXCLUDED.monthly_price_cents,
  yearly_price_cents = EXCLUDED.yearly_price_cents,
  credit_rate = EXCLUDED.credit_rate,
  daily_bot_messages = EXCLUDED.daily_bot_messages;

-- ============================================================================
-- Trigger for updated_at
-- ============================================================================

CREATE OR REPLACE TRIGGER update_user_subscriptions_updated_at
  BEFORE UPDATE ON user_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
