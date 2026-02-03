import { test, expect } from '@playwright/test'

test.describe('Wallet & Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test.describe('Wallet Connection UI', () => {
    test('shows connect wallet button when not connected', async ({ page }) => {
      await page.goto('/')
      // Look for wallet connection UI elements
      const connectButton = page.locator('button').filter({ hasText: /connect|sign in/i }).first()
      await expect(connectButton).toBeVisible()
    })

    test('clicking connect button opens auth modal', async ({ page }) => {
      await page.goto('/')
      const connectButton = page.locator('button').filter({ hasText: /connect|sign in/i }).first()

      // Skip if no connect button (different UI state)
      if (!(await connectButton.isVisible())) {
        test.skip()
        return
      }

      await connectButton.click()
      await page.waitForTimeout(500)

      // Modal should appear with auth options
      const authModal = page.locator('[role="dialog"], [data-testid="auth-modal"], .modal')
      await expect(authModal).toBeVisible()
    })

    test('auth modal contains passkey option', async ({ page }) => {
      await page.goto('/')
      const connectButton = page.locator('button').filter({ hasText: /connect|sign in/i }).first()

      if (!(await connectButton.isVisible())) {
        test.skip()
        return
      }

      await connectButton.click()
      await page.waitForTimeout(500)

      // Should show passkey-related option
      const passkeyOption = page.locator('text=/passkey|biometric|face id|touch id/i')
      await expect(passkeyOption.first()).toBeVisible()
    })

    test('auth modal contains email option', async ({ page }) => {
      await page.goto('/')
      const connectButton = page.locator('button').filter({ hasText: /connect|sign in/i }).first()

      if (!(await connectButton.isVisible())) {
        test.skip()
        return
      }

      await connectButton.click()
      await page.waitForTimeout(500)

      // Should show email input or option
      const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]')
      await expect(emailInput.first()).toBeVisible()
    })
  })

  test.describe('Session Persistence', () => {
    test('anonymous session ID is stored in localStorage', async ({ page }) => {
      await page.goto('/')
      await page.waitForTimeout(1000)

      // Check localStorage for session data
      const sessionKeys = await page.evaluate(() => {
        return Object.keys(localStorage).filter(k =>
          k.includes('session') || k.includes('juice')
        )
      })

      // Should have at least one session-related key
      expect(sessionKeys.length).toBeGreaterThan(0)
    })

    test('app loads correctly after page reload', async ({ page }) => {
      await page.goto('/')

      // Type a message to create some state
      const chatInput = page.locator('textarea').first()
      if (await chatInput.isVisible()) {
        await chatInput.fill('Test message')
      }

      // Reload page
      await page.reload()

      // App should still work
      await expect(page.locator('.border-juice-orange')).toBeVisible()
      await expect(page.locator('textarea').first()).toBeVisible()
    })
  })

  test.describe('Wallet Address Display', () => {
    test('no wallet address shown when disconnected', async ({ page }) => {
      await page.goto('/')

      // Should not show a wallet address pattern when not connected
      const addressPattern = page.locator('text=/0x[a-fA-F0-9]{4}\.{3}[a-fA-F0-9]{4}/')
      await expect(addressPattern).not.toBeVisible()
    })
  })

  test.describe('Disconnected State', () => {
    test('app loads without wallet connection', async ({ page }) => {
      await page.goto('/')

      // App should load without errors
      await expect(page.locator('.border-juice-orange')).toBeVisible()

      // Chat input should be functional
      const chatInput = page.locator('textarea').first()
      await expect(chatInput).toBeVisible()
      await expect(chatInput).toBeEnabled()
    })

    test('can type in chat without wallet', async ({ page }) => {
      await page.goto('/')

      const chatInput = page.locator('textarea').first()
      await chatInput.fill('Hello without wallet')
      await expect(chatInput).toHaveValue('Hello without wallet')
    })
  })

  test.describe('Mobile Wallet UI', () => {
    test('auth button is accessible on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 })
      await page.goto('/')

      // App should render
      await expect(page.locator('.border-juice-orange')).toBeVisible()

      // Connect button should be within viewport
      const connectButton = page.locator('button').filter({ hasText: /connect|sign in/i }).first()
      if (await connectButton.isVisible()) {
        const box = await connectButton.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(375)
      }
    })

    test('no horizontal scroll on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 })
      await page.goto('/')

      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth
      })

      expect(hasHorizontalScroll).toBe(false)
    })
  })
})
