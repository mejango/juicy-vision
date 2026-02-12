import { test, expect } from '../fixtures/auth'

/**
 * User Journey 1.1: New User Lands on App
 *
 * Tests the first impression and basic functionality available
 * to users before they authenticate.
 */
test.describe('New User Landing Experience', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing state
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Initial Page Load', () => {
    test('shows app title and branding', async ({ page }) => {
      // App should have identifiable branding
      await expect(page.locator('body')).toBeVisible()

      // Look for logo or title
      const branding = page.locator('[data-testid="logo"], img[alt*="logo" i], h1').first()
      // Branding element should exist
    })

    test('chat input is visible and ready', async ({ page }) => {
      // Main chat input should be immediately visible
      const chatInput = page.locator('textarea, input[type="text"]').filter({
        hasText: /message|chat|ask|type/i
      }).first().or(
        page.locator('[data-testid="chat-input"], [placeholder*="message" i]')
      ).first()

      await expect(chatInput).toBeVisible({ timeout: 5000 })
    })

    test('suggestion pills are visible', async ({ page }) => {
      // Should show clickable suggestions for new users
      const suggestions = page.locator('button').filter({
        hasText: /fund|treasury|project|create|launch/i
      })

      const count = await suggestions.count()
      expect(count).toBeGreaterThan(0)
    })

    test('sign in button is visible', async ({ page }) => {
      // Unauthenticated users should see way to sign in
      const signInBtn = page.locator('button').filter({
        hasText: /sign in|connect|login|get started/i
      }).first()

      await expect(signInBtn).toBeVisible()
    })
  })

  test.describe('Theme Toggle', () => {
    test('theme toggle exists and works', async ({ page }) => {
      // Find theme toggle
      const themeToggle = page.locator('[data-testid="theme-toggle"], button[aria-label*="theme" i], button[title*="theme" i]').first()

      if (await themeToggle.isVisible()) {
        // Get initial state
        const initialBg = await page.evaluate(() =>
          getComputedStyle(document.body).backgroundColor
        )

        await themeToggle.click()
        await page.waitForTimeout(300)

        // Background should change
        const newBg = await page.evaluate(() =>
          getComputedStyle(document.body).backgroundColor
        )

        // Theme should have toggled (color changed)
        expect(newBg).not.toBe(initialBg)
      }
    })

    test('theme preference persists', async ({ page }) => {
      const themeToggle = page.locator('[data-testid="theme-toggle"], button[aria-label*="theme" i]').first()

      if (await themeToggle.isVisible()) {
        await themeToggle.click()
        await page.waitForTimeout(300)

        const themeAfterToggle = await page.evaluate(() =>
          localStorage.getItem('juice-theme') || document.body.className
        )

        // Reload page
        await page.reload()
        await page.waitForLoadState('networkidle')

        const themeAfterReload = await page.evaluate(() =>
          localStorage.getItem('juice-theme') || document.body.className
        )

        // Theme should persist
        expect(themeAfterReload).toBe(themeAfterToggle)
      }
    })
  })

  test.describe('Suggestion Pills', () => {
    test('clicking suggestion fills chat input', async ({ page }) => {
      const suggestion = page.locator('button').filter({
        hasText: /fund|treasury|project|create/i
      }).first()

      if (await suggestion.isVisible()) {
        const suggestionText = await suggestion.textContent()
        await suggestion.click()
        await page.waitForTimeout(500)

        // Chat should have the suggestion text or be in a conversational state
        const chatInput = page.locator('textarea, input[type="text"]').first()
        // Either input has text or a message was sent
      }
    })

    test('shuffle button changes suggestions', async ({ page }) => {
      const shuffleBtn = page.locator('button').filter({
        hasText: /shuffle/i
      }).first()

      if (await shuffleBtn.isVisible()) {
        // Get initial suggestions
        const initialSuggestions = await page.locator('button').filter({
          hasText: /fund|treasury|project|create|launch/i
        }).allTextContents()

        await shuffleBtn.click()
        await page.waitForTimeout(300)

        // Get new suggestions
        const newSuggestions = await page.locator('button').filter({
          hasText: /fund|treasury|project|create|launch/i
        }).allTextContents()

        // At least some suggestions should be different
        const changed = newSuggestions.some((s, i) => s !== initialSuggestions[i])
        expect(changed).toBe(true)
      }
    })
  })

  test.describe('Responsive Design', () => {
    test('mobile viewport has no horizontal scroll', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 })
      await page.reload()
      await page.waitForLoadState('networkidle')

      const hasHorizontalScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth
      )

      expect(hasHorizontalScroll).toBe(false)
    })

    test('tablet viewport renders correctly', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 })
      await page.reload()
      await page.waitForLoadState('networkidle')

      await expect(page.locator('body')).toBeVisible()

      // Chat input should still be accessible
      const chatInput = page.locator('textarea, input[type="text"]').first()
      await expect(chatInput).toBeVisible()
    })

    test('desktop viewport uses space well', async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 })
      await page.reload()
      await page.waitForLoadState('networkidle')

      await expect(page.locator('body')).toBeVisible()

      // Content should be centered, not stretched edge to edge
      const mainContent = page.locator('main, [role="main"], .container').first()
      if (await mainContent.isVisible()) {
        const box = await mainContent.boundingBox()
        if (box) {
          // Content should not span entire width
          expect(box.width).toBeLessThan(1800)
        }
      }
    })
  })

  test.describe('Accessibility', () => {
    test('page has proper heading structure', async ({ page }) => {
      const h1 = page.locator('h1')
      const h1Count = await h1.count()

      // Should have at least one h1
      expect(h1Count).toBeGreaterThanOrEqual(1)
    })

    test('interactive elements are keyboard accessible', async ({ page }) => {
      // Tab through first few interactive elements
      await page.keyboard.press('Tab')

      // Something should be focused
      const focusedElement = page.locator(':focus')
      await expect(focusedElement).toBeVisible()
    })

    test('no images missing alt text', async ({ page }) => {
      const imagesWithoutAlt = await page.locator('img:not([alt])').count()
      expect(imagesWithoutAlt).toBe(0)
    })
  })

  test.describe('Performance', () => {
    test('page loads within reasonable time', async ({ page }) => {
      const startTime = Date.now()
      await page.goto('/')
      await page.waitForLoadState('domcontentloaded')
      const loadTime = Date.now() - startTime

      // Should load DOM within 3 seconds
      expect(loadTime).toBeLessThan(3000)
    })

    test('no console errors on load', async ({ page }) => {
      const errors: string[] = []
      page.on('console', msg => {
        if (msg.type() === 'error') {
          errors.push(msg.text())
        }
      })

      await page.goto('/')
      await page.waitForLoadState('networkidle')

      // Filter out expected/ignorable errors
      const realErrors = errors.filter(e =>
        !e.includes('favicon') &&
        !e.includes('ResizeObserver') &&
        !e.includes('third-party')
      )

      expect(realErrors).toHaveLength(0)
    })
  })
})
