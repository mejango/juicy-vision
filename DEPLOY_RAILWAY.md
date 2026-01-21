# Juicy Vision - Railway Deployment Guide

This guide covers deploying Juicy Vision to Railway with the juicy.vision domain on Namecheap.

## Architecture

- **Frontend**: Static site built with Vite, served via Railway static hosting
- **Backend**: Deno server running on Railway
- **Database**: PostgreSQL on Railway
- **Domain**: juicy.vision managed on Namecheap

## Prerequisites

1. [Railway account](https://railway.app) (GitHub login recommended)
2. [Namecheap account](https://namecheap.com) with juicy.vision domain
3. Required API keys:
   - Anthropic API key (for Claude AI)
   - WalletConnect Project ID (optional, for wallet connections)
   - Bendystraw API key (optional, for enhanced Juicebox data)
   - TheGraph API key (optional, for Uniswap data)

## Step 1: Create Railway Project

1. Go to [Railway Dashboard](https://railway.app/dashboard)
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Connect and select this repository

## Step 2: Set Up PostgreSQL Database

1. In your Railway project, click "New Service"
2. Select "Database" → "PostgreSQL"
3. Railway will create the database automatically
4. Copy the `DATABASE_URL` from the PostgreSQL service's variables

## Step 3: Deploy Backend

1. Click "New Service" → "GitHub Repo"
2. Select this repo and set root directory to `/backend`
3. Add environment variables:

```env
# Required
PORT=3001
DENO_ENV=production
DATABASE_URL=<from-postgres-service>
JWT_SECRET=<generate-secure-random-32-char-string>
ANTHROPIC_API_KEY=sk-ant-...

# Authentication
SESSION_DURATION_MS=604800000

# Security
CRON_SECRET=<generate-secure-random-string>

# Reserves wallet (for on-chain transactions)
RESERVES_PRIVATE_KEY=0x...

# Optional external APIs
BENDYSTRAW_API_KEY=
THEGRAPH_API_KEY=
ANKR_API_KEY=

# Optional Stripe (for fiat payments)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

4. Set the start command: `deno run --allow-net --allow-env --allow-read main.ts`
5. Deploy and note the generated URL (e.g., `juicy-vision-backend-production.up.railway.app`)

## Step 4: Deploy Frontend

1. Click "New Service" → "GitHub Repo"
2. Select this repo (root directory `/`)
3. Add environment variables:

```env
VITE_API_URL=https://api.juicy.vision
VITE_WALLETCONNECT_PROJECT_ID=<your-walletconnect-project-id>
VITE_THEGRAPH_API_KEY=<optional>
```

4. Railway will detect Vite and build automatically
5. Note the generated URL

## Step 5: Configure Custom Domains

### Backend Domain (api.juicy.vision)

1. In Railway backend service, go to Settings → Domains
2. Add custom domain: `api.juicy.vision`
3. Railway will provide a CNAME target

### Frontend Domain (juicy.vision)

1. In Railway frontend service, go to Settings → Domains
2. Add custom domains:
   - `juicy.vision`
   - `www.juicy.vision`
3. Railway will provide CNAME targets

## Step 6: Configure Namecheap DNS

1. Log in to Namecheap Dashboard
2. Go to Domain List → juicy.vision → Manage
3. Click "Advanced DNS"
4. Add the following records:

| Type  | Host | Value                           | TTL  |
|-------|------|---------------------------------|------|
| CNAME | @    | <railway-frontend-target>       | Auto |
| CNAME | www  | <railway-frontend-target>       | Auto |
| CNAME | api  | <railway-backend-target>        | Auto |

Note: For root domain (@), you may need to use Namecheap's URL redirect or ALIAS record if CNAME doesn't work.

Alternative using A record (if CNAME doesn't work for root):
1. Use Railway's IP address for A record on @
2. Or use Cloudflare as DNS proxy (recommended for better performance)

## Step 7: SSL/HTTPS

Railway automatically provisions SSL certificates for custom domains. Wait a few minutes after DNS propagation for HTTPS to activate.

## Step 8: Database Migrations

Connect to your Railway PostgreSQL and run migrations:

```bash
# Using Railway CLI
railway run --service=backend deno task migrate

# Or connect directly to the database
railway connect postgres
```

## Step 9: Verify Deployment

1. Check backend health: `curl https://api.juicy.vision/health`
2. Open frontend: `https://juicy.vision`
3. Test a chat interaction

## Environment Variable Reference

### Backend (Required)
| Variable | Description |
|----------|-------------|
| `PORT` | Server port (Railway sets this automatically) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for JWT token signing |
| `ANTHROPIC_API_KEY` | Claude AI API key |
| `RESERVES_PRIVATE_KEY` | Private key for on-chain transactions |

### Backend (Optional)
| Variable | Description |
|----------|-------------|
| `BENDYSTRAW_API_KEY` | Enhanced Juicebox data API |
| `THEGRAPH_API_KEY` | Subgraph queries for Uniswap |
| `STRIPE_SECRET_KEY` | Fiat payment processing |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification |

### Frontend
| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend API URL (e.g., https://api.juicy.vision) |
| `VITE_WALLETCONNECT_PROJECT_ID` | WalletConnect v2 project ID |

## Monitoring

Railway provides built-in monitoring:
- Logs: Railway Dashboard → Service → Logs
- Metrics: Railway Dashboard → Service → Metrics
- Alerts: Set up in Railway settings

## Troubleshooting

### Database Connection Issues
- Verify `DATABASE_URL` is correct
- Check PostgreSQL service is running
- Ensure network is configured properly in Railway

### CORS Errors
- Backend is configured to allow the frontend domain
- Check `VITE_API_URL` matches the actual backend URL

### SSL Certificate Not Working
- Wait 5-10 minutes for DNS propagation
- Verify DNS records are correctly configured
- Check Railway domain settings

## Cost Estimate

Railway's pricing (as of 2024):
- **Hobby plan**: $5/month (includes $5 credit)
  - Good for low-traffic sites
- **Pro plan**: Usage-based ($0.000463/vCPU minute, $0.000231/GB RAM minute)
  - Better for production with variable traffic

Typical monthly cost for a small deployment: $5-20/month
