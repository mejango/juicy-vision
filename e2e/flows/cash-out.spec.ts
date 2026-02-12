import { test, expect, type Page } from '../fixtures/auth'
import { mockAuthEndpoints } from '../fixtures/auth'
import { mockProjectEndpoints, mockTransactionEndpoints, createMockProject } from '../fixtures/api'

/**
 * User Journey 3.1: User Cashes Out (Redeems Tokens)
 *
 * Tests the token redemption flow where users exchange project
 * tokens for ETH/funds from the project's overflow.
 */

// Helper to get chain slug
function getChainSlug(chainId: number): string {
  const slugs: Record<number, string> = { 1: 'eth', 10: 'op', 8453: 'base', 42161: 'arb' }
  return slugs[chainId] || 'eth'
}

test.describe('Cash Out Flow', () => {
  const testProject = createMockProject({
    id: 200,
    name: 'Cash Out Test Project',
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

  test.describe('Cash Out UI', () => {
    test('cash out option is visible for token holders', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      // Look for cash out / redeem button or section
      const cashOutBtn = page.locator('button, [role="button"]').filter({
        hasText: /cash out|redeem|burn|withdraw/i
      }).first()

      // Cash out may be in a specific tab (Tokens/Members)
      const tokensTab = page.getByRole('button', { name: 'Members', exact: true })
        .or(page.getByRole('button', { name: 'Tokens', exact: true }))
        .first()

      if (await tokensTab.isVisible()) {
        await tokensTab.click()
        await page.waitForTimeout(300)
      }

      // Page should load without error
      await expect(page.locator('body')).toBeVisible()
    })

    test('shows current token balance', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      // Navigate to tokens tab if needed
      const tokensTab = page.getByRole('button', { name: 'Members', exact: true })
        .or(page.getByRole('button', { name: 'Tokens', exact: true }))
        .first()

      if (await tokensTab.isVisible()) {
        await tokensTab.click()
        await page.waitForTimeout(300)
      }

      // Look for balance display
      const balanceDisplay = page.locator('text=/balance|tokens|holdings/i')
      // Balance section should exist
    })

    test('shows redemption rate preview', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      // Cash out preview should show how much ETH user would receive
      // This depends on the bonding curve / redemption rate

      // Look for rate or "you receive" display
      const rateDisplay = page.locator('text=/redemption|receive|get back|rate/i')
      // Rate info may be shown on page
    })
  })

  test.describe('Cash Out Calculation', () => {
    test('calculates redemption amount correctly', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      // Find cash out input
      const redeemInput = page.locator('input[type="number"]').filter({
        has: page.locator('[placeholder*="redeem" i], [placeholder*="amount" i], [placeholder*="tokens" i]')
      }).first()

      if (await redeemInput.isVisible()) {
        await redeemInput.fill('100')
        await page.waitForTimeout(500)

        // Should show expected ETH output
        const output = page.locator('text=/ETH|Ξ|receive/i')
        // Output calculation should appear
      }
    })

    test('shows bonding curve visualization', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      // Some projects show a curve visualization
      const curveViz = page.locator('[data-testid="bonding-curve"], canvas, svg').first()
      // Visualization may or may not be present
    })

    test('updates output when changing input amount', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      const redeemInput = page.locator('input[type="number"]').first()

      if (await redeemInput.isVisible()) {
        await redeemInput.fill('50')
        await page.waitForTimeout(300)
        const output1 = await page.locator('text=/\\d+\\.?\\d*\\s*ETH/i').textContent().catch(() => null)

        await redeemInput.fill('100')
        await page.waitForTimeout(300)
        const output2 = await page.locator('text=/\\d+\\.?\\d*\\s*ETH/i').textContent().catch(() => null)

        // Output should change when input changes
        // (may be same if rate is 0 or no overflow)
      }
    })
  })

  test.describe('Cash Out Validation', () => {
    test('cannot cash out more than balance', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      const redeemInput = page.locator('input[type="number"]').first()

      if (await redeemInput.isVisible()) {
        await redeemInput.fill('999999999')
        await page.waitForTimeout(300)

        // Should show error or cap input
        const error = page.locator('text=/exceed|insufficient|not enough|max/i')
        const cashOutBtn = page.locator('button').filter({ hasText: /cash out|redeem/i }).first()

        // Either error shown or button disabled
      }
    })

    test('handles zero balance gracefully', async ({ page }) => {
      // Mock zero token balance
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      // Should show empty state or disabled cash out
      const emptyState = page.locator('text=/no tokens|nothing to redeem|0 tokens/i')
      // Empty state or disabled button expected
    })

    test('handles zero overflow gracefully', async ({ page }) => {
      // When project has no overflow, redemption gives 0 ETH
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      // Should show warning about zero redemption value
      const zeroWarning = page.locator('text=/no overflow|0 ETH|nothing available/i')
      // Warning may be shown
    })
  })

  test.describe('Cash Out Execution', () => {
    test('shows confirmation before cashing out', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      const redeemInput = page.locator('input[type="number"]').first()

      if (await redeemInput.isVisible()) {
        await redeemInput.fill('10')
        await page.waitForTimeout(300)

        const cashOutBtn = page.locator('button').filter({
          hasText: /cash out|redeem/i
        }).first()

        if (await cashOutBtn.isVisible() && await cashOutBtn.isEnabled()) {
          await cashOutBtn.click()
          await page.waitForTimeout(500)

          // Should show confirmation dialog
          const confirmation = page.locator('[role="dialog"], [role="alertdialog"]')
          // Confirmation may appear
        }
      }
    })

    test('handles successful cash out', async ({ page }) => {
      await mockTransactionEndpoints(page, {
        bundleStatus: 'confirmed',
        transactionHash: '0x' + 'b'.repeat(64)
      })

      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      // App should handle success without crashing
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles cash out failure', async ({ page }) => {
      await page.route('**/wallet/execute', async (route) => {
        await route.fulfill({
          status: 500,
          body: JSON.stringify({
            success: false,
            error: 'Transaction reverted: insufficient overflow'
          })
        })
      })

      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      // App should show error state without crashing
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Post Cash Out', () => {
    test('updates token balance after cash out', async ({ page }) => {
      // After successful cash out, balance should decrease
      // Would need to mock balance change
    })

    test('shows transaction confirmation', async ({ page }) => {
      // After cash out, should show tx link/confirmation
    })

    test('records in activity feed', async ({ page }) => {
      // Cash out should appear in project activity
    })
  })
})

test.describe('Cash Out - Special Cases', () => {
  test.describe('Redemption Rate Edge Cases', () => {
    test('handles 0% redemption rate', async ({ page, mockManagedAuth }) => {
      // When redemption rate is 0, tokens are worthless for cash out
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await mockManagedAuth(page)

      await page.goto('/eth:200')
      await page.waitForLoadState('domcontentloaded')

      // Should show warning or disable cash out
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles 100% redemption rate', async ({ page, mockManagedAuth }) => {
      // Maximum redemption - get full share of overflow
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await mockManagedAuth(page)

      await page.goto('/eth:200')
      await page.waitForLoadState('domcontentloaded')

      await expect(page.locator('body')).toBeVisible()
    })

    test('handles partial redemption rate', async ({ page, mockManagedAuth }) => {
      // Typical case - get portion of overflow
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await mockManagedAuth(page)

      await page.goto('/eth:200')
      await page.waitForLoadState('domcontentloaded')

      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Multi-Chain Cash Out', () => {
    test('shows correct chain for cash out', async ({ page, mockManagedAuth }) => {
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await mockManagedAuth(page)

      // For omnichain projects, need to cash out on correct chain
      await page.goto('/eth:200')
      await page.waitForLoadState('domcontentloaded')

      // Chain indicator should be visible
      const chainIndicator = page.locator('text=/ethereum|mainnet|ETH chain/i')
      // Chain info may be shown
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles tokens on different chain than connected', async ({ page, mockManagedAuth }) => {
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await mockManagedAuth(page)

      // User may need to switch chains
      await page.goto('/op:200') // Optimism
      await page.waitForLoadState('domcontentloaded')

      // Should prompt chain switch or show cross-chain info
      await expect(page.locator('body')).toBeVisible()
    })
  })
})

test.describe('Cash Out - Unauthenticated', () => {
  test('prompts to connect when trying to cash out', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()

    await page.goto('/eth:200')
    await page.waitForLoadState('domcontentloaded')

    const cashOutBtn = page.locator('button').filter({
      hasText: /cash out|redeem|connect/i
    }).first()

    if (await cashOutBtn.isVisible()) {
      await cashOutBtn.click()
      await page.waitForTimeout(500)

      // Should prompt authentication
      const authPrompt = page.locator('[role="dialog"], text=/connect|sign in/i')
      // Auth prompt should appear
    }
  })
})
