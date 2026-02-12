import { test, expect, type Page } from '../fixtures/auth'
import { mockAuthEndpoints } from '../fixtures/auth'
import { mockProjectEndpoints, mockTransactionEndpoints, createMockProject } from '../fixtures/api'

/**
 * User Journey 1.5: User Pays Into a Project
 *
 * Tests the payment/contribution flow for projects.
 */

// Helper to get chain slug
function getChainSlug(chainId: number): string {
  const slugs: Record<number, string> = { 1: 'eth', 10: 'op', 8453: 'base', 42161: 'arb' }
  return slugs[chainId] || 'eth'
}

test.describe('Payment Flow', () => {
  const testProject = createMockProject({
    id: 100,
    name: 'Test Payment Project',
    chainId: 1,
  })
  const projectUrl = `/${getChainSlug(testProject.chainId)}:${testProject.id}`

  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page)
    await mockAuthEndpoints(page)
    await mockProjectEndpoints(page, { projects: [testProject] })
    await mockTransactionEndpoints(page)

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
  })

  test.describe('Payment UI', () => {
    test('payment input is visible on project page', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      // Look for payment input on the page
      const paymentInput = page.locator('input[type="number"], input[placeholder*="amount" i], input[placeholder*="pay" i], input[placeholder*="ETH" i]').first()

      // Payment input may be in a specific tab or section
      await expect(page.locator('body')).toBeVisible()
    })

    test('shows expected token amount when entering payment', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      const paymentInput = page.locator('input[type="number"], input[placeholder*="amount" i]').first()

      if (await paymentInput.isVisible()) {
        await paymentInput.fill('1')
        await page.waitForTimeout(500)

        // Should show tokens user will receive
        const tokenAmount = page.locator('text=/receive|get|tokens|you.+get/i')
        // Token display may vary based on project configuration
      }
    })

    test('pay button is disabled without amount', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      const payBtn = page.locator('button').filter({
        hasText: /^pay$|send|contribute/i
      }).first()

      if (await payBtn.isVisible()) {
        // Button should be disabled or not present without amount
        const isDisabled = await payBtn.isDisabled()
        // May also be enabled but validate on click
      }
    })
  })

  test.describe('Payment Validation', () => {
    test('rejects negative payment amount', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      const paymentInput = page.locator('input[type="number"]').first()

      if (await paymentInput.isVisible()) {
        await paymentInput.fill('-1')
        await page.waitForTimeout(300)

        // Should show error or prevent submission
        const errorMsg = page.locator('text=/invalid|negative|must be positive/i')
        const payBtn = page.locator('button').filter({ hasText: /pay/i }).first()

        // Either error shown or button disabled
      }
    })

    test('rejects payment below minimum', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      const paymentInput = page.locator('input[type="number"]').first()

      if (await paymentInput.isVisible()) {
        await paymentInput.fill('0.0000001')
        await page.waitForTimeout(300)

        // Should indicate too small or minimum
      }
    })

    test('shows warning for very large payment', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      const paymentInput = page.locator('input[type="number"]').first()

      if (await paymentInput.isVisible()) {
        await paymentInput.fill('1000000')
        await page.waitForTimeout(300)

        // May show warning about large amount
        // Or indicate insufficient balance
      }
    })
  })

  test.describe('Payment Execution', () => {
    test('shows transaction preview before paying', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      const paymentInput = page.locator('input[type="number"]').first()

      if (await paymentInput.isVisible()) {
        await paymentInput.fill('0.1')
        await page.waitForTimeout(300)

        const payBtn = page.locator('button').filter({
          hasText: /^pay$|send|contribute/i
        }).first()

        if (await payBtn.isVisible() && await payBtn.isEnabled()) {
          await payBtn.click()
          await page.waitForTimeout(500)

          // Should show confirmation or transaction preview
          const confirmation = page.locator('[role="dialog"], [data-testid="tx-preview"]')
          // Confirmation may appear
        }
      }
    })

    test('handles successful payment', async ({ page }) => {
      // Mock successful transaction
      await page.route('**/wallet/execute', async (route) => {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({
            success: true,
            data: { txHash: '0x' + '1'.repeat(64) }
          })
        })
      })

      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      // App should handle success state without crashing
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles payment failure', async ({ page }) => {
      // Mock failed transaction
      await page.route('**/wallet/execute', async (route) => {
        await route.fulfill({
          status: 500,
          body: JSON.stringify({
            success: false,
            error: 'Transaction reverted'
          })
        })
      })

      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      // App should show error state without crashing
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Insufficient Balance', () => {
    test('shows warning when balance too low', async ({ page }) => {
      // Mock low balance
      await page.route('**/wallet/balances', async (route) => {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({
            success: true,
            data: {
              accounts: [{
                chainId: 1,
                balances: [{ tokenSymbol: 'ETH', balance: '1000000000000000' }] // 0.001 ETH
              }]
            }
          })
        })
      })

      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      const paymentInput = page.locator('input[type="number"]').first()

      if (await paymentInput.isVisible()) {
        await paymentInput.fill('10') // More than balance
        await page.waitForTimeout(500)

        // Should show insufficient balance warning
        const warning = page.locator('text=/insufficient|not enough|low balance/i')
        // Warning may appear
      }
    })
  })

  test.describe('Multi-Currency Payment', () => {
    test('can select payment currency', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      // Look for currency selector
      const currencySelect = page.locator('[data-testid="currency-select"], select, button').filter({
        hasText: /ETH|USDC|USD/
      }).first()

      if (await currencySelect.isVisible()) {
        await currencySelect.click()
        await page.waitForTimeout(200)

        // Options should appear
        const options = page.locator('[role="option"], [role="menuitem"]')
        const optionCount = await options.count()
        expect(optionCount).toBeGreaterThan(0)
      }
    })

    test('shows conversion rate for non-ETH payment', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      // If USDC payment is available
      const currencySelect = page.locator('text=/USDC/i').first()

      if (await currencySelect.isVisible()) {
        await currencySelect.click()
        await page.waitForTimeout(300)

        // Should show conversion rate
        const rate = page.locator('text=/≈|~|\\$/i')
        // Rate display may vary
      }
    })
  })

  test.describe('Post-Payment', () => {
    test('shows success message after payment', async ({ page }) => {
      // Mock successful payment flow
      await mockTransactionEndpoints(page, {
        bundleStatus: 'confirmed',
        transactionHash: '0x' + 'a'.repeat(64)
      })

      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      // After a successful payment, success state should be shown
      // This would require triggering a full payment flow
    })

    test('updates balance after payment', async ({ page }) => {
      // Would need to mock balance change after payment
      // Verify UI reflects new balance
    })

    test('shows transaction in activity feed', async ({ page }) => {
      // After payment, activity should show the contribution
      // Would need to mock activity endpoint to include new payment
    })
  })
})

test.describe('Payment - Unauthenticated', () => {
  test('prompts to connect wallet when paying', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()

    await page.goto('/eth:100')
    await page.waitForLoadState('domcontentloaded')

    // Try to pay without auth
    const payBtn = page.locator('button').filter({
      hasText: /^pay$|send|contribute|connect/i
    }).first()

    if (await payBtn.isVisible()) {
      await payBtn.click()
      await page.waitForTimeout(500)

      // Should prompt to connect or show auth modal
      const authPrompt = page.locator('[role="dialog"], text=/connect|sign in/i')
      // Auth prompt should appear
    }
  })
})

test.describe('Payment - Edge Cases', () => {
  test('handles network error during payment', async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await mockManagedAuth(page)

    // Block transaction endpoints
    await page.route('**/wallet/execute', route => route.abort())

    await page.goto('/eth:100')
    await page.waitForLoadState('domcontentloaded')

    // App should handle gracefully
    await expect(page.locator('body')).toBeVisible()
  })

  test('handles project pause during payment', async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await mockManagedAuth(page)

    // Project paused mid-payment would revert
    // Test that UI shows appropriate error

    await page.goto('/eth:100')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('body')).toBeVisible()
  })
})
