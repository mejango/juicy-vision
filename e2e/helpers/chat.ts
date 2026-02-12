import type { Page, Locator } from '@playwright/test'
import { expect } from '@playwright/test'

// ============================================================================
// Types
// ============================================================================

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  isStreaming?: boolean
}

export interface ChatState {
  messages: ChatMessage[]
  isWaitingForAi: boolean
  currentChatId: string | null
}

// ============================================================================
// Selectors
// ============================================================================

const SELECTORS = {
  chatInput: 'textarea',
  sendButton: 'button[type="submit"], button[aria-label*="send" i]',
  messageList: '[data-testid="message-list"], .message-list',
  userMessage: '[data-role="user"], .message-user',
  assistantMessage: '[data-role="assistant"], .message-assistant',
  streamingIndicator: '[data-streaming="true"], .streaming',
  chatContainer: '[data-testid="chat-container"], .chat-container',
  transactionPreview: '[data-testid="transaction-preview"], transaction-preview',
  newChatButton: 'button[aria-label*="new chat" i], button:has-text("New")',
} as const

// ============================================================================
// Chat Interaction Helpers
// ============================================================================

/**
 * Get the chat input textarea.
 */
export function getChatInput(page: Page): Locator {
  return page.locator(SELECTORS.chatInput).first()
}

/**
 * Type a message in the chat input.
 */
export async function typeMessage(page: Page, message: string) {
  const input = getChatInput(page)
  await expect(input).toBeVisible()
  await input.fill(message)
}

/**
 * Send a message by pressing Enter or clicking send.
 */
export async function sendMessage(page: Page, message: string) {
  await typeMessage(page, message)

  // Try pressing Enter first
  const input = getChatInput(page)
  await input.press('Enter')

  // Wait for the message to appear in the chat
  await page.waitForTimeout(100)
}

/**
 * Send a message and wait for the AI response to complete.
 */
export async function sendMessageAndWaitForResponse(
  page: Page,
  message: string,
  options: {
    timeout?: number
    expectStreaming?: boolean
  } = {}
) {
  const { timeout = 30000, expectStreaming = true } = options

  // Count existing messages to detect new ones
  const initialMessageCount = await page.locator(SELECTORS.assistantMessage).count()

  // Send the message
  await sendMessage(page, message)

  // Wait for streaming indicator if expected
  if (expectStreaming) {
    try {
      await page.waitForSelector(SELECTORS.streamingIndicator, { timeout: 5000 })
    } catch {
      // Streaming might be too fast to catch
    }
  }

  // Wait for a new assistant message to appear
  await page.waitForFunction(
    ({ selector, initialCount }) => {
      const messages = document.querySelectorAll(selector)
      return messages.length > initialCount
    },
    { selector: SELECTORS.assistantMessage, initialCount: initialMessageCount },
    { timeout }
  )

  // Wait for streaming to complete (no more streaming indicators)
  await page.waitForFunction(
    (selector) => document.querySelectorAll(selector).length === 0,
    SELECTORS.streamingIndicator,
    { timeout }
  )
}

/**
 * Get all messages currently displayed in the chat.
 */
export async function getMessages(page: Page): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = []

  // Get user messages
  const userMessages = page.locator(SELECTORS.userMessage)
  const userCount = await userMessages.count()
  for (let i = 0; i < userCount; i++) {
    const content = await userMessages.nth(i).textContent()
    messages.push({ role: 'user', content: content || '' })
  }

  // Get assistant messages
  const assistantMessages = page.locator(SELECTORS.assistantMessage)
  const assistantCount = await assistantMessages.count()
  for (let i = 0; i < assistantCount; i++) {
    const el = assistantMessages.nth(i)
    const content = await el.textContent()
    const isStreaming = await el.getAttribute('data-streaming') === 'true'
    messages.push({ role: 'assistant', content: content || '', isStreaming })
  }

  return messages
}

/**
 * Get the last assistant message.
 */
export async function getLastAssistantMessage(page: Page): Promise<string | null> {
  const messages = page.locator(SELECTORS.assistantMessage)
  const count = await messages.count()
  if (count === 0) return null

  return messages.last().textContent()
}

/**
 * Wait for the AI to stop streaming.
 */
export async function waitForAiComplete(page: Page, timeout = 30000) {
  await page.waitForFunction(
    (selector) => document.querySelectorAll(selector).length === 0,
    SELECTORS.streamingIndicator,
    { timeout }
  )
}

/**
 * Check if the chat is currently waiting for AI response.
 */
export async function isWaitingForAi(page: Page): Promise<boolean> {
  const streamingCount = await page.locator(SELECTORS.streamingIndicator).count()
  return streamingCount > 0
}

// ============================================================================
// Transaction Preview Helpers
// ============================================================================

/**
 * Wait for a transaction preview component to appear.
 */
export async function waitForTransactionPreview(page: Page, timeout = 10000): Promise<Locator> {
  const preview = page.locator(SELECTORS.transactionPreview).first()
  await expect(preview).toBeVisible({ timeout })
  return preview
}

/**
 * Get transaction preview data.
 */
export async function getTransactionPreviewData(page: Page): Promise<Record<string, unknown> | null> {
  const preview = page.locator(SELECTORS.transactionPreview).first()
  if (!(await preview.isVisible())) return null

  // Try to get data from data attribute or inner content
  const dataAttr = await preview.getAttribute('data-transaction')
  if (dataAttr) {
    try {
      return JSON.parse(dataAttr)
    } catch {
      // Fall through
    }
  }

  // Try to parse from inner text
  const text = await preview.textContent()
  if (text) {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }
    } catch {
      // Fall through
    }
  }

  return null
}

/**
 * Click the deploy/confirm button in a transaction preview.
 */
export async function confirmTransactionPreview(page: Page) {
  const preview = page.locator(SELECTORS.transactionPreview).first()
  await expect(preview).toBeVisible()

  // Look for deploy/confirm/execute button
  const confirmButton = preview.locator('button').filter({
    hasText: /deploy|confirm|execute|sign|approve/i,
  }).first()

  await expect(confirmButton).toBeVisible()
  await confirmButton.click()
}

// ============================================================================
// Chat Navigation Helpers
// ============================================================================

/**
 * Create a new chat.
 */
export async function createNewChat(page: Page) {
  const newChatButton = page.locator(SELECTORS.newChatButton).first()
  if (await newChatButton.isVisible()) {
    await newChatButton.click()
    await page.waitForTimeout(500)
  }
}

/**
 * Get the current chat ID from the URL or localStorage.
 */
export async function getCurrentChatId(page: Page): Promise<string | null> {
  // Try URL first
  const url = page.url()
  const chatMatch = url.match(/\/chat\/([^/?]+)/)
  if (chatMatch) return chatMatch[1]

  // Try localStorage
  return page.evaluate(() => {
    const chatStore = localStorage.getItem('juice-chat')
    if (!chatStore) return null
    try {
      const parsed = JSON.parse(chatStore)
      return parsed.state?.currentChatId || null
    } catch {
      return null
    }
  })
}

/**
 * Navigate to a specific chat.
 */
export async function navigateToChat(page: Page, chatId: string) {
  await page.goto(`/#/chat/${chatId}`)
  await page.waitForLoadState('networkidle')
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert that a specific message content exists in the chat.
 */
export async function assertMessageExists(
  page: Page,
  content: string,
  role: 'user' | 'assistant' = 'assistant'
) {
  const selector = role === 'user' ? SELECTORS.userMessage : SELECTORS.assistantMessage
  const message = page.locator(selector).filter({ hasText: content })
  await expect(message.first()).toBeVisible()
}

/**
 * Assert that the chat input is ready for input.
 */
export async function assertChatReady(page: Page) {
  const input = getChatInput(page)
  await expect(input).toBeVisible()
  await expect(input).toBeEnabled()
}

/**
 * Assert that a transaction preview is visible with specific type.
 */
export async function assertTransactionPreviewType(
  page: Page,
  type: string
) {
  const data = await getTransactionPreviewData(page)
  expect(data).not.toBeNull()
  expect((data as Record<string, unknown>)?.type).toBe(type)
}
