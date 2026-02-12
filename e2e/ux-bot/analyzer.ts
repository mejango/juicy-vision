import Anthropic from '@anthropic-ai/sdk'
import type { PageState, AnalysisResult, UXIssue, Action } from './types'

/**
 * Analyzes page state and screenshots using Claude to determine:
 * 1. Current page/state
 * 2. Available actions
 * 3. Next best action to achieve goal
 * 4. Any UX issues observed
 */
export class PageAnalyzer {
  private client: Anthropic | null = null
  private model: string = 'claude-sonnet-4-20250514'

  constructor(apiKey?: string) {
    // Only initialize if API key is provided
    if (apiKey || process.env.ANTHROPIC_API_KEY) {
      this.client = new Anthropic({ apiKey })
    }
  }

  /**
   * Check if the analyzer is available (has API key)
   */
  isAvailable(): boolean {
    return this.client !== null
  }

  /**
   * Analyze the current page state and determine next action.
   */
  async analyze(
    pageState: PageState,
    goal: string,
    previousActions: string[],
    screenshotBase64?: string
  ): Promise<AnalysisResult> {
    if (!this.client) {
      return this.fallbackAnalysis(pageState, goal)
    }

    const systemPrompt = `You are a UX testing expert analyzing a web application. Your job is to:
1. Understand the current page state
2. Identify any UX issues (usability, accessibility, visual problems)
3. Determine the best next action to achieve the user's goal
4. Estimate progress toward the goal

Always respond with valid JSON in this exact format:
{
  "currentPage": "description of current page/view",
  "currentState": "description of current UI state",
  "availableActions": ["list", "of", "possible", "actions"],
  "suggestedNextAction": {
    "type": "click|type|scroll|wait|navigate",
    "selector": "CSS selector if applicable",
    "text": "text to type or click text",
    "description": "why this action"
  },
  "uxIssues": [
    {
      "id": "unique-id",
      "severity": "critical|major|minor|suggestion",
      "category": "usability|accessibility|visual|functionality|error_handling|feedback|navigation",
      "title": "Issue title",
      "description": "Detailed description",
      "suggestion": "How to fix"
    }
  ],
  "progress": 0-100
}`

    const userMessage = this.buildUserMessage(pageState, goal, previousActions)

    try {
      const content: Anthropic.Messages.ContentBlockParam[] = []

      // Add screenshot if available
      if (screenshotBase64) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: screenshotBase64,
          },
        })
      }

      content.push({ type: 'text', text: userMessage })

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content }],
      })

      const responseText = response.content[0].type === 'text' ? response.content[0].text : ''

      // Parse JSON response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        console.warn('Failed to parse analyzer response, using fallback')
        return this.fallbackAnalysis(pageState, goal)
      }

      const parsed = JSON.parse(jsonMatch[0])
      return this.normalizeResult(parsed)
    } catch (error) {
      console.error('Analyzer error:', error)
      return this.fallbackAnalysis(pageState, goal)
    }
  }

  private buildUserMessage(
    pageState: PageState,
    goal: string,
    previousActions: string[]
  ): string {
    const parts: string[] = [
      `GOAL: ${goal}`,
      '',
      `CURRENT URL: ${pageState.url}`,
      `PAGE TITLE: ${pageState.title}`,
      '',
    ]

    if (previousActions.length > 0) {
      parts.push('PREVIOUS ACTIONS:')
      parts.push(...previousActions.map((a, i) => `${i + 1}. ${a}`))
      parts.push('')
    }

    parts.push('PAGE CONTENT:')
    parts.push(this.domToText(pageState.dom))

    if (pageState.errors.length > 0) {
      parts.push('')
      parts.push('JAVASCRIPT ERRORS:')
      parts.push(...pageState.errors)
    }

    if (pageState.networkErrors.length > 0) {
      parts.push('')
      parts.push('NETWORK ERRORS:')
      parts.push(...pageState.networkErrors)
    }

    parts.push('')
    parts.push('Analyze this page and suggest the next action to achieve the goal.')

    return parts.join('\n')
  }

  private domToText(dom: PageState['dom'], indent = 0): string {
    const lines: string[] = []
    const prefix = '  '.repeat(indent)

    for (const el of dom) {
      if (!el.visible) continue

      let line = `${prefix}<${el.tag}`

      if (el.id) line += ` id="${el.id}"`
      if (el.classes?.length) line += ` class="${el.classes.join(' ')}"`
      if (el.type) line += ` type="${el.type}"`
      if (el.placeholder) line += ` placeholder="${el.placeholder}"`
      if (el.disabled) line += ` disabled`

      line += '>'

      if (el.text) {
        line += ` ${el.text}`
      }

      lines.push(line)

      if (el.children) {
        lines.push(this.domToText(el.children, indent + 1))
      }
    }

    return lines.join('\n')
  }

  private normalizeResult(parsed: Record<string, unknown>): AnalysisResult {
    return {
      currentPage: String(parsed.currentPage || 'Unknown'),
      currentState: String(parsed.currentState || 'Unknown'),
      availableActions: Array.isArray(parsed.availableActions) ? parsed.availableActions : [],
      suggestedNextAction: this.normalizeAction(parsed.suggestedNextAction),
      uxIssues: this.normalizeIssues(parsed.uxIssues),
      progress: typeof parsed.progress === 'number' ? parsed.progress : 0,
    }
  }

  private normalizeAction(action: unknown): Action | null {
    if (!action || typeof action !== 'object') return null

    const a = action as Record<string, unknown>
    const type = String(a.type || 'wait')

    switch (type) {
      case 'click':
        return {
          type: 'click',
          selector: a.selector ? String(a.selector) : undefined,
          text: a.text ? String(a.text) : undefined,
          description: a.description ? String(a.description) : undefined,
        }
      case 'type':
        return {
          type: 'type',
          selector: a.selector ? String(a.selector) : undefined,
          text: String(a.text || ''),
          description: a.description ? String(a.description) : undefined,
        }
      case 'scroll':
        return {
          type: 'scroll',
          direction: (a.direction as 'up' | 'down' | 'left' | 'right') || 'down',
          description: a.description ? String(a.description) : undefined,
        }
      case 'wait':
        return {
          type: 'wait',
          timeout: typeof a.timeout === 'number' ? a.timeout : 1000,
          description: a.description ? String(a.description) : undefined,
        }
      case 'navigate':
        return {
          type: 'navigate',
          url: String(a.url || '/'),
          description: a.description ? String(a.description) : undefined,
        }
      default:
        return {
          type: 'wait',
          timeout: 1000,
          description: 'Default wait action',
        }
    }
  }

  private normalizeIssues(issues: unknown): UXIssue[] {
    if (!Array.isArray(issues)) return []

    return issues
      .filter((i): i is Record<string, unknown> => i && typeof i === 'object')
      .map((i, idx) => ({
        id: String(i.id || `issue-${idx}`),
        severity: this.normalizeSeverity(i.severity),
        category: this.normalizeCategory(i.category),
        title: String(i.title || 'Unknown Issue'),
        description: String(i.description || ''),
        suggestion: i.suggestion ? String(i.suggestion) : undefined,
      }))
  }

  private normalizeSeverity(s: unknown): UXIssue['severity'] {
    const valid = ['critical', 'major', 'minor', 'suggestion']
    return valid.includes(String(s)) ? (String(s) as UXIssue['severity']) : 'minor'
  }

  private normalizeCategory(c: unknown): UXIssue['category'] {
    const valid = [
      'usability',
      'accessibility',
      'performance',
      'visual',
      'functionality',
      'error_handling',
      'feedback',
      'navigation',
    ]
    return valid.includes(String(c)) ? (String(c) as UXIssue['category']) : 'usability'
  }

  /**
   * Fallback analysis when Claude API is not available.
   * Uses simple heuristics to suggest actions.
   */
  private fallbackAnalysis(pageState: PageState, goal: string): AnalysisResult {
    const issues: UXIssue[] = []

    // Check for JS errors
    if (pageState.errors.length > 0) {
      issues.push({
        id: 'js-errors',
        severity: 'major',
        category: 'functionality',
        title: 'JavaScript Errors Detected',
        description: `Found ${pageState.errors.length} JavaScript errors: ${pageState.errors.slice(0, 3).join(', ')}`,
        suggestion: 'Fix JavaScript errors to improve reliability',
      })
    }

    // Check for network errors
    if (pageState.networkErrors.length > 0) {
      issues.push({
        id: 'network-errors',
        severity: 'major',
        category: 'functionality',
        title: 'Network Errors Detected',
        description: `Found ${pageState.networkErrors.length} failed network requests`,
        suggestion: 'Ensure API endpoints are working correctly',
      })
    }

    // Suggest a default action based on the goal
    let suggestedAction: Action | null = null
    const goalLower = goal.toLowerCase()

    if (goalLower.includes('create') && goalLower.includes('project')) {
      suggestedAction = {
        type: 'type',
        selector: 'textarea',
        text: 'create a project called TestStore',
        description: 'Type project creation request in chat',
      }
    } else if (goalLower.includes('navigate') || goalLower.includes('go to')) {
      suggestedAction = {
        type: 'click',
        text: 'Dashboard',
        description: 'Navigate to dashboard',
      }
    } else {
      suggestedAction = {
        type: 'wait',
        timeout: 2000,
        description: 'Wait for page to stabilize',
      }
    }

    return {
      currentPage: pageState.title || pageState.url,
      currentState: 'Page loaded',
      availableActions: ['click buttons', 'type in inputs', 'scroll page', 'navigate'],
      suggestedNextAction: suggestedAction,
      uxIssues: issues,
      progress: 0,
    }
  }
}
