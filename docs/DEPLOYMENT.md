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
- Database replication lag (if replica configured)
- Database disk usage and growth rate
- Claude API token usage
- Error rate by endpoint

### Alerts
Set up alerts for:
- Error rate > 1%
- Response time p95 > 2s
- WebSocket disconnection spikes
- Database connection exhaustion (pool at 80%+)
- Database replication lag > 10s
- Database disk usage > 80%
- Claude API rate limit warnings

## Scaling

### Horizontal Scaling
- Backend: Railway auto-scales based on CPU/memory
- Database: Vertical scaling (upgrade instance) or read replicas
  - **TODO**: Configure read replica for failover (see Database Resilience section)

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
- [ ] `ENCRYPTION_MASTER_KEY` differs from `JWT_SECRET`
- [ ] `RESERVES_PRIVATE_KEY` hot wallet has limited balance

## Deployment Guides

- [Railway Deployment](../DEPLOY_RAILWAY.md) - Step-by-step Railway setup
- [Local Development](../README.md) - Local dev environment

## Database Resilience

### Resilience Checklist

- [ ] **Backup verification**: Confirm PITR (point-in-time recovery) is enabled on PostgreSQL instance
- [ ] **Read replica**: Set up at least one read replica for failover and read scaling
- [ ] **WAL archiving**: Enable WAL archiving for platform-independent recovery
- [ ] **Disaster recovery drill**: Test restore process quarterly (document last test date)
- [ ] **Connection pooling**: Verify pool size (currently 10) is appropriate for load
- [ ] **Backup retention**: Confirm backup retention period meets compliance needs

### Redundancy Status

| Component | Current State | Target State |
|-----------|---------------|--------------|
| Primary DB | Single instance (Railway/GCP) | Same |
| Read Replica | ❌ Not configured | ✅ At least 1 replica |
| Multi-region | ❌ Single region | ⚠️ Consider for critical data |
| PITR | ⚠️ Platform-dependent | ✅ Verified enabled |
| WAL Archive | ❌ Not configured | ✅ External storage |

### Event Sourcing Candidates

These domains have audit trails but could benefit from full event sourcing if needed:

| Domain | Current Approach | Event Sourcing Value |
|--------|------------------|----------------------|
| Juice transactions | Separate tables per action | High - financial audit trail |
| Smart account exports | JSON status per chain | Medium - multi-chain coordination |
| Identity changes | History table | Low - already sufficient |

## Disaster Recovery

### Database Backups
- Railway: Automatic daily backups (Pro plan)
- GCP: Point-in-time recovery enabled
- **Verify**: Run `SELECT pg_is_in_recovery();` to confirm replica status

### Recovery Procedure
1. Scale down backend services
2. Restore database from backup
3. Run integrity checks:
   ```sql
   -- Verify critical table counts
   SELECT 'users' as tbl, count(*) FROM users
   UNION SELECT 'juice_balances', count(*) FROM juice_balances
   UNION SELECT 'user_smart_accounts', count(*) FROM user_smart_accounts;
   ```
4. Verify foreign key constraints: `SELECT conname FROM pg_constraint WHERE contype = 'f';`
5. Scale up backend services
6. Clear CDN cache if needed
7. **Document** the incident and recovery in runbook

### Recovery Time Objectives

| Scenario | RTO Target | RPO Target |
|----------|------------|------------|
| Database corruption | < 1 hour | < 5 minutes (with PITR) |
| Region outage | < 4 hours | < 1 hour |
| Full restore from backup | < 2 hours | Last daily backup |

### Rollback Procedure
1. Identify last known good deployment
2. Railway: Revert to previous deployment in dashboard
3. GCP: Redeploy previous container image
4. Verify functionality
5. Investigate root cause
