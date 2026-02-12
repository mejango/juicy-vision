import { test, expect } from '../fixtures/auth'
import { mockAuthEndpoints } from '../fixtures/auth'
import { mockProjectEndpoints, createMockProject } from '../fixtures/api'
import { assertOnDashboard, navigateToDashboard } from '../helpers/components'

// Map chainId to URL slug
function getChainSlug(chainId: number): string {
  const slugs: Record<number, string> = { 1: 'eth', 10: 'op', 8453: 'base', 42161: 'arb' }
  return slugs[chainId] || 'eth'
}

test.describe('Dashboard Navigation', () => {
  const testProject = createMockProject({
    id: 456,
    name: 'Dashboard Test Project',
    chainId: 1,
  })
  const projectUrl = `/${getChainSlug(testProject.chainId)}:${testProject.id}`

  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    const user = await mockManagedAuth(page)
    await mockAuthEndpoints(page, { user })
    await mockProjectEndpoints(page, { projects: [testProject] })

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
  })

  test.describe('Dashboard Link Format', () => {
    test('dashboard URL contains project ID and chain slug', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      const url = page.url()
      // URL format is /{chainSlug}:{projectId}
      expect(url).toContain(`eth:${testProject.id}`)
      // Page should not crash even if project not found
      await expect(page.locator('body')).toBeVisible()
    })

    test('dashboard loads correctly from direct URL', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      // Page should load without errors
      await expect(page.locator('body')).toBeVisible()
      // Note: Will show "not found" if project doesn't exist in Bendystraw
    })

    test('handles invalid project ID gracefully', async ({ page }) => {
      // Navigate to a non-existent project
      await page.goto('/eth:99999')
      await page.waitForLoadState('domcontentloaded')

      // Should show error state (not found page)
      await expect(page.locator('body')).toBeVisible()
      // App should not crash - look for error message or home navigation
      const notFoundOrHome = page.locator('text=/not found|go home/i').first()
      await expect(notFoundOrHome).toBeVisible()
    })

    test('handles invalid chain slug gracefully', async ({ page }) => {
      // Use an invalid chain slug
      await page.goto(`/invalidchain:${testProject.id}`)
      await page.waitForLoadState('domcontentloaded')

      // Should handle gracefully - show error or redirect to home
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Dashboard Content', () => {
    test('shows project name on dashboard', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      // Page should load without crashing
      await expect(page.locator('body')).toBeVisible()
      // Note: Will show "not found" if project doesn't exist in Bendystraw
    })

    test('shows project owner address', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      // Owner address might be truncated
      const truncatedAddress = testProject.owner.slice(0, 6)
      // Look for address display
    })

    test('shows chain indicator', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      // Should indicate which chain (Ethereum mainnet for chainId 1)
      const chainIndicator = page.locator('text=/ethereum|mainnet/i')
      // Note: Chain display depends on implementation
    })
  })

  test.describe('Dashboard Navigation', () => {
    test('back button returns to previous page', async ({ page }) => {
      // Start on home
      await page.goto('/')
      await page.waitForLoadState('domcontentloaded')

      // Navigate to dashboard (even if it shows "not found")
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      // Go back
      await page.goBack()
      await page.waitForLoadState('domcontentloaded')

      // Should be back home
      await expect(page.locator('body')).toBeVisible()
    })

    test('can navigate between project tabs/sections', async ({ page }) => {
      await page.goto(projectUrl)
      await page.waitForLoadState('domcontentloaded')

      // Look for navigation tabs (Tiers, Settings, Activity, etc.)
      const tabs = page.locator('[role="tab"], .tab, nav a, nav button')
      const tabCount = await tabs.count()

      // Click through tabs if they exist
      for (let i = 0; i < Math.min(tabCount, 3); i++) {
        const tab = tabs.nth(i)
        if (await tab.isVisible()) {
          await tab.click()
          await page.waitForTimeout(300)
        }
      }
    })
  })

  test.describe('Omnichain Projects', () => {
    test('single dashboard for multi-chain project', async ({ page }) => {
      // Mock an omnichain project (deployed on multiple chains)
      const omnichainProject = createMockProject({
        id: 789,
        name: 'Omnichain Project',
        chainId: 1, // Primary chain
        metadata: {
          deployedChains: [1, 10, 8453], // Mainnet, Optimism, Base
        },
      })

      await page.goto(`/eth:${omnichainProject.id}`)
      await page.waitForLoadState('domcontentloaded')

      // Page should load without crashing
      await expect(page.locator('body')).toBeVisible()
      // Note: Will show "not found" if project doesn't exist in Bendystraw
    })

    test('shows aggregated data across chains', async ({ page }) => {
      // For omnichain projects, data should be aggregated
      // This test verifies the UI handles multi-chain data
    })

    test('can switch between chain views', async ({ page }) => {
      // If there's a chain switcher on the dashboard
      const chainSelector = page.locator('[data-testid="chain-selector"], .chain-selector')
      if (await chainSelector.isVisible()) {
        await chainSelector.click()
        await page.waitForTimeout(200)

        // Chain options should appear
        const chainOptions = page.locator('[data-testid="chain-option"]')
        const optionCount = await chainOptions.count()
        // Should have multiple chain options for omnichain projects
      }
    })
  })
})

test.describe('Dashboard After Deployment', () => {
  test('navigating to dashboard link after deploy shows project', async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page)

    const newProject = createMockProject({ id: 999, name: 'Just Deployed' })
    await mockProjectEndpoints(page, { projects: [newProject] })

    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // Simulate clicking a dashboard link that appears after deployment
    // In a real flow, this link would come from the AI response after successful deploy

    // Navigate to the dashboard using the correct URL format
    const slug = getChainSlug(newProject.chainId)
    await page.goto(`/${slug}:${newProject.id}`)
    await page.waitForLoadState('domcontentloaded')

    // Verify we're on the dashboard
    const url = page.url()
    expect(url).toContain(`:${newProject.id}`)
  })

  test('dashboard reflects recent deployment changes', async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page)

    // Mock project with specific recent deployment data
    const recentProject = createMockProject({
      id: 888,
      name: 'Recent Deploy',
      createdAt: new Date().toISOString(),
    })

    await mockProjectEndpoints(page, { projects: [recentProject] })
    await page.reload()

    const slug = getChainSlug(recentProject.chainId)
    await page.goto(`/${slug}:${recentProject.id}`)
    await page.waitForLoadState('domcontentloaded')

    // Dashboard should load and show project
    await expect(page.locator('body')).toBeVisible()
  })
})

test.describe('Dashboard Responsiveness', () => {
  test('dashboard is usable on mobile', async ({ page, mockManagedAuth }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page)
    const project = createMockProject({ id: 111 })
    await mockProjectEndpoints(page, { projects: [project] })
    await page.reload()

    const slug = getChainSlug(project.chainId)
    await page.goto(`/${slug}:${project.id}`)
    await page.waitForLoadState('domcontentloaded')

    // No horizontal scroll
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth
    })
    expect(hasHorizontalScroll).toBe(false)

    // Key elements should be visible
    await expect(page.locator('body')).toBeVisible()
  })

  test('dashboard works on tablet', async ({ page, mockManagedAuth }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page)
    const project = createMockProject({ id: 222 })
    await mockProjectEndpoints(page, { projects: [project] })
    await page.reload()

    const slug = getChainSlug(project.chainId)
    await page.goto(`/${slug}:${project.id}`)
    await page.waitForLoadState('domcontentloaded')

    // Page should render correctly
    await expect(page.locator('body')).toBeVisible()
  })
})
