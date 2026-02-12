import { test, expect, devices, type Page } from '@playwright/test'
import { test as authTest, seedTestUsers, setupRealAuth } from './fixtures/auth'

/**
 * Visual Regression Testing Suite
 *
 * Captures screenshots of key pages and components, comparing them
 * against baseline images to detect unintended visual changes.
 *
 * First run creates baseline screenshots in e2e/visual-regression.spec.ts-snapshots/
 * Subsequent runs compare against baselines.
 *
 * Run with: npm run test:visual
 * Update baselines: npm run test:visual -- --update-snapshots
 */

// ============================================================================
// Configuration
// ============================================================================

// Mask dynamic content that changes between runs
const DYNAMIC_MASKS = [
  '[data-testid="timestamp"]',
  '[data-testid="balance"]',
  '[data-testid="address"]',
  '.animate-pulse',
  '.animate-spin',
  '[class*="loading"]',
]

// Wait for animations to complete
async function waitForStableUI(page: Page) {
  // Wait for network idle
  await page.waitForLoadState('domcontentloaded')

  // Wait for animations
  await page.waitForTimeout(500)

  // Wait for any lazy-loaded images
  await page.evaluate(() => {
    return Promise.all(
      Array.from(document.images)
        .filter(img => !img.complete)
        .map(img => new Promise(resolve => {
          img.onload = img.onerror = resolve
        }))
    )
  })

  // Additional wait for React hydration
  await page.waitForTimeout(300)
}

// ============================================================================
// Desktop Visual Tests
// ============================================================================

test.describe('Visual Regression - Desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('home page', async ({ page }) => {
    await page.goto('/')
    await waitForStableUI(page)

    // Hide dynamic content
    for (const selector of DYNAMIC_MASKS) {
      await page.locator(selector).evaluateAll(els =>
        els.forEach(el => (el as HTMLElement).style.visibility = 'hidden')
      ).catch(() => {})
    }

    await expect(page).toHaveScreenshot('desktop-home.png', {
      maxDiffPixels: 100,
      threshold: 0.2,
    })
  })

  test('home page - scrolled', async ({ page }) => {
    await page.goto('/')
    await waitForStableUI(page)

    // Scroll down
    await page.evaluate(() => window.scrollTo(0, 500))
    await page.waitForTimeout(300)

    await expect(page).toHaveScreenshot('desktop-home-scrolled.png', {
      maxDiffPixels: 100,
      threshold: 0.2,
    })
  })

  test('welcome screen with prompts', async ({ page }) => {
    await page.goto('/')
    await waitForStableUI(page)

    // Focus on the prompt area
    const promptArea = page.locator('[class*="cursor-grab"]').first()
    if (await promptArea.count() > 0) {
      await expect(promptArea).toHaveScreenshot('desktop-prompt-canvas.png', {
        maxDiffPixels: 200, // More tolerance for scattered prompts
        threshold: 0.3,
      })
    }
  })
})

// ============================================================================
// Mobile Visual Tests
// ============================================================================

test.describe('Visual Regression - Mobile', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('home page mobile', async ({ page }) => {
    await page.goto('/')
    await waitForStableUI(page)

    await expect(page).toHaveScreenshot('mobile-home.png', {
      maxDiffPixels: 100,
      threshold: 0.2,
    })
  })

  test('home page mobile - landscape', async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 })
    await page.goto('/')
    await waitForStableUI(page)

    await expect(page).toHaveScreenshot('mobile-home-landscape.png', {
      maxDiffPixels: 100,
      threshold: 0.2,
    })
  })
})

// ============================================================================
// Tablet Visual Tests
// ============================================================================

test.describe('Visual Regression - Tablet', () => {
  test.use({ viewport: { width: 768, height: 1024 } })

  test('home page tablet', async ({ page }) => {
    await page.goto('/')
    await waitForStableUI(page)

    await expect(page).toHaveScreenshot('tablet-home.png', {
      maxDiffPixels: 100,
      threshold: 0.2,
    })
  })
})

// ============================================================================
// Authenticated Visual Tests
// ============================================================================

authTest.describe('Visual Regression - Authenticated', () => {
  authTest.use({ viewport: { width: 1280, height: 800 } })
  authTest.setTimeout(60000)

  authTest.beforeAll(async () => {
    await seedTestUsers()
  })

  authTest('dashboard view', async ({ page, realAuth }) => {
    await realAuth(page, 'e2e-user@test.juicy.vision')
    await waitForStableUI(page)

    // Hide dynamic wallet data
    await page.locator('[data-testid="wallet-balance"]').evaluateAll(els =>
      els.forEach(el => (el as HTMLElement).style.visibility = 'hidden')
    ).catch(() => {})

    await expect(page).toHaveScreenshot('authenticated-dashboard.png', {
      maxDiffPixels: 150,
      threshold: 0.25,
    })
  })

  authTest('chat interface', async ({ page, realAuth }) => {
    await realAuth(page, 'e2e-user@test.juicy.vision')
    await waitForStableUI(page)

    // Find and focus the chat input
    const chatInput = page.locator('textarea, input[type="text"]').first()
    if (await chatInput.count() > 0) {
      await chatInput.click()
      await page.waitForTimeout(200)
    }

    await expect(page).toHaveScreenshot('authenticated-chat.png', {
      maxDiffPixels: 150,
      threshold: 0.25,
    })
  })
})

// ============================================================================
// Component Visual Tests
// ============================================================================

test.describe('Visual Regression - Components', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('buttons and inputs', async ({ page }) => {
    await page.goto('/')
    await waitForStableUI(page)

    // Capture button styles
    const buttons = page.locator('button:visible').first()
    if (await buttons.count() > 0) {
      await expect(buttons).toHaveScreenshot('component-button.png', {
        maxDiffPixels: 50,
        threshold: 0.1,
      })
    }
  })

  test('navigation elements', async ({ page }) => {
    await page.goto('/')
    await waitForStableUI(page)

    // Capture nav if visible
    const nav = page.locator('nav, header').first()
    if (await nav.count() > 0) {
      await expect(nav).toHaveScreenshot('component-navigation.png', {
        maxDiffPixels: 100,
        threshold: 0.2,
      })
    }
  })
})

// ============================================================================
// Dark Mode Visual Tests (if applicable)
// ============================================================================

test.describe('Visual Regression - Dark Mode', () => {
  test.use({
    viewport: { width: 1280, height: 800 },
    colorScheme: 'dark',
  })

  test('home page dark mode', async ({ page }) => {
    await page.goto('/')
    await waitForStableUI(page)

    await expect(page).toHaveScreenshot('dark-mode-home.png', {
      maxDiffPixels: 100,
      threshold: 0.2,
    })
  })
})

// ============================================================================
// Full Page Screenshots
// ============================================================================

test.describe('Visual Regression - Full Page', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('home page full', async ({ page }) => {
    await page.goto('/')
    await waitForStableUI(page)

    await expect(page).toHaveScreenshot('full-page-home.png', {
      fullPage: true,
      maxDiffPixels: 500, // More tolerance for full page
      threshold: 0.3,
    })
  })
})

// ============================================================================
// Interaction State Visual Tests
// ============================================================================

test.describe('Visual Regression - Interaction States', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('button hover state', async ({ page }) => {
    await page.goto('/')
    await waitForStableUI(page)

    const button = page.locator('button:visible').first()
    if (await button.count() > 0) {
      await button.hover()
      await page.waitForTimeout(200)

      await expect(button).toHaveScreenshot('state-button-hover.png', {
        maxDiffPixels: 50,
        threshold: 0.1,
      })
    }
  })

  test('input focus state', async ({ page }) => {
    await page.goto('/')
    await waitForStableUI(page)

    const input = page.locator('input:visible, textarea:visible').first()
    if (await input.count() > 0) {
      await input.focus()
      await page.waitForTimeout(200)

      await expect(input).toHaveScreenshot('state-input-focus.png', {
        maxDiffPixels: 50,
        threshold: 0.1,
      })
    }
  })
})

// ============================================================================
// Cross-Browser Visual Tests (requires multiple projects in playwright.config)
// ============================================================================

test.describe('Visual Regression - Cross Browser', () => {
  test('home page renders consistently', async ({ page, browserName }) => {
    await page.goto('/')
    await waitForStableUI(page)

    await expect(page).toHaveScreenshot(`cross-browser-home-${browserName}.png`, {
      maxDiffPixels: 200, // More tolerance for cross-browser
      threshold: 0.3,
    })
  })
})
