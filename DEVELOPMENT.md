# Development Guide

## Prerequisites

### Deno (for backend)

The backend runs on [Deno](https://deno.com/), a secure TypeScript runtime. Install it:

```bash
# macOS/Linux
curl -fsSL https://deno.land/install.sh | sh

# or via Homebrew (macOS)
brew install deno

# Windows (PowerShell)
irm https://deno.land/install.ps1 | iex
```

Verify installation:
```bash
deno --version
# deno 2.x.x
```

### Node.js (for frontend)

Node.js 18+ is required for the frontend:
```bash
# Check version
node --version
# v18.x.x or higher
```

## Quick Start

```bash
# 1. Start PostgreSQL database
docker run -d --name juicyvision-db \
  -e POSTGRES_USER=juicy \
  -e POSTGRES_PASSWORD=juicy123 \
  -e POSTGRES_DB=juicyvision \
  -p 5432:5432 \
  postgres:16-alpine

# 2. Configure backend environment
cp backend/.env.example backend/.env
# Edit backend/.env with your API keys

# 3. Start backend (in backend/ directory)
cd backend && deno task dev

# 4. Start frontend (in project root)
npm run dev
```

**Services:**
- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- Debug Dashboard: http://localhost:3001/api/debug

## Restarting Services

### Restart Database (Fresh)

```bash
# Stop and remove existing container, then start fresh
docker stop juicyvision-db && docker rm juicyvision-db

docker run -d --name juicyvision-db \
  -e POSTGRES_USER=juicy \
  -e POSTGRES_PASSWORD=juicy123 \
  -e POSTGRES_DB=juicyvision \
  -p 5432:5432 \
  postgres:16-alpine
```

The backend will automatically run migrations when it starts.

### Restart Backend

```bash
# Kill existing process and restart
lsof -ti:3001 | xargs kill -9 2>/dev/null
cd backend && deno task dev
```

### Restart Frontend

```bash
# Kill existing process and restart
lsof -ti:3000 | xargs kill -9 2>/dev/null
npm run dev
```

## Resetting the Database

### Option 1: API Endpoint (Keeps schema, clears data)

```bash
# Development only - clears all data but keeps tables
curl -X POST http://localhost:3001/api/debug/reset-db
```

This truncates all tables while preserving the schema. The endpoint is **blocked in production**.

### Option 2: Full Reset (Recreate container)

```bash
# Destroys everything and starts fresh
docker stop juicyvision-db && docker rm juicyvision-db

docker run -d --name juicyvision-db \
  -e POSTGRES_USER=juicy \
  -e POSTGRES_PASSWORD=juicy123 \
  -e POSTGRES_DB=juicyvision \
  -p 5432:5432 \
  postgres:16-alpine

# Restart backend to run migrations
lsof -ti:3001 | xargs kill -9 2>/dev/null
cd backend && deno task dev
```

## Environment Variables

Backend configuration is in `backend/.env`. Create it from the example and fill in your values.

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://juicy:juicy123@localhost:5432/juicyvision` |
| `ANTHROPIC_API_KEY` | Claude API key for AI features | `sk-ant-api03-...` |

### Optional Variables

#### Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Backend server port |
| `DENO_ENV` | `development` | Environment (`development` or `production`) |
| `TESTNET_MODE` | `false` | Use testnet chains instead of mainnet |

#### Authentication & Security

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | `dev-secret-*` | Secret for signing JWT tokens. **Must change in production** |
| `SESSION_DURATION_MS` | `604800000` (7 days) | JWT session expiry in milliseconds |
| `ENCRYPTION_MASTER_KEY` | `dev-encryption-*` | Key for encrypting keypairs. **Must differ from JWT_SECRET** |
| `CRON_SECRET` | `dev-cron-secret` | Secret for authenticating cron job requests |

#### AI Provider

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_PROVIDER` | `anthropic` | AI provider (`anthropic` or `moonshot`) |
| `MOONSHOT_API_KEY` | - | Kimi/Moonshot API key (if using moonshot provider) |
| `MOONSHOT_MODEL` | `moonshot-v1-32k` | Moonshot model to use |

#### Blockchain & External APIs

| Variable | Default | Description |
|----------|---------|-------------|
| `RESERVES_PRIVATE_KEY` | - | Private key for reserves wallet (hex with 0x prefix) |
| `BENDYSTRAW_API_KEY` | - | API key for Bendystraw GraphQL proxy |
| `THEGRAPH_API_KEY` | - | The Graph API key for subgraph queries |
| `ANKR_API_KEY` | - | Ankr API key for RPC endpoints |

#### IPFS (Pinata)

| Variable | Default | Description |
|----------|---------|-------------|
| `IPFS_API_URL` | `https://api.pinata.cloud` | Pinata API URL |
| `IPFS_API_KEY` | - | Pinata API key |
| `IPFS_API_SECRET` | - | Pinata API secret |

#### Stripe Payments

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe secret API key |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |

#### Passkey/WebAuthn

| Variable | Description |
|----------|-------------|
| `PASSKEY_RP_ID` | Relying party ID (usually your domain) |
| `PASSKEY_ORIGIN` | Expected origin for WebAuthn (e.g., `https://yourdomain.com`) |

#### Development Features

| Variable | Default | Description |
|----------|---------|-------------|
| `FORGE_DOCKER_ENABLED` | `false` | Enable Foundry Docker for hook compilation |
| `SEMGREP_ENABLED` | `false` | Enable Semgrep security scanning |

### Minimal Development Setup

For basic local development, only these are required:

```env
DATABASE_URL=postgresql://juicy:juicy123@localhost:5432/juicyvision
ANTHROPIC_API_KEY=your-key-here
```

All other variables have sensible defaults for development. **Never use the dev defaults in production.**

## Production Safety

The database reset endpoint (`/api/debug/reset-db`) is protected:

1. The entire `/api/debug/*` route group returns 403 when `DENO_ENV !== 'development'`
2. The reset endpoint has an additional explicit check
3. Production deployments set `DENO_ENV=production`

**Never set `DENO_ENV=development` in production.**
