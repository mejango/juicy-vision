# Juicy Vision Backend - Security Documentation

## Authentication Security

### Email OTP

| Control | Implementation |
|---------|---------------|
| Code length | 6 digits (1M combinations) |
| Expiration | 10 minutes |
| Single use | Marked used after verification |
| Invalidation | New code invalidates previous |
| Timing-safe comparison | Constant-time string compare |
| Rate limiting | Per-email limits on requests |

**Threat model:**
- Brute force: 6 digits with 10-min expiry limits attempts
- Interception: Relies on email security; consider 2FA for high-value ops

### Passkey/WebAuthn

| Control | Implementation |
|---------|---------------|
| Challenge expiry | 5 minutes |
| Counter validation | Detects cloned authenticators |
| Credential uniqueness | Global unique constraint on credential_id |
| IDOR protection | User can only manage own credentials |
| Attestation verification | CBOR parsing with signature validation |

**Threat model:**
- Cloning: Counter tracking detects replayed credentials
- Phishing: WebAuthn origin binding prevents cross-site attacks

### SIWE (Sign-In With Ethereum)

| Control | Implementation |
|---------|---------------|
| Nonce validation | Random 32-char, 5-min expiry |
| Signature verification | viem recoverMessageAddress |
| Session expiry | 30 days |
| Address normalization | Case-insensitive (checksummed storage) |
| Replay prevention | Nonce consumed on use |

**Threat model:**
- Replay attacks: Nonce validation prevents
- Signature forgery: ECDSA security (secp256k1)

## Session Management

### JWT Tokens (Managed Users)

| Control | Implementation |
|---------|---------------|
| Algorithm | HS256 |
| Expiry | 7 days |
| Secret | `JWT_SECRET` env var (required in production) |
| Payload | `{ userId, sessionId, iat, exp }` |
| Validation | Signature + expiry check on every request |

### Session Tokens (SIWE Users)

| Control | Implementation |
|---------|---------------|
| Format | 64-char random hex |
| Storage | Database with expiry timestamp |
| Expiry | 30 days |
| Lookup | Indexed for fast validation |

### Anonymous Sessions

| Control | Implementation |
|---------|---------------|
| Identifier | X-Session-ID header |
| Address derivation | HMAC-SHA256 with server secret |
| Persistence | None (stateless pseudo-identity) |

## Input Validation

All API inputs validated with Zod schemas:

```typescript
// Example: Juice spend validation
const spendSchema = z.object({
  projectId: z.number().int().positive(),
  chainId: z.number().refine(id => SUPPORTED_CHAINS.includes(id)),
  amountUsd: z.number().min(1).max(50000),
  beneficiaryAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  memo: z.string().max(500).optional(),
});
```

### Validation Rules

| Field Type | Validation |
|------------|------------|
| Addresses | Regex `0x[a-fA-F0-9]{40}`, checksummed |
| Chain IDs | Whitelist: 1, 10, 42161, 8453 |
| Amounts | Min/max limits, positive numbers |
| Strings | Max length, sanitization |
| UUIDs | Format validation |

## Rate Limiting

Database-backed rate limiting per identifier:

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/auth/request-code` | 5 | 1 hour |
| `/juice/purchase` | 10 | 1 hour |
| `/juice/spend` | 20 | 1 hour |
| `/juice/cash-out` | 5 | 1 hour |
| Global API | 100 | 1 minute |

**Implementation:**
- Sliding window counter in `rate_limits` table
- Atomic increment with FOR UPDATE
- Automatic cleanup via cron job

## Financial Controls

### Amount Limits

| Operation | Minimum | Maximum |
|-----------|---------|---------|
| Juice purchase | $1 | $10,000 |
| Juice spend | $1 | $50,000 |
| Juice cash-out | $1 | $10,000 |

### Chargeback Protection

Risk-based settlement delays using Stripe Radar:

| Risk Score | Delay |
|------------|-------|
| 0-20 | Immediate |
| 21-40 | 7 days |
| 41-60 | 30 days |
| 61-80 | 60 days |
| 81-100 | 120 days |

**On dispute/refund:**
- Payment marked as disputed
- Settlement blocked
- Funds not released

### Cash-Out Delay

All cash-outs have 24-hour delay:
- Allows user to cancel if account compromised
- Email notification on cash-out request
- Cancel endpoint available

## Database Security

### Row-Level Security

All queries include user context:

```sql
-- User can only see their own sessions
SELECT * FROM sessions WHERE user_id = $1

-- Member can only see their chats
SELECT * FROM multi_chats mc
JOIN multi_chat_members mcm ON mcm.chat_id = mc.id
WHERE mcm.member_address = $1 AND mcm.is_active = TRUE
```

### Constraints

| Table | Constraint |
|-------|-----------|
| `juice_balances` | `CHECK (balance >= 0)` |
| `passkey_credentials` | `UNIQUE (credential_id)` |
| `wallet_sessions` | `UNIQUE (wallet_address)` |
| `pending_fiat_payments` | `risk_score >= 0 AND risk_score <= 100` |

### Concurrency Control

```sql
-- Row locking for concurrent processing
SELECT * FROM juice_spends
WHERE status = 'pending'
FOR UPDATE SKIP LOCKED
LIMIT 20;
```

## Cryptographic Security

### Key Management

| Secret | Storage | Rotation |
|--------|---------|----------|
| `JWT_SECRET` | Environment | On compromise |
| `ENCRYPTION_KEY` | Environment | Version-based |
| `RESERVES_PRIVATE_KEY` | Environment | On compromise |
| Per-chat encryption keys | Database (encrypted) | Per-member |

### Algorithms

| Purpose | Algorithm |
|---------|-----------|
| JWT signing | HMAC-SHA256 |
| Password comparison | Constant-time |
| Session tokens | crypto.randomBytes |
| E2E encryption | X25519 + ChaCha20-Poly1305 |
| Anonymous address | HMAC-SHA256 |

## External Integration Security

### Stripe Webhooks

```typescript
// Signature verification
const sig = c.req.header('stripe-signature');
const event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
```

### Blockchain RPCs

- No private keys sent to RPCs
- Transaction signing done locally
- Gas estimation with safety margins

### Chainlink Oracle

| Check | Value |
|-------|-------|
| Staleness | < 1 hour |
| Price range | $100 - $100,000 |
| Round validation | Valid round ID |

## Secrets Management

### Required in Production

```bash
JWT_SECRET          # JWT signing key
ENCRYPTION_KEY      # E2E encryption master key
RESERVES_PRIVATE_KEY # Hot wallet for settlements
STRIPE_WEBHOOK_SECRET # Webhook signature validation
DATABASE_URL        # PostgreSQL connection
```

### Validation on Startup

```typescript
if (ENV === 'production') {
  if (!JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  // ... similar checks for other secrets
}
```

## Error Handling

### Information Disclosure Prevention

```typescript
// Development: Full error details
if (ENV === 'development') {
  return c.json({ error: err.message, stack: err.stack }, 500);
}

// Production: Generic message
return c.json({ error: 'Internal server error' }, 500);
```

### Logging

- Structured JSON logging
- Sensitive data redacted (passwords, tokens)
- Request IDs for tracing

## CORS & Headers

```typescript
app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
}));

// Security headers via middleware
```

## Audit Trail

### Logged Events

| Event | Data Captured |
|-------|---------------|
| Login | user_id, method, IP |
| Juice purchase | user_id, amount, payment_id |
| Juice spend | user_id, project, amount |
| Cash-out | user_id, address, amount |
| Session create/delete | user_id, session_id |

### Database Timestamps

All tables include:
- `created_at` - Record creation
- `updated_at` - Last modification (via trigger)

## Vulnerability Response

### Reporting

Report security issues to: [security contact]

### Response Timeline

| Severity | Response | Fix |
|----------|----------|-----|
| Critical | 4 hours | 24 hours |
| High | 24 hours | 7 days |
| Medium | 72 hours | 30 days |
| Low | 7 days | 90 days |

## Security Checklist

### Deployment

- [ ] All secrets configured (non-default values)
- [ ] JWT_SECRET is cryptographically random (32+ chars)
- [ ] RESERVES_PRIVATE_KEY secured (consider HSM/multi-sig)
- [ ] Database SSL enabled
- [ ] CORS origins restricted
- [ ] Rate limiting enabled
- [ ] Monitoring/alerting configured

### Code Review

- [ ] No hardcoded secrets
- [ ] Input validation on all endpoints
- [ ] User context checked in queries
- [ ] Error messages don't leak internals
- [ ] Timing-safe comparisons for secrets

### Monitoring

- [ ] Failed auth attempts
- [ ] Unusual transaction patterns
- [ ] Rate limit hits
- [ ] Settlement failures
- [ ] Passkey counter anomalies
