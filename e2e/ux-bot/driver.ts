import type { Page } from '@playwright/test'
import type { Action, PageState, DOMElement } from './types'

/**
 * Playwright driver for executing actions decided by the AI agent.
 */
export class PlaywrightDriver {
  private page: Page
  private consoleMessages: string[] = []
  private networkErrors: string[] = []
  private jsErrors: string[] = []

  constructor(page: Page) {
    this.page = page
    this.setupListeners()
  }

  private setupListeners() {
    // Capture console messages
    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        this.consoleMessages.push(`[ERROR] ${msg.text()}`)
      } else if (msg.type() === 'warning') {
        this.consoleMessages.push(`[WARN] ${msg.text()}`)
      }
    })

    // Capture JS errors
    this.page.on('pageerror', (error) => {
      this.jsErrors.push(error.message)
    })

    // Capture network errors
    this.page.on('requestfailed', (request) => {
      this.networkErrors.push(`${request.method()} ${request.url()} - ${request.failure()?.errorText}`)
    })
  }

  /**
   * Execute an action on the page.
   */
  async executeAction(action: Action): Promise<{ success: boolean; error?: string }> {
    try {
      switch (action.type) {
        case 'click':
          await this.executeClick(action)
          break

        case 'type':
          await this.executeType(action)
          break

        case 'scroll':
          await this.executeScroll(action)
          break

        case 'wait':
          await this.executeWait(action)
          break

        case 'navigate':
          await this.executeNavigate(action)
          break

        case 'hover':
          await this.executeHover(action)
          break

        case 'press_key':
          await this.executePressKey(action)
          break

        case 'select':
          await this.executeSelect(action)
          break

        case 'clear':
          await this.executeClear(action)
          break

        case 'screenshot':
          // No action needed, screenshot is taken separately
          break

        default:
          return { success: false, error: `Unknown action type: ${(action as Action).type}` }
      }

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  private async executeClick(action: Extract<Action, { type: 'click' }>) {
    if (action.selector) {
      await this.page.locator(action.selector).first().click({ timeout: 5000 })
    } else if (action.text) {
      await this.page.getByText(action.text).first().click({ timeout: 5000 })
    } else if (action.position) {
      await this.page.mouse.click(action.position.x, action.position.y)
    } else {
      throw new Error('Click action requires selector, text, or position')
    }
  }

  private async executeType(action: Extract<Action, { type: 'type' }>) {
    if (action.selector) {
      await this.page.locator(action.selector).first().fill(action.text)
    } else {
      // Type to currently focused element
      await this.page.keyboard.type(action.text)
    }
  }

  private async executeScroll(action: Extract<Action, { type: 'scroll' }>) {
    const amount = action.amount || 300
    const delta = {
      up: { x: 0, y: -amount },
      down: { x: 0, y: amount },
      left: { x: -amount, y: 0 },
      right: { x: amount, y: 0 },
    }[action.direction]

    await this.page.mouse.wheel(delta.x, delta.y)
  }

  private async executeWait(action: Extract<Action, { type: 'wait' }>) {
    const timeout = action.timeout || 5000

    if (action.selector) {
      await this.page.waitForSelector(action.selector, { timeout })
    } else if (action.condition) {
      // Custom condition support
      switch (action.condition) {
        case 'networkidle':
          await this.page.waitForLoadState('networkidle', { timeout })
          break
        case 'domcontentloaded':
          await this.page.waitForLoadState('domcontentloaded', { timeout })
          break
        default:
          await this.page.waitForTimeout(timeout)
      }
    } else {
      await this.page.waitForTimeout(timeout)
    }
  }

  private async executeNavigate(action: Extract<Action, { type: 'navigate' }>) {
    await this.page.goto(action.url)
    await this.page.waitForLoadState('networkidle')
  }

  private async executeHover(action: Extract<Action, { type: 'hover' }>) {
    await this.page.locator(action.selector).first().hover()
  }

  private async executePressKey(action: Extract<Action, { type: 'press_key' }>) {
    await this.page.keyboard.press(action.key)
  }

  private async executeSelect(action: Extract<Action, { type: 'select' }>) {
    await this.page.locator(action.selector).first().selectOption(action.value)
  }

  private async executeClear(action: Extract<Action, { type: 'clear' }>) {
    await this.page.locator(action.selector).first().clear()
  }

  /**
   * Take a screenshot of the current page.
   */
  async takeScreenshot(): Promise<Buffer> {
    return this.page.screenshot({ type: 'png', fullPage: false })
  }

  /**
   * Get the current page state including DOM and errors.
   */
  async getPageState(): Promise<PageState> {
    const url = this.page.url()
    const title = await this.page.title()

    // Get simplified DOM tree
    const dom = await this.page.evaluate(() => {
      function serializeElement(el: Element, depth = 0): unknown {
        if (depth > 3) return null // Limit depth

        const rect = el.getBoundingClientRect()
        const computedStyle = window.getComputedStyle(el)
        const isVisible =
          computedStyle.display !== 'none' &&
          computedStyle.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0

        // Skip invisible elements
        if (!isVisible && depth > 0) return null

        const result: Record<string, unknown> = {
          tag: el.tagName.toLowerCase(),
          visible: isVisible,
        }

        if (el.id) result.id = el.id
        if (el.className && typeof el.className === 'string') {
          result.classes = el.className.split(' ').filter(Boolean).slice(0, 5)
        }

        // Get text content (first 100 chars)
        const text = el.textContent?.trim().slice(0, 100)
        if (text && el.children.length === 0) {
          result.text = text
        }

        // Get attributes for interactive elements
        if (el instanceof HTMLAnchorElement) {
          result.href = el.href
        }
        if (el instanceof HTMLInputElement) {
          result.type = el.type
          result.placeholder = el.placeholder
          result.value = el.value
          result.disabled = el.disabled
        }
        if (el instanceof HTMLButtonElement) {
          result.disabled = el.disabled
        }
        if (el instanceof HTMLTextAreaElement) {
          result.placeholder = el.placeholder
          result.value = el.value?.slice(0, 100)
        }

        // Get bounding rect for visible elements
        if (isVisible) {
          result.rect = {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          }
        }

        // Get children (only for important containers)
        const importantTags = ['div', 'main', 'section', 'article', 'form', 'nav', 'ul', 'ol']
        if (importantTags.includes(el.tagName.toLowerCase()) && el.children.length > 0) {
          const children: unknown[] = []
          for (let i = 0; i < el.children.length; i++) {
            const child = el.children[i]
            const serialized = serializeElement(child, depth + 1)
            if (serialized) children.push(serialized)
          }
          if (children.length > 0) {
            result.children = children.slice(0, 10) // Limit children
          }
        }

        return result
      }

      // Get main content areas
      const body = document.body
      const main = document.querySelector('main') || body
      return [serializeElement(main)]
    })

    // Get errors collected since last check
    const errors = [...this.jsErrors]
    const consoleMessages = [...this.consoleMessages]
    const networkErrors = [...this.networkErrors]

    // Clear collected errors
    this.jsErrors = []
    this.consoleMessages = []
    this.networkErrors = []

    return {
      url,
      title,
      dom: dom as DOMElement[],
      errors,
      consoleMessages,
      networkErrors,
    }
  }

  /**
   * Get a simplified text representation of the page for the AI.
   */
  async getPageText(): Promise<string> {
    const state = await this.getPageState()

    const parts: string[] = [
      `URL: ${state.url}`,
      `Title: ${state.title}`,
      '',
      'Interactive Elements:',
    ]

    // Extract interactive elements
    const interactiveElements = await this.page.evaluate(() => {
      const elements: string[] = []

      // Buttons
      document.querySelectorAll('button').forEach((el, i) => {
        if (el.offsetParent !== null) { // Visible
          const text = el.textContent?.trim().slice(0, 50) || ''
          const disabled = el.disabled ? ' (disabled)' : ''
          elements.push(`- Button: "${text}"${disabled}`)
        }
      })

      // Links
      document.querySelectorAll('a').forEach((el) => {
        if (el.offsetParent !== null) {
          const text = el.textContent?.trim().slice(0, 50) || ''
          const href = el.href?.slice(0, 50) || ''
          elements.push(`- Link: "${text}" -> ${href}`)
        }
      })

      // Inputs
      document.querySelectorAll('input, textarea').forEach((el) => {
        const htmlEl = el as HTMLElement
        if (htmlEl.offsetParent !== null) {
          const input = el as HTMLInputElement | HTMLTextAreaElement
          const type = input.type || 'text'
          const placeholder = input.placeholder || ''
          const value = input.value?.slice(0, 30) || ''
          elements.push(`- Input (${type}): placeholder="${placeholder}" value="${value}"`)
        }
      })

      return elements.slice(0, 30) // Limit
    })

    parts.push(...interactiveElements)

    // Add any errors
    if (state.errors.length > 0) {
      parts.push('', 'Errors:')
      parts.push(...state.errors.map(e => `- ${e}`))
    }

    return parts.join('\n')
  }
}
