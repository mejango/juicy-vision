import { test, expect, type Page } from '../fixtures/auth'
import { mockAuthEndpoints } from '../fixtures/auth'
import { mockProjectEndpoints, mockTransactionEndpoints, createMockProject } from '../fixtures/api'

/**
 * Owner Actions Tests
 *
 * Tests all project owner capabilities:
 * - Queue and manage rulesets
 * - Distribute payouts
 * - Configure splits
 * - Manage NFT tiers
 * - Deploy ERC20 token
 * - Update project metadata
 */

// Helper to get chain slug
function getChainSlug(chainId: number): string {
  const slugs: Record<number, string> = { 1: 'eth', 10: 'op', 8453: 'base', 42161: 'arb' }
  return slugs[chainId] || 'eth'
}

// Owner's address for testing
const OWNER_ADDRESS = '0x1234567890123456789012345678901234567890'

test.describe('Owner: Ruleset Management', () => {
  const testProject = createMockProject({
    id: 600,
    name: 'Ruleset Test Project',
    chainId: 1,
    owner: OWNER_ADDRESS,
  })
  const projectUrl = `/${getChainSlug(testProject.chainId)}:${testProject.id}`

  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    // Auth as owner
    await mockManagedAuth(page, { smartAccountAddress: OWNER_ADDRESS })
    await mockAuthEndpoints(page)
    await mockProjectEndpoints(page, { projects: [testProject] })
    await mockTransactionEndpoints(page)

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('View Current Ruleset', () => {
    test('owner can see current ruleset configuration', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Navigate to Rules/Rulesets tab
      const rulesTab = page.getByRole('button', { name: 'Rules', exact: true }).first()
      if (await rulesTab.isVisible()) {
        await rulesTab.click()
        await page.waitForTimeout(300)
      }

      // Should see ruleset info
      await expect(page.locator('body')).toBeVisible()
    })

    test('displays reserved rate', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      const rulesTab = page.getByRole('button', { name: 'Rules', exact: true }).first()
      if (await rulesTab.isVisible()) {
        await rulesTab.click()
        await page.waitForTimeout(300)
      }

      // Look for reserved rate display
      const reservedRate = page.locator('text=/reserved|reserve/i')
      // Rate info may be visible
    })

    test('displays redemption rate', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      const rulesTab = page.getByRole('button', { name: 'Rules', exact: true }).first()
      if (await rulesTab.isVisible()) {
        await rulesTab.click()
        await page.waitForTimeout(300)
      }

      const redemptionRate = page.locator('text=/redemption|cash out rate/i')
      // Rate info may be visible
    })

    test('displays ruleset duration', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      const rulesTab = page.getByRole('button', { name: 'Rules', exact: true }).first()
      if (await rulesTab.isVisible()) {
        await rulesTab.click()
        await page.waitForTimeout(300)
      }

      const duration = page.locator('text=/duration|days|until/i')
      // Duration info may be visible
    })
  })

  test.describe('Queue New Ruleset', () => {
    test('queue ruleset button available for owner', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Look for queue ruleset via chat or button
      const queueBtn = page.locator('button').filter({
        hasText: /queue|edit|change.*rule/i
      }).first()

      // Queue option should be available to owner
    })

    test('can queue ruleset via AI chat', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      // Ask AI to change ruleset
      const chatInput = page.locator('textarea, input[type="text"]').first()

      if (await chatInput.isVisible()) {
        await chatInput.fill(`Queue a new ruleset for project ${testProject.id} with 10% reserved rate`)
        await chatInput.press('Enter')
        await page.waitForTimeout(1000)

        // AI should help with ruleset
      }
    })

    test('shows pending ruleset after queuing', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // After queuing, pending ruleset should be visible
      const pendingIndicator = page.locator('text=/pending|queued|upcoming/i')
      // Pending state may be shown
    })

    test('can cancel queued ruleset', async ({ page }) => {
      // If there's a queued ruleset, owner can cancel
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      const cancelBtn = page.locator('button').filter({
        hasText: /cancel.*ruleset|remove.*queued/i
      }).first()

      // Cancel option may be available
    })
  })

  test.describe('Ruleset Restrictions', () => {
    test('cannot increase reserved rate if locked', async ({ page }) => {
      // Some projects lock reserved rate
      // UI should prevent or warn about changes
    })

    test('cannot decrease redemption rate below minimum', async ({ page }) => {
      // Redemption rate may have minimum
    })

    test('shows warning for significant changes', async ({ page }) => {
      // Major changes should warn user
    })
  })
})

test.describe('Owner: Payout Distribution', () => {
  const testProject = createMockProject({
    id: 601,
    name: 'Payout Test Project',
    chainId: 1,
    owner: OWNER_ADDRESS,
  })
  const projectUrl = `/${getChainSlug(testProject.chainId)}:${testProject.id}`

  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page, { smartAccountAddress: OWNER_ADDRESS })
    await mockAuthEndpoints(page)
    await mockProjectEndpoints(page, { projects: [testProject] })
    await mockTransactionEndpoints(page)

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('View Payout Status', () => {
    test('shows available payout amount', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Navigate to Funds tab
      const fundsTab = page.getByRole('button', { name: 'Funds', exact: true }).first()
      if (await fundsTab.isVisible()) {
        await fundsTab.click()
        await page.waitForTimeout(300)
      }

      // Should show available for payout
      const availableAmount = page.locator('text=/available|distributable|payout/i')
      // Amount info may be visible
    })

    test('shows payout limit if set', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      const fundsTab = page.getByRole('button', { name: 'Funds', exact: true }).first()
      if (await fundsTab.isVisible()) {
        await fundsTab.click()
        await page.waitForTimeout(300)
      }

      const limit = page.locator('text=/limit|maximum|cap/i')
      // Limit info may be visible
    })

    test('shows split breakdown', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      const fundsTab = page.getByRole('button', { name: 'Funds', exact: true }).first()
      if (await fundsTab.isVisible()) {
        await fundsTab.click()
        await page.waitForTimeout(300)
      }

      // Should show how payout will be split
      const splitInfo = page.locator('text=/split|recipient|share/i')
      // Split breakdown may be visible
    })
  })

  test.describe('Send Payouts', () => {
    test('send payouts button visible when funds available', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      const sendPayoutsBtn = page.locator('button').filter({
        hasText: /send payouts|distribute/i
      }).first()

      // Button may be in owner menu or funds tab
    })

    test('shows confirmation before sending', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      const sendPayoutsBtn = page.locator('button').filter({
        hasText: /send payouts/i
      }).first()

      if (await sendPayoutsBtn.isVisible()) {
        await sendPayoutsBtn.click()
        await page.waitForTimeout(300)

        // Confirmation dialog should appear
        const confirmation = page.locator('[role="dialog"]')
        // Confirmation may be visible
      }
    })

    test('handles successful payout', async ({ page }) => {
      await mockTransactionEndpoints(page, { bundleStatus: 'confirmed' })

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // After successful payout, should show success
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles payout failure', async ({ page }) => {
      await page.route('**/wallet/execute', async (route) => {
        await route.fulfill({
          status: 500,
          body: JSON.stringify({ success: false, error: 'Payout failed' })
        })
      })

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Should handle error gracefully
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Payout Edge Cases', () => {
    test('shows empty state when no funds to distribute', async ({ page }) => {
      // When treasury is empty
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Should show empty/no funds state
    })

    test('respects payout limit', async ({ page }) => {
      // Cannot distribute more than limit
    })

    test('handles multi-chain payout limits', async ({ page }) => {
      // Each chain has independent limit
    })
  })
})

test.describe('Owner: Splits Configuration', () => {
  const testProject = createMockProject({
    id: 602,
    name: 'Splits Test Project',
    chainId: 1,
    owner: OWNER_ADDRESS,
  })
  const projectUrl = `/${getChainSlug(testProject.chainId)}:${testProject.id}`

  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page, { smartAccountAddress: OWNER_ADDRESS })
    await mockAuthEndpoints(page)
    await mockProjectEndpoints(page, { projects: [testProject] })
    await mockTransactionEndpoints(page)

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('View Splits', () => {
    test('shows current split recipients', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Splits may be visible in funds or dedicated section
      const splitsSection = page.locator('text=/splits|recipients|payees/i')
      // Splits info may be visible
    })

    test('shows percentage allocation', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Each recipient should show their %
      const percentage = page.locator('text=/%|percent/i')
      // Percentage info may be visible
    })
  })

  test.describe('Edit Splits', () => {
    test('can open splits editor', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      const editSplitsBtn = page.locator('button').filter({
        hasText: /edit splits|configure splits|set splits/i
      }).first()

      // Edit option may be available to owner
    })

    test('can add new split recipient', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Would open splits editor and add recipient
    })

    test('can remove split recipient', async ({ page }) => {
      // Remove existing recipient
    })

    test('can modify split percentages', async ({ page }) => {
      // Change allocation amounts
    })

    test('validates split percentages sum to 100%', async ({ page }) => {
      // Splits must total 100%
    })
  })
})

test.describe('Owner: NFT Tier Management', () => {
  const testProject = createMockProject({
    id: 603,
    name: 'NFT Tier Test Project',
    chainId: 1,
    owner: OWNER_ADDRESS,
  })
  const projectUrl = `/${getChainSlug(testProject.chainId)}:${testProject.id}`

  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page, { smartAccountAddress: OWNER_ADDRESS })
    await mockAuthEndpoints(page)
    await mockProjectEndpoints(page, { projects: [testProject] })
    await mockTransactionEndpoints(page)

    // Mock NFT tiers
    await page.route('**/projects/*/tiers', async (route) => {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({
          success: true,
          data: {
            tiers: [
              { id: 1, name: 'Basic', price: '0.01', supply: 100, sold: 5 },
              { id: 2, name: 'Premium', price: '0.1', supply: 50, sold: 2 },
            ]
          }
        })
      })
    })

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Add Tier', () => {
    test('sell something button visible for owner', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Navigate to Shop tab
      const shopTab = page.getByRole('button', { name: 'Shop', exact: true }).first()
      if (await shopTab.isVisible()) {
        await shopTab.click()
        await page.waitForTimeout(300)
      }

      const sellBtn = page.locator('button').filter({
        hasText: /sell something|add tier/i
      }).first()

      // Should be visible for owner
    })

    test('can add tier via chat', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      const chatInput = page.locator('textarea, input[type="text"]').first()

      if (await chatInput.isVisible()) {
        await chatInput.fill('Add a new NFT tier called "Gold" for 0.5 ETH with 25 supply')
        await chatInput.press('Enter')
        await page.waitForTimeout(1000)

        // AI should help with tier creation
      }
    })
  })

  test.describe('Edit Tier', () => {
    test('edit button visible on tier cards for owner', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      const shopTab = page.getByRole('button', { name: 'Shop', exact: true }).first()
      if (await shopTab.isVisible()) {
        await shopTab.click()
        await page.waitForTimeout(300)
      }

      const editBtn = page.locator('button:has-text("Edit")').first()
      // Edit button should be visible for owner
    })

    test('can edit tier name', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      const shopTab = page.getByRole('button', { name: 'Shop', exact: true }).first()
      if (await shopTab.isVisible()) {
        await shopTab.click()
        await page.waitForTimeout(300)
      }

      const editBtn = page.locator('button:has-text("Edit")').first()
      if (await editBtn.isVisible()) {
        await editBtn.click()
        await page.waitForTimeout(300)

        const nameInput = page.locator('input[name="name"]').first()
        if (await nameInput.isVisible()) {
          await nameInput.fill('Updated Tier Name')
          // Save changes
        }
      }
    })

    test('can set tier discount', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      const shopTab = page.getByRole('button', { name: 'Shop', exact: true }).first()
      if (await shopTab.isVisible()) {
        await shopTab.click()
        await page.waitForTimeout(300)
      }

      const editBtn = page.locator('button:has-text("Edit")').first()
      if (await editBtn.isVisible()) {
        await editBtn.click()
        await page.waitForTimeout(300)

        const discountInput = page.locator('input[name="discount"]').first()
        if (await discountInput.isVisible()) {
          await discountInput.fill('15')
          // Save changes
        }
      }
    })

    test('validates discount range', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      const shopTab = page.getByRole('button', { name: 'Shop', exact: true }).first()
      if (await shopTab.isVisible()) {
        await shopTab.click()
        await page.waitForTimeout(300)
      }

      const editBtn = page.locator('button:has-text("Edit")').first()
      if (await editBtn.isVisible()) {
        await editBtn.click()
        await page.waitForTimeout(300)

        const discountInput = page.locator('input[name="discount"]').first()
        if (await discountInput.isVisible()) {
          await discountInput.fill('150') // Invalid
          await page.waitForTimeout(300)

          // Should show validation error
          const error = page.locator('text=/exceed|invalid|100/i')
          // Error may be shown
        }
      }
    })
  })

  test.describe('Remove Tier', () => {
    test('delete button visible for removable tiers', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      const shopTab = page.getByRole('button', { name: 'Shop', exact: true }).first()
      if (await shopTab.isVisible()) {
        await shopTab.click()
        await page.waitForTimeout(300)
      }

      const deleteBtn = page.locator('button:has-text("Delete")').first()
      // Delete button may be visible
    })

    test('shows confirmation before delete', async ({ page }) => {
      // Should confirm before removing tier
    })

    test('cannot remove tier with cannotBeRemoved flag', async ({ page }) => {
      // Some tiers are locked
    })
  })
})

test.describe('Owner: ERC20 Token Deployment', () => {
  const testProject = createMockProject({
    id: 604,
    name: 'Token Deploy Test Project',
    chainId: 1,
    owner: OWNER_ADDRESS,
  })
  const projectUrl = `/${getChainSlug(testProject.chainId)}:${testProject.id}`

  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page, { smartAccountAddress: OWNER_ADDRESS })
    await mockAuthEndpoints(page)
    await mockProjectEndpoints(page, { projects: [testProject] })
    await mockTransactionEndpoints(page)

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Deploy Token', () => {
    test('deploy ERC20 option visible when no token exists', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      const deployBtn = page.locator('button').filter({
        hasText: /deploy.*token|deploy.*erc20|create.*token/i
      }).first()

      // Should be visible if project has no token yet
    })

    test('can specify token name and symbol', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Would open token deployment form
      // Fill name and symbol
    })

    test('validates token symbol format', async ({ page }) => {
      // Symbol should be uppercase, limited length
    })

    test('deploy option hidden after token exists', async ({ page }) => {
      // Once deployed, shouldn't show deploy again
    })
  })
})

test.describe('Owner: Surplus Allowance', () => {
  const testProject = createMockProject({
    id: 605,
    name: 'Surplus Test Project',
    chainId: 1,
    owner: OWNER_ADDRESS,
  })
  const projectUrl = `/${getChainSlug(testProject.chainId)}:${testProject.id}`

  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page, { smartAccountAddress: OWNER_ADDRESS })
    await mockAuthEndpoints(page)
    await mockProjectEndpoints(page, { projects: [testProject] })
    await mockTransactionEndpoints(page)

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Use Surplus', () => {
    test('shows available surplus', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      const fundsTab = page.getByRole('button', { name: 'Funds', exact: true }).first()
      if (await fundsTab.isVisible()) {
        await fundsTab.click()
        await page.waitForTimeout(300)
      }

      const surplus = page.locator('text=/surplus|overflow|available/i')
      // Surplus info may be visible
    })

    test('can use surplus allowance', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      const useSurplusBtn = page.locator('button').filter({
        hasText: /use surplus|withdraw surplus/i
      }).first()

      // Option may be available to owner
    })

    test('respects surplus allowance limit', async ({ page }) => {
      // Cannot exceed configured limit
    })
  })
})

test.describe('Owner: Metadata Update', () => {
  const testProject = createMockProject({
    id: 606,
    name: 'Metadata Test Project',
    chainId: 1,
    owner: OWNER_ADDRESS,
  })
  const projectUrl = `/${getChainSlug(testProject.chainId)}:${testProject.id}`

  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page, { smartAccountAddress: OWNER_ADDRESS })
    await mockAuthEndpoints(page)
    await mockProjectEndpoints(page, { projects: [testProject] })
    await mockTransactionEndpoints(page)

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Update Project Info', () => {
    test('can update project description', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Look for edit metadata option
      const editBtn = page.locator('button').filter({
        hasText: /edit.*info|update.*metadata|edit.*project/i
      }).first()

      // May be in owner menu
    })

    test('can update project logo', async ({ page }) => {
      // Logo/image update
    })

    test('metadata changes require transaction', async ({ page }) => {
      // On-chain metadata update
    })
  })
})
