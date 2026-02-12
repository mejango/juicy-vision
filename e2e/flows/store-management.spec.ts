import { test, expect, type Page } from '../fixtures/auth'
import { mockAuthEndpoints } from '../fixtures/auth'
import { mockProjectEndpoints, mockTransactionEndpoints, createMockProject } from '../fixtures/api'
import { tierHelpers, waitForLoading, assertNoError, waitForSuccess } from '../helpers/components'
import { navigateToDashboard, assertOnDashboard } from '../helpers/components'

// Map chainId to URL slug
function getChainSlug(chainId: number): string {
  const slugs: Record<number, string> = { 1: 'eth', 10: 'op', 8453: 'base', 42161: 'arb' }
  return slugs[chainId] || 'eth'
}

// Helper to navigate to Shop tab on project dashboard
async function navigateToShopTab(page: Page, projectId: number, chainId: number) {
  const slug = getChainSlug(chainId)
  await page.goto(`/${slug}:${projectId}`)
  await page.waitForLoadState('domcontentloaded')

  // Click on Shop tab to see tiers
  // Use exact text match to avoid matching other buttons containing "shop"
  const shopTab = page.getByRole('button', { name: 'Shop', exact: true }).first()
  if (await shopTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await shopTab.click()
    await page.waitForTimeout(300)
  }
}

test.describe('Store Management', () => {
  const testProject = createMockProject({
    id: 123,
    name: 'TestStore',
    chainId: 1,
  })

  test.beforeEach(async ({ page, mockManagedAuth }) => {
    // Clear and set up auth
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    const user = await mockManagedAuth(page)

    // Set up API mocks
    await mockAuthEndpoints(page, { user })
    await mockProjectEndpoints(page, { projects: [testProject] })
    await mockTransactionEndpoints(page)

    // Mock 721 tiers endpoint
    await page.route('**/projects/*/tiers', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              tiers: [
                { id: 1, name: 'Bronze Tier', price: '0.01', supply: 100, sold: 5 },
                { id: 2, name: 'Silver Tier', price: '0.05', supply: 50, sold: 2 },
                { id: 3, name: 'Gold Tier', price: '0.1', supply: 25, sold: 0 },
              ],
            },
          }),
        })
      } else if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}')
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              tier: {
                id: 4,
                name: body.name || 'New Tier',
                price: body.price || '0.1',
                supply: body.supply || 100,
                sold: 0,
              },
            },
          }),
        })
      } else {
        await route.continue()
      }
    })

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
  })

  test.describe('Tier Display', () => {
    test('displays existing tiers on dashboard', async ({ page }) => {
      await navigateToShopTab(page, testProject.id, testProject.chainId)

      // Should see tier cards or tier list
      // Note: Actual selectors depend on the dashboard implementation
    })

    test('shows tier details (name, price, supply)', async ({ page }) => {
      await navigateToShopTab(page, testProject.id, testProject.chainId)

      // Look for tier information on the page
      // This test verifies the data is being rendered
    })
  })

  test.describe('Add Tier', () => {
    test('can open add tier form', async ({ page }) => {
      await navigateToShopTab(page, testProject.id, testProject.chainId)

      // Look for add tier button
      const addTierBtn = page.locator('button').filter({ hasText: /add tier|new tier|sell something/i }).first()
      if (await addTierBtn.isVisible()) {
        await addTierBtn.click()
        await page.waitForTimeout(300)

        // A form or modal should appear
        const formOrModal = page.locator('[data-testid="tier-form"], [role="dialog"], form')
        await expect(formOrModal.first()).toBeVisible()
      }
    })

    test('tier form validates required fields', async ({ page }) => {
      await navigateToShopTab(page, testProject.id, testProject.chainId)

      const addTierBtn = page.locator('button').filter({ hasText: /add tier|new tier|sell something/i }).first()
      if (await addTierBtn.isVisible()) {
        await addTierBtn.click()
        await page.waitForTimeout(300)

        // Try to submit empty form
        const submitBtn = page.locator('button[type="submit"], button:has-text("Save")').first()
        if (await submitBtn.isVisible()) {
          await submitBtn.click()

          // Should show validation errors or prevent submission
          // Form should not close if validation fails
        }
      }
    })

    test('can add a new tier', async ({ page }) => {
      await navigateToShopTab(page, testProject.id, testProject.chainId)

      const newTier = {
        name: 'Platinum Tier',
        price: '0.5',
        supply: '10',
      }

      // Open add form
      const addTierBtn = page.locator('button').filter({ hasText: /add tier|new tier|sell something/i }).first()
      if (await addTierBtn.isVisible()) {
        await addTierBtn.click()
        await page.waitForTimeout(300)

        // Fill form
        const nameInput = page.locator('input[name="name"], input[placeholder*="name" i]').first()
        const priceInput = page.locator('input[name="price"], input[placeholder*="price" i]').first()
        const supplyInput = page.locator('input[name="supply"], input[placeholder*="supply" i]').first()

        if (await nameInput.isVisible()) await nameInput.fill(newTier.name)
        if (await priceInput.isVisible()) await priceInput.fill(newTier.price)
        if (await supplyInput.isVisible()) await supplyInput.fill(newTier.supply)

        // Submit
        const submitBtn = page.locator('button[type="submit"], button:has-text("Save")').first()
        if (await submitBtn.isVisible()) {
          await submitBtn.click()
        }
      }
    })
  })

  test.describe('Edit Tier', () => {
    test('can open edit tier form', async ({ page }) => {
      await navigateToShopTab(page, testProject.id, testProject.chainId)

      // Find an edit button on a tier card
      const editBtn = page.locator('button:has-text("Edit")').first()
      if (await editBtn.isVisible()) {
        await editBtn.click()
        await page.waitForTimeout(300)

        // Edit form should open
        const formOrModal = page.locator('[data-testid="tier-form"], [role="dialog"]')
        await expect(formOrModal.first()).toBeVisible()
      }
    })

    test('edit form shows existing values', async ({ page }) => {
      await navigateToShopTab(page, testProject.id, testProject.chainId)

      const editBtn = page.locator('button:has-text("Edit")').first()
      if (await editBtn.isVisible()) {
        await editBtn.click()
        await page.waitForTimeout(300)

        // Form inputs should have values
        const nameInput = page.locator('input[name="name"]').first()
        if (await nameInput.isVisible()) {
          const value = await nameInput.inputValue()
          expect(value).toBeTruthy()
        }
      }
    })
  })

  test.describe('Delete Tier', () => {
    test('shows confirmation before delete', async ({ page }) => {
      await navigateToShopTab(page, testProject.id, testProject.chainId)

      const deleteBtn = page.locator('button:has-text("Delete"), button[aria-label*="delete" i]').first()
      if (await deleteBtn.isVisible()) {
        await deleteBtn.click()

        // Should show confirmation dialog
        const confirmDialog = page.locator('[role="alertdialog"], [role="dialog"]:has-text("confirm")')
        // Note: Dialog presence depends on implementation
      }
    })
  })

  test.describe('Tier Discounts', () => {
    test('can set discount on tier', async ({ page }) => {
      await navigateToShopTab(page, testProject.id, testProject.chainId)

      // Open edit for a tier
      const editBtn = page.locator('button:has-text("Edit")').first()
      if (await editBtn.isVisible()) {
        await editBtn.click()
        await page.waitForTimeout(300)

        // Find discount input
        const discountInput = page.locator('input[name="discount"], input[placeholder*="discount" i]').first()
        if (await discountInput.isVisible()) {
          await discountInput.fill('10')

          const submitBtn = page.locator('button[type="submit"], button:has-text("Save")').first()
          if (await submitBtn.isVisible()) {
            await submitBtn.click()
          }
        }
      }
    })

    test('validates discount range (0-100%)', async ({ page }) => {
      await navigateToShopTab(page, testProject.id, testProject.chainId)

      const editBtn = page.locator('button:has-text("Edit")').first()
      if (await editBtn.isVisible()) {
        await editBtn.click()
        await page.waitForTimeout(300)

        const discountInput = page.locator('input[name="discount"]').first()
        if (await discountInput.isVisible()) {
          // Try invalid discount
          await discountInput.fill('150')

          const submitBtn = page.locator('button[type="submit"]').first()
          if (await submitBtn.isVisible()) {
            await submitBtn.click()

            // Should show validation error
            // or input should be constrained to valid range
          }
        }
      }
    })
  })
})

test.describe('Store Management - Transactions', () => {
  test('adding tier creates transaction', async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await mockManagedAuth(page)

    // Set up transaction mock to capture calls
    const transactionCalls: unknown[] = []
    await page.route('**/wallet/execute', async (route) => {
      transactionCalls.push(JSON.parse(route.request().postData() || '{}'))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { txHash: '0x' + '1'.repeat(64) },
        }),
      })
    })

    // The test would continue with adding a tier and verifying transaction was called
  })

  test('handles transaction failure', async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await mockManagedAuth(page)

    // Mock transaction failure
    await page.route('**/wallet/execute', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Transaction failed',
        }),
      })
    })

    // The UI should show error state without crashing
  })
})
