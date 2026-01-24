# Development Guide

## Quick Start

```bash
# 1. Start PostgreSQL database
docker run -d --name juicyvision-db \
  -e POSTGRES_USER=juicy \
  -e POSTGRES_PASSWORD=juicy123 \
  -e POSTGRES_DB=juicyvision \
  -p 5432:5432 \
  postgres:16-alpine

# 2. Start backend (in backend/ directory)
cd backend && deno task dev

# 3. Start frontend (in project root)
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

Backend configuration is in `backend/.env`:

```env
DATABASE_URL=postgresql://juicy:juicy123@localhost:5432/juicyvision
ANTHROPIC_API_KEY=your-key-here
```

## Production Safety

The database reset endpoint (`/api/debug/reset-db`) is protected:

1. The entire `/api/debug/*` route group returns 403 when `DENO_ENV !== 'development'`
2. The reset endpoint has an additional explicit check
3. Production deployments set `DENO_ENV=production`

**Never set `DENO_ENV=development` in production.**
