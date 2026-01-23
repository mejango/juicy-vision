# Security Review Findings

Date: 2026-01-22
Reviewer: Claude Opus 4.5

## Summary

Overall the auth architecture is solid. Found 2 critical issues and several medium-priority items.

---

## Critical Issues

### 1. ~~JWT Secret Reused as Encryption Master Key~~ (FIXED)

**Location**: `backend/src/services/encryption.ts:104`

**Status**: ✅ Fixed on 2026-01-22

**Fix Applied**:
- Added `ENCRYPTION_MASTER_KEY` to config (`backend/src/utils/config.ts`)
- Updated `deriveServerKey()` to use dedicated encryption key
- Added `validateConfigForEncryption()` to prevent deployment without proper key
- Server startup now validates encryption key is set and different from JWT secret

---

### 2. ~~OTP Code Returned in API Response (Development Mode Leak)~~ (FIXED)

**Location**: `backend/src/services/auth.ts:284-293`

**Status**: ✅ Fixed on 2026-01-22

**Fix Applied**:
- OTP code now only returned in `development` environment
- Production responses only include `expiresIn`, no code
- Console logging of code only in development mode

---

## Medium Priority

### 3. P-256 Fallback Instead of X25519

**Location**: `backend/src/services/encryption.ts:132-154`

The code uses P-256 ECDH because Web Crypto doesn't support X25519 directly. P-256 is still secure but X25519 is generally preferred for modern systems.

**Recommendation**: Consider using `@noble/curves` or `@noble/ed25519` for proper X25519/Ed25519 support.

---

### 4. Group Key Encryption Not Truly E2E

**Location**: `backend/src/services/encryption.ts:391-401`

The group key is encrypted using a key derived from the server's master key and the member's public key. This means the server can decrypt all group messages.

**Current Flow**:
1. Server generates group key
2. Server encrypts group key with server-derived key
3. Server can decrypt at any time

**For True E2E**:
1. Client generates group key
2. Client encrypts for each member's public key
3. Server stores encrypted blobs without decryption capability

**Recommendation**: Move group key generation and encryption to the client for `private` mode chats.

---

### 5. Salt Reused as IV

**Location**: `backend/src/services/encryption.ts:265`

```typescript
{ name: 'AES-GCM', iv: salt }, // Use salt as IV for simplicity
```

Using salt as IV is acceptable since the salt is random per encryption. However, nonce reuse with AES-GCM can be catastrophic. The current implementation appears safe but should be documented.

---

## Good Practices Observed

1. **Server-generated nonces for SIWE**: Prevents replay attacks
2. **WebAuthn for passkeys**: Uses standard browser API with server-side verification
3. **Session tokens stored in DB**: Allows revocation and tracks expiry
4. **OTP codes invalidated on use**: Prevents replay
5. **Privacy mode enforcement**: Ghost mode properly skips analytics
6. **Bearer token extraction**: Standard middleware pattern
7. **Email normalization**: Consistently lowercased

---

## Verification Checklist

- [x] No API keys in frontend bundle
- [x] JWT tokens use HS256 with secret
- [x] Session expiry enforced server-side
- [x] OTP expiry enforced (10 minutes)
- [x] Passkey challenges from server
- [x] SIWE nonces from server
- [x] Dedicated encryption key (FIXED 2026-01-22)
- [x] OTP code removed from response (FIXED 2026-01-22)
- [ ] True E2E for private chats (needs architecture change)

---

## Recommended Actions

| Priority | Issue | Status |
|----------|-------|--------|
| ~~**Critical**~~ | ~~Separate encryption key from JWT secret~~ | ✅ Fixed |
| ~~**Critical**~~ | ~~Remove OTP code from API response~~ | ✅ Fixed |
| Medium | Implement client-side E2E for private mode | Pending |
| Low | Migrate to X25519 | Pending |
