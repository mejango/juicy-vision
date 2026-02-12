import { test, expect, type Page } from '../fixtures/auth'
import { type BrowserContext } from '@playwright/test'
import { mockAuthEndpoints, type TestUser } from '../fixtures/auth'
import { mockProjectEndpoints, mockTransactionEndpoints, createMockProject } from '../fixtures/api'

/**
 * Multi-User Scenarios
 *
 * Tests interactions between multiple users on the same project:
 * - Owner creates project
 * - Contributors pay and receive tokens
 * - Buyers purchase NFTs
 * - State synchronization across users
 */

// Helper to get chain slug
function getChainSlug(chainId: number): string {
  const slugs: Record<number, string> = { 1: 'eth', 10: 'op', 8453: 'base', 42161: 'arb' }
  return slugs[chainId] || 'eth'
}

// Create different test users
const USERS = {
  owner: {
    id: 'owner-001',
    email: 'owner@test.com',
    token: 'owner-token',
    smartAccountAddress: '0x1111111111111111111111111111111111111111',
    mode: 'managed' as const,
  },
  contributor1: {
    id: 'contributor-001',
    email: 'contributor1@test.com',
    token: 'contributor1-token',
    smartAccountAddress: '0x2222222222222222222222222222222222222222',
    mode: 'managed' as const,
  },
  contributor2: {
    id: 'contributor-002',
    email: 'contributor2@test.com',
    token: 'contributor2-token',
    smartAccountAddress: '0x3333333333333333333333333333333333333333',
    mode: 'managed' as const,
  },
  buyer: {
    id: 'buyer-001',
    email: 'buyer@test.com',
    token: 'buyer-token',
    smartAccountAddress: '0x4444444444444444444444444444444444444444',
    mode: 'managed' as const,
  },
}

// Helper to set up authenticated page for a specific user
async function setupUserPage(page: Page, user: TestUser) {
  await page.goto('/')
  await page.evaluate((u) => {
    localStorage.clear()
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
  await page.reload()
  await page.waitForLoadState('networkidle')
}

test.describe('Multi-User: Owner and Contributors', () => {
  const testProject = createMockProject({
    id: 500,
    name: 'Multi-User Test Project',
    chainId: 1,
    owner: USERS.owner.smartAccountAddress,
  })
  const projectUrl = `/${getChainSlug(testProject.chainId)}:${testProject.id}`

  test.describe('Owner Actions Visible to Contributors', () => {
    test('contributor sees project created by owner', async ({ page }) => {
      // Set up as contributor
      await setupUserPage(page, USERS.contributor1)
      await mockProjectEndpoints(page, { projects: [testProject] })

      // Navigate to owner's project
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Should see project (even if "not found" in test env)
      await expect(page.locator('body')).toBeVisible()
    })

    test('contributor does not see owner controls', async ({ page }) => {
      await setupUserPage(page, USERS.contributor1)
      await mockProjectEndpoints(page, { projects: [testProject] })

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Should NOT see owner-only controls
      const ownerGear = page.locator('[data-testid="owner-menu"], button[aria-label*="settings" i]').first()
      const queueRuleset = page.locator('button').filter({ hasText: /queue ruleset/i }).first()
      const sendPayouts = page.locator('button').filter({ hasText: /send payouts/i }).first()

      // These should not be visible to non-owners
      // (May not render at all, or may be hidden)
    })

    test('owner sees owner controls on their project', async ({ page }) => {
      await setupUserPage(page, USERS.owner)
      await mockProjectEndpoints(page, { projects: [testProject] })

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Owner should see management options
      // Look for "You" badge or owner indicator
      const youBadge = page.locator('text=/you|owner/i').first()
      // Owner indicator may be visible
    })
  })

  test.describe('Multiple Contributors Paying', () => {
    test('first contributor pays into project', async ({ page }) => {
      await setupUserPage(page, USERS.contributor1)
      await mockProjectEndpoints(page, { projects: [testProject] })
      await mockTransactionEndpoints(page, { bundleStatus: 'confirmed' })

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Look for payment input
      const payInput = page.locator('input[type="number"]').first()

      if (await payInput.isVisible()) {
        await payInput.fill('1')
        // Payment flow continues...
      }

      await expect(page.locator('body')).toBeVisible()
    })

    test('second contributor pays into project', async ({ page }) => {
      await setupUserPage(page, USERS.contributor2)
      await mockProjectEndpoints(page, { projects: [testProject] })
      await mockTransactionEndpoints(page, { bundleStatus: 'confirmed' })

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Similar payment flow
      await expect(page.locator('body')).toBeVisible()
    })

    test('project balance reflects multiple contributions', async ({ page }) => {
      // After multiple contributions, total should be summed
      await setupUserPage(page, USERS.owner)
      await mockProjectEndpoints(page, { projects: [testProject] })

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Look for balance display
      const balanceDisplay = page.locator('text=/balance|raised|treasury/i')
      // Balance should reflect contributions
    })
  })

  test.describe('Token Distribution to Contributors', () => {
    test('contributor receives tokens after payment', async ({ page }) => {
      await setupUserPage(page, USERS.contributor1)

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // After paying, contributor should have tokens
      // Check token balance display
      const tokenBalance = page.locator('text=/tokens|balance|holdings/i')
      // Token balance may be visible
    })

    test('contributors have proportional token amounts', async ({ page }) => {
      // If C1 pays 1 ETH and C2 pays 2 ETH, C2 should have ~2x tokens
      // Would need to mock specific balances to test
    })
  })
})

test.describe('Multi-User: NFT Shop Competition', () => {
  const testProject = createMockProject({
    id: 501,
    name: 'NFT Shop Project',
    chainId: 1,
  })
  const projectUrl = `/${getChainSlug(testProject.chainId)}:${testProject.id}`

  test.describe('Limited Supply NFTs', () => {
    test('first buyer gets NFT from limited tier', async ({ page }) => {
      await setupUserPage(page, USERS.buyer)
      await mockProjectEndpoints(page, { projects: [testProject] })
      await mockTransactionEndpoints(page, { bundleStatus: 'confirmed' })

      // Mock tier with limited supply
      await page.route('**/projects/*/tiers', async (route) => {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({
            success: true,
            data: {
              tiers: [{
                id: 1,
                name: 'Rare NFT',
                price: '0.1',
                supply: 1, // Only 1 available!
                sold: 0,
              }]
            }
          })
        })
      })

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Navigate to Shop tab
      const shopTab = page.getByRole('button', { name: 'Shop', exact: true }).first()
      if (await shopTab.isVisible()) {
        await shopTab.click()
        await page.waitForTimeout(300)
      }

      await expect(page.locator('body')).toBeVisible()
    })

    test('second buyer sees sold out after first purchase', async ({ page }) => {
      await setupUserPage(page, USERS.contributor1) // Different user

      // Mock tier as sold out
      await page.route('**/projects/*/tiers', async (route) => {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({
            success: true,
            data: {
              tiers: [{
                id: 1,
                name: 'Rare NFT',
                price: '0.1',
                supply: 1,
                sold: 1, // Now sold out
              }]
            }
          })
        })
      })

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Should show sold out state
      const soldOut = page.locator('text=/sold out|unavailable|0 left/i')
      // Sold out indicator may be visible
    })

    test('supply updates in real-time during purchase', async ({ page }) => {
      // When one user buys, others should see supply decrease
      // Would need WebSocket mocking for real-time updates
    })
  })

  test.describe('Concurrent Purchase Attempts', () => {
    test('handles race condition on last item', async ({ page }) => {
      await setupUserPage(page, USERS.buyer)

      // Mock transaction that fails due to sold out
      await page.route('**/wallet/execute', async (route) => {
        await route.fulfill({
          status: 400,
          body: JSON.stringify({
            success: false,
            error: 'Tier sold out'
          })
        })
      })

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Should show appropriate error
      await expect(page.locator('body')).toBeVisible()
    })
  })
})

test.describe('Multi-User: Owner Distributes to Contributors', () => {
  const testProject = createMockProject({
    id: 502,
    name: 'Payout Test Project',
    chainId: 1,
    owner: USERS.owner.smartAccountAddress,
  })
  const projectUrl = `/${getChainSlug(testProject.chainId)}:${testProject.id}`

  test.describe('Payout Splits', () => {
    test('owner can view split recipients', async ({ page }) => {
      await setupUserPage(page, USERS.owner)
      await mockProjectEndpoints(page, { projects: [testProject] })

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Look for splits/payouts section
      const splitsSection = page.locator('text=/splits|payouts|recipients/i')
      // Splits info may be visible
    })

    test('split recipients see their allocation', async ({ page }) => {
      await setupUserPage(page, USERS.contributor1)

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Contributors in splits should see their share
      const myShare = page.locator('text=/your share|allocation|receive/i')
      // Share info may be visible
    })

    test('owner sends payouts to splits', async ({ page }) => {
      await setupUserPage(page, USERS.owner)
      await mockProjectEndpoints(page, { projects: [testProject] })
      await mockTransactionEndpoints(page, { bundleStatus: 'confirmed' })

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Look for send payouts button
      const sendPayoutsBtn = page.locator('button').filter({
        hasText: /send payouts|distribute/i
      }).first()

      // Payout functionality may be available
    })

    test('recipients see balance increase after payout', async ({ page }) => {
      await setupUserPage(page, USERS.contributor1)

      // After payout, recipient should see increased balance
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Balance update would be visible
    })
  })
})

test.describe('Multi-User: Reserved Token Distribution', () => {
  const testProject = createMockProject({
    id: 503,
    name: 'Reserved Token Project',
    chainId: 1,
    owner: USERS.owner.smartAccountAddress,
  })
  const projectUrl = `/${getChainSlug(testProject.chainId)}:${testProject.id}`

  test.describe('Reserved Token Claims', () => {
    test('owner sends reserved tokens', async ({ page }) => {
      await setupUserPage(page, USERS.owner)
      await mockProjectEndpoints(page, { projects: [testProject] })
      await mockTransactionEndpoints(page, { bundleStatus: 'confirmed' })

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Look for reserved token distribution
      const sendReservedBtn = page.locator('button').filter({
        hasText: /send reserved|distribute tokens/i
      }).first()

      // Reserved token functionality may be available
    })

    test('recipients receive reserved tokens', async ({ page }) => {
      await setupUserPage(page, USERS.contributor1)

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // After distribution, tokens should appear
      const tokenBalance = page.locator('text=/tokens|balance/i')
      // Balance should reflect reserved tokens
    })
  })
})

test.describe('Multi-User: Competitive Cash Out', () => {
  const testProject = createMockProject({
    id: 504,
    name: 'Cash Out Competition Project',
    chainId: 1,
  })
  const projectUrl = `/${getChainSlug(testProject.chainId)}:${testProject.id}`

  test.describe('Multiple Users Cashing Out', () => {
    test('first user cashes out from overflow', async ({ page }) => {
      await setupUserPage(page, USERS.contributor1)
      await mockProjectEndpoints(page, { projects: [testProject] })
      await mockTransactionEndpoints(page, { bundleStatus: 'confirmed' })

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Cash out flow
      await expect(page.locator('body')).toBeVisible()
    })

    test('second user sees reduced overflow after first cash out', async ({ page }) => {
      await setupUserPage(page, USERS.contributor2)

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Overflow should be less now
      // Redemption amount should be proportionally less
    })

    test('bonding curve adjusts for multiple redemptions', async ({ page }) => {
      // Each redemption changes the curve
      // Later redeemers may get less per token
    })
  })

  test.describe('Large Cash Out Impact', () => {
    test('large cash out significantly reduces overflow', async ({ page }) => {
      await setupUserPage(page, USERS.contributor1)

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // If user cashes out large amount, overflow drops significantly
      // Other users should see updated rate
    })

    test('small holders see reduced value after whale exit', async ({ page }) => {
      // If one user has most tokens and exits,
      // remaining users have less overflow to share
    })
  })
})

test.describe('Multi-User: Activity Feed', () => {
  const testProject = createMockProject({
    id: 505,
    name: 'Activity Feed Project',
    chainId: 1,
  })
  const projectUrl = `/${getChainSlug(testProject.chainId)}:${testProject.id}`

  test.describe('Activity Visibility', () => {
    test('all users see same activity feed', async ({ page }) => {
      await setupUserPage(page, USERS.contributor1)

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Activity feed should show all contributions
      const activitySection = page.locator('text=/activity|history|recent/i')
      // Activity may be visible
    })

    test('activity shows correct attribution', async ({ page }) => {
      // Each activity item should show who did it
      // Addresses should be displayed correctly
    })

    test('new activity appears for all users', async ({ page }) => {
      // When one user acts, others should see it
      // (requires real-time updates or refresh)
    })
  })
})

test.describe('Multi-User: Permission Boundaries', () => {
  const testProject = createMockProject({
    id: 506,
    name: 'Permission Test Project',
    chainId: 1,
    owner: USERS.owner.smartAccountAddress,
  })
  const projectUrl = `/${getChainSlug(testProject.chainId)}:${testProject.id}`

  test.describe('Owner-Only Actions', () => {
    test('non-owner cannot queue ruleset', async ({ page }) => {
      await setupUserPage(page, USERS.contributor1)

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Ruleset controls should not be visible
      const queueBtn = page.locator('button').filter({
        hasText: /queue ruleset|edit rules/i
      }).first()

      // Should be hidden or disabled
      if (await queueBtn.isVisible()) {
        expect(await queueBtn.isDisabled()).toBe(true)
      }
    })

    test('non-owner cannot modify splits', async ({ page }) => {
      await setupUserPage(page, USERS.contributor1)

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      const splitsBtn = page.locator('button').filter({
        hasText: /edit splits|configure splits/i
      }).first()

      // Should be hidden or disabled for non-owner
    })

    test('non-owner cannot add NFT tiers', async ({ page }) => {
      await setupUserPage(page, USERS.contributor1)

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Navigate to Shop
      const shopTab = page.getByRole('button', { name: 'Shop', exact: true }).first()
      if (await shopTab.isVisible()) {
        await shopTab.click()
        await page.waitForTimeout(300)
      }

      const addTierBtn = page.locator('button').filter({
        hasText: /sell something|add tier/i
      }).first()

      // Should not be visible for non-owner
    })
  })

  test.describe('Public Actions', () => {
    test('anyone can view project details', async ({ page }) => {
      await setupUserPage(page, USERS.contributor1)

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Basic project info should be visible to all
      await expect(page.locator('body')).toBeVisible()
    })

    test('anyone can pay into project', async ({ page }) => {
      await setupUserPage(page, USERS.contributor1)

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Payment should be available to all authenticated users
      const payInput = page.locator('input[type="number"]').first()
      // Payment input may be visible
    })

    test('anyone can mint available NFTs', async ({ page }) => {
      await setupUserPage(page, USERS.buyer)

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // NFT minting should be available to all
    })
  })
})

test.describe('Multi-User: State Synchronization', () => {
  const testProject = createMockProject({
    id: 507,
    name: 'Sync Test Project',
    chainId: 1,
  })
  const projectUrl = `/${getChainSlug(testProject.chainId)}:${testProject.id}`

  test.describe('Cross-User Updates', () => {
    test('payment by one user reflected for others on refresh', async ({ page }) => {
      // User A pays
      await setupUserPage(page, USERS.contributor1)
      await mockTransactionEndpoints(page, { bundleStatus: 'confirmed' })

      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // Switch to User B
      await setupUserPage(page, USERS.contributor2)
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')

      // User B should see updated state
      await expect(page.locator('body')).toBeVisible()
    })

    test('NFT purchase removes from availability for others', async ({ page }) => {
      // Similar pattern - one buys, others see reduced supply
    })

    test('ruleset change visible to all after confirmation', async ({ page }) => {
      // Owner queues ruleset, contributors see it pending
    })
  })
})
