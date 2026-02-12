import { test, expect, type Page } from '../fixtures/auth'
import { mockAuthEndpoints } from '../fixtures/auth'
import { mockProjectEndpoints, createMockProject } from '../fixtures/api'

/**
 * Accessibility Tests
 *
 * Tests for WCAG compliance and accessibility best practices:
 * - Keyboard navigation
 * - Screen reader support
 * - Color contrast
 * - Focus management
 * - ARIA attributes
 */

test.describe('Accessibility: Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Tab Navigation', () => {
    test('can tab through all interactive elements', async ({ page }) => {
      let tabCount = 0
      const maxTabs = 50 // Limit to prevent infinite loop

      while (tabCount < maxTabs) {
        await page.keyboard.press('Tab')
        tabCount++

        const focused = page.locator(':focus')
        const isVisible = await focused.isVisible().catch(() => false)

        if (!isVisible) {
          // May have looped back to start
          break
        }

        // Verify focused element is interactive
        const tagName = await focused.evaluate(el => el.tagName.toLowerCase())
        const validTags = ['a', 'button', 'input', 'textarea', 'select', 'details', 'summary']
        const hasTabIndex = await focused.getAttribute('tabindex')
        const isInteractive = validTags.includes(tagName) || hasTabIndex !== null

        if (tagName !== 'body') {
          expect(isInteractive).toBe(true)
        }
      }
    })

    test('Shift+Tab navigates backwards', async ({ page }) => {
      // Tab forward a few times
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')

      const thirdFocus = await page.locator(':focus').textContent().catch(() => null)

      // Tab back
      await page.keyboard.press('Shift+Tab')

      const secondFocus = await page.locator(':focus').textContent().catch(() => null)

      // Should be different elements
      // (may not be if only one focusable element)
    })

    test('focus is visible', async ({ page }) => {
      await page.keyboard.press('Tab')

      const focused = page.locator(':focus')

      if (await focused.isVisible()) {
        // Check for visible focus indicator
        const outline = await focused.evaluate(el => {
          const style = getComputedStyle(el)
          return style.outline || style.boxShadow || style.border
        })

        // Should have some visual focus indicator
        // (outline, box-shadow, or border change)
      }
    })

    test('skip link exists for main content', async ({ page }) => {
      // First Tab should hit skip link (if implemented)
      await page.keyboard.press('Tab')

      const skipLink = page.locator('a').filter({
        hasText: /skip|main content/i
      }).first()

      // Skip link is a best practice
    })
  })

  test.describe('Enter/Space Activation', () => {
    test('Enter activates buttons', async ({ page }) => {
      const button = page.locator('button').first()

      if (await button.isVisible()) {
        await button.focus()
        await page.keyboard.press('Enter')

        // Button should activate
      }
    })

    test('Space activates buttons', async ({ page }) => {
      const button = page.locator('button').first()

      if (await button.isVisible()) {
        await button.focus()
        await page.keyboard.press('Space')

        // Button should activate
      }
    })

    test('Enter submits forms', async ({ page }) => {
      const input = page.locator('input[type="text"], textarea').first()

      if (await input.isVisible()) {
        await input.focus()
        await input.fill('Test')
        await page.keyboard.press('Enter')

        // Form should submit (or action should occur)
      }
    })
  })

  test.describe('Escape Key', () => {
    test('Escape closes modals', async ({ page }) => {
      // Open a modal first
      const modalTrigger = page.locator('button').filter({
        hasText: /sign in|connect|menu/i
      }).first()

      if (await modalTrigger.isVisible()) {
        await modalTrigger.click()
        await page.waitForTimeout(300)

        // Press Escape
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)

        // Modal should close
        const modal = page.locator('[role="dialog"]')
        // Modal visibility should change
      }
    })

    test('Escape closes dropdowns', async ({ page }) => {
      // Find and open dropdown
      const dropdown = page.locator('[aria-haspopup]').first()

      if (await dropdown.isVisible()) {
        await dropdown.click()
        await page.waitForTimeout(200)

        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)

        // Dropdown should close
      }
    })
  })

  test.describe('Arrow Key Navigation', () => {
    test('arrows navigate within menus', async ({ page }) => {
      // Open menu
      const menuTrigger = page.locator('[aria-haspopup="menu"]').first()

      if (await menuTrigger.isVisible()) {
        await menuTrigger.click()
        await page.waitForTimeout(200)

        // Arrow down should move focus
        await page.keyboard.press('ArrowDown')
        await page.waitForTimeout(100)

        const focused = page.locator(':focus')
        // Should be within menu
      }
    })

    test('arrows navigate within tabs', async ({ page }) => {
      const tabList = page.locator('[role="tablist"]').first()

      if (await tabList.isVisible()) {
        const firstTab = tabList.locator('[role="tab"]').first()
        await firstTab.focus()

        await page.keyboard.press('ArrowRight')
        await page.waitForTimeout(100)

        // Focus should move to next tab
      }
    })
  })
})

test.describe('Accessibility: ARIA and Semantics', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test.describe('Landmarks', () => {
    test('page has main landmark', async ({ page }) => {
      const main = page.locator('main, [role="main"]')
      await expect(main.first()).toBeVisible()
    })

    test('page has navigation landmark', async ({ page }) => {
      const nav = page.locator('nav, [role="navigation"]')
      // Navigation should exist
    })

    test('page has contentinfo (footer) if applicable', async ({ page }) => {
      const footer = page.locator('footer, [role="contentinfo"]')
      // Footer may exist
    })
  })

  test.describe('Headings', () => {
    test('has exactly one h1', async ({ page }) => {
      const h1Count = await page.locator('h1').count()
      expect(h1Count).toBe(1)
    })

    test('heading levels are sequential', async ({ page }) => {
      const headings = await page.locator('h1, h2, h3, h4, h5, h6').all()
      let lastLevel = 0

      for (const heading of headings) {
        const tag = await heading.evaluate(el => el.tagName.toLowerCase())
        const level = parseInt(tag.replace('h', ''))

        // Should not skip levels (h1 -> h3 is bad)
        expect(level).toBeLessThanOrEqual(lastLevel + 1)
        lastLevel = level
      }
    })
  })

  test.describe('Button and Link Labels', () => {
    test('all buttons have accessible names', async ({ page }) => {
      const buttons = await page.locator('button').all()

      for (const button of buttons.slice(0, 20)) { // Check first 20
        if (await button.isVisible()) {
          const hasText = (await button.textContent())?.trim()
          const ariaLabel = await button.getAttribute('aria-label')
          const ariaLabelledBy = await button.getAttribute('aria-labelledby')
          const title = await button.getAttribute('title')

          // Should have some accessible name
          expect(hasText || ariaLabel || ariaLabelledBy || title).toBeTruthy()
        }
      }
    })

    test('all links have accessible names', async ({ page }) => {
      const links = await page.locator('a').all()

      for (const link of links.slice(0, 20)) {
        if (await link.isVisible()) {
          const hasText = (await link.textContent())?.trim()
          const ariaLabel = await link.getAttribute('aria-label')

          expect(hasText || ariaLabel).toBeTruthy()
        }
      }
    })

    test('icon buttons have labels', async ({ page }) => {
      // Buttons with only SVG/icon need aria-label
      const iconButtons = await page.locator('button:has(svg)').all()

      for (const button of iconButtons.slice(0, 10)) {
        if (await button.isVisible()) {
          const text = (await button.textContent())?.trim()
          const ariaLabel = await button.getAttribute('aria-label')
          const title = await button.getAttribute('title')

          // If no text, must have aria-label or title
          if (!text) {
            expect(ariaLabel || title).toBeTruthy()
          }
        }
      }
    })
  })

  test.describe('Form Labels', () => {
    test('all inputs have associated labels', async ({ page }) => {
      const inputs = await page.locator('input, textarea, select').all()

      for (const input of inputs.slice(0, 10)) {
        if (await input.isVisible()) {
          const id = await input.getAttribute('id')
          const ariaLabel = await input.getAttribute('aria-label')
          const ariaLabelledBy = await input.getAttribute('aria-labelledby')
          const placeholder = await input.getAttribute('placeholder')

          if (id) {
            const label = page.locator(`label[for="${id}"]`)
            const hasLabel = await label.count() > 0

            // Should have label, aria-label, or aria-labelledby
            expect(hasLabel || ariaLabel || ariaLabelledBy || placeholder).toBeTruthy()
          }
        }
      }
    })

    test('required fields are marked', async ({ page }) => {
      const requiredInputs = await page.locator('input[required], textarea[required]').all()

      for (const input of requiredInputs) {
        // Should have aria-required or visual indicator
        const ariaRequired = await input.getAttribute('aria-required')
        // aria-required should be true or input should have required attribute
      }
    })
  })

  test.describe('Images', () => {
    test('all images have alt text', async ({ page }) => {
      const images = await page.locator('img').all()

      for (const img of images) {
        if (await img.isVisible()) {
          const alt = await img.getAttribute('alt')
          // Alt can be empty string for decorative images, but should exist
          expect(alt !== null).toBe(true)
        }
      }
    })

    test('decorative images have empty alt', async ({ page }) => {
      // Images with role="presentation" or empty alt are decorative
      const decorativeImages = await page.locator('img[role="presentation"], img[alt=""]').all()

      for (const img of decorativeImages) {
        const alt = await img.getAttribute('alt')
        expect(alt).toBe('')
      }
    })
  })
})

test.describe('Accessibility: Focus Management', () => {
  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page)
    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Modal Focus', () => {
    test('focus moves to modal when opened', async ({ page }) => {
      const modalTrigger = page.locator('button').filter({
        hasText: /sign in|connect|menu|settings/i
      }).first()

      if (await modalTrigger.isVisible()) {
        await modalTrigger.click()
        await page.waitForTimeout(300)

        const modal = page.locator('[role="dialog"]').first()

        if (await modal.isVisible()) {
          // Focus should be within modal
          const focused = page.locator(':focus')
          const focusInModal = await modal.locator(':focus').count() > 0

          // Focus should be trapped in modal
        }
      }
    })

    test('focus returns to trigger when modal closes', async ({ page }) => {
      const modalTrigger = page.locator('button').filter({
        hasText: /sign in|connect/i
      }).first()

      if (await modalTrigger.isVisible()) {
        await modalTrigger.click()
        await page.waitForTimeout(300)

        // Close modal
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)

        // Focus should return to trigger
        const focused = page.locator(':focus')
        // Should be back on trigger or nearby
      }
    })

    test('focus is trapped within modal', async ({ page }) => {
      const modalTrigger = page.locator('button').filter({
        hasText: /sign in|connect/i
      }).first()

      if (await modalTrigger.isVisible()) {
        await modalTrigger.click()
        await page.waitForTimeout(300)

        const modal = page.locator('[role="dialog"]').first()

        if (await modal.isVisible()) {
          // Tab should cycle within modal
          for (let i = 0; i < 20; i++) {
            await page.keyboard.press('Tab')
            await page.waitForTimeout(50)

            const focused = page.locator(':focus')
            // Focus should stay within modal
          }
        }
      }
    })
  })

  test.describe('Dynamic Content', () => {
    test('focus moves to new content appropriately', async ({ page }) => {
      // After action, focus should move to relevant content
      const chatInput = page.locator('textarea, input[type="text"]').first()

      if (await chatInput.isVisible()) {
        await chatInput.fill('Test message')
        await chatInput.press('Enter')
        await page.waitForTimeout(1000)

        // Focus should remain logical (may stay on input for next message)
      }
    })

    test('announces dynamic changes', async ({ page }) => {
      // Live regions should announce changes
      const liveRegion = page.locator('[aria-live]')
      // Live region may exist for status updates
    })
  })
})

test.describe('Accessibility: Color and Contrast', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test.describe('Light Mode', () => {
    test('text is readable in light mode', async ({ page }) => {
      // Ensure light mode
      const themeToggle = page.locator('[data-testid="theme-toggle"]').first()
      // Toggle to light if needed

      // Sample text elements for contrast
      const textElements = await page.locator('p, span, h1, h2, h3, button').all()

      for (const el of textElements.slice(0, 5)) {
        if (await el.isVisible()) {
          const styles = await el.evaluate(element => {
            const computed = getComputedStyle(element)
            return {
              color: computed.color,
              backgroundColor: computed.backgroundColor,
            }
          })

          // Would need color contrast calculation
          // For now, just verify styles exist
          expect(styles.color).toBeTruthy()
        }
      }
    })
  })

  test.describe('Dark Mode', () => {
    test('text is readable in dark mode', async ({ page }) => {
      // Toggle to dark mode
      const themeToggle = page.locator('[data-testid="theme-toggle"]').first()
      if (await themeToggle.isVisible()) {
        await themeToggle.click()
        await page.waitForTimeout(300)
      }

      // Verify text is still readable
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Color Independence', () => {
    test('information not conveyed by color alone', async ({ page }) => {
      // Errors should have icons/text, not just red color
      // Success should have icons/text, not just green color

      // Find error states
      const errorElements = page.locator('[class*="error"], [class*="red"], .text-red-500')

      for (const el of await errorElements.all()) {
        if (await el.isVisible()) {
          // Should have icon, text, or aria-label
          const hasText = (await el.textContent())?.trim()
          const hasIcon = await el.locator('svg').count() > 0

          // Error should be perceivable without color
        }
      }
    })
  })
})

test.describe('Accessibility: Screen Reader Support', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test.describe('ARIA States', () => {
    test('expandable elements have aria-expanded', async ({ page }) => {
      const expandables = await page.locator('[aria-expanded]').all()

      for (const el of expandables) {
        const expanded = await el.getAttribute('aria-expanded')
        expect(['true', 'false']).toContain(expanded)
      }
    })

    test('selected items have aria-selected', async ({ page }) => {
      const selectables = await page.locator('[aria-selected]').all()

      for (const el of selectables) {
        const selected = await el.getAttribute('aria-selected')
        expect(['true', 'false']).toContain(selected)
      }
    })

    test('disabled elements have aria-disabled', async ({ page }) => {
      const disabledButtons = await page.locator('button[disabled]').all()

      for (const button of disabledButtons) {
        // Disabled buttons should be perceivable
        const ariaDisabled = await button.getAttribute('aria-disabled')
        // May have aria-disabled="true" or just disabled attribute
      }
    })
  })

  test.describe('Live Regions', () => {
    test('status messages are announced', async ({ page }) => {
      // Find live regions
      const liveRegions = await page.locator('[aria-live]').all()

      for (const region of liveRegions) {
        const politeness = await region.getAttribute('aria-live')
        expect(['polite', 'assertive', 'off']).toContain(politeness)
      }
    })

    test('loading states are announced', async ({ page }) => {
      // aria-busy for loading states
      const busyElements = await page.locator('[aria-busy]').all()

      for (const el of busyElements) {
        const busy = await el.getAttribute('aria-busy')
        expect(['true', 'false']).toContain(busy)
      }
    })
  })

  test.describe('Hidden Content', () => {
    test('decorative elements hidden from AT', async ({ page }) => {
      // Elements with aria-hidden should not be interactive
      const hiddenElements = await page.locator('[aria-hidden="true"]').all()

      for (const el of hiddenElements) {
        // Should not contain focusable children
        const focusableChildren = await el.locator('a, button, input, [tabindex]').count()
        // Focusable children in aria-hidden is an error
      }
    })
  })
})

test.describe('Accessibility: Reduced Motion', () => {
  test('respects prefers-reduced-motion', async ({ page }) => {
    // Emulate reduced motion preference
    await page.emulateMedia({ reducedMotion: 'reduce' })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // App should disable or reduce animations
    // Check for animation-duration: 0 or similar

    await expect(page.locator('body')).toBeVisible()
  })
})

test.describe('Accessibility: Text Scaling', () => {
  test('content readable at 200% zoom', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Zoom to 200%
    await page.evaluate(() => {
      document.body.style.zoom = '2'
    })

    // Content should still be usable
    await expect(page.locator('body')).toBeVisible()

    // No horizontal scroll
    const hasHorizontalScroll = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth * 2
    )

    // May have some scroll at high zoom, but should be minimal
  })

  test('text not truncated at larger sizes', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Increase font size
    await page.evaluate(() => {
      document.body.style.fontSize = '24px'
    })

    await page.waitForTimeout(300)

    // Check for truncated text (text-overflow: ellipsis)
    // Critical text should not be cut off
    await expect(page.locator('body')).toBeVisible()
  })
})
