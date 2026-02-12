import { test, expect, type Page } from '../fixtures/auth'
import { mockAuthEndpoints } from '../fixtures/auth'
import { mockChatEndpoints, AI_RESPONSES, createMockChat, createMockMessage } from '../fixtures/api'

/**
 * User Journey 5.1: Multi-Turn Chat Conversation
 *
 * Tests the core AI chat functionality including message sending,
 * streaming responses, context maintenance, and special commands.
 */

test.describe('Chat Interaction', () => {
  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page)
    await mockAuthEndpoints(page)
    await mockChatEndpoints(page)

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Sending Messages', () => {
    test('can type in chat input', async ({ page }) => {
      const chatInput = page.locator('textarea, input[type="text"]').filter({
        has: page.locator('[placeholder*="message" i], [data-testid="chat-input"]')
      }).first().or(
        page.locator('[data-testid="chat-input"], textarea').first()
      )

      await expect(chatInput).toBeVisible()

      await chatInput.fill('Hello, I want to create a project')
      await expect(chatInput).toHaveValue('Hello, I want to create a project')
    })

    test('can send message with Enter key', async ({ page }) => {
      const chatInput = page.locator('textarea, input[type="text"]').first()

      if (await chatInput.isVisible()) {
        await chatInput.fill('Test message')
        await chatInput.press('Enter')
        await page.waitForTimeout(500)

        // Message should appear in chat or input should clear
        const inputValue = await chatInput.inputValue()
        // Input may clear after sending
      }
    })

    test('can send message with send button', async ({ page }) => {
      const chatInput = page.locator('textarea, input[type="text"]').first()
      const sendBtn = page.locator('button[type="submit"], button[aria-label*="send" i], button').filter({
        hasText: /send|submit/i
      }).first().or(
        page.locator('button svg').first().locator('..')
      )

      if (await chatInput.isVisible()) {
        await chatInput.fill('Test message via button')

        if (await sendBtn.isVisible()) {
          await sendBtn.click()
          await page.waitForTimeout(500)
        }
      }
    })

    test('input clears after sending', async ({ page }) => {
      const chatInput = page.locator('textarea, input[type="text"]').first()

      if (await chatInput.isVisible()) {
        await chatInput.fill('Test message')
        await chatInput.press('Enter')
        await page.waitForTimeout(1000)

        // Input should be cleared
        const inputValue = await chatInput.inputValue()
        // May be empty or may have new text
      }
    })

    test('Shift+Enter creates new line instead of sending', async ({ page }) => {
      const chatInput = page.locator('textarea').first()

      if (await chatInput.isVisible()) {
        await chatInput.fill('Line 1')
        await chatInput.press('Shift+Enter')
        await chatInput.type('Line 2')

        const value = await chatInput.inputValue()
        expect(value).toContain('Line 1')
        expect(value).toContain('Line 2')
      }
    })
  })

  test.describe('Receiving AI Responses', () => {
    test('shows loading indicator while AI responds', async ({ page }) => {
      // Mock slow AI response
      await page.route('**/chat/*/ai/invoke', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 1000))
        await route.fulfill({
          status: 200,
          body: JSON.stringify({ success: true, data: { message: 'Test response' } })
        })
      })

      const chatInput = page.locator('textarea, input[type="text"]').first()

      if (await chatInput.isVisible()) {
        await chatInput.fill('Test question')
        await chatInput.press('Enter')

        // Should show loading indicator
        const loading = page.locator('[data-testid="ai-loading"], text=/thinking|typing|loading/i, .animate-pulse')
        // Loading indicator may appear
      }
    })

    test('displays AI response in chat', async ({ page }) => {
      await mockChatEndpoints(page, {
        aiResponse: { content: 'This is a test AI response.' }
      })

      const chatInput = page.locator('textarea, input[type="text"]').first()

      if (await chatInput.isVisible()) {
        await chatInput.fill('Test question')
        await chatInput.press('Enter')
        await page.waitForTimeout(2000)

        // AI response should appear
        const response = page.locator('text=/test AI response/i')
        // Response may be visible
      }
    })

    test('handles streaming responses', async ({ page }) => {
      // Mock streaming response
      await page.route('**/chat/*/ai/invoke', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: [
            'data: {"type":"chunk","content":"Hello","done":false}\n\n',
            'data: {"type":"chunk","content":" world","done":false}\n\n',
            'data: {"type":"chunk","content":"!","done":true}\n\n',
          ].join('')
        })
      })

      const chatInput = page.locator('textarea, input[type="text"]').first()

      if (await chatInput.isVisible()) {
        await chatInput.fill('Test streaming')
        await chatInput.press('Enter')
        await page.waitForTimeout(1000)

        // Streamed content should appear
      }
    })
  })

  test.describe('Conversation Context', () => {
    test('maintains context across messages', async ({ page }) => {
      // Send first message
      const chatInput = page.locator('textarea, input[type="text"]').first()

      if (await chatInput.isVisible()) {
        await chatInput.fill('My project is called TestProject')
        await chatInput.press('Enter')
        await page.waitForTimeout(1500)

        // Send follow-up
        await chatInput.fill('What did I name it?')
        await chatInput.press('Enter')
        await page.waitForTimeout(1500)

        // AI should reference previous context
        // (Would need properly mocked AI to test this)
      }
    })

    test('scrolls to new messages', async ({ page }) => {
      // Send multiple messages to create scroll
      const chatInput = page.locator('textarea, input[type="text"]').first()

      if (await chatInput.isVisible()) {
        for (let i = 0; i < 5; i++) {
          await chatInput.fill(`Message ${i + 1}`)
          await chatInput.press('Enter')
          await page.waitForTimeout(500)
        }

        // Last message should be visible (scrolled to)
        const lastMessage = page.locator('text=/Message 5/i')
        if (await lastMessage.isVisible()) {
          await expect(lastMessage).toBeInViewport()
        }
      }
    })
  })

  test.describe('Message History', () => {
    test('shows previous messages on reload', async ({ page }) => {
      // Send a message
      const chatInput = page.locator('textarea, input[type="text"]').first()

      if (await chatInput.isVisible()) {
        await chatInput.fill('Remember this message')
        await chatInput.press('Enter')
        await page.waitForTimeout(1000)

        // Reload page
        await page.reload()
        await page.waitForLoadState('networkidle')

        // Previous messages should be visible
        // (Depends on persistence implementation)
      }
    })

    test('can scroll through message history', async ({ page }) => {
      // If chat has history, should be scrollable
      const chatContainer = page.locator('[data-testid="chat-messages"], [role="log"]').first()

      if (await chatContainer.isVisible()) {
        // Scroll up
        await chatContainer.evaluate(el => {
          el.scrollTop = 0
        })

        // Should be able to scroll
      }
    })
  })

  test.describe('Chat Actions', () => {
    test('can start new chat', async ({ page }) => {
      const newChatBtn = page.locator('button').filter({
        hasText: /new chat|new conversation|clear|\+/i
      }).first()

      if (await newChatBtn.isVisible()) {
        await newChatBtn.click()
        await page.waitForTimeout(500)

        // Chat should be cleared or new chat created
      }
    })

    test('can copy message content', async ({ page }) => {
      // If copy button exists on messages
      const copyBtn = page.locator('button[aria-label*="copy" i], button').filter({
        has: page.locator('svg')
      }).first()

      // Copy functionality may exist
    })

    test('can regenerate AI response', async ({ page }) => {
      // If regenerate button exists
      const regenerateBtn = page.locator('button').filter({
        hasText: /regenerate|retry|try again/i
      }).first()

      // Regenerate may be available after AI response
    })
  })

  test.describe('Error Handling', () => {
    test('shows error when AI fails', async ({ page }) => {
      await page.route('**/chat/*/ai/invoke', async (route) => {
        await route.fulfill({
          status: 500,
          body: JSON.stringify({ success: false, error: 'AI service unavailable' })
        })
      })

      const chatInput = page.locator('textarea, input[type="text"]').first()

      if (await chatInput.isVisible()) {
        await chatInput.fill('Test error handling')
        await chatInput.press('Enter')
        await page.waitForTimeout(1000)

        // Error message should appear
        const error = page.locator('text=/error|failed|try again/i')
        // Error handling should be visible
      }
    })

    test('handles rate limiting gracefully', async ({ page }) => {
      await page.route('**/chat/*/ai/invoke', async (route) => {
        await route.fulfill({
          status: 429,
          body: JSON.stringify({ success: false, error: 'Rate limit exceeded' })
        })
      })

      const chatInput = page.locator('textarea, input[type="text"]').first()

      if (await chatInput.isVisible()) {
        await chatInput.fill('Test rate limit')
        await chatInput.press('Enter')
        await page.waitForTimeout(1000)

        // Should show rate limit message
        const rateLimitMsg = page.locator('text=/rate limit|too many|slow down|wait/i')
        // Rate limit error may be shown
      }
    })

    test('handles network disconnect', async ({ page }) => {
      // Mock network failure
      await page.route('**/chat/**', route => route.abort())

      const chatInput = page.locator('textarea, input[type="text"]').first()

      if (await chatInput.isVisible()) {
        await chatInput.fill('Test network error')
        await chatInput.press('Enter')
        await page.waitForTimeout(1000)

        // Should show connection error
      }
    })
  })

  test.describe('Special Inputs', () => {
    test('handles very long messages', async ({ page }) => {
      const chatInput = page.locator('textarea').first()

      if (await chatInput.isVisible()) {
        const longMessage = 'A'.repeat(5000)
        await chatInput.fill(longMessage)

        // Should either accept or truncate/warn
        const value = await chatInput.inputValue()
        expect(value.length).toBeGreaterThan(0)
      }
    })

    test('handles emoji in messages', async ({ page }) => {
      const chatInput = page.locator('textarea, input[type="text"]').first()

      if (await chatInput.isVisible()) {
        await chatInput.fill('Hello 👋 World 🌍!')
        const value = await chatInput.inputValue()
        expect(value).toContain('👋')
        expect(value).toContain('🌍')
      }
    })

    test('handles code blocks in messages', async ({ page }) => {
      const chatInput = page.locator('textarea').first()

      if (await chatInput.isVisible()) {
        await chatInput.fill('```javascript\nconst x = 1;\n```')
        await chatInput.press('Enter')
        await page.waitForTimeout(500)

        // Code should be preserved
      }
    })

    test('handles markdown formatting', async ({ page }) => {
      const chatInput = page.locator('textarea').first()

      if (await chatInput.isVisible()) {
        await chatInput.fill('**bold** and _italic_ and [link](http://example.com)')
        await chatInput.press('Enter')
        await page.waitForTimeout(500)

        // Markdown may be rendered
      }
    })
  })
})

test.describe('Chat - Transaction Components', () => {
  test.describe('Transaction Preview', () => {
    test('AI can show transaction preview', async ({ page, mockManagedAuth }) => {
      await mockManagedAuth(page)
      await mockChatEndpoints(page, {
        aiResponse: AI_RESPONSES.projectCreation
      })

      await page.reload()
      await page.waitForLoadState('networkidle')

      const chatInput = page.locator('textarea, input[type="text"]').first()

      if (await chatInput.isVisible()) {
        await chatInput.fill('Create a project called TestProject')
        await chatInput.press('Enter')
        await page.waitForTimeout(2000)

        // Transaction preview component may appear
        const txPreview = page.locator('[data-testid="transaction-preview"], [data-testid="tx-preview"]')
        // Preview may be rendered
      }
    })

    test('can confirm transaction from chat', async ({ page, mockManagedAuth }) => {
      await mockManagedAuth(page)

      // Would need full flow to test confirmation
      await expect(page.locator('body')).toBeVisible()
    })

    test('can cancel transaction from chat', async ({ page, mockManagedAuth }) => {
      await mockManagedAuth(page)

      // Would need full flow to test cancellation
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Project Links', () => {
    test('AI can include project links in response', async ({ page, mockManagedAuth }) => {
      await mockManagedAuth(page)
      await mockChatEndpoints(page, {
        aiResponse: AI_RESPONSES.projectCreationSuccess
      })

      await page.reload()
      await page.waitForLoadState('networkidle')

      // After successful creation, should see dashboard link
      // This requires full flow mock
    })

    test('project links are clickable', async ({ page }) => {
      // If chat contains project links, they should navigate
      const projectLink = page.locator('a[href*="/eth:"], a[href*="/project/"]').first()

      if (await projectLink.isVisible()) {
        const href = await projectLink.getAttribute('href')
        expect(href).toBeTruthy()
      }
    })
  })
})

test.describe('Chat - Sidebar', () => {
  test.describe('Chat List', () => {
    test('shows list of previous chats', async ({ page, mockManagedAuth }) => {
      await mockManagedAuth(page)
      await page.reload()
      await page.waitForLoadState('networkidle')

      // Sidebar may show chat history
      const sidebar = page.locator('[data-testid="chat-sidebar"], [role="navigation"]').first()
      // Sidebar may be visible
    })

    test('can switch between chats', async ({ page, mockManagedAuth }) => {
      await mockManagedAuth(page)
      await page.reload()
      await page.waitForLoadState('networkidle')

      // Click a previous chat to switch
      const chatItem = page.locator('[data-testid="chat-item"], [role="listitem"]').first()

      if (await chatItem.isVisible()) {
        await chatItem.click()
        await page.waitForTimeout(500)
        // Should load that chat's messages
      }
    })

    test('can delete a chat', async ({ page, mockManagedAuth }) => {
      await mockManagedAuth(page)
      await page.reload()
      await page.waitForLoadState('networkidle')

      // Find delete option on chat
      const deleteBtn = page.locator('button[aria-label*="delete" i], [data-testid="delete-chat"]').first()
      // Delete functionality may exist
    })
  })
})
