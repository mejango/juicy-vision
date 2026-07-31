import type { Page, Locator } from '@playwright/test'
import { expect } from '@playwright/test'

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
async function typeMessage(page: Page, message: string) {
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
 * Assert that the chat input is ready for input.
 */
export async function assertChatReady(page: Page) {
  const input = getChatInput(page)
  await expect(input).toBeVisible()
  await expect(input).toBeEnabled()
}
