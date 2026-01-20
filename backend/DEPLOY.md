# Juicy Vision Backend - Deployment Checklist

## Prerequisites

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
- 001: Users and sessions
- 002: Chat history
- 003: Wallet infrastructure
- 004: Pending fiat payments
- 005: Risk-based settlement (adds `risk_score`, `settlement_delay_days`)

## Stripe Webhook Setup

### Required Events

Configure Stripe to send these events to `POST /api/stripe/webhook`:

1. `payment_intent.succeeded` - Triggers pending payment creation
2. `charge.dispute.created` - Blocks settlement on chargeback
3. `charge.refunded` - Blocks settlement on refund

### Stripe Dashboard Configuration

1. Go to Stripe Dashboard > Developers > Webhooks
2. Add endpoint: `https://YOUR_DOMAIN/api/stripe/webhook`
3. Select events:
   - `payment_intent.succeeded`
   - `charge.dispute.created`
   - `charge.refunded`
4. Copy signing secret to `STRIPE_WEBHOOK_SECRET`

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
- [ ] Stripe webhook: Send test event from Stripe dashboard
- [ ] Test payment: Create small test payment and verify:
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
-- Pending settlements by delay tier
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
```
