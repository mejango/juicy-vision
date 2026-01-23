# Deployment Architecture

This document describes the production deployment architecture for Juicy Vision.

## Overview

Juicy Vision uses a multi-service architecture deployed across several platforms:

```
┌─────────────────────────────────────────────────────────────────┐
│                         CDN / IPFS                              │
│                    (Static Frontend)                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Load Balancer                              │
│                   (Railway / GCP)                               │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│   API Server     │ │   WebSocket      │ │   Cron Jobs      │
│   (Hono/Deno)    │ │   Server         │ │   (Scheduled)    │
└──────────────────┘ └──────────────────┘ └──────────────────┘
              │               │               │
              └───────────────┼───────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PostgreSQL                                 │
│                   (Railway / GCP)                               │
└─────────────────────────────────────────────────────────────────┘
```

## Production Stack

### Frontend
- **Build**: Vite with React 18 and TypeScript
- **Hosting Options**:
  - **IPFS**: Decentralized hosting via Pinata gateway
  - **Railway**: Static site hosting with custom domain
  - **Cloudflare Pages**: Alternative CDN option
- **CDN**: Cloudflare for caching and performance

### Backend
- **Runtime**: Deno with Hono framework
- **Hosting**:
  - **Railway** (primary): Serverless containers
  - **GCP Cloud Run**: Alternative serverless option
- **Features**:
  - REST API endpoints
  - WebSocket connections for real-time chat
  - Claude AI streaming integration
  - Cron jobs for maintenance tasks

### Database
- **Engine**: PostgreSQL 16
- **Hosting**:
  - **Railway**: Managed PostgreSQL service
  - **Google Cloud SQL**: Production-grade managed database
- **Migrations**: Managed via Deno migrations

### External Services
| Service | Purpose |
|---------|---------|
| Anthropic API | Claude AI for chat |
| Pinata | IPFS pinning for archives |
| Stripe | Fiat payment processing |
| Relayr | Gas sponsorship |
| Bendystraw | Juicebox GraphQL API |
| WalletConnect | Wallet connections |

## Environment Configuration

### Backend Environment Variables

#### Required
```env
PORT=3001
DATABASE_URL=postgres://...
JWT_SECRET=<32-char-secure-random>
ANTHROPIC_API_KEY=sk-ant-...
RESERVES_PRIVATE_KEY=0x...
CRON_SECRET=<secure-random>
```

#### Optional
```env
# External APIs
BENDYSTRAW_API_KEY=
THEGRAPH_API_KEY=
ANKR_API_KEY=

# Payments
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Gas Sponsorship
RELAYR_API_KEY=

# Storage
PINATA_JWT=
```

### Frontend Environment Variables

```env
VITE_API_URL=https://api.juicy.vision
VITE_WALLETCONNECT_PROJECT_ID=
VITE_THEGRAPH_API_KEY=
```

## CI/CD Pipeline

### GitHub Actions Workflow

1. **On Pull Request**:
   - Run frontend tests (`npm test`)
   - Run E2E tests (`npm run test:e2e`)
   - Type checking (`npm run typecheck`)
   - Lint check (`npm run lint`)

2. **On Merge to Main**:
   - Build frontend (`npm run build`)
   - Deploy to IPFS via Pinata
   - Deploy backend to Railway/GCP
   - Run database migrations
   - Notify on success/failure

### Deployment Commands

```bash
# Frontend build
npm run build

# Analyze bundle
npm run build -- --analyze

# Backend deploy (Railway)
railway up --service backend

# Database migrations
railway run --service backend deno task migrate
```

## Monitoring

### Application Logs
- **Railway**: Built-in log streaming in dashboard
- **GCP**: Cloud Logging with structured JSON output

### Health Checks
- `GET /health` - Basic health check
- `GET /api/health` - Full API health with dependencies

### Metrics to Monitor
- Response time (p50, p95, p99)
- WebSocket connections count
- Database connection pool usage
- Claude API token usage
- Error rate by endpoint

### Alerts
Set up alerts for:
- Error rate > 1%
- Response time p95 > 2s
- WebSocket disconnection spikes
- Database connection exhaustion
- Claude API rate limit warnings

## Scaling

### Horizontal Scaling
- Backend: Railway auto-scales based on CPU/memory
- Database: Vertical scaling (upgrade instance) or read replicas

### Performance Optimizations
- Frontend code splitting by vendor
- WebSocket connection pooling
- Database connection pooling (20 connections default)
- Response caching for static data
- CDN caching for frontend assets

## Security Checklist

- [ ] All API keys stored in environment variables, not in code
- [ ] JWT secrets are securely generated (32+ chars)
- [ ] Database connections use SSL in production
- [ ] CORS configured to allow only production domains
- [ ] Rate limiting enabled on API endpoints
- [ ] WebSocket connections require authentication
- [ ] Cron endpoints require secret token
- [ ] Frontend bundle does not contain API keys

## Deployment Guides

- [Railway Deployment](../DEPLOY_RAILWAY.md) - Step-by-step Railway setup
- [Local Development](../README.md) - Local dev environment

## Disaster Recovery

### Database Backups
- Railway: Automatic daily backups (Pro plan)
- GCP: Point-in-time recovery enabled

### Recovery Procedure
1. Scale down backend services
2. Restore database from backup
3. Verify data integrity
4. Scale up backend services
5. Clear CDN cache if needed

### Rollback Procedure
1. Identify last known good deployment
2. Railway: Revert to previous deployment in dashboard
3. GCP: Redeploy previous container image
4. Verify functionality
5. Investigate root cause
