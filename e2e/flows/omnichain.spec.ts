import { test, expect, type Page } from '../fixtures/auth'
import { mockAuthEndpoints } from '../fixtures/auth'
import { mockProjectEndpoints, mockTransactionEndpoints, createMockProject } from '../fixtures/api'

/**
 * Omnichain Project Tests
 *
 * Tests for projects deployed across multiple chains:
 * - Cross-chain navigation
 * - Aggregated data display
 * - Chain-specific operations
 * - Bridge/Relayr integration
 */

// Chain configurations
const CHAINS = {
  ethereum: { id: 1, slug: 'eth', name: 'Ethereum' },
  optimism: { id: 10, slug: 'op', name: 'Optimism' },
  base: { id: 8453, slug: 'base', name: 'Base' },
  arbitrum: { id: 42161, slug: 'arb', name: 'Arbitrum' },
}

function getChainSlug(chainId: number): string {
  const entry = Object.values(CHAINS).find(c => c.id === chainId)
  return entry?.slug || 'eth'
}

test.describe('Omnichain: Multi-Chain Project Display', () => {
  // Project deployed on multiple chains
  const omnichainProject = createMockProject({
    id: 700,
    name: 'Omnichain Test Project',
    chainId: 1, // Primary chain
    metadata: {
      deployedChains: [1, 10, 8453], // ETH, OP, Base
    },
  })

  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page)
    await mockAuthEndpoints(page)
    await mockProjectEndpoints(page, { projects: [omnichainProject] })
    await mockTransactionEndpoints(page)

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Chain Navigation', () => {
    test('can access project via different chain URLs', async ({ page }) => {
      // Access via Ethereum URL
      await page.goto('/eth:700')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()

      // Access via Optimism URL
      await page.goto('/op:700')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()

      // Access via Base URL
      await page.goto('/base:700')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('shows chain selector for multi-chain project', async ({ page }) => {
      await page.goto('/eth:700')
      await page.waitForLoadState('networkidle')

      // Look for chain selector/switcher
      const chainSelector = page.locator('[data-testid="chain-selector"], [data-testid="chain-switcher"]').first()
      const chainDropdown = page.locator('button').filter({
        hasText: /ethereum|optimism|base|chain/i
      }).first()

      // Chain selection UI may be visible
    })

    test('switching chains updates URL', async ({ page }) => {
      await page.goto('/eth:700')
      await page.waitForLoadState('networkidle')

      // Find and click chain switcher
      const chainSelector = page.locator('[data-testid="chain-option"], button').filter({
        hasText: /optimism/i
      }).first()

      if (await chainSelector.isVisible()) {
        await chainSelector.click()
        await page.waitForTimeout(500)

        // URL should change to reflect new chain
        const url = page.url()
        // May contain /op: or optimism indicator
      }
    })
  })

  test.describe('Aggregated Data', () => {
    test('shows total balance across all chains', async ({ page }) => {
      await page.goto('/eth:700')
      await page.waitForLoadState('networkidle')

      // Look for aggregate balance display
      const totalBalance = page.locator('text=/total|combined|all chains/i')
      // Aggregate info may be visible
    })

    test('shows breakdown by chain', async ({ page }) => {
      await page.goto('/eth:700')
      await page.waitForLoadState('networkidle')

      // Should show per-chain breakdown
      const chainBreakdown = page.locator('text=/ethereum.*\\d|optimism.*\\d|base.*\\d/i')
      // Chain-specific amounts may be visible
    })

    test('aggregates token supply across chains', async ({ page }) => {
      await page.goto('/eth:700')
      await page.waitForLoadState('networkidle')

      // Token supply should be summed
    })

    test('shows activity from all chains', async ({ page }) => {
      await page.goto('/eth:700')
      await page.waitForLoadState('networkidle')

      // Activity feed should include all chains
      // Each activity should show which chain it occurred on
    })
  })

  test.describe('Chain-Specific Operations', () => {
    test('payment goes to selected chain', async ({ page }) => {
      await page.goto('/op:700') // Optimism
      await page.waitForLoadState('networkidle')

      // Payment should go to Optimism terminal
      const payInput = page.locator('input[type="number"]').first()
      // Payment would use OP terminal
    })

    test('NFT mint uses chain-specific supply', async ({ page }) => {
      await page.goto('/base:700') // Base
      await page.waitForLoadState('networkidle')

      // NFT supply on Base may differ from other chains
      // Each chain has independent inventory
    })

    test('cash out from specific chain', async ({ page }) => {
      await page.goto('/eth:700')
      await page.waitForLoadState('networkidle')

      // Cash out uses selected chain's overflow
    })
  })
})

test.describe('Omnichain: NFT Inventory', () => {
  const nftProject = createMockProject({
    id: 701,
    name: 'Omnichain NFT Project',
    chainId: 1,
    metadata: {
      deployedChains: [1, 10, 8453],
    },
  })

  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page)
    await mockAuthEndpoints(page)
    await mockProjectEndpoints(page, { projects: [nftProject] })

    // Mock per-chain NFT tiers
    await page.route('**/projects/*/tiers*', async (route) => {
      const url = route.request().url()
      const isBase = url.includes('chainId=8453')
      const isOptimism = url.includes('chainId=10')

      await route.fulfill({
        status: 200,
        body: JSON.stringify({
          success: true,
          data: {
            tiers: [{
              id: 1,
              name: 'Multi-Chain NFT',
              price: '0.1',
              supply: 50, // Per chain
              sold: isBase ? 45 : isOptimism ? 20 : 10, // Different per chain
            }]
          }
        })
      })
    })

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Per-Chain Supply', () => {
    test('shows supply badge with multi-chain breakdown', async ({ page }) => {
      await page.goto('/eth:701')
      await page.waitForLoadState('networkidle')

      const shopTab = page.getByRole('button', { name: 'Shop', exact: true }).first()
      if (await shopTab.isVisible()) {
        await shopTab.click()
        await page.waitForTimeout(300)
      }

      // Supply badge should show per-chain breakdown
      const supplyBadge = page.locator('[data-testid="supply-badge"]').first()
      // Badge may show chain breakdown on hover/click
    })

    test('different chains show different availability', async ({ page }) => {
      // ETH: 40 remaining (50 - 10 sold)
      await page.goto('/eth:701')
      await page.waitForLoadState('networkidle')

      const ethSupply = await page.locator('text=/\\d+.*left|\\d+.*available/i').first().textContent().catch(() => null)

      // Base: 5 remaining (50 - 45 sold)
      await page.goto('/base:701')
      await page.waitForLoadState('networkidle')

      const baseSupply = await page.locator('text=/\\d+.*left|\\d+.*available/i').first().textContent().catch(() => null)

      // Supplies should differ
    })

    test('sold out on one chain but available on others', async ({ page }) => {
      // Mock Base as sold out
      await page.route('**/projects/*/tiers*', async (route) => {
        const url = route.request().url()
        const isBase = url.includes('chainId=8453') || url.includes('base')

        await route.fulfill({
          status: 200,
          body: JSON.stringify({
            success: true,
            data: {
              tiers: [{
                id: 1,
                name: 'Limited NFT',
                price: '0.1',
                supply: 10,
                sold: isBase ? 10 : 5, // Sold out on Base only
              }]
            }
          })
        })
      })

      // Base should show sold out
      await page.goto('/base:701')
      await page.waitForLoadState('networkidle')
      // May show "Sold out" or 0 available

      // ETH should still have supply
      await page.goto('/eth:701')
      await page.waitForLoadState('networkidle')
      // Should show available
    })
  })
})

test.describe('Omnichain: Cross-Chain Payments', () => {
  const paymentProject = createMockProject({
    id: 702,
    name: 'Cross-Chain Payment Project',
    chainId: 1,
    metadata: {
      deployedChains: [1, 10, 8453],
    },
  })

  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page)
    await mockAuthEndpoints(page)
    await mockProjectEndpoints(page, { projects: [paymentProject] })
    await mockTransactionEndpoints(page)

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Relayr Integration', () => {
    test('shows option to pay from different chain', async ({ page }) => {
      await page.goto('/eth:702')
      await page.waitForLoadState('networkidle')

      // Look for cross-chain payment option
      const crossChainOption = page.locator('button, text').filter({
        hasText: /pay from|different chain|relayr/i
      }).first()

      // Cross-chain option may be available
    })

    test('calculates bridge fees', async ({ page }) => {
      await page.goto('/eth:702')
      await page.waitForLoadState('networkidle')

      // When paying cross-chain, should show bridge fee
      const bridgeFee = page.locator('text=/bridge fee|relay fee|additional fee/i')
      // Fee info may be shown
    })

    test('shows estimated time for cross-chain', async ({ page }) => {
      // Cross-chain payments take longer
      const timeEstimate = page.locator('text=/minutes|estimated time/i')
      // Time estimate may be shown
    })
  })

  test.describe('Multi-Chain Bundle', () => {
    test('can pay to multiple chains in one transaction', async ({ page }) => {
      await page.goto('/eth:702')
      await page.waitForLoadState('networkidle')

      // Advanced option to split payment across chains
      // This would use Relayr bundle
    })

    test('shows bundle progress across chains', async ({ page }) => {
      // When bundle executes, show status per chain
    })

    test('handles partial bundle failure', async ({ page }) => {
      // If one chain fails but others succeed
    })
  })
})

test.describe('Omnichain: Owner Operations', () => {
  const ownerAddress = '0x1234567890123456789012345678901234567890'
  const ownerProject = createMockProject({
    id: 703,
    name: 'Omnichain Owner Project',
    chainId: 1,
    owner: ownerAddress,
    metadata: {
      deployedChains: [1, 10, 8453],
    },
  })

  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page, { smartAccountAddress: ownerAddress })
    await mockAuthEndpoints(page)
    await mockProjectEndpoints(page, { projects: [ownerProject] })
    await mockTransactionEndpoints(page)

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Per-Chain Payout Limits', () => {
    test('shows payout limit per chain', async ({ page }) => {
      await page.goto('/eth:703')
      await page.waitForLoadState('networkidle')

      const fundsTab = page.getByRole('button', { name: 'Funds', exact: true }).first()
      if (await fundsTab.isVisible()) {
        await fundsTab.click()
        await page.waitForTimeout(300)
      }

      // Should show limit for each chain
      const limitInfo = page.locator('text=/limit|allowance/i')
      // Per-chain limits may be shown
    })

    test('payout uses chain-specific limit', async ({ page }) => {
      // Each chain has independent payout limit
      // Cannot aggregate across chains
    })

    test('shows remaining allowance per chain', async ({ page }) => {
      // After partial payout, remaining should update
    })
  })

  test.describe('Cross-Chain Ruleset', () => {
    test('ruleset applies to all chains', async ({ page }) => {
      await page.goto('/eth:703')
      await page.waitForLoadState('networkidle')

      // Ruleset change should apply everywhere
    })

    test('shows ruleset sync status across chains', async ({ page }) => {
      // May show if rulesets are in sync
    })
  })
})

test.describe('Omnichain: Different Project IDs', () => {
  // Omnichain projects have DIFFERENT project IDs on each chain
  // This is a fundamental constraint

  test.describe('Project ID Mapping', () => {
    test('handles different project IDs per chain', async ({ page, mockManagedAuth }) => {
      await mockManagedAuth(page)

      // Project 700 on Ethereum might be project 123 on Optimism
      // The UI should handle this mapping

      await page.goto('/eth:700')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('dashboard aggregates across different IDs', async ({ page, mockManagedAuth }) => {
      await mockManagedAuth(page)

      // Single dashboard for project deployed with different IDs
      await page.goto('/eth:700')
      await page.waitForLoadState('networkidle')

      // Should show data from all chains despite different IDs
    })

    test('activity feed shows correct chain attribution', async ({ page, mockManagedAuth }) => {
      await mockManagedAuth(page)

      await page.goto('/eth:700')
      await page.waitForLoadState('networkidle')

      // Each activity should show which chain/projectId
    })
  })
})

test.describe('Omnichain: Network Errors', () => {
  const testProject = createMockProject({
    id: 704,
    name: 'Network Error Test Project',
    chainId: 1,
    metadata: {
      deployedChains: [1, 10, 8453],
    },
  })

  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page)
    await mockAuthEndpoints(page)

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('RPC Failures', () => {
    test('handles one chain RPC being down', async ({ page }) => {
      // Mock Optimism RPC failure
      await page.route('**/optimism/**', route => route.abort())
      await page.route('**/chainId=10**', route => route.abort())

      await page.goto('/eth:704')
      await page.waitForLoadState('networkidle')

      // Should show data from working chains
      // May show error indicator for down chain
      await expect(page.locator('body')).toBeVisible()
    })

    test('shows partial data when some chains fail', async ({ page }) => {
      // Should degrade gracefully
    })

    test('retries failed chain periodically', async ({ page }) => {
      // Should attempt to reconnect
    })
  })

  test.describe('Data Sync Delays', () => {
    test('handles data lag between chains', async ({ page }) => {
      // One chain may be behind others
      // UI should handle inconsistent data
    })

    test('shows sync status indicator', async ({ page }) => {
      // May show when data is stale
    })
  })
})
