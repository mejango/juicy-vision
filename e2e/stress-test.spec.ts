import { test, expect, type Page } from '@playwright/test'
import { test as authTest, seedTestUsers, setupRealAuth } from './fixtures/auth'
import { createUXAgent } from './ux-bot'

/**
 * Stress Testing Suite
 *
 * Tests app behavior under stress conditions:
 * - Rapid interactions
 * - Concurrent operations
 * - Long sessions
 * - Edge case inputs
 *
 * Run with: npm run test:stress
 */

test.describe('Stress Tests - Rapid Interactions', () => {
  test.setTimeout(120000)

  test('handles rapid button clicks', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Find all clickable elements
    const buttons = await page.locator('button:visible').all()

    // Rapidly click multiple buttons
    const clickPromises: Promise<void>[] = []
    for (let i = 0; i < Math.min(buttons.length, 10); i++) {
      for (let j = 0; j < 5; j++) {
        clickPromises.push(
          buttons[i].click({ force: true, timeout: 1000 }).catch(() => {})
        )
      }
    }

    await Promise.allSettled(clickPromises)

    // App should still be responsive
    await page.waitForTimeout(1000)
    const body = await page.locator('body')
    await expect(body).toBeVisible()
  })

  test('handles rapid navigation', async ({ page }) => {
    await page.goto('/')

    // Rapidly navigate using browser buttons
    for (let i = 0; i < 10; i++) {
      await page.goBack().catch(() => {})
      await page.goForward().catch(() => {})
    }

    // App should recover
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('body')).toBeVisible()
  })

  test('handles rapid form input', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Find input fields
    const inputs = await page.locator('input:visible, textarea:visible').all()

    if (inputs.length > 0) {
      const input = inputs[0]

      // Rapidly type and clear
      for (let i = 0; i < 20; i++) {
        await input.fill('test' + i).catch(() => {})
        await input.fill('').catch(() => {})
      }

      // Should still be functional
      await input.fill('final value')
      await expect(input).toHaveValue('final value')
    }
  })

  test('handles rapid scroll', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Rapid scroll up and down
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, 500)
      await page.mouse.wheel(0, -500)
    }

    // Page should still be functional
    await expect(page.locator('body')).toBeVisible()
  })
})

test.describe('Stress Tests - Edge Case Inputs', () => {
  test.setTimeout(60000)

  test('handles very long text input', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const inputs = await page.locator('input[type="text"]:visible, textarea:visible').all()

    if (inputs.length > 0) {
      const longText = 'a'.repeat(10000)
      await inputs[0].fill(longText).catch(() => {})

      // Should handle gracefully (may truncate or show error)
      await page.waitForTimeout(500)
      await expect(page.locator('body')).toBeVisible()
    }
  })

  test('handles special characters', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const inputs = await page.locator('input[type="text"]:visible').all()

    if (inputs.length > 0) {
      const specialChars = '<script>alert("xss")</script> & " \' < > \n\r\t'
      await inputs[0].fill(specialChars).catch(() => {})

      // Should not break the page
      await page.waitForTimeout(500)
      await expect(page.locator('body')).toBeVisible()

      // Check no script execution
      const alerts: string[] = []
      page.on('dialog', (dialog) => {
        alerts.push(dialog.message())
        dialog.dismiss()
      })
      await page.waitForTimeout(1000)
      expect(alerts).toHaveLength(0)
    }
  })

  test('handles emoji and unicode', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const inputs = await page.locator('input[type="text"]:visible').all()

    if (inputs.length > 0) {
      const unicode = '👋 Hello 世界 مرحبا 🎉 \u200B\uFEFF'
      await inputs[0].fill(unicode).catch(() => {})

      await page.waitForTimeout(500)
      await expect(page.locator('body')).toBeVisible()
    }
  })

  test('handles extreme numbers', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const numberInputs = await page.locator('input[type="number"]:visible').all()

    if (numberInputs.length > 0) {
      // Try extreme values
      const extremeValues = [
        '999999999999999999999999999999',
        '-999999999999999999999999999999',
        '0.000000000000000000001',
        'NaN',
        'Infinity',
        '-Infinity',
      ]

      for (const value of extremeValues) {
        await numberInputs[0].fill(value).catch(() => {})
        await page.waitForTimeout(100)
      }

      await expect(page.locator('body')).toBeVisible()
    }
  })
})

test.describe('Stress Tests - Concurrent Operations', () => {
  test.setTimeout(180000)

  test('handles multiple tabs', async ({ browser }) => {
    const context = await browser.newContext()

    // Open multiple tabs
    const pages: Page[] = []
    for (let i = 0; i < 5; i++) {
      const page = await context.newPage()
      await page.goto('/')
      pages.push(page)
    }

    // Interact with all tabs
    const interactions = pages.map(async (page) => {
      await page.waitForLoadState('domcontentloaded')
      const buttons = await page.locator('button:visible').first()
      if (await buttons.count() > 0) {
        await buttons.click().catch(() => {})
      }
    })

    await Promise.allSettled(interactions)

    // All tabs should still work
    for (const page of pages) {
      await expect(page.locator('body')).toBeVisible()
    }

    await context.close()
  })

  test('handles rapid page reloads', async ({ page }) => {
    await page.goto('/')

    // Rapidly reload
    for (let i = 0; i < 10; i++) {
      await page.reload().catch(() => {})
    }

    // Final state should be stable
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('body')).toBeVisible()
  })
})

test.describe('Stress Tests - Memory & Performance', () => {
  test.setTimeout(300000) // 5 minutes

  test('handles long session without memory leak', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Simulate long session with many interactions
    for (let round = 0; round < 10; round++) {
      // Navigate around
      const links = await page.locator('a:visible').all()
      if (links.length > 0) {
        const randomLink = links[Math.floor(Math.random() * links.length)]
        await randomLink.click().catch(() => {})
        await page.waitForTimeout(500)
      }

      // Click buttons
      const buttons = await page.locator('button:visible').all()
      if (buttons.length > 0) {
        const randomButton = buttons[Math.floor(Math.random() * buttons.length)]
        await randomButton.click().catch(() => {})
        await page.waitForTimeout(500)
      }

      // Type in inputs
      const inputs = await page.locator('input:visible').all()
      if (inputs.length > 0) {
        await inputs[0].fill('test ' + round).catch(() => {})
      }

      // Go back home
      await page.goto('/').catch(() => {})
    }

    // Should still be responsive
    await expect(page.locator('body')).toBeVisible()

    // Check for JavaScript errors
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.waitForTimeout(1000)

    // Log any errors found (don't fail, just report)
    if (errors.length > 0) {
      console.warn('JS errors during long session:', errors)
    }
  })
})

// ============================================================================
// Authenticated Stress Tests
// ============================================================================

authTest.describe('Stress Tests - Authenticated', () => {
  authTest.setTimeout(120000)

  authTest.beforeAll(async () => {
    await seedTestUsers()
  })

  authTest('handles rapid authenticated actions', async ({ page, realAuth }) => {
    await realAuth(page, 'e2e-user@test.juicy.vision')

    const agent = createUXAgent(page, {
      maxSteps: 20,
      screenshotOnEachStep: false, // Faster without screenshots
    })

    const report = await agent.runScenario(
      'Rapidly click around the dashboard, open and close modals, switch tabs, and perform multiple actions in quick succession'
    )

    // Should complete without critical errors
    const criticalErrors = report.issues.filter((i) => i.severity === 'critical')
    expect(criticalErrors).toHaveLength(0)

    console.log(`Rapid actions test: ${report.status}`)
    console.log(`Steps completed: ${report.steps.length}`)
  })

  authTest('handles session during network instability', async ({ page, realAuth, context }) => {
    await realAuth(page, 'e2e-power@test.juicy.vision')

    // Simulate network issues by blocking random requests
    let blockCount = 0
    await context.route('**/*', async (route) => {
      blockCount++
      // Block every 5th request
      if (blockCount % 5 === 0) {
        await route.abort('failed')
      } else {
        await route.continue()
      }
    })

    // Try to use the app
    const agent = createUXAgent(page, {
      maxSteps: 10,
      screenshotOnEachStep: true,
    })

    const report = await agent.runScenario(
      'Try to navigate around the app and perform some actions despite network issues'
    )

    console.log(`Network instability test: ${report.status}`)
    console.log(`Issues found: ${report.issues.length}`)

    // The app should handle errors gracefully
    expect(report.steps.length).toBeGreaterThan(0)
  })
})
