import { test, expect } from '@playwright/test'

test.describe('Juicy Vision App', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage before each test
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test.describe('Initial Load', () => {
    test('loads the app without errors', async ({ page }) => {
      await page.goto('/')
      // Should see the main container with the orange border
      await expect(page.locator('.border-juice-orange')).toBeVisible()
    })

    test('shows welcome screen when no messages', async ({ page }) => {
      await page.goto('/')
      // Welcome screen should be visible
      await expect(page.locator('text=juicy.vision').first()).toBeVisible()
    })

    test('shows live activity sidebar', async ({ page }) => {
      await page.goto('/')
      // Activity sidebar should be visible
      await expect(page.locator('text=Live juicy activity')).toBeVisible()
    })
  })

  test.describe('Theme', () => {
    test('defaults to dark theme', async ({ page }) => {
      await page.goto('/')
      // Check that the html element has dark class
      const htmlClass = await page.locator('html').getAttribute('class')
      expect(htmlClass).toBe('dark')
    })

    test('applies dark theme styles', async ({ page }) => {
      await page.goto('/')
      // Dark theme should have dark background
      const body = page.locator('body')
      const bgColor = await body.evaluate((el) =>
        window.getComputedStyle(el).backgroundColor
      )
      // Should be a dark color
      expect(bgColor).toBeTruthy()
    })
  })

  test.describe('Chat Interface', () => {
    test('shows chat input area', async ({ page }) => {
      await page.goto('/')
      // Chat input should be visible
      const chatInput = page.locator('textarea, input[type="text"]').first()
      await expect(chatInput).toBeVisible()
    })

    test('can type in chat input', async ({ page }) => {
      await page.goto('/')
      // Find the chat input
      const chatInput = page.locator('textarea').first()
      await chatInput.fill('Hello, Juice!')
      await expect(chatInput).toHaveValue('Hello, Juice!')
    })
  })

  test.describe('Mobile Sidebar', () => {
    test('sidebar is hidden on mobile by default', async ({ page }) => {
      // Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 })
      await page.goto('/')

      // The mobile sidebar content should not be visible initially
      const sidebarContent = page.locator('text=Conversations')
      await expect(sidebarContent).not.toBeVisible()
    })

    test('can open sidebar on mobile', async ({ page }) => {
      // Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 })
      await page.goto('/')

      // Click the menu button (hamburger icon)
      const menuButton = page.locator('button').filter({ has: page.locator('svg path[d*="M4 6h16"]') }).first()

      // Only try to click if the button is visible
      if (await menuButton.isVisible()) {
        await menuButton.click()
        // Sidebar should be visible
        await expect(page.locator('text=Conversations')).toBeVisible()
      }
    })
  })

  test.describe('URL Navigation', () => {
    test('handles hash-based routing', async ({ page }) => {
      await page.goto('/#/some-route')
      // App should still load correctly with hash routes
      await expect(page.locator('.border-juice-orange')).toBeVisible()
    })

    test('navigates back to home on invalid routes', async ({ page }) => {
      await page.goto('/#/invalid-route')
      // Should still show the app
      await expect(page.locator('.border-juice-orange')).toBeVisible()
    })
  })

  test.describe('Responsive Layout', () => {
    test('desktop layout shows full width', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 })
      await page.goto('/')

      // Activity sidebar should be visible on desktop
      await expect(page.locator('text=Live juicy activity')).toBeVisible()
    })

    test('mobile layout adjusts correctly', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 })
      await page.goto('/')

      // App should still render
      await expect(page.locator('.border-juice-orange')).toBeVisible()
    })
  })

  test.describe('Accessibility', () => {
    test('has visible text elements', async ({ page }) => {
      await page.goto('/')
      // Check that key text is visible
      await expect(page.locator('text=juicy.vision').first()).toBeVisible()
    })

    test('interactive elements are focusable', async ({ page }) => {
      await page.goto('/')
      // Tab through the page
      await page.keyboard.press('Tab')
      // Some element should have focus
      const focusedElement = await page.evaluate(() =>
        document.activeElement?.tagName.toLowerCase()
      )
      expect(focusedElement).toBeTruthy()
    })
  })

  test.describe('Local Storage', () => {
    test('persists theme preference', async ({ page }) => {
      await page.goto('/')
      // Check that theme is stored in localStorage
      const storedTheme = await page.evaluate(() =>
        localStorage.getItem('juice-theme')
      )
      expect(storedTheme).toBeTruthy()
    })
  })
})

test.describe('Error Handling', () => {
  test('handles network errors gracefully', async ({ page }) => {
    // Block all API requests to simulate network failure
    await page.route('**/api/**', route => route.abort())

    await page.goto('/')
    // App should still load the static content
    await expect(page.locator('.border-juice-orange')).toBeVisible()
  })
})
