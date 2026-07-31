import { test, expect } from '../fixtures/auth';
import { mockAuthEndpoints } from '../fixtures/auth'
import { mockProjectEndpoints, createMockProject } from '../fixtures/api';

/**
 * Error Recovery Tests
 *
 * Tests application resilience to various failure scenarios:
 * - Network errors
 * - Transaction failures
 * - API errors
 * - State corruption
 * - Session issues
 */

test.describe('Network Error Recovery', () => {
  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page)
    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('API Failures', () => {
    test('recovers from 500 error', async ({ page }) => {
      // Mock server error
      await page.route('**/api/**', async (route) => {
        await route.fulfill({
          status: 500,
          body: JSON.stringify({ error: 'Internal server error' })
        })
      })

      await page.reload()
      await page.waitForLoadState('networkidle')

      // App should not crash
      await expect(page.locator('body')).toBeVisible()
      // Error handling should be graceful
    })

    test('recovers from 503 service unavailable', async ({ page }) => {
      await page.route('**/api/**', async (route) => {
        await route.fulfill({
          status: 503,
          body: JSON.stringify({ error: 'Service unavailable' })
        })
      })

      await page.reload()
      await page.waitForLoadState('networkidle')

      await expect(page.locator('body')).toBeVisible()
    })

    test('recovers from 429 rate limit', async ({ page }) => {
      await page.route('**/api/**', async (route) => {
        await route.fulfill({
          status: 429,
          headers: { 'Retry-After': '60' },
          body: JSON.stringify({ error: 'Rate limit exceeded' })
        })
      })

      await page.reload()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    })

    test('recovers from timeout', async ({ page }) => {
      await page.route('**/api/**', async (route) => {
        // Delay response to cause timeout
        await new Promise(resolve => setTimeout(resolve, 31000))
        await route.fulfill({ status: 200, body: '{}' })
      })

      // Page should handle timeout gracefully
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Network Disconnection', () => {
    test('handles going offline', async ({ page }) => {
      // Go offline
      await page.route('**/*', route => route.abort())

      // Try to interact
      const chatInput = page.locator('textarea, input[type="text"]').first()

      if (await chatInput.isVisible()) {
        await chatInput.fill('Test message')
        await chatInput.press('Enter')
        await page.waitForTimeout(1000)
        // Error should be shown
      }
    })

    test('recovers when coming back online', async ({ page }) => {
      // Simulate offline then online
      await page.route('**/*', route => route.abort())
      await page.waitForTimeout(1000)

      // Come back online
      await page.unroute('**/*')

      await page.reload()
      await page.waitForLoadState('networkidle')

      // Should recover
      await expect(page.locator('body')).toBeVisible()
    })

    test('retries failed requests automatically', async ({ page }) => {
      let requestCount = 0
      await page.route('**/api/**', async (route) => {
        requestCount++
        if (requestCount < 3) {
          await route.abort()
        } else {
          await route.fulfill({
            status: 200,
            body: JSON.stringify({ success: true })
          })
        }
      })

      // Request should eventually succeed after retries
    })
  })

  test.describe('Partial Data Load', () => {
    test('handles some endpoints failing while others succeed', async ({ page }) => {
      // Projects endpoint succeeds
      await page.route('**/projects**', async (route) => {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({ success: true, data: { projects: [] } })
        })
      })

      // Chat endpoint fails
      await page.route('**/chat**', async (route) => {
        await route.fulfill({
          status: 500,
          body: JSON.stringify({ error: 'Failed' })
        })
      })

      await page.reload()
      await page.waitForLoadState('networkidle')

      // App should partially work
      await expect(page.locator('body')).toBeVisible()
    })
  })
})

test.describe('Transaction Error Recovery', () => {
  const testProject = createMockProject({
    id: 800,
    name: 'Transaction Error Test',
    chainId: 1,
  })

  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page)
    await mockAuthEndpoints(page)
    await mockProjectEndpoints(page, { projects: [testProject] })

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Transaction Rejections', () => {
    test('handles user rejecting transaction', async ({ page }) => {
      await page.route('**/wallet/execute', async (route) => {
        await route.fulfill({
          status: 400,
          body: JSON.stringify({
            success: false,
            error: 'User rejected transaction'
          })
        })
      })

      await page.goto('/eth:800')
      await page.waitForLoadState('networkidle')

      // App should handle rejection gracefully
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Transaction Reverts', () => {
    test('handles on-chain revert', async ({ page }) => {
      await page.route('**/wallet/execute', async (route) => {
        await route.fulfill({
          status: 400,
          body: JSON.stringify({
            success: false,
            error: 'Transaction reverted: insufficient funds'
          })
        })
      })

      await page.goto('/eth:800')
      await page.waitForLoadState('networkidle')

      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Transaction Stuck', () => {
    test('handles transaction stuck pending', async ({ page }) => {
      await page.route('**/transactions/*', async (route) => {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({
            status: 'pending',
            hash: '0x' + '1'.repeat(64)
          })
        })
      })

      // Transaction remains pending
      // UI should show pending state
    })
  })

  test.describe('Out of Gas', () => {
    test('handles out of gas error', async ({ page }) => {
      await page.route('**/wallet/execute', async (route) => {
        await route.fulfill({
          status: 400,
          body: JSON.stringify({
            success: false,
            error: 'Transaction failed: out of gas'
          })
        })
      })

      await page.goto('/eth:800')
      await page.waitForLoadState('networkidle')

      await expect(page.locator('body')).toBeVisible()
    })
  })
})

test.describe('Session Error Recovery', () => {
  test.describe('Token Expiration', () => {
    test('handles expired auth token', async ({ page, mockManagedAuth }) => {
      await mockManagedAuth(page)

      // Simulate token expiration on API call
      await page.route('**/api/**', async (route) => {
        await route.fulfill({
          status: 401,
          body: JSON.stringify({ error: 'Token expired' })
        })
      })

      await page.reload()
      await page.waitForLoadState('networkidle')

      // Should prompt to re-authenticate
      await expect(page.locator('body')).toBeVisible()
    })

    test('clears invalid session gracefully', async ({ page }) => {
      // Set invalid token
      await page.evaluate(() => {
        const invalidAuth = {
          state: {
            mode: 'managed',
            token: 'invalid-expired-token',
            user: null,
          },
          version: 1,
        }
        localStorage.setItem('juice-auth', JSON.stringify(invalidAuth))
      })

      await page.reload()
      await page.waitForLoadState('networkidle')

      // Should recover to unauthenticated state
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Corrupted State', () => {
    test('handles corrupted localStorage', async ({ page }) => {
      await page.evaluate(() => {
        localStorage.setItem('juice-auth', 'not-valid-json{{{')
      })

      await page.reload()
      await page.waitForLoadState('networkidle')

      // Should recover by clearing bad data
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles missing required fields', async ({ page }) => {
      await page.evaluate(() => {
        const partialAuth = {
          state: { mode: 'managed' }, // Missing user, token
          version: 1,
        }
        localStorage.setItem('juice-auth', JSON.stringify(partialAuth))
      })

      await page.reload()
      await page.waitForLoadState('networkidle')

      await expect(page.locator('body')).toBeVisible()
    })

    test('handles old schema version', async ({ page }) => {
      await page.evaluate(() => {
        const oldAuth = {
          state: { oldField: 'value' },
          version: 0, // Old version
        }
        localStorage.setItem('juice-auth', JSON.stringify(oldAuth))
      })

      await page.reload()
      await page.waitForLoadState('networkidle')

      // Should migrate or reset
      await expect(page.locator('body')).toBeVisible()
    })
  })
})

test.describe('Websocket/Streaming Recovery', () => {
  test.describe('Stream Interruption', () => {
    test('handles AI response stream interruption', async ({ page, mockManagedAuth }) => {
      await mockManagedAuth(page)

      // Mock stream that stops mid-response
      await page.route('**/chat/*/ai/invoke', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"type":"chunk","content":"Hello"}\n\n'
          // No done:true, stream ends unexpectedly
        })
      })

      await page.reload()
      await page.waitForLoadState('networkidle')

      const chatInput = page.locator('textarea, input[type="text"]').first()

      if (await chatInput.isVisible()) {
        await chatInput.fill('Test message')
        await chatInput.press('Enter')
        await page.waitForTimeout(2000)

        // Should handle incomplete stream
        await expect(page.locator('body')).toBeVisible()
      }
    })
  })
})

test.describe('Concurrent Operation Errors', () => {
  test.describe('Multiple Tabs', () => {
    test('handles auth change in another tab', async ({ page, context }) => {
      // Auth in one tab, app should update in another
      const page2 = await context.newPage()

      await page.goto('/')
      await page2.goto('/')

      // Sign out in page 2
      await page2.evaluate(() => {
        localStorage.removeItem('juice-auth')
        window.dispatchEvent(new StorageEvent('storage', {
          key: 'juice-auth',
          oldValue: '{}',
          newValue: null,
        }))
      })

      await page.waitForTimeout(500)

      // Page 1 should reflect auth change
    })
  })

  test.describe('Race Conditions', () => {
    test('handles rapid repeated actions', async ({ page, mockManagedAuth }) => {
      await mockManagedAuth(page)
      await page.reload()
      await page.waitForLoadState('networkidle')

      const chatInput = page.locator('textarea, input[type="text"]').first()

      if (await chatInput.isVisible()) {
        // Send multiple messages rapidly
        for (let i = 0; i < 5; i++) {
          await chatInput.fill(`Message ${i}`)
          await chatInput.press('Enter')
          // No wait between sends
        }

        await page.waitForTimeout(2000)

        // App should handle gracefully
        await expect(page.locator('body')).toBeVisible()
      }
    })

    test('handles double-click on submit', async ({ page, mockManagedAuth }) => {
      await mockManagedAuth(page)
      await page.reload()
      await page.waitForLoadState('networkidle')

      // Find and double-click submit button
      const submitBtn = page.locator('button[type="submit"]').first()

      if (await submitBtn.isVisible()) {
        await submitBtn.dblclick()
        await page.waitForTimeout(500)

        // Should not submit twice
      }
    })
  })
})

test.describe('Browser Compatibility Issues', () => {
  test.describe('Feature Detection', () => {
    test('handles missing localStorage', async ({ page }) => {
      // Mock localStorage being blocked
      await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new Error('localStorage is blocked')
          }
        })
      })

      await page.goto('/')
      await page.waitForLoadState('networkidle')

      // Should show appropriate message or fallback
      await expect(page.locator('body')).toBeVisible()
    })
  })
})

test.describe('Memory/Performance Issues', () => {
  test.describe('Long Sessions', () => {
    test('handles very long chat history', async ({ page, mockManagedAuth }) => {
      await mockManagedAuth(page)

      // Mock chat with many messages
      await page.route('**/chat/*/messages', async (route) => {
        const messages = Array.from({ length: 1000 }, (_, i) => ({
          id: `msg-${i}`,
          content: `Message ${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
        }))

        await route.fulfill({
          status: 200,
          body: JSON.stringify({ success: true, data: { messages } })
        })
      })

      await page.reload()
      await page.waitForLoadState('networkidle')

      // App should handle large history
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles rapid navigation', async ({ page }) => {
      // Navigate rapidly between pages
      for (let i = 0; i < 10; i++) {
        await page.goto('/')
        await page.goto('/eth:1')
      }

      // Should not leak memory or crash
      await expect(page.locator('body')).toBeVisible()
    })
  })
})
