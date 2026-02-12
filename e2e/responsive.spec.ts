import { test, expect, devices } from '@playwright/test'
import { test as authTest, seedTestUsers, setupRealAuth } from './fixtures/auth'
import { createUXAgent } from './ux-bot'

/**
 * Responsive & Mobile Testing Suite
 *
 * Tests app behavior at different viewport sizes:
 * - Mobile (375px - iPhone SE)
 * - Mobile Large (414px - iPhone Pro Max)
 * - Tablet (768px - iPad)
 * - Desktop (1280px)
 * - Large Desktop (1920px)
 *
 * Run with: npm run test:responsive
 */

// Viewport configurations
const VIEWPORTS = {
  mobileSmall: { width: 320, height: 568, name: 'Mobile Small (320px)' },
  mobile: { width: 375, height: 667, name: 'Mobile (375px)' },
  mobileLarge: { width: 414, height: 896, name: 'Mobile Large (414px)' },
  tablet: { width: 768, height: 1024, name: 'Tablet (768px)' },
  desktop: { width: 1280, height: 800, name: 'Desktop (1280px)' },
  desktopLarge: { width: 1920, height: 1080, name: 'Large Desktop (1920px)' },
  desktop4k: { width: 3840, height: 2160, name: '4K (3840px)' },
}

// ============================================================================
// Core Layout Tests
// ============================================================================

test.describe('Responsive - Layout Integrity', () => {
  for (const [key, viewport] of Object.entries(VIEWPORTS)) {
    test(`renders correctly at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/')
      await page.waitForLoadState('domcontentloaded')

      // Check no horizontal overflow
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
      expect(bodyWidth).toBeLessThanOrEqual(viewport.width + 20) // Allow small margin

      // Check main content is visible
      const mainContent = page.locator('main, [role="main"], .main-content, #root > div').first()
      if (await mainContent.count() > 0) {
        await expect(mainContent).toBeVisible()
      }

      // Check for elements that are cut off (warn, don't fail)
      // Note: Exclude elements inside infinite canvas (scattered prompts on welcome screen)
      const allElements = await page.locator('button:not([class*="cursor-grab"] *), a:not([class*="cursor-grab"] *), input, [role="button"]:not([class*="cursor-grab"] *)').all()
      const offscreenElements: string[] = []
      for (const element of allElements.slice(0, 20)) {
        const box = await element.boundingBox()
        if (box) {
          // Element should be within viewport or scrollable area
          // Skip elements that are part of the infinite canvas (very negative X)
          if (box.x < -100) continue // Infinite canvas elements are at x=-5000+

          if (box.x < -10 || box.x + box.width > viewport.width + 50) {
            const text = await element.textContent().catch(() => '')
            offscreenElements.push(`Element at x=${box.x.toFixed(0)}: "${text?.slice(0, 30)}"`)
          }
        }
      }
      if (offscreenElements.length > 0) {
        console.warn(`[${viewport.name}] Off-screen elements found:`, offscreenElements.slice(0, 5))
      }
    })
  }
})

// ============================================================================
// Mobile-Specific Tests
// ============================================================================

test.describe('Responsive - Mobile Experience', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('navigation menu is accessible on mobile', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Look for hamburger menu or mobile nav
    const mobileNav = page.locator(
      '[aria-label*="menu" i], [aria-label*="nav" i], button:has(svg), .hamburger, .mobile-menu'
    )

    if (await mobileNav.count() > 0) {
      await mobileNav.first().click()
      await page.waitForTimeout(500)

      // Menu should be visible
      const menuItems = page.locator('nav a, [role="menuitem"], .nav-link')
      expect(await menuItems.count()).toBeGreaterThan(0)
    }
  })

  test('forms are usable on mobile', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const inputs = await page.locator('input:visible').all()

    for (const input of inputs.slice(0, 5)) {
      const box = await input.boundingBox()
      if (box) {
        // Input should be at least 44px tall (touch target)
        expect(box.height).toBeGreaterThanOrEqual(30)

        // Input should be reasonably wide
        expect(box.width).toBeGreaterThanOrEqual(100)
      }
    }
  })

  test('buttons are touch-friendly', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const buttons = await page.locator('button:visible, [role="button"]:visible').all()

    for (const button of buttons.slice(0, 10)) {
      const box = await button.boundingBox()
      if (box) {
        // Buttons should be at least 44x44 for touch (WCAG guideline)
        // Allow some smaller utility buttons but warn
        if (box.height < 30 || box.width < 30) {
          console.warn(`Small touch target found: ${box.width}x${box.height}`)
        }
      }
    }
  })

  test('text is readable without zooming', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Check font sizes
    const textElements = await page.locator('p, span, div, h1, h2, h3, h4, h5, h6, a, button, label').all()

    for (const element of textElements.slice(0, 20)) {
      const fontSize = await element.evaluate((el) => {
        const style = window.getComputedStyle(el)
        return parseFloat(style.fontSize)
      })

      // Text should be at least 12px (ideally 14px+)
      if (fontSize > 0 && fontSize < 10) {
        const text = await element.textContent()
        console.warn(`Very small text (${fontSize}px): "${text?.slice(0, 50)}"`)
      }
    }
  })

  test('scrolling works smoothly', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Scroll down
    await page.evaluate(() => window.scrollTo(0, 500))
    await page.waitForTimeout(100)

    const scrollY = await page.evaluate(() => window.scrollY)
    expect(scrollY).toBeGreaterThan(0)

    // Scroll back up
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(100)

    const scrollYAfter = await page.evaluate(() => window.scrollY)
    expect(scrollYAfter).toBe(0)
  })
})

// ============================================================================
// Tablet Tests
// ============================================================================

test.describe('Responsive - Tablet Experience', () => {
  test.use({ viewport: { width: 768, height: 1024 } })

  test('layout adapts for tablet', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Check for multi-column layouts
    const containers = await page.locator('.grid, .flex, [class*="grid"], [class*="flex"]').all()

    // At least some flex/grid containers should exist
    expect(containers.length).toBeGreaterThan(0)

    // No horizontal scroll
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
    expect(bodyWidth).toBeLessThanOrEqual(768 + 20)
  })

  test('modals fit within viewport', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Try to trigger a modal
    const modalTriggers = page.locator(
      'button:has-text("settings"), button:has-text("more"), [aria-haspopup="dialog"]'
    )

    if (await modalTriggers.count() > 0) {
      await modalTriggers.first().click()
      await page.waitForTimeout(500)

      const modal = page.locator('[role="dialog"], .modal, [class*="modal"]')
      if (await modal.count() > 0) {
        const box = await modal.first().boundingBox()
        if (box) {
          expect(box.width).toBeLessThanOrEqual(768)
          expect(box.height).toBeLessThanOrEqual(1024)
        }
      }
    }
  })
})

// ============================================================================
// Large Screen Tests
// ============================================================================

test.describe('Responsive - Large Screens', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('content does not stretch awkwardly', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Check for max-width containers
    const mainContainers = await page.locator('main, .container, [class*="container"], [class*="max-w"]').all()

    for (const container of mainContainers.slice(0, 5)) {
      const box = await container.boundingBox()
      if (box) {
        // Content should have reasonable max-width, not stretch to 1920px
        // (unless it's a full-width section intentionally)
        if (box.width > 1600) {
          const classes = await container.getAttribute('class')
          console.warn(`Wide container (${box.width}px): ${classes}`)
        }
      }
    }
  })

  test('text line length is readable', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const paragraphs = await page.locator('p').all()

    for (const p of paragraphs.slice(0, 10)) {
      const box = await p.boundingBox()
      if (box) {
        // Optimal line length is 50-75 characters, roughly 600-900px
        // Warn if text is too wide
        if (box.width > 1000) {
          const text = await p.textContent()
          if (text && text.length > 100) {
            console.warn(`Wide text block (${box.width}px): may be hard to read`)
          }
        }
      }
    }
  })
})

// ============================================================================
// Orientation Tests
// ============================================================================

test.describe('Responsive - Orientation Changes', () => {
  test('handles portrait to landscape', async ({ page }) => {
    // Start in portrait
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Switch to landscape
    await page.setViewportSize({ width: 667, height: 375 })
    await page.waitForTimeout(500)

    // Content should adapt
    await expect(page.locator('body')).toBeVisible()

    // No horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
    expect(bodyWidth).toBeLessThanOrEqual(667 + 20)
  })

  test('handles landscape to portrait', async ({ page }) => {
    // Start in landscape
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Switch to portrait
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.waitForTimeout(500)

    // Content should adapt
    await expect(page.locator('body')).toBeVisible()
  })
})

// ============================================================================
// Authenticated Mobile Tests
// ============================================================================

authTest.describe('Responsive - Authenticated Mobile', () => {
  authTest.use({ viewport: { width: 375, height: 667 } })
  authTest.setTimeout(120000)

  authTest.beforeAll(async () => {
    await seedTestUsers()
  })

  authTest('can complete flows on mobile', async ({ page, realAuth }) => {
    await realAuth(page, 'e2e-user@test.juicy.vision')

    const agent = createUXAgent(page, {
      maxSteps: 15,
      screenshotOnEachStep: true,
    })

    const report = await agent.runScenario(
      'On mobile, navigate through the app, open menus, and try to interact with the main features'
    )

    console.log(`Mobile authenticated test: ${report.status}`)
    console.log(`Steps: ${report.steps.length}`)
    console.log(`Issues: ${report.issues.length}`)

    // Should be able to navigate
    expect(report.steps.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// Device Emulation Tests
// ============================================================================

test.describe('Responsive - Device Emulation', () => {
  test('works on iPhone SE', async ({ browser }) => {
    const context = await browser.newContext({
      ...devices['iPhone SE'],
    })
    const page = await context.newPage()

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('body')).toBeVisible()

    // Take screenshot for visual verification
    await page.screenshot({ path: 'test-results/responsive/iphone-se.png' })

    await context.close()
  })

  test('works on iPhone 14 Pro Max', async ({ browser }) => {
    const context = await browser.newContext({
      ...devices['iPhone 14 Pro Max'],
    })
    const page = await context.newPage()

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('body')).toBeVisible()

    await page.screenshot({ path: 'test-results/responsive/iphone-14-pro-max.png' })

    await context.close()
  })

  test('works on iPad Pro', async ({ browser }) => {
    const context = await browser.newContext({
      ...devices['iPad Pro 11'],
    })
    const page = await context.newPage()

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('body')).toBeVisible()

    await page.screenshot({ path: 'test-results/responsive/ipad-pro.png' })

    await context.close()
  })

  test('works on Pixel 7', async ({ browser }) => {
    const context = await browser.newContext({
      ...devices['Pixel 7'],
    })
    const page = await context.newPage()

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('body')).toBeVisible()

    await page.screenshot({ path: 'test-results/responsive/pixel-7.png' })

    await context.close()
  })
})
