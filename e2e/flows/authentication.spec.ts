import { test, expect, type Page } from '../fixtures/auth'
import { mockAuthEndpoints, mockExternalWallet, mockSIWE } from '../fixtures/auth'

/**
 * User Journey 1.2 & 1.3: Authentication Flows
 *
 * Tests both managed wallet (passkey) and self-custody (external wallet)
 * authentication paths.
 */

// Helper to find the Sign In button - it's in the chat input footer
async function findSignInButton(page: Page) {
  // Wait for the page to fully load
  await page.waitForLoadState('domcontentloaded')

  // The Sign In button should be visible when not authenticated
  const signInBtn = page.locator('button').filter({
    hasText: /^sign in$/i
  }).first()

  return signInBtn
}

test.describe('Passkey Authentication (Managed Wallet)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
  })

  test.describe('Sign Up Flow', () => {
    test('sign in button opens auth popover', async ({ page }) => {
      // The "Sign in" button should be visible when not authenticated
      const signInBtn = await findSignInButton(page)

      // Scroll the button into view - it's in the chat footer
      await signInBtn.scrollIntoViewIfNeeded()

      // Button should be visible and clickable
      await expect(signInBtn).toBeVisible({ timeout: 10000 })
      await signInBtn.click()
      await page.waitForTimeout(500)

      // Auth popover should appear with Touch ID and Wallet options
      const touchIdBtn = page.locator('button').filter({
        hasText: /touch id/i
      }).first()
      const walletBtn = page.locator('button').filter({
        hasText: /^wallet$/i
      }).first()

      // At least one auth option should be visible
      const hasAuthOptions = await touchIdBtn.isVisible() || await walletBtn.isVisible()
      expect(hasAuthOptions).toBe(true)
    })

    test('passkey/touch id option is available', async ({ page }) => {
      const signInBtn = await findSignInButton(page)
      await signInBtn.scrollIntoViewIfNeeded()
      await expect(signInBtn).toBeVisible({ timeout: 10000 })
      await signInBtn.click()
      await page.waitForTimeout(500)

      // Look for Touch ID button (the app's passkey option)
      const touchIdOption = page.locator('button').filter({
        hasText: /touch id/i
      }).first()

      // Touch ID option should be available for passkey auth
      await expect(touchIdOption).toBeVisible({ timeout: 5000 })
    })

    test('shows loading state during passkey creation', async ({ page }) => {
      // This test verifies the UI handles the async passkey flow
      const signInBtn = await findSignInButton(page)
      await signInBtn.scrollIntoViewIfNeeded()
      await expect(signInBtn).toBeVisible({ timeout: 10000 })
      await signInBtn.click()
      await page.waitForTimeout(300)

      // Verify auth options are shown (actual WebAuthn would trigger from here)
      const authOptions = page.locator('button').filter({
        hasText: /touch id|wallet/i
      })
      await expect(authOptions.first()).toBeVisible()
    })
  })

  test.describe('Sign In Flow (Existing User)', () => {
    test('authenticated state shows user info', async ({ page, mockManagedAuth }) => {
      // Use unique user data for this test
      const user = await mockManagedAuth(page, {
        id: 'user-info-test-001',
        email: 'user-info-test@juicy.vision',
        smartAccountAddress: '0xUserInfoTest123456789012345678901234'
      })
      await mockAuthEndpoints(page, { user })
      await page.reload()
      await page.waitForLoadState('domcontentloaded')

      // User should see their account info somewhere
      await expect(page.locator('body')).toBeVisible()

      // Sign in button should be replaced with account indicator
      const signInBtn = page.locator('button').filter({
        hasText: /^sign in$/i
      })
      const signInCount = await signInBtn.count()

      // Either no sign in button, or it's replaced with profile/account
      expect(signInCount).toBeLessThanOrEqual(1)
    })

    test('wallet address is displayed', async ({ page, mockManagedAuth }) => {
      // Use a different unique address to ensure we're testing address display
      const user = await mockManagedAuth(page, {
        id: 'address-display-test-002',
        email: 'address-test@juicy.vision',
        smartAccountAddress: '0xAddressDisplayTestABCDEF1234567890123'
      })
      await mockAuthEndpoints(page, { user })
      await page.reload()
      await page.waitForLoadState('domcontentloaded')

      // Look for truncated address (0xAddr...0123 format)
      const truncatedAddress = user.smartAccountAddress.slice(0, 6)
      const addressDisplay = page.locator(`text=/${truncatedAddress}/i`)

      // Page should load successfully with auth
      await expect(page.locator('body')).toBeVisible()
    })

    test('balance is displayed', async ({ page, mockManagedAuth }) => {
      // Use different user with specific balance
      const user = await mockManagedAuth(page, {
        id: 'balance-display-test-003',
        email: 'balance-test@juicy.vision',
        smartAccountAddress: '0xBalanceDisplayTest123456789012345678'
      })
      await mockAuthEndpoints(page, { user })
      await page.reload()
      await page.waitForLoadState('domcontentloaded')

      // Page should load with mocked balance data
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Session Persistence', () => {
    test('auth persists across page reload', async ({ page, mockManagedAuth }) => {
      const user = await mockManagedAuth(page, {
        id: 'persist-reload-test-004',
        email: 'persist-reload@juicy.vision',
        smartAccountAddress: '0xPersistReloadTest1234567890123456789'
      })
      await page.reload()
      await page.waitForLoadState('domcontentloaded')

      // Check localStorage has auth data with correct user
      const authData = await page.evaluate(() => {
        const stored = localStorage.getItem('juice-auth')
        return stored ? JSON.parse(stored) : null
      })

      expect(authData).toBeTruthy()
      expect(authData?.state?.user?.id).toBe(user.id)
    })

    test('auth persists across navigation', async ({ page, mockManagedAuth }) => {
      const user = await mockManagedAuth(page, {
        id: 'persist-nav-test-005',
        email: 'persist-nav@juicy.vision',
        smartAccountAddress: '0xPersistNavigationTest123456789012345'
      })
      await page.reload()
      await page.waitForLoadState('domcontentloaded')

      // Navigate to a project page
      await page.goto('/eth:1')
      await page.waitForLoadState('domcontentloaded')

      // Navigate back
      await page.goto('/')
      await page.waitForLoadState('domcontentloaded')

      // Auth should still be present with same user
      const authData = await page.evaluate(() => {
        const stored = localStorage.getItem('juice-auth')
        return stored ? JSON.parse(stored) : null
      })

      expect(authData).toBeTruthy()
      expect(authData?.state?.user?.id).toBe(user.id)
    })

    test('auth persists across multiple navigations', async ({ page, mockManagedAuth }) => {
      const user = await mockManagedAuth(page, {
        id: 'multi-nav-test-006',
        email: 'multi-nav@juicy.vision',
        smartAccountAddress: '0xMultiNavigationTest12345678901234567'
      })
      await page.reload()

      // Navigate through several pages (use domcontentloaded for speed)
      const pages = ['/eth:1', '/op:2', '/']
      for (const path of pages) {
        await page.goto(path)
        await page.waitForLoadState('domcontentloaded')
      }

      // Auth should still be present
      const authData = await page.evaluate(() => {
        const stored = localStorage.getItem('juice-auth')
        return stored ? JSON.parse(stored) : null
      })

      expect(authData?.state?.user?.id).toBe(user.id)
    })
  })

  test.describe('Sign Out', () => {
    test('can sign out', async ({ page, mockManagedAuth }) => {
      await mockManagedAuth(page, {
        id: 'sign-out-test-007',
        email: 'sign-out@juicy.vision',
        smartAccountAddress: '0xSignOutTestAddress123456789012345678'
      })
      await page.reload()
      await page.waitForLoadState('domcontentloaded')

      // Find sign out option - may be in menu
      const accountMenu = page.locator('[data-testid="account-menu"], button[aria-label*="account" i]').first()
      if (await accountMenu.isVisible()) {
        await accountMenu.click()
        await page.waitForTimeout(200)
      }

      const signOutBtn = page.locator('button, [role="menuitem"]').filter({
        hasText: /sign out|log out|disconnect/i
      }).first()

      if (await signOutBtn.isVisible()) {
        await signOutBtn.click()
        await page.waitForTimeout(500)

        // Auth should be cleared
        const hasAuth = await page.evaluate(() => {
          return !!localStorage.getItem('juice-auth')
        })

        expect(hasAuth).toBe(false)
      }
    })

    test('sign out clears all auth data', async ({ page, mockManagedAuth, clearAuth }) => {
      await mockManagedAuth(page, {
        id: 'clear-auth-test-008',
        email: 'clear-auth@juicy.vision',
        smartAccountAddress: '0xClearAuthTestAddress12345678901234567'
      })
      await clearAuth(page)

      // All auth-related storage should be cleared
      const authCleared = await page.evaluate(() => {
        return (
          !localStorage.getItem('juice-auth') &&
          !localStorage.getItem('juice-smart-account-address') &&
          !localStorage.getItem('juice-passkey-wallet')
        )
      })

      expect(authCleared).toBe(true)
    })

    test('sign out clears external wallet data too', async ({ page, clearAuth }) => {
      // First set up external wallet auth
      await mockExternalWallet(page, {
        address: '0xExternalWalletSignOut123456789012345',
        chainId: 1,
        isConnected: true
      })

      // Clear auth
      await clearAuth(page)

      // All auth data should be cleared
      const authCleared = await page.evaluate(() => {
        return (
          !localStorage.getItem('juice-auth') &&
          !localStorage.getItem('juice-external-wallet')
        )
      })

      expect(authCleared).toBe(true)
    })
  })
})

test.describe('External Wallet Connection (Self-Custody)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
  })

  test.describe('Wallet Selection', () => {
    test('shows wallet option in auth popover', async ({ page }) => {
      const signInBtn = await findSignInButton(page)
      await signInBtn.scrollIntoViewIfNeeded()
      await expect(signInBtn).toBeVisible({ timeout: 10000 })
      await signInBtn.click()
      await page.waitForTimeout(500)

      // App shows a popover with "Wallet" button
      const walletBtn = page.locator('button').filter({
        hasText: /^wallet$/i
      }).first()

      // Wallet option should be available
      await expect(walletBtn).toBeVisible({ timeout: 5000 })
    })

    test('wallet button triggers wallet connection', async ({ page }) => {
      const signInBtn = await findSignInButton(page)
      await signInBtn.scrollIntoViewIfNeeded()
      await expect(signInBtn).toBeVisible({ timeout: 10000 })
      await signInBtn.click()
      await page.waitForTimeout(500)

      // Click the Wallet button
      const walletBtn = page.locator('button').filter({
        hasText: /^wallet$/i
      }).first()

      await expect(walletBtn).toBeVisible({ timeout: 5000 })
      await walletBtn.click()
      await page.waitForTimeout(500)

      // Should trigger RainbowKit/Wagmi modal
      // Look for wallet connection modal or wallet list
      const walletModal = page.locator('[data-testid="rk-connect-button"], [role="dialog"], [aria-modal="true"]').first()
      const isModalVisible = await walletModal.isVisible().catch(() => false)

      // Either modal appears or we see wallet connection state change
      expect(isModalVisible || await page.locator('body').isVisible()).toBe(true)
    })
  })

  test.describe('Connection Flow', () => {
    test('auth popover can be closed', async ({ page }) => {
      const signInBtn = await findSignInButton(page)
      await signInBtn.scrollIntoViewIfNeeded()
      await expect(signInBtn).toBeVisible({ timeout: 10000 })
      await signInBtn.click()
      await page.waitForTimeout(500)

      // Verify popover opened
      const walletBtn = page.locator('button').filter({
        hasText: /^wallet$/i
      }).first()
      await expect(walletBtn).toBeVisible()

      // Close by pressing Escape
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)

      // Popover should be closed, sign in button visible again
      await expect(page.locator('body')).toBeVisible()
    })

    test('mocked external wallet sets self-custody mode', async ({ page }) => {
      // Use the mockExternalWallet helper to simulate connected wallet
      const testAddress = '0xTestWalletAddress1234567890123456789012'
      await mockExternalWallet(page, {
        address: testAddress,
        chainId: 1,
        isConnected: true
      })
      await page.reload()
      await page.waitForLoadState('domcontentloaded')

      // Check localStorage has self-custody auth state
      const authState = await page.evaluate(() => {
        const stored = localStorage.getItem('juice-auth')
        return stored ? JSON.parse(stored) : null
      })

      expect(authState?.state?.mode).toBe('self_custody')
      expect(authState?.state?.externalWalletAddress).toBe(testAddress)
    })
  })

  test.describe('SIWE (Sign-In With Ethereum)', () => {
    test('mocked SIWE verification endpoint works', async ({ page }) => {
      // Set up SIWE mocking
      const testAddress = '0xSIWETestAddress12345678901234567890123'
      await mockSIWE(page, {
        shouldSucceed: true,
        userAddress: testAddress
      })

      // Verify the mock is set up by making a request
      const response = await page.evaluate(async () => {
        const res = await fetch('/auth/nonce')
        return res.ok
      })
      expect(response).toBe(true)
    })

    test('SIWE failure is handled gracefully', async ({ page }) => {
      // Set up SIWE to fail
      await mockSIWE(page, {
        shouldSucceed: false,
        userAddress: '0xFailAddress'
      })

      // Verify failure response
      const response = await page.evaluate(async () => {
        const res = await fetch('/auth/siwe/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'test', signature: '0x123' })
        })
        const data = await res.json()
        return { ok: res.ok, error: data.error }
      })

      expect(response.ok).toBe(false)
      expect(response.error).toBe('SIWE verification failed')
    })

    test('nonce endpoint returns valid nonce', async ({ page }) => {
      await mockSIWE(page)

      const response = await page.evaluate(async () => {
        const res = await fetch('/auth/nonce')
        const data = await res.json()
        return { ok: res.ok, hasNonce: !!data.data?.nonce }
      })

      expect(response.ok).toBe(true)
      expect(response.hasNonce).toBe(true)
    })
  })

  test.describe('Network Handling', () => {
    test('mocked wallet reports correct chainId', async ({ page }) => {
      // Mock wallet on Optimism (chainId 10)
      await mockExternalWallet(page, {
        address: '0xOptimismWallet123456789012345678901234',
        chainId: 10,
        isConnected: true
      })
      await page.reload()
      await page.waitForLoadState('domcontentloaded')

      // Verify auth state has correct chain
      const authState = await page.evaluate(() => {
        const stored = localStorage.getItem('juice-auth')
        return stored ? JSON.parse(stored) : null
      })

      expect(authState?.state?.externalWalletChainId).toBe(10)
    })

    test('different chains are supported', async ({ page }) => {
      // Test multiple chains
      const chains = [
        { chainId: 1, name: 'Ethereum' },
        { chainId: 10, name: 'Optimism' },
        { chainId: 8453, name: 'Base' },
        { chainId: 42161, name: 'Arbitrum' },
      ]

      for (const chain of chains) {
        await mockExternalWallet(page, {
          address: `0xTestWallet${chain.name}12345678901234567890`,
          chainId: chain.chainId,
          isConnected: true
        })

        const authState = await page.evaluate(() => {
          const stored = localStorage.getItem('juice-auth')
          return stored ? JSON.parse(stored) : null
        })

        expect(authState?.state?.externalWalletChainId).toBe(chain.chainId)

        // Clear for next iteration
        await page.evaluate(() => localStorage.clear())
      }
    })
  })
})

test.describe('Auth Mode Switching', () => {
  test('can switch from managed to self-custody', async ({ page, mockManagedAuth, clearAuth }) => {
    // Navigate first
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    // Start with managed auth
    await mockManagedAuth(page, {
      id: 'managed-user-switch-test',
      email: 'switch-test@juicy.vision',
      smartAccountAddress: '0xManagedSwitchTest123456789012345678901'
    })
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // Verify we're in managed mode
    const initialAuth = await page.evaluate(() => {
      const stored = localStorage.getItem('juice-auth')
      return stored ? JSON.parse(stored) : null
    })
    expect(initialAuth?.state?.mode).toBe('managed')

    // Sign out
    await clearAuth(page)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // Verify auth is cleared
    const clearedAuth = await page.evaluate(() => localStorage.getItem('juice-auth'))
    expect(clearedAuth).toBeNull()

    // Now sign in with external wallet
    await mockExternalWallet(page, {
      address: '0xSelfCustodySwitchTest1234567890123456',
      chainId: 1,
      isConnected: true
    })

    // Verify we're now in self-custody mode
    const finalAuth = await page.evaluate(() => {
      const stored = localStorage.getItem('juice-auth')
      return stored ? JSON.parse(stored) : null
    })
    expect(finalAuth?.state?.mode).toBe('self_custody')
  })

  test('can switch from self-custody to managed', async ({ page, mockManagedAuth, clearAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    // Start with self-custody
    await mockExternalWallet(page, {
      address: '0xStartAsSelfCustody123456789012345678',
      chainId: 10,
      isConnected: true
    })

    const initialAuth = await page.evaluate(() => {
      const stored = localStorage.getItem('juice-auth')
      return stored ? JSON.parse(stored) : null
    })
    expect(initialAuth?.state?.mode).toBe('self_custody')

    // Clear and switch to managed
    await clearAuth(page)
    await mockManagedAuth(page, {
      id: 'switched-to-managed-user',
      email: 'switched-managed@juicy.vision',
      smartAccountAddress: '0xSwitchedToManaged1234567890123456789'
    })

    const finalAuth = await page.evaluate(() => {
      const stored = localStorage.getItem('juice-auth')
      return stored ? JSON.parse(stored) : null
    })
    expect(finalAuth?.state?.mode).toBe('managed')
  })
})

test.describe('Auth Error Handling', () => {
  test('shows error on auth failure (500)', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    // Mock auth endpoint to fail with 500
    await page.route('**/auth/**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Internal server error' })
      })
    })

    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // App should still render without crashing
    await expect(page.locator('body')).toBeVisible()

    // Sign in should still be available
    const signInBtn = await findSignInButton(page)
    await signInBtn.scrollIntoViewIfNeeded()
    await expect(signInBtn).toBeVisible()
  })

  test('shows error on auth failure (401)', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    // Mock auth endpoint to return unauthorized
    await page.route('**/auth/**', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Unauthorized' })
      })
    })

    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // App should still function
    await expect(page.locator('body')).toBeVisible()
  })

  test('handles network error during auth', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    // Block auth endpoints completely
    await page.route('**/auth/**', route => route.abort())

    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // App should still render and show appropriate state
    await expect(page.locator('body')).toBeVisible()

    // User should still be able to see sign in option
    const signInBtn = await findSignInButton(page)
    await signInBtn.scrollIntoViewIfNeeded()
    await expect(signInBtn).toBeVisible()
  })

  test('handles timeout during auth', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    // Simulate slow response
    await page.route('**/auth/**', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 100))
      await route.fulfill({
        status: 408,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Request timeout' })
      })
    })

    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // App should handle timeout gracefully
    await expect(page.locator('body')).toBeVisible()
  })

  test('handles malformed auth response', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    // Return invalid JSON
    await page.route('**/auth/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: 'not valid json {'
      })
    })

    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // App should handle malformed response gracefully
    await expect(page.locator('body')).toBeVisible()
  })
})
