# E2E Test Status

Last updated: Current session

## Summary

**All Core User Journey Tests: PASSING**

| Category | Tests | Status |
|----------|-------|--------|
| Project Creation | 10 | ✓ ALL PASS |
| Store Management | 14 | ✓ ALL PASS |
| Dashboard Navigation | 16 | ✓ ALL PASS |
| Payment Flow | 20 | ✓ ALL PASS |
| Cash Out Flow | 22 | ✓ ALL PASS |
| Authentication | 28 | ✓ ALL PASS |
| **Total Core Tests** | **110** | **ALL PASSING** |

---

## Authentication Tests (28 tests)

### Passkey Authentication (Managed Wallet)
| Test | Status |
|------|--------|
| Sign in button opens auth popover | ✓ PASS |
| Passkey/Touch ID option is available | ✓ PASS |
| Shows loading state during passkey creation | ✓ PASS |
| Authenticated state shows user info | ✓ PASS |
| Wallet address is displayed | ✓ PASS |
| Balance is displayed | ✓ PASS |
| Auth persists across page reload | ✓ PASS |
| Auth persists across navigation | ✓ PASS |
| Auth persists across multiple navigations | ✓ PASS |
| Can sign out | ✓ PASS |
| Sign out clears all auth data | ✓ PASS |
| Sign out clears external wallet data too | ✓ PASS |

### External Wallet Connection (Self-Custody)
| Test | Status |
|------|--------|
| Shows wallet option in auth popover | ✓ PASS |
| Wallet button triggers wallet connection | ✓ PASS |
| Auth popover can be closed | ✓ PASS |
| Mocked external wallet sets self-custody mode | ✓ PASS |
| Mocked SIWE verification endpoint works | ✓ PASS |
| SIWE failure is handled gracefully | ✓ PASS |
| Nonce endpoint returns valid nonce | ✓ PASS |
| Mocked wallet reports correct chainId | ✓ PASS |
| Different chains are supported | ✓ PASS |

### Auth Mode Switching
| Test | Status |
|------|--------|
| Can switch from managed to self-custody | ✓ PASS |
| Can switch from self-custody to managed | ✓ PASS |

### Auth Error Handling
| Test | Status |
|------|--------|
| Shows error on auth failure (500) | ✓ PASS |
| Shows error on auth failure (401) | ✓ PASS |
| Handles network error during auth | ✓ PASS |
| Handles timeout during auth | ✓ PASS |
| Handles malformed auth response | ✓ PASS |

---

## Mock Data Variety

Tests use diverse mock data to avoid overfitting:

- **User IDs**: Unique per test (e.g., `user-info-test-001`, `persist-reload-test-004`)
- **Emails**: Unique per test (e.g., `user-info-test@juicy.vision`, `persist-nav@juicy.vision`)
- **Smart Account Addresses**: Unique per test (40 hex chars each)
- **Chain IDs**: Ethereum (1), Optimism (10), Base (8453), Arbitrum (42161)
- **Error Scenarios**: 500, 401, network abort, timeout, malformed JSON

---

## External Wallet Testing

External wallet tests use proper mocking:

```typescript
// Set up external wallet mock
await mockExternalWallet(page, {
  address: '0xTestWalletAddress...',
  chainId: 1,  // Ethereum mainnet
  isConnected: true
})

// Set up SIWE verification mock
await mockSIWE(page, {
  shouldSucceed: true,
  userAddress: '0xSIWEAddress...'
})
```

**Mocking features:**
- `mockExternalWallet()` - Sets up localStorage and window.ethereum
- `mockSIWE()` - Mocks SIWE verification and nonce endpoints
- Supports multiple chains (ETH, OP, Base, Arbitrum)
- Simulates both success and failure scenarios

---

## Test Reliability

Tests use `domcontentloaded` instead of `networkidle` for better reliability:
- Faster test execution
- Fewer transient timeouts
- More deterministic results

**Note**: Occasional timeout failures during parallel runs are transient and pass when re-run individually.

---

## Extended Test Coverage (Needs Review)

| Category | File | Tests | Status |
|----------|------|-------|--------|
| Chat Variants | chat-variants.spec.ts | ~100 | Needs review |
| Project Variants | project-variants.spec.ts | ~160 | Needs review |
| Payment Variants | payment-variants.spec.ts | ~120 | Needs review |
| Accessibility | accessibility.spec.ts | 45 | Partial pass |
| Multi-user | multi-user-scenarios.spec.ts | 25 | Placeholder |
| Owner Actions | owner-actions.spec.ts | 30 | Placeholder |
| Omnichain | omnichain.spec.ts | 25 | Placeholder |

---

## Running Tests

```bash
# Run all core flow tests (recommended)
npx playwright test e2e/flows/project-creation.spec.ts e2e/flows/store-management.spec.ts e2e/flows/dashboard.spec.ts e2e/flows/payment.spec.ts e2e/flows/cash-out.spec.ts e2e/flows/authentication.spec.ts

# Run auth tests only
npx playwright test e2e/flows/authentication.spec.ts

# Run full suite
npx playwright test

# Run with HTML report
npx playwright test --reporter=html

# Run single test file
npx playwright test e2e/flows/payment.spec.ts
```
