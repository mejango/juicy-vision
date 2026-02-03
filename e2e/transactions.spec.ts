import { test, expect } from '@playwright/test'

test.describe('Transaction & Payment Flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test.describe('Chat Payment Intent', () => {
    test('chat input accepts payment-related queries', async ({ page }) => {
      await page.goto('/')

      const chatInput = page.locator('textarea').first()
      await expect(chatInput).toBeVisible()

      await chatInput.fill('I want to pay project 123')
      await expect(chatInput).toHaveValue('I want to pay project 123')
    })
  })

  test.describe('Disconnected Payment Guards', () => {
    test('no ETH balance shown without wallet', async ({ page }) => {
      await page.goto('/')

      // Without wallet, should not show ETH balance
      const ethBalance = page.locator('text=/[0-9]+\.[0-9]+ ETH/i')
      await expect(ethBalance).not.toBeVisible()
    })

    test('no transaction hash visible on fresh load', async ({ page }) => {
      await page.goto('/')

      // No transaction hash should be visible
      const txHash = page.locator('text=/0x[a-fA-F0-9]{64}/')
      await expect(txHash).not.toBeVisible()
    })

    test('no error state on fresh load', async ({ page }) => {
      await page.goto('/')

      // Should not show transaction error states
      const errorIndicator = page.locator('[data-status="failed"], .status-failed, .error-message')
      await expect(errorIndicator).not.toBeVisible()
    })
  })

  test.describe('UI Without Active Transaction', () => {
    test('transaction preview not visible without context', async ({ page }) => {
      await page.goto('/')

      // Transaction preview only appears after AI suggests one
      const transactionPreview = page.locator('[data-testid="transaction-preview"]')
      await expect(transactionPreview).not.toBeVisible()
    })

    test('pending transaction indicators not visible', async ({ page }) => {
      await page.goto('/')

      // No pending indicators on fresh load
      const pendingIndicator = page.locator('[data-status="pending"], .status-pending')
      await expect(pendingIndicator).not.toBeVisible()
    })
  })

  test.describe('Responsive Layout', () => {
    test('no horizontal scroll on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 })
      await page.goto('/')

      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth
      })

      expect(hasHorizontalScroll).toBe(false)
    })

    test('readable font size on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 })
      await page.goto('/')

      const bodyFontSize = await page.evaluate(() => {
        return parseInt(window.getComputedStyle(document.body).fontSize)
      })

      // Font should be at least 14px for readability
      expect(bodyFontSize).toBeGreaterThanOrEqual(14)
    })

    test('chat input accessible on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 })
      await page.goto('/')

      const chatInput = page.locator('textarea').first()
      await expect(chatInput).toBeVisible()

      // Should be able to type
      await chatInput.fill('Mobile test')
      await expect(chatInput).toHaveValue('Mobile test')
    })
  })

  test.describe('Chain Display', () => {
    test('app loads without chain selection errors', async ({ page }) => {
      await page.goto('/')

      // App should load successfully
      await expect(page.locator('.border-juice-orange')).toBeVisible()

      // No chain-related error messages
      const chainError = page.locator('text=/unsupported chain|wrong network/i')
      await expect(chainError).not.toBeVisible()
    })
  })

  test.describe('Amount Validation UI', () => {
    test('amount inputs accept numeric values', async ({ page }) => {
      await page.goto('/')

      // If there's an amount input visible (e.g., in a payment form)
      const amountInput = page.locator('input[type="number"]').first()

      if (await amountInput.isVisible()) {
        await amountInput.fill('100')
        await expect(amountInput).toHaveValue('100')

        // Clear and try decimal
        await amountInput.fill('10.5')
        await expect(amountInput).toHaveValue('10.5')
      }
    })
  })

  test.describe('App Stability', () => {
    test('survives rapid navigation', async ({ page }) => {
      await page.goto('/')
      await expect(page.locator('.border-juice-orange')).toBeVisible()

      // Navigate away and back
      await page.goto('/#/some-route')
      await page.goto('/')

      // App should still work
      await expect(page.locator('.border-juice-orange')).toBeVisible()
      await expect(page.locator('textarea').first()).toBeVisible()
    })

    test('handles page refresh gracefully', async ({ page }) => {
      await page.goto('/')

      const chatInput = page.locator('textarea').first()
      await chatInput.fill('Pre-refresh message')

      await page.reload()

      // App should recover
      await expect(page.locator('.border-juice-orange')).toBeVisible()
    })
  })
})
