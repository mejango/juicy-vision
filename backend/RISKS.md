# Juice System Risk Assessment

This document outlines potential failure modes, security considerations, and operational risks for the Juice stored-value system.

## Critical Dependencies

### 1. Reserves Wallet
**Risk**: Single point of failure for all on-chain transactions.

| Scenario | Impact | Mitigation |
|----------|--------|------------|
| Private key compromised | Complete loss of reserves | Use HSM or multi-sig in production |
| Wallet drained by attacker | Cannot fulfill spends/cash-outs | Monitor balance, set up alerts |
| Insufficient balance | Pending transactions fail | Daily reconciliation, top-up alerts |
| Nonce desync from parallel txs | Transactions stuck | Sequential processing with locking |

**Current state**: `RESERVES_PRIVATE_KEY` is a single hot key. Consider upgrading to a Gnosis Safe with threshold signing for production.

### 2. Chainlink Price Feed
**Risk**: Bad price data causes over/underpayment.

| Scenario | Impact | Mitigation |
|----------|--------|------------|
| Stale data (oracle down) | Wrong USD/ETH conversion | **FIXED**: 1hr staleness check |
| Flash loan price manipulation | N/A (Chainlink is off-chain) | N/A |
| Price outside sane range | Over/underpayment | **FIXED**: $100-$100k sanity check |
| Mainnet oracle used for L2 | Slight price deviation | Use chain-native oracles for L2s |

### 3. Stripe Integration
**Risk**: Payment processing failures or fraud.

| Scenario | Impact | Mitigation |
|----------|--------|------------|
| Webhook signature spoofed | Fake credits | **OK**: Signature verified |
| Chargeback after credit | Financial loss | Risk-based delay (0-120 days) |
| API key leaked | Unauthorized charges | Rotate keys, use restricted keys |
| Duplicate webhook delivery | Double credit | Unique constraint on payment_intent_id |

### 4. Database
**Risk**: Data corruption or race conditions.

| Scenario | Impact | Mitigation |
|----------|--------|------------|
| Concurrent balance updates | Double-spend | Atomic UPDATE with balance check |
| Cron jobs processing same record | Duplicate execution | **FIXED**: FOR UPDATE SKIP LOCKED |
| Balance goes negative | Overdraft | CHECK constraint on balance >= 0 |
| Transaction isolation failure | Inconsistent state | Uses transactions for multi-step ops |

### 5. Authentication
**Risk**: Account compromise or unauthorized access.

| Scenario | Impact | Mitigation |
|----------|--------|------------|
| OTP brute force | Account takeover | Rate limiting, 6-digit codes expire in 10min |
| OTP interception (email) | Account takeover | Consider 2FA for high-value operations |
| Passkey cloning | Unauthorized access | Counter tracking detects clones |
| SIWE replay attack | Session hijacking | Nonce validation, short-lived challenges |
| Session fixation | Account takeover | New session ID on auth, secure cookies |
| JWT secret compromise | All sessions compromised | Rotate JWT_SECRET, invalidate all sessions |

**Current state**: Multiple auth methods (Email OTP, Passkey/WebAuthn, SIWE) provide flexibility. Passkey is the most secure option. Email OTP relies on email security. SIWE relies on wallet security.

---

## Security Vulnerabilities

### Addressed
- [x] **Chain validation**: Only allow supported chains (1, 10, 42161, 8453)
- [x] **Price staleness**: Chainlink data must be <1hr old
- [x] **Price sanity**: ETH must be $100-$100k
- [x] **Row locking**: SKIP LOCKED prevents concurrent processing
- [x] **Webhook auth**: Stripe signature verification
- [x] **User isolation**: All queries include user_id check
- [x] **Amount limits**: Purchase $1-$10k, Cash-out $1-$10k, Spend $1-$50k

#### Authentication (Tested via Integration Tests)
- [x] **Email OTP timing-safe comparison**: Prevents timing attacks on code verification
- [x] **OTP code invalidation**: New codes invalidate previous codes for same email
- [x] **OTP single-use**: Verified codes cannot be reused
- [x] **Case-insensitive email**: Email normalization prevents duplicates
- [x] **Session expiration**: Sessions have enforced expiry times
- [x] **Passkey IDOR protection**: Users can only manage their own credentials
- [x] **Passkey counter tracking**: Detects cloned authenticators
- [x] **Passkey credential uniqueness**: credential_id is globally unique
- [x] **SIWE nonce validation**: Prevents replay attacks
- [x] **SIWE address normalization**: Case-insensitive address handling
- [x] **SIWE session expiry**: 30-day session lifetime enforced
- [x] **Anonymous session migration**: Supports linking anonymous to authenticated sessions

### Potential Concerns

#### Rate Limiting
The Juice API endpoints don't have dedicated rate limiting. Relies on global API rate limits.

**Recommendation**: Add endpoint-specific limits:
- `/purchase`: 10/hour (prevent PaymentIntent spam)
- `/spend`: 20/hour (prevent queue flooding)
- `/cash-out`: 5/hour (prevent withdrawal spam)

#### Floating-Point Precision
USD to Wei conversion uses JavaScript floats:
```typescript
const amountEth = amountUsd / ethUsdRate;
const amountWei = BigInt(Math.floor(amountEth * 1e18));
```

For $10,000 at $2,000/ETH = 5 ETH, precision is sufficient. For edge cases with unusual rates, there could be ±$0.01 variance.

**Recommendation**: Use a decimal library for amounts >$10k.

#### Error Message Leakage
Internal error messages are returned to users:
```typescript
return c.json({ success: false, error: message }, 400);
```

In production, consider generic error messages with internal logging.

---

## Operational Failure Modes

### 1. Cron Processing Backlog
If spends/cash-outs accumulate faster than processing (20/batch, every 2-5 min):

| Metric | Threshold | Action |
|--------|-----------|--------|
| pending_spends | >100 | Alert, increase batch size |
| pending_cash_outs | >50 | Alert, manual intervention |
| avg_retry_count | >2 | Investigate RPC failures |

### 2. RPC Provider Failures
LlamaRPC endpoints could be rate-limited or down.

| Symptom | Detection | Recovery |
|---------|-----------|----------|
| Timeouts | retry_count increases | Failover RPC list |
| Rate limits | 429 responses | Multiple providers |
| Wrong chain | tx fails validation | Verify chain ID in tx |

### 3. JBMultiTerminal Reverts
The pay() call can revert for various reasons:

| Reason | Detection | Recovery |
|--------|-----------|----------|
| Project paused | Tx reverts | Mark spend failed, refund |
| Terminal deprecated | Tx reverts | Update terminal address |
| Insufficient gas | Tx reverts | Increase gas estimates |
| Metadata issues | Tx reverts | Check project config |

---

## Financial Risks

### 1. Chargeback Window
Stripe chargebacks can occur up to 120 days after payment. The risk-based delay mitigates but doesn't eliminate this.

**Exposure**: Any Juice credited before chargeback deadline is at risk.

**Mitigation**:
- High-risk (score >60) transactions have 60-120 day holds
- Implement velocity checks (new users, large amounts)
- Consider requiring verification for amounts >$500

### 2. ETH Price Volatility
Between purchase and spend/cash-out, ETH price could move significantly:
- User buys $100 Juice at ETH=$2000
- User cashes out when ETH=$4000
- They receive 0.025 ETH instead of 0.05 ETH

This is by design (Juice is USD-denominated), but users may not understand.

**Recommendation**: Clear UI messaging about USD denomination.

### 3. Gas Price Spikes
On-chain operations pay gas from reserves. During high gas periods:
- Small spends/cash-outs may have gas > value
- Large batches could drain reserves quickly

**Mitigation**:
- Monitor gas prices before processing
- Pause processing if gas > threshold
- Set minimum spend/cash-out above dust threshold

---

## Fraud Scenarios

### 1. Stolen Credit Card → Juice → Crypto
Attacker uses stolen CC to buy Juice, immediately cashes out.

**Mitigation**:
- 24-hour cash-out delay (allows chargeback notification)
- Risk-based purchase delays (up to 120 days)
- Velocity limits on new accounts

### 2. Account Takeover → Drain Balance
Attacker gains access to account, initiates cash-out.

**Mitigation**:
- 24-hour cash-out delay with email notification
- Cancel endpoint allows user to stop pending cash-out
- Consider 2FA for cash-out operations

### 3. Malicious Project Payments
User spends Juice on a project they control to extract funds.

**Mitigation**:
- This converts fiat to crypto on-chain, risk is absorbed by clearing delay
- Project payments are publicly visible on-chain
- Consider flagging payments to very new projects

---

## Monitoring Checklist

### Daily
- [ ] Reserves wallet balance vs pending obligations
- [ ] Failed transactions in last 24h
- [ ] Disputes/chargebacks received
- [ ] Cron job execution times

### Weekly
- [ ] Total Juice in circulation vs total credited
- [ ] Average processing time for spends
- [ ] RPC error rates by chain
- [ ] User complaints about timing/amounts

### Alerts
```
reserves_balance < sum(pending_cash_outs) * 1.5  → CRITICAL
failed_transactions_1h > 5                        → WARNING
chainlink_price_age > 1800                        → WARNING
pending_spends > 100                              → WARNING
failed_otp_attempts_per_email_1h > 10             → WARNING (potential brute force)
sessions_created_per_user_1h > 20                 → WARNING (potential session fixation)
passkey_counter_resets > 0                        → CRITICAL (cloned authenticator detected)
```

---

## Recovery Procedures

### 1. Reserves Wallet Compromised
1. Immediately pause all cron jobs
2. Revoke/rotate RESERVES_PRIVATE_KEY
3. Audit all recent transactions
4. Deploy new reserves wallet
5. Update configuration
6. Resume processing

### 2. Database Corruption
1. Stop all API traffic
2. Restore from backup
3. Reconcile with Stripe (source of truth for purchases)
4. Reconcile with blockchain (source of truth for spends/cash-outs)
5. Manually fix any discrepancies
6. Resume operations

### 3. Stripe Account Suspension
1. Pause new purchases (return 503)
2. Continue processing existing balances
3. Resolve with Stripe
4. Resume purchases

### 4. JWT Secret Compromised
1. Immediately rotate `JWT_SECRET` in environment
2. All existing sessions become invalid (users must re-authenticate)
3. Audit access logs for suspicious activity during exposure window
4. Consider notifying affected users if suspicious access detected

### 5. Account Takeover Detected
1. Invalidate all sessions for affected user (`DELETE FROM sessions WHERE user_id = ...`)
2. Block pending cash-outs for the user
3. Contact user via verified email to confirm
4. If passkey was compromised, revoke that credential
5. Require re-verification before allowing sensitive operations

---

## Open Questions

1. **Multi-sig for reserves?** Should production use Gnosis Safe with 2-of-3 signing?

2. **L2-native price feeds?** Should we use chain-specific oracles for Optimism/Arbitrum/Base instead of mainnet Chainlink?

3. **Stablecoin cash-outs?** Should users be able to cash out to USDC instead of ETH to avoid volatility?

4. **KYC requirements?** At what threshold should we require identity verification?

5. **Insurance?** Should we explore coverage for the reserves wallet?

6. **2FA for high-value operations?** Should cash-outs >$500 require additional verification (passkey if email auth, or vice versa)?

7. **Session revocation UI?** Should users be able to see and revoke active sessions from other devices?

8. **Passkey-only accounts?** Should we allow passwordless accounts that only use passkeys (no email fallback)?

---

## Planned: Bridge.xyz Integration

**Status**: Pending multi-sig address

**Architecture**:
```
Stripe → Bridge API → USDC → Multi-sig Reserves → Swap → JBMultiTerminal
```

**Benefits**:
- Automated fiat→USDC conversion (no manual CEX transfers)
- USDC reserves eliminate ETH volatility while holding
- Multi-sig security for reserves wallet

**Requirements**:
- [ ] Multi-sig address (Gnosis Safe)
- [ ] Bridge API credentials
- [ ] Swap integration (Uniswap/1inch/Cowswap)

**Note**: Stripe acquired Bridge in 2024, so this may become native Stripe functionality.
