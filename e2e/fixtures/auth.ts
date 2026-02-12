import { test as base, expect, type Page, type BrowserContext } from '@playwright/test'

// ============================================================================
// Type Declarations
// ============================================================================

declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
      on?: (event: string, handler: (...args: unknown[]) => void) => void
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void
    }
  }
}

// ============================================================================
// Configuration
// ============================================================================

const API_BASE = process.env.API_URL || 'http://localhost:3001'

// ============================================================================
// Types
// ============================================================================

export interface TestUser {
  id: string
  email: string
  token: string
  smartAccountAddress: string
  mode: 'managed' | 'self_custody'
  balance?: string
  usdcBalance?: string
}

export interface RealTestUser {
  id: string
  email: string
  token: string
  privacyMode: string
}

export interface AuthState {
  mode: 'managed' | 'self_custody'
  privacyMode: 'open_book' | 'anonymous' | 'private' | 'ghost'
  user: {
    id: string
    email: string
    privacyMode: string
    hasCustodialWallet: boolean
    passkeyEnabled?: boolean
    isAdmin?: boolean
  } | null
  token: string | null
}

// ============================================================================
// Test Fixtures
// ============================================================================

export interface AuthFixtures {
  /**
   * A page with managed mode authentication pre-configured.
   * Skips actual passkey auth and sets up localStorage directly.
   */
  authenticatedPage: Page

  /**
   * A page with REAL backend authentication.
   * Uses OTP flow to get a real JWT token from the backend.
   */
  realAuthenticatedPage: Page

  /**
   * A page in self-custody mode (wallet connection required).
   * No authentication, but local storage is cleared.
   */
  unauthenticatedPage: Page

  /**
   * Mock a managed user in localStorage without real auth.
   * Useful for testing UI states that require authentication.
   */
  mockManagedAuth: (page: Page, user?: Partial<TestUser>) => Promise<TestUser>

  /**
   * Authenticate with the real backend using OTP flow.
   * Returns a real JWT token that works with all API endpoints.
   */
  realAuth: (page: Page, email?: string) => Promise<RealTestUser>

  /**
   * Clear all auth state from localStorage.
   */
  clearAuth: (page: Page) => Promise<void>

  /**
   * Get current auth state from localStorage.
   */
  getAuthState: (page: Page) => Promise<AuthState | null>
}

// Deterministic test user for consistent testing
const DEFAULT_TEST_USER: TestUser = {
  id: 'test-user-001',
  email: 'test@juicy.vision',
  token: 'test-token-e2e-' + Date.now(),
  smartAccountAddress: '0x1234567890123456789012345678901234567890',
  mode: 'managed',
}

// Real E2E test users (seeded in database)
const E2E_TEST_USERS = {
  standard: 'e2e-user@test.juicy.vision',
  power: 'e2e-power@test.juicy.vision',
  anonymous: 'e2e-anon@test.juicy.vision',
  ghost: 'e2e-ghost@test.juicy.vision',
}

// ============================================================================
// Real Backend Authentication Helpers
// ============================================================================

// Token cache to avoid OTP race conditions in parallel tests
const tokenCache = new Map<string, { token: RealTestUser; timestamp: number }>()
const TOKEN_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const authLocks = new Map<string, Promise<RealTestUser>>()

/**
 * Seed test users in the database via debug endpoint.
 * Call this once before running tests.
 */
export async function seedTestUsers(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/debug/seed-test-users`, {
      method: 'POST',
    })
    const data = await response.json()
    return data.success
  } catch {
    return false
  }
}

/**
 * Get a real auth token for a test user via OTP flow.
 * In development mode, the backend returns the OTP code directly.
 * Uses caching to prevent OTP race conditions in parallel tests.
 */
export async function getRealAuthToken(email: string): Promise<RealTestUser> {
  // Check cache first
  const cached = tokenCache.get(email)
  if (cached && Date.now() - cached.timestamp < TOKEN_CACHE_TTL) {
    return cached.token
  }

  // If another request is already in progress for this email, wait for it
  const existingLock = authLocks.get(email)
  if (existingLock) {
    return existingLock
  }

  // Create a new auth request
  const authPromise = (async () => {
    try {
      // Request OTP code
      const codeResponse = await fetch(`${API_BASE}/auth/request-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const codeData = await codeResponse.json()

      if (!codeData.success || !codeData.data.code) {
        throw new Error(`Failed to get OTP code: ${codeData.error || 'No code returned (is backend in dev mode?)'}`)
      }

      // Verify OTP and get token
      const verifyResponse = await fetch(`${API_BASE}/auth/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: codeData.data.code }),
      })
      const verifyData = await verifyResponse.json()

      if (!verifyData.success) {
        throw new Error(`Failed to verify OTP: ${verifyData.error}`)
      }

      const result: RealTestUser = {
        id: verifyData.data.user.id,
        email: verifyData.data.user.email,
        token: verifyData.data.token,
        privacyMode: verifyData.data.user.privacyMode,
      }

      // Cache the token
      tokenCache.set(email, { token: result, timestamp: Date.now() })

      return result
    } finally {
      // Clean up the lock
      authLocks.delete(email)
    }
  })()

  // Store the promise so parallel requests wait for it
  authLocks.set(email, authPromise)

  return authPromise
}

/**
 * Set up real authentication in the browser.
 * Gets a real JWT token and stores it in localStorage.
 */
export async function setupRealAuth(page: Page, email?: string): Promise<RealTestUser> {
  const userEmail = email || E2E_TEST_USERS.standard

  // Get real token from backend
  const authResult = await getRealAuthToken(userEmail)

  // Navigate to app and set up auth state
  await page.goto('/')
  await page.evaluate((auth) => {
    const authState = {
      state: {
        mode: 'managed',
        privacyMode: auth.privacyMode,
        user: {
          id: auth.id,
          email: auth.email,
          privacyMode: auth.privacyMode,
          hasCustodialWallet: true,
          passkeyEnabled: true,
        },
        token: auth.token,
      },
      version: 1,
    }
    localStorage.setItem('juice-auth', JSON.stringify(authState))
  }, authResult)

  // Reload to apply auth state
  await page.reload()
  // Use domcontentloaded instead of networkidle to avoid timeout on long-polling connections
  await page.waitForLoadState('domcontentloaded')
  // Give a moment for React hydration
  await page.waitForTimeout(1000)

  return authResult
}

/**
 * Extended test with auth fixtures
 */
export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    // Set up managed auth state in localStorage before navigation
    await page.goto('/')
    await page.evaluate((user) => {
      const authState = {
        state: {
          mode: 'managed',
          privacyMode: 'open_book',
          user: {
            id: user.id,
            email: user.email,
            privacyMode: 'open_book',
            hasCustodialWallet: true,
            passkeyEnabled: true,
          },
          token: user.token,
        },
        version: 1,
      }
      localStorage.setItem('juice-auth', JSON.stringify(authState))
      localStorage.setItem('juice-smart-account-address', user.smartAccountAddress)
    }, DEFAULT_TEST_USER)

    // Reload to apply the auth state
    await page.reload()
    await page.waitForLoadState('networkidle')

    await use(page)
  },

  realAuthenticatedPage: async ({ page }, use) => {
    // Get real auth token from backend and set up page
    await setupRealAuth(page, E2E_TEST_USERS.standard)
    await use(page)
  },

  realAuth: async ({ }, use) => {
    const authenticate = async (page: Page, email?: string): Promise<RealTestUser> => {
      return setupRealAuth(page, email)
    }
    await use(authenticate)
  },

  unauthenticatedPage: async ({ page }, use) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.clear()
    })
    await page.reload()
    await page.waitForLoadState('networkidle')
    await use(page)
  },

  mockManagedAuth: async ({ }, use) => {
    const mockAuth = async (page: Page, overrides: Partial<TestUser> = {}): Promise<TestUser> => {
      const user: TestUser = { ...DEFAULT_TEST_USER, ...overrides }

      await page.evaluate((u) => {
        const authState = {
          state: {
            mode: 'managed',
            privacyMode: 'open_book',
            user: {
              id: u.id,
              email: u.email,
              privacyMode: 'open_book',
              hasCustodialWallet: true,
              passkeyEnabled: true,
            },
            token: u.token,
          },
          version: 1,
        }
        localStorage.setItem('juice-auth', JSON.stringify(authState))
        localStorage.setItem('juice-smart-account-address', u.smartAccountAddress)
      }, user)

      return user
    }
    await use(mockAuth)
  },

  clearAuth: async ({ }, use) => {
    const clear = async (page: Page) => {
      await page.evaluate(() => {
        // Clear managed wallet auth data
        localStorage.removeItem('juice-auth')
        localStorage.removeItem('juice-smart-account-address')
        localStorage.removeItem('juice-passkey-wallet')
        localStorage.removeItem('juice-passkey-credential')
        localStorage.removeItem('juicy-identity')
        // Clear external wallet auth data
        localStorage.removeItem('juice-external-wallet')
        // Clear any session tokens
        localStorage.removeItem('juice-session-token')
        localStorage.removeItem('juice-refresh-token')
      })
    }
    await use(clear)
  },

  getAuthState: async ({ }, use) => {
    const getState = async (page: Page): Promise<AuthState | null> => {
      return page.evaluate(() => {
        const stored = localStorage.getItem('juice-auth')
        if (!stored) return null
        try {
          const parsed = JSON.parse(stored)
          return parsed.state || null
        } catch {
          return null
        }
      })
    }
    await use(getState)
  },
})

// ============================================================================
// Helpers for API Mocking
// ============================================================================

/**
 * Set up API route mocking for authentication endpoints.
 * Use this to create deterministic test scenarios.
 */
export async function mockAuthEndpoints(page: Page, options: {
  user?: TestUser
  shouldFail?: boolean
  errorMessage?: string
} = {}) {
  const { user = DEFAULT_TEST_USER, shouldFail = false, errorMessage = 'Authentication failed' } = options

  // Mock /wallet/address endpoint
  await page.route('**/wallet/address', async (route) => {
    if (shouldFail) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: errorMessage }),
      })
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            address: user.smartAccountAddress,
            chainId: 1,
            deployed: true,
            custodyStatus: 'managed',
          },
        }),
      })
    }
  })

  // Mock /wallet/balances endpoint
  await page.route('**/wallet/balances', async (route) => {
    if (shouldFail) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: errorMessage }),
      })
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            accounts: [
              {
                chainId: 1,
                address: user.smartAccountAddress,
                deployed: true,
                custodyStatus: 'managed',
                balances: [
                  { tokenAddress: '0x0000000000000000000000000000000000000000', tokenSymbol: 'ETH', balance: '1000000000000000000', decimals: 18 },
                ],
              },
            ],
          },
        }),
      })
    }
  })

  // Mock /auth/me endpoint
  await page.route('**/auth/me', async (route) => {
    if (shouldFail) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: errorMessage }),
      })
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: user.id,
            email: user.email,
            privacyMode: 'open_book',
            hasCustodialWallet: true,
            passkeyEnabled: true,
          },
        }),
      })
    }
  })
}

/**
 * Wait for authentication state to be hydrated from localStorage.
 */
export async function waitForAuthHydration(page: Page, timeout = 5000) {
  await page.waitForFunction(
    () => {
      const stored = localStorage.getItem('juice-auth')
      if (!stored) return true // No auth is valid state
      const parsed = JSON.parse(stored)
      return parsed?.state?._hasHydrated !== false
    },
    { timeout }
  )
}

// ============================================================================
// External Wallet Mocking
// ============================================================================

/**
 * Mock external wallet connection for testing self-custody mode.
 * This simulates a connected wallet without requiring actual wallet extension.
 */
export async function mockExternalWallet(page: Page, options: {
  address?: string
  chainId?: number
  isConnected?: boolean
} = {}) {
  const {
    address = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12',
    chainId = 1,
    isConnected = true,
  } = options

  // Set up self-custody auth state
  await page.evaluate(({ addr, chain, connected }) => {
    if (connected) {
      const authState = {
        state: {
          mode: 'self_custody',
          privacyMode: 'open_book',
          user: null,
          token: null,
          externalWalletAddress: addr,
          externalWalletChainId: chain,
        },
        version: 1,
      }
      localStorage.setItem('juice-auth', JSON.stringify(authState))
      localStorage.setItem('juice-external-wallet', addr)
    }
  }, { addr: address, chain: chainId, connected: isConnected })

  // Mock wagmi/RainbowKit state
  await page.addInitScript(({ addr, chain, connected }) => {
    // Mock window.ethereum for basic detection
    if (!window.ethereum) {
      (window as any).ethereum = {
        isMetaMask: true,
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_accounts') {
            return connected ? [addr] : []
          }
          if (method === 'eth_chainId') {
            return '0x' + chain.toString(16)
          }
          if (method === 'eth_requestAccounts') {
            return connected ? [addr] : []
          }
          if (method === 'personal_sign') {
            // Return a mock signature for SIWE
            return '0x' + '1'.repeat(130)
          }
          return null
        },
        on: () => {},
        removeListener: () => {},
      }
    }
  }, { addr: address, chain: chainId, connected: isConnected })
}

/**
 * Mock SIWE (Sign-In With Ethereum) flow for testing.
 */
export async function mockSIWE(page: Page, options: {
  shouldSucceed?: boolean
  userAddress?: string
} = {}) {
  const {
    shouldSucceed = true,
    userAddress = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12',
  } = options

  // Mock SIWE verification endpoint
  await page.route('**/auth/siwe/**', async (route) => {
    if (shouldSucceed) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            address: userAddress,
            verified: true,
          },
        }),
      })
    } else {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'SIWE verification failed',
        }),
      })
    }
  })

  // Mock nonce endpoint
  await page.route('**/auth/nonce', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { nonce: 'test-nonce-' + Date.now() },
      }),
    })
  })
}

// Re-export expect and Page for convenience
export { expect, type Page }
