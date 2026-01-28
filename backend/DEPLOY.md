# Juicy Vision Backend - Deployment Checklist

## Staging Environment (Testnet)

For development with Sepolia testnets, create a separate staging deployment:

### 1. Create Staging Database

```bash
# Local development
./scripts/setup-staging-db.sh

# Or manually create on Railway/GCP
# Database name: juicyvision_staging
```

### 2. Railway Staging Deployment

Create a new Railway project for staging:

```bash
# In project root
railway init --name juicyvision-staging

# Link to new project
railway link

# Set environment variables
railway variables set DENO_ENV=production
railway variables set TESTNET_MODE=true
railway variables set DATABASE_URL=<staging-database-url>
railway variables set JWT_SECRET=<staging-jwt-secret>
railway variables set ANTHROPIC_API_KEY=<your-key>
# ... other required vars

# Deploy backend (uses railway.staging.json)
cd backend && railway up

# Deploy frontend (uses railway.staging.json build command)
cd .. && railway up
```

### 3. Staging Environment Variables

Key differences from production:
- `TESTNET_MODE=true` - Uses Sepolia chains
- `DATABASE_URL` - Points to staging database (NEVER production!)
- `STRIPE_*` - Use `sk_test_`/`pk_test_` keys (or leave empty to disable)

### 4. Frontend Staging Build

```bash
npm run build:staging  # Creates testnet build with VITE_TESTNET_MODE=true
```

The staging frontend will:
- Connect to Sepolia chains only
- Use staging Relayr (staging.api.relayr.network)
- Use testnet Bendystraw (testnet.bendystraw.xyz)
- Show "TESTNET" badge

---

## Production Prerequisites

> **CRITICAL**: Never mix staging and production databases or API keys!

- [ ] GCP Project created with billing enabled
- [ ] Cloud Run API enabled
- [ ] Cloud Scheduler API enabled
- [ ] Cloud SQL (PostgreSQL) instance created
- [ ] Stripe account with Radar enabled

## Environment Variables

Copy `.env.example` and configure all values:

```bash
# Required for all environments
DATABASE_URL=postgresql://...
JWT_SECRET=<generate-secure-random-string>
RESERVES_PRIVATE_KEY=0x...
ANTHROPIC_API_KEY=sk-ant-...

# Stripe (for fiat payments)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# GCP (for production)
GCP_PROJECT_ID=your-project
GCP_SERVICE_ACCOUNT=your-sa@your-project.iam.gserviceaccount.com
CRON_SECRET=<generate-secure-random-string>
```

## Database Migrations

Run all migrations before deploying:

```bash
deno task migrate
```

Current migrations:
- 001: Consolidated schema (all tables in single migration)
  - Users & auth (OTP codes, sessions, OAuth connections)
  - Passkey/WebAuthn credentials & challenges
  - Wallet sessions (SIWE authentication)
  - Smart accounts (ERC-4337) with roles, balances, withdrawals
  - Juice stored-value system (balances, purchases, spends, cash-outs)
  - Multi-person chat system with encryption support
  - Fiat payments with risk-based settlement
  - Context management (summaries, transaction state)

## Testing

The project has comprehensive test coverage across unit and integration tests:

```bash
# Run all tests
deno task test

# Run only unit tests (fast, no DB required)
deno test --allow-all src/**/*.test.ts --ignore="**/*.integration.test.ts"

# Run only integration tests (requires database)
deno test --allow-all src/**/*.integration.test.ts
```

### Test Coverage

**Unit Tests:**
- Route handlers (auth, chat, juice, passkey, projects, invite)
- Services (claude AI, wallet, juice, smart accounts, summarization)
- Security tests

**Integration Tests (Database):**
- `auth.integration.test.ts` - Email OTP authentication (18 tests)
  - OTP generation, invalidation, verification
  - User creation, session management, privacy modes
- `passkey.integration.test.ts` - WebAuthn/Passkey authentication (17 tests)
  - Challenge management, credential CRUD
  - Counter tracking, IDOR protection, backup flags
- `siwe.integration.test.ts` - Sign-In With Ethereum (15 tests)
  - Wallet session storage, nonce validation
  - 30-day session expiry, anonymous migration
- `smartAccounts.integration.test.ts` - ERC-4337 accounts
  - Account creation, idempotency, role management
- `juice.integration.test.ts` - Stored value system
  - Balance operations, purchases, spends, cash-outs

Total: 315+ tests (some AI tests require `RUN_AI_TESTS=1`)

## Stripe Webhook Setup

### Required Events

Configure Stripe to send these events to `POST /api/stripe/webhook`:

1. `checkout.session.completed` - Triggers Juice credit purchase (Checkout Sessions API)
2. `payment_intent.succeeded` - Triggers direct payment creation (fallback)
3. `charge.dispute.created` - Blocks settlement on chargeback
4. `charge.refunded` - Blocks settlement on refund

### Stripe Dashboard Configuration

1. Go to Stripe Dashboard > Developers > Webhooks
2. Add endpoint: `https://YOUR_DOMAIN/api/stripe/webhook`
3. Select events:
   - `checkout.session.completed` (required for Juice purchases)
   - `payment_intent.succeeded`
   - `charge.dispute.created`
   - `charge.refunded`
4. Copy signing secret to `STRIPE_WEBHOOK_SECRET`

### Frontend Stripe Configuration

The frontend uses Stripe's Embedded Checkout for Juice credit purchases:

1. Ensure `STRIPE_PUBLISHABLE_KEY` is set in the backend environment
2. The `/api/juice/stripe-config` endpoint serves the publishable key to the frontend
3. Dynamic payment methods are enabled - Stripe automatically shows relevant methods

### Stripe Radar

Stripe Radar must be enabled for risk-based settlement to work:

1. Go to Stripe Dashboard > Radar > Settings
2. Enable Radar for Fraud Teams (or ensure basic Radar is active)
3. Risk scores will be included in payment intents automatically

### Risk-Based Settlement Tiers

| Risk Score | Settlement Delay | Chargeback Protection |
|------------|------------------|----------------------|
| 0-20       | Immediate        | Low risk - settle via webhook |
| 21-40      | 7 days           | Standard protection |
| 41-60      | 30 days          | Extended protection |
| 61-80      | 60 days          | High protection |
| 81-100     | 120 days         | Maximum protection |

## Cloud Run Deployment

```bash
# Build and push
gcloud builds submit --tag gcr.io/PROJECT_ID/juicy-vision-api

# Deploy
gcloud run deploy juicy-vision-api \
  --image gcr.io/PROJECT_ID/juicy-vision-api \
  --platform managed \
  --region us-east1 \
  --allow-unauthenticated \
  --set-env-vars "DENO_ENV=production,..." \
  --set-secrets "DATABASE_URL=database-url:latest,..."
```

## Cloud Scheduler Setup

See `cloud-scheduler.yaml` for cron job configuration.

```bash
# Create maintenance job (runs hourly)
gcloud scheduler jobs create http juicy-vision-maintenance \
  --location=us-east1 \
  --schedule="0 * * * *" \
  --uri="https://YOUR_CLOUD_RUN_URL/api/cron/maintenance" \
  --http-method=POST \
  --oidc-service-account-email=YOUR_SA@YOUR_PROJECT.iam.gserviceaccount.com \
  --oidc-token-audience=https://YOUR_CLOUD_RUN_URL
```

## Post-Deployment Verification

- [ ] Health check: `GET /health` returns `{"status":"ok"}`
- [ ] Stripe config: `GET /api/juice/stripe-config` returns publishable key
- [ ] Stripe webhook: Send test event from Stripe dashboard
- [ ] Test Juice purchase: Buy credits via embedded checkout and verify:
  - Checkout session completes successfully
  - Webhook receives `checkout.session.completed`
  - Low risk (0-20): Credits immediately
  - Higher risk: Creates clearing purchase with correct delay
- [ ] Test direct payment: Create small test payment and verify:
  - Low risk (0-20): Settles immediately
  - Higher risk: Creates pending payment with correct delay
- [ ] Cron job: Trigger manually and verify logs

## Monitoring

### Critical Alerts to Configure

1. **Disputed settled payments** - If a dispute arrives for an already-settled payment:
   - Log: `"Dispute received for already settled payment"`
   - This requires manual intervention (funds already sent on-chain)

2. **Settlement failures** - Monitor `retry_count` approaching `MAX_RETRIES` (5)

3. **Reserves wallet balance** - Ensure hot wallet has sufficient ETH for settlements

### Useful Queries

```sql
-- Pending settlements by delay tier (direct payments)
SELECT settlement_delay_days, COUNT(*), SUM(amount_usd)
FROM pending_fiat_payments
WHERE status = 'pending_settlement'
GROUP BY settlement_delay_days;

-- Failed settlements needing attention
SELECT * FROM pending_fiat_payments
WHERE retry_count >= 3 AND status = 'pending_settlement';

-- Disputed payments (audit trail)
SELECT p.*, d.dispute_reason
FROM pending_fiat_payments p
JOIN fiat_payment_disputes d ON d.pending_payment_id = p.id
WHERE p.status = 'disputed';

-- Juice purchases pending credit (clearing)
SELECT settlement_delay_days, COUNT(*), SUM(juice_amount)
FROM juice_purchases
WHERE status = 'clearing' AND clears_at > NOW()
GROUP BY settlement_delay_days;

-- Juice purchases ready to credit
SELECT * FROM juice_purchases
WHERE status = 'clearing' AND clears_at <= NOW();

-- Total Juice balances
SELECT SUM(balance) as total_balance,
       SUM(lifetime_purchased) as total_purchased,
       SUM(lifetime_spent) as total_spent
FROM juice_balances;

-- Pending Juice spends (awaiting on-chain execution)
SELECT chain_id, COUNT(*), SUM(juice_amount)
FROM juice_spends
WHERE status = 'pending'
GROUP BY chain_id;
```
