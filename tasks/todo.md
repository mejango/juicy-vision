# Cost Management, Vibeengineering, and Security Hardening

## Completed Tasks

### Phase 1: Cost Management

- [x] **Dynamic Model Selection** (`claude.ts`)
  - Added `selectModel()` function that chooses between Haiku 3.5 ($1/1M) and Sonnet 4 ($15/1M)
  - Uses intent detection patterns: complex queries → Sonnet, simple queries → Haiku
  - Considers tool usage and token count in decision

- [x] **PostgreSQL Rate Limiting** (`claude.ts`, `rateLimit.ts`)
  - Removed in-memory rate limits from `claude.ts`
  - Now uses existing `rateLimit.ts` PostgreSQL implementation
  - Survives restarts, works across instances

- [x] **Token-Based Billing** (`aiBilling.ts`, `config.ts`, `types/index.ts`)
  - Added `AI_FREE_MODE` environment variable (default: `true` for beta)
  - Added `calculateTokenCost()` for per-model cost calculation
  - Updated `deductAiCost()` to use actual token counts

### Phase 2: Security Hardening

- [x] **Per-Tool Rate Limits** (`rateLimit.ts`)
  - Added limits for sensitive AI tools:
    - `pin_to_ipfs`: 10/hour
    - `execute_bridge_transaction`: 5/hour
    - `prepare_bridge_transaction`: 20/hour
    - `claim_bridge_transaction`: 20/hour
  - Added `checkToolRateLimit()` helper function

- [x] **GraphQL Query Sanitization** (`omnichain.ts`)
  - Added `sanitizeForGraphQL()` function
  - Removes quotes, backslashes, and control characters
  - Limits query length to 100 chars

- [x] **Structured Error Types** (`errors/AppError.ts`)
  - Created `AppError` base class with code, message, statusCode
  - Added specialized errors: `RateLimitError`, `AuthError`, `ForbiddenError`, `NotFoundError`, `ValidationError`, `ConflictError`, `ExternalServiceError`, `CircuitBreakerError`, `InsufficientBalanceError`
  - Added `isAppError()` type guard

- [x] **Global Error Handler** (`main.ts`)
  - Updated `app.onError()` to detect `AppError` instances
  - Returns structured JSON with error code and proper status
  - Sets `Retry-After` header for rate limits

### Phase 3: Code Hardening

- [x] **Circuit Breaker** (`utils/circuitBreaker.ts`)
  - Created `CircuitBreaker` class with closed/open/half-open states
  - Pre-configured breakers for: Bendystraw, IPFS, Juicerkle, MCP Docs
  - Added `getAllCircuitStats()` for monitoring

## Deferred Tasks

- [ ] Split `chat.ts` (1,484 lines) → 4 files
- [ ] Split `smartAccounts.ts` (1,783 lines) → 3 files

## Verification Results

- [x] TypeScript compiles: `deno check main.ts` ✓
- [x] All modified files pass type check ✓

## Files Modified

| File | Changes |
|------|---------|
| `services/claude.ts` | Model selection, PostgreSQL rate limits |
| `services/aiBilling.ts` | Token-based billing, env var control |
| `services/rateLimit.ts` | Tool-specific rate limits |
| `services/omnichain.ts` | GraphQL sanitization |
| `utils/config.ts` | Added `aiFreeMode` config |
| `types/index.ts` | Added `aiFreeMode` to `EnvConfig` |
| `main.ts` | Structured error handling |

## New Files

| File | Purpose |
|------|---------|
| `errors/AppError.ts` | Structured error types |
| `utils/circuitBreaker.ts` | Circuit breaker for external services |
