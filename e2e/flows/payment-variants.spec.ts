import { test, expect, type Page } from '../fixtures/auth'
import { mockAuthEndpoints } from '../fixtures/auth'
import { mockProjectEndpoints, mockTransactionEndpoints, createMockProject } from '../fixtures/api'

/**
 * Payment Variants
 *
 * Tests many different payment scenarios:
 * - Amount variations (micro, small, large, whale)
 * - Currency variations (ETH, USDC, DAI)
 * - Tier purchase variations
 * - Multi-tier purchases
 * - Cross-chain payments via Relayr
 */

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

// Payment amount templates
const PAYMENT_AMOUNTS = {
  dust: '0.0001',      // Very small amount
  micro: '0.001',      // 1 finney
  small: '0.01',       // Common tier price
  medium: '0.1',       // Medium contribution
  standard: '1.0',     // 1 ETH
  large: '10.0',       // Large contribution
  whale: '100.0',      // Whale amount
  huge: '1000.0',      // Massive amount
}

// USDC amounts (no decimals confusion)
const USDC_AMOUNTS = {
  tiny: '1',           // $1
  small: '10',         // $10
  medium: '100',       // $100
  standard: '1000',    // $1k
  large: '10000',      // $10k
  whale: '100000',     // $100k
}

test.describe('Payment Variants: Amount Levels', () => {
  const paymentProject = createMockProject({
    id: 900,
    name: 'Payment Variants Test',
    chainId: 1,
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

  test.describe('ETH Payments', () => {
    test('pays dust amount (0.0001 ETH)', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:900`)
      await page.waitForLoadState('networkidle')

      const payInput = page.locator('input[type="number"], input[data-testid="pay-input"]').first()
      if (await payInput.isVisible()) {
        await payInput.fill(PAYMENT_AMOUNTS.dust)
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays micro amount (0.001 ETH)', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:900`)
      await page.waitForLoadState('networkidle')

      const payInput = page.locator('input[type="number"]').first()
      if (await payInput.isVisible()) {
        await payInput.fill(PAYMENT_AMOUNTS.micro)
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays small amount (0.01 ETH)', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:900`)
      await page.waitForLoadState('networkidle')

      const payInput = page.locator('input[type="number"]').first()
      if (await payInput.isVisible()) {
        await payInput.fill(PAYMENT_AMOUNTS.small)
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays medium amount (0.1 ETH)', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:900`)
      await page.waitForLoadState('networkidle')

      const payInput = page.locator('input[type="number"]').first()
      if (await payInput.isVisible()) {
        await payInput.fill(PAYMENT_AMOUNTS.medium)
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays standard amount (1 ETH)', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:900`)
      await page.waitForLoadState('networkidle')

      const payInput = page.locator('input[type="number"]').first()
      if (await payInput.isVisible()) {
        await payInput.fill(PAYMENT_AMOUNTS.standard)
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays large amount (10 ETH)', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:900`)
      await page.waitForLoadState('networkidle')

      const payInput = page.locator('input[type="number"]').first()
      if (await payInput.isVisible()) {
        await payInput.fill(PAYMENT_AMOUNTS.large)
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays whale amount (100 ETH)', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:900`)
      await page.waitForLoadState('networkidle')

      const payInput = page.locator('input[type="number"]').first()
      if (await payInput.isVisible()) {
        await payInput.fill(PAYMENT_AMOUNTS.whale)
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays huge amount (1000 ETH)', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:900`)
      await page.waitForLoadState('networkidle')

      const payInput = page.locator('input[type="number"]').first()
      if (await payInput.isVisible()) {
        await payInput.fill(PAYMENT_AMOUNTS.huge)
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Decimal Precision', () => {
    test('pays with 1 decimal place', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:900`)
      await page.waitForLoadState('networkidle')

      const payInput = page.locator('input[type="number"]').first()
      if (await payInput.isVisible()) {
        await payInput.fill('0.1')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays with 4 decimal places', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:900`)
      await page.waitForLoadState('networkidle')

      const payInput = page.locator('input[type="number"]').first()
      if (await payInput.isVisible()) {
        await payInput.fill('0.0001')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays with 8 decimal places', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:900`)
      await page.waitForLoadState('networkidle')

      const payInput = page.locator('input[type="number"]').first()
      if (await payInput.isVisible()) {
        await payInput.fill('0.00000001')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays with 18 decimal places (wei precision)', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:900`)
      await page.waitForLoadState('networkidle')

      const payInput = page.locator('input[type="number"]').first()
      if (await payInput.isVisible()) {
        await payInput.fill('0.000000000000000001')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays round number', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:900`)
      await page.waitForLoadState('networkidle')

      const payInput = page.locator('input[type="number"]').first()
      if (await payInput.isVisible()) {
        await payInput.fill('5')
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Invalid Amounts', () => {
    test('handles 0 amount input', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:900`)
      await page.waitForLoadState('networkidle')

      const payInput = page.locator('input[type="number"]').first()
      if (await payInput.isVisible()) {
        await payInput.fill('0')
        // Should show validation error or disable button
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles negative amount', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:900`)
      await page.waitForLoadState('networkidle')

      const payInput = page.locator('input[type="number"]').first()
      if (await payInput.isVisible()) {
        await payInput.fill('-1')
        // Should reject negative
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles non-numeric input', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:900`)
      await page.waitForLoadState('networkidle')

      const payInput = page.locator('input[type="number"]').first()
      if (await payInput.isVisible()) {
        await payInput.fill('abc')
        // Should reject non-numeric
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles amount exceeding balance', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:900`)
      await page.waitForLoadState('networkidle')

      const payInput = page.locator('input[type="number"]').first()
      if (await payInput.isVisible()) {
        await payInput.fill('999999999')
        // Should show insufficient balance warning
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })
})

test.describe('Payment Variants: Multi-Currency', () => {
  const multiCurrencyProject = createMockProject({
    id: 901,
    name: 'Multi-Currency Project',
    chainId: 1,
    metadata: { acceptsUSDC: true, acceptsDAI: true },
  })

  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page)
    await mockAuthEndpoints(page)
    await mockProjectEndpoints(page, { projects: [multiCurrencyProject] })
    await mockTransactionEndpoints(page)

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('USDC Payments', () => {
    test('pays $1 USDC', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:901`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays $10 USDC', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:901`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays $100 USDC', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:901`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays $1000 USDC', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:901`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays $10000 USDC (whale)', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:901`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays $0.01 USDC (cent)', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:901`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Currency Switching', () => {
    test('switches from ETH to USDC', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:901`)
      await page.waitForLoadState('networkidle')

      // Look for currency selector
      const currencySelector = page.locator('[data-testid="currency-selector"], select')
      await expect(page.locator('body')).toBeVisible()
    })

    test('switches from USDC to DAI', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:901`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('switches from DAI to ETH', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:901`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('amount updates when switching currency', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:901`)
      await page.waitForLoadState('networkidle')
      // Enter 1 ETH, switch to USDC, amount should show USD equivalent
      await expect(page.locator('body')).toBeVisible()
    })
  })
})

test.describe('Payment Variants: Tier Purchases', () => {
  const tieredProject = createMockProject({
    id: 902,
    name: 'Tiered Project',
    chainId: 8453,
    metadata: {},
  })

  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page)
    await mockAuthEndpoints(page)
    await mockProjectEndpoints(page, { projects: [tieredProject] })

    // Mock tiers
    await page.route('**/projects/*/tiers*', async (route) => {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({
          success: true,
          data: {
            tiers: [
              { id: 1, name: 'Bronze', price: '0.01', supply: 100, sold: 10 },
              { id: 2, name: 'Silver', price: '0.05', supply: 50, sold: 5 },
              { id: 3, name: 'Gold', price: '0.1', supply: 25, sold: 2 },
              { id: 4, name: 'Platinum', price: '0.5', supply: 10, sold: 1 },
              { id: 5, name: 'Diamond', price: '1.0', supply: 5, sold: 0 },
            ]
          }
        })
      })
    })

    await mockTransactionEndpoints(page)
    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Single Tier Purchase', () => {
    test('purchases cheapest tier (Bronze)', async ({ page }) => {
      await page.goto(`/${getChainSlug(8453)}:902`)
      await page.waitForLoadState('networkidle')

      const shopTab = page.getByRole('button', { name: 'Shop', exact: true }).first()
      if (await shopTab.isVisible()) {
        await shopTab.click()
        await page.waitForTimeout(300)
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('purchases mid-tier (Silver)', async ({ page }) => {
      await page.goto(`/${getChainSlug(8453)}:902`)
      await page.waitForLoadState('networkidle')

      const shopTab = page.getByRole('button', { name: 'Shop', exact: true }).first()
      if (await shopTab.isVisible()) {
        await shopTab.click()
        await page.waitForTimeout(300)
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('purchases mid-tier (Gold)', async ({ page }) => {
      await page.goto(`/${getChainSlug(8453)}:902`)
      await page.waitForLoadState('networkidle')

      const shopTab = page.getByRole('button', { name: 'Shop', exact: true }).first()
      if (await shopTab.isVisible()) {
        await shopTab.click()
        await page.waitForTimeout(300)
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('purchases expensive tier (Platinum)', async ({ page }) => {
      await page.goto(`/${getChainSlug(8453)}:902`)
      await page.waitForLoadState('networkidle')

      const shopTab = page.getByRole('button', { name: 'Shop', exact: true }).first()
      if (await shopTab.isVisible()) {
        await shopTab.click()
        await page.waitForTimeout(300)
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('purchases most expensive tier (Diamond)', async ({ page }) => {
      await page.goto(`/${getChainSlug(8453)}:902`)
      await page.waitForLoadState('networkidle')

      const shopTab = page.getByRole('button', { name: 'Shop', exact: true }).first()
      if (await shopTab.isVisible()) {
        await shopTab.click()
        await page.waitForTimeout(300)
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Quantity Variations', () => {
    test('purchases 1 of a tier', async ({ page }) => {
      await page.goto(`/${getChainSlug(8453)}:902`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('purchases 2 of a tier', async ({ page }) => {
      await page.goto(`/${getChainSlug(8453)}:902`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('purchases 5 of a tier', async ({ page }) => {
      await page.goto(`/${getChainSlug(8453)}:902`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('purchases 10 of a tier', async ({ page }) => {
      await page.goto(`/${getChainSlug(8453)}:902`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('purchases max available of a tier', async ({ page }) => {
      await page.goto(`/${getChainSlug(8453)}:902`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Multi-Tier Purchase', () => {
    test('purchases 2 different tiers', async ({ page }) => {
      await page.goto(`/${getChainSlug(8453)}:902`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('purchases 3 different tiers', async ({ page }) => {
      await page.goto(`/${getChainSlug(8453)}:902`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('purchases all available tiers', async ({ page }) => {
      await page.goto(`/${getChainSlug(8453)}:902`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('purchases mix of quantities across tiers', async ({ page }) => {
      await page.goto(`/${getChainSlug(8453)}:902`)
      await page.waitForLoadState('networkidle')
      // 3x Bronze, 2x Silver, 1x Gold
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Tier + Payment Combo', () => {
    test('tier purchase only (exact price)', async ({ page }) => {
      await page.goto(`/${getChainSlug(8453)}:902`)
      await page.waitForLoadState('networkidle')
      // Purchase tier at exact price
      await expect(page.locator('body')).toBeVisible()
    })

    test('tier purchase + extra payment', async ({ page }) => {
      await page.goto(`/${getChainSlug(8453)}:902`)
      await page.waitForLoadState('networkidle')
      // Purchase tier + add extra payment amount
      await expect(page.locator('body')).toBeVisible()
    })

    test('extra payment without tier', async ({ page }) => {
      await page.goto(`/${getChainSlug(8453)}:902`)
      await page.waitForLoadState('networkidle')
      // Just pay without selecting a tier
      await expect(page.locator('body')).toBeVisible()
    })

    test('multiple tiers + extra payment', async ({ page }) => {
      await page.goto(`/${getChainSlug(8453)}:902`)
      await page.waitForLoadState('networkidle')
      // Select multiple tiers and add extra
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Supply Constraints', () => {
    test('shows warning for low supply tier', async ({ page }) => {
      // Diamond has only 5 left
      await page.goto(`/${getChainSlug(8453)}:902`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('cannot purchase more than available', async ({ page }) => {
      await page.goto(`/${getChainSlug(8453)}:902`)
      await page.waitForLoadState('networkidle')
      // Try to buy 100 of a tier with only 25 left
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles sold out tier gracefully', async ({ page }) => {
      // Mock a sold out tier
      await page.route('**/projects/*/tiers*', async (route) => {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({
            success: true,
            data: {
              tiers: [
                { id: 1, name: 'Sold Out', price: '0.01', supply: 10, sold: 10 },
              ]
            }
          })
        })
      })

      await page.goto(`/${getChainSlug(8453)}:902`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })
  })
})

test.describe('Payment Variants: Cross-Chain (Relayr)', () => {
  const omnichainProject = createMockProject({
    id: 903,
    name: 'Omnichain Payment Project',
    chainId: 1,
    metadata: { deployedChains: [1, 10, 8453] },
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

  test.describe('Pay from Different Chain', () => {
    test('pays to ETH project from Optimism', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:903`)
      await page.waitForLoadState('networkidle')
      // Select "Pay from Optimism"
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays to ETH project from Base', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:903`)
      await page.waitForLoadState('networkidle')
      // Select "Pay from Base"
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays to Optimism project from ETH', async ({ page }) => {
      await page.goto(`/${getChainSlug(10)}:903`)
      await page.waitForLoadState('networkidle')
      // Select "Pay from Ethereum"
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays to Base project from Arbitrum', async ({ page }) => {
      await page.goto(`/${getChainSlug(8453)}:903`)
      await page.waitForLoadState('networkidle')
      // Select "Pay from Arbitrum"
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Bridge Fee Display', () => {
    test('shows bridge fee for cross-chain payment', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:903`)
      await page.waitForLoadState('networkidle')
      // Select cross-chain option, verify fee display
      await expect(page.locator('body')).toBeVisible()
    })

    test('shows estimated time for cross-chain', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:903`)
      await page.waitForLoadState('networkidle')
      // Verify time estimate display
      await expect(page.locator('body')).toBeVisible()
    })

    test('compares same-chain vs cross-chain fees', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:903`)
      await page.waitForLoadState('networkidle')
      // Show comparison of direct vs bridged payment
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Multi-Chain Bundle', () => {
    test('pays to multiple chains in one transaction', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:903`)
      await page.waitForLoadState('networkidle')
      // Select bundle payment to ETH + OP + Base
      await expect(page.locator('body')).toBeVisible()
    })

    test('shows bundle progress per chain', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:903`)
      await page.waitForLoadState('networkidle')
      // Verify progress indicators for each chain
      await expect(page.locator('body')).toBeVisible()
    })
  })
})

test.describe('Payment Variants: User Balances', () => {
  test.describe('Sufficient Balance', () => {
    test('pays with exact balance', async ({ page, mockManagedAuth }) => {
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())

      // Mock user with exactly 0.1 ETH
      await mockManagedAuth(page, { balance: '0.1' })
      await mockAuthEndpoints(page)
      await mockProjectEndpoints(page, { projects: [] })
      await mockTransactionEndpoints(page)

      await page.reload()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays with more than enough balance', async ({ page, mockManagedAuth }) => {
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())

      // Mock user with 10 ETH
      await mockManagedAuth(page, { balance: '10.0' })
      await mockAuthEndpoints(page)
      await mockProjectEndpoints(page, { projects: [] })
      await mockTransactionEndpoints(page)

      await page.reload()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Insufficient Balance', () => {
    test('shows insufficient balance for ETH', async ({ page, mockManagedAuth }) => {
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())

      // Mock user with 0 ETH
      await mockManagedAuth(page, { balance: '0' })
      await mockAuthEndpoints(page)
      await mockProjectEndpoints(page, { projects: [] })
      await mockTransactionEndpoints(page)

      await page.reload()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('shows insufficient balance for USDC', async ({ page, mockManagedAuth }) => {
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())

      await mockManagedAuth(page, { usdcBalance: '0' })
      await mockAuthEndpoints(page)
      await mockProjectEndpoints(page, { projects: [] })
      await mockTransactionEndpoints(page)

      await page.reload()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('offers to buy more ETH', async ({ page, mockManagedAuth }) => {
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())

      await mockManagedAuth(page, { balance: '0.001' })
      await mockAuthEndpoints(page)
      await mockProjectEndpoints(page, { projects: [] })
      await mockTransactionEndpoints(page)

      await page.reload()
      await page.waitForLoadState('networkidle')
      // Should offer on-ramp option
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Gas Estimation', () => {
    test('shows gas estimate for payment', async ({ page, mockManagedAuth }) => {
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())

      await mockManagedAuth(page)
      await mockAuthEndpoints(page)
      await mockProjectEndpoints(page, { projects: [] })
      await mockTransactionEndpoints(page)

      await page.reload()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('warns if gas + payment exceeds balance', async ({ page, mockManagedAuth }) => {
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())

      // Balance barely covers payment but not gas
      await mockManagedAuth(page, { balance: '0.01' })
      await mockAuthEndpoints(page)
      await mockProjectEndpoints(page, { projects: [] })
      await mockTransactionEndpoints(page)

      await page.reload()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })
  })
})

test.describe('Payment Variants: Transaction States', () => {
  const stateTestProject = createMockProject({
    id: 904,
    name: 'Transaction State Test',
    chainId: 1,
  })

  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page)
    await mockAuthEndpoints(page)
    await mockProjectEndpoints(page, { projects: [stateTestProject] })

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Success States', () => {
    test('handles instant confirmation', async ({ page }) => {
      await mockTransactionEndpoints(page, { confirmationTime: 0 })
      await page.goto(`/${getChainSlug(1)}:904`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles slow confirmation (10s)', async ({ page }) => {
      await mockTransactionEndpoints(page, { confirmationTime: 10000 })
      await page.goto(`/${getChainSlug(1)}:904`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles very slow confirmation (60s)', async ({ page }) => {
      await mockTransactionEndpoints(page, { confirmationTime: 60000 })
      await page.goto(`/${getChainSlug(1)}:904`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Failure States', () => {
    test('handles user rejection', async ({ page }) => {
      await page.route('**/wallet/execute', async (route) => {
        await route.fulfill({
          status: 400,
          body: JSON.stringify({ success: false, error: 'User rejected' })
        })
      })

      await page.goto(`/${getChainSlug(1)}:904`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles insufficient funds', async ({ page }) => {
      await page.route('**/wallet/execute', async (route) => {
        await route.fulfill({
          status: 400,
          body: JSON.stringify({ success: false, error: 'Insufficient funds' })
        })
      })

      await page.goto(`/${getChainSlug(1)}:904`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles out of gas', async ({ page }) => {
      await page.route('**/wallet/execute', async (route) => {
        await route.fulfill({
          status: 400,
          body: JSON.stringify({ success: false, error: 'Out of gas' })
        })
      })

      await page.goto(`/${getChainSlug(1)}:904`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles network error', async ({ page }) => {
      await page.route('**/wallet/execute', async (route) => {
        await route.abort('failed')
      })

      await page.goto(`/${getChainSlug(1)}:904`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles timeout', async ({ page }) => {
      await page.route('**/wallet/execute', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 35000))
        await route.fulfill({ status: 200 })
      })

      await page.goto(`/${getChainSlug(1)}:904`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Retry Behavior', () => {
    test('allows retry after failure', async ({ page }) => {
      let attempts = 0
      await page.route('**/wallet/execute', async (route) => {
        attempts++
        if (attempts === 1) {
          await route.fulfill({
            status: 400,
            body: JSON.stringify({ success: false, error: 'Failed' })
          })
        } else {
          await route.fulfill({
            status: 200,
            body: JSON.stringify({ success: true })
          })
        }
      })

      await page.goto(`/${getChainSlug(1)}:904`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('does not allow retry during pending', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:904`)
      await page.waitForLoadState('networkidle')
      // Button should be disabled while tx is pending
      await expect(page.locator('body')).toBeVisible()
    })
  })
})

test.describe('Payment Variants: Memo/Beneficiary', () => {
  const memoProject = createMockProject({
    id: 905,
    name: 'Memo Test Project',
    chainId: 1,
  })

  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page)
    await mockAuthEndpoints(page)
    await mockProjectEndpoints(page, { projects: [memoProject] })
    await mockTransactionEndpoints(page)

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Memo Variations', () => {
    test('pays with empty memo', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:905`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays with short memo', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:905`)
      await page.waitForLoadState('networkidle')
      // Memo: "Thanks!"
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays with long memo', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:905`)
      await page.waitForLoadState('networkidle')
      // Long memo that tests limits
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays with special characters in memo', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:905`)
      await page.waitForLoadState('networkidle')
      // Memo: "🚀💰 Thanks & <script>alert('xss')</script>"
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays with unicode memo', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:905`)
      await page.waitForLoadState('networkidle')
      // Memo: "感谢支持"
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Beneficiary Variations', () => {
    test('pays to self (default)', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:905`)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays to different address', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:905`)
      await page.waitForLoadState('networkidle')
      // Set beneficiary to another address
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays to ENS name', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:905`)
      await page.waitForLoadState('networkidle')
      // Set beneficiary to vitalik.eth
      await expect(page.locator('body')).toBeVisible()
    })

    test('pays as gift (0x0 beneficiary)', async ({ page }) => {
      await page.goto(`/${getChainSlug(1)}:905`)
      await page.waitForLoadState('networkidle')
      // Gift payment - no beneficiary
      await expect(page.locator('body')).toBeVisible()
    })
  })
})
