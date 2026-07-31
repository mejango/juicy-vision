/**
 * Types for the UX Testing Bot
 */

// ============================================================================
// Driver Types
// ============================================================================

type ActionType =
  | 'click'
  | 'type'
  | 'scroll'
  | 'wait'
  | 'screenshot'
  | 'navigate'
  | 'hover'
  | 'press_key'
  | 'select'
  | 'clear'

interface BaseAction {
  type: ActionType
  description?: string
}

interface ClickAction extends BaseAction {
  type: 'click'
  selector?: string
  text?: string
  position?: { x: number; y: number }
}

interface TypeAction extends BaseAction {
  type: 'type'
  selector?: string
  text: string
}

interface ScrollAction extends BaseAction {
  type: 'scroll'
  direction: 'up' | 'down' | 'left' | 'right'
  amount?: number
}

interface WaitAction extends BaseAction {
  type: 'wait'
  condition?: string
  timeout?: number
  selector?: string
}

interface ScreenshotAction extends BaseAction {
  type: 'screenshot'
}

interface NavigateAction extends BaseAction {
  type: 'navigate'
  url: string
}

interface HoverAction extends BaseAction {
  type: 'hover'
  selector: string
}

interface PressKeyAction extends BaseAction {
  type: 'press_key'
  key: string
}

interface SelectAction extends BaseAction {
  type: 'select'
  selector: string
  value: string
}

interface ClearAction extends BaseAction {
  type: 'clear'
  selector: string
}

export type Action =
  | ClickAction
  | TypeAction
  | ScrollAction
  | WaitAction
  | ScreenshotAction
  | NavigateAction
  | HoverAction
  | PressKeyAction
  | SelectAction
  | ClearAction

// ============================================================================
// Analysis Types
// ============================================================================

export interface DOMElement {
  tag: string
  id?: string
  classes?: string[]
  text?: string
  href?: string
  type?: string
  placeholder?: string
  value?: string
  disabled?: boolean
  visible?: boolean
  rect?: {
    x: number
    y: number
    width: number
    height: number
  }
  children?: DOMElement[]
}

export interface PageState {
  url: string
  title: string
  dom: DOMElement[]
  screenshot?: Buffer
  screenshotBase64?: string
  errors: string[]
  consoleMessages: string[]
  networkErrors: string[]
}

export interface AnalysisResult {
  currentPage: string
  currentState: string
  availableActions: string[]
  suggestedNextAction: Action | null
  uxIssues: UXIssue[]
  progress: number // 0-100 estimate of goal completion
}

// ============================================================================
// Issue Types
// ============================================================================

type IssueSeverity = 'critical' | 'major' | 'minor' | 'suggestion'

type IssueCategory =
  | 'usability'
  | 'accessibility'
  | 'performance'
  | 'visual'
  | 'functionality'
  | 'error_handling'
  | 'feedback'
  | 'navigation'

export interface UXIssue {
  id: string
  severity: IssueSeverity
  category: IssueCategory
  title: string
  description: string
  location?: string
  screenshot?: string
  reproductionSteps?: string[]
  suggestion?: string
}

// ============================================================================
// Report Types
// ============================================================================

export interface TestStep {
  stepNumber: number
  action: Action
  result: 'success' | 'failure' | 'warning'
  screenshot?: string
  duration: number
  notes?: string
}

export interface UXReport {
  scenario: string
  startTime: Date
  endTime: Date
  duration: number
  status: 'passed' | 'failed' | 'partial'
  steps: TestStep[]
  issues: UXIssue[]
  summary: string
  recommendations: string[]
}

// ============================================================================
// Agent Types
// ============================================================================

export interface AgentConfig {
  maxSteps: number
  timeout: number
  screenshotOnEachStep: boolean
  stopOnCriticalIssue: boolean
  baseUrl: string
  headless: boolean
}

interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentState {
  scenario: string
  goal: string
  currentStep: number
  maxSteps: number
  history: AgentMessage[]
  pageState: PageState | null
  issues: UXIssue[]
  isComplete: boolean
  error?: string
}

// ============================================================================
// API Client Types
// ============================================================================

export interface APITestResult {
  endpoint: string
  method: string
  status: number
  responseTime: number
  success: boolean
  error?: string
  data?: unknown
}

export interface APITestSuite {
  name: string
  results: APITestResult[]
  passed: number
  failed: number
  duration: number
}
