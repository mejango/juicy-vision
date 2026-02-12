import type { Page } from '@playwright/test'
import { PlaywrightDriver } from './driver'
import { PageAnalyzer } from './analyzer'
import { ReportGenerator, printReportSummary } from './reporter'
import type {
  AgentConfig,
  AgentState,
  UXReport,
  UXIssue,
  TestStep,
  Action,
} from './types'

/**
 * AI-powered UX testing agent.
 * Uses Claude to analyze pages and decide on actions to test user flows.
 */
export class UXTestAgent {
  private page: Page
  private driver: PlaywrightDriver
  private analyzer: PageAnalyzer
  private reporter: ReportGenerator
  private config: AgentConfig

  constructor(page: Page, config: Partial<AgentConfig> = {}) {
    this.page = page
    this.driver = new PlaywrightDriver(page)
    this.analyzer = new PageAnalyzer()
    this.reporter = new ReportGenerator()

    this.config = {
      maxSteps: config.maxSteps || 20,
      timeout: config.timeout || 60000,
      screenshotOnEachStep: config.screenshotOnEachStep ?? true,
      stopOnCriticalIssue: config.stopOnCriticalIssue ?? false,
      baseUrl: config.baseUrl || 'http://localhost:3000',
      headless: config.headless ?? true,
    }
  }

  /**
   * Run a test scenario.
   */
  async runScenario(scenario: string): Promise<UXReport> {
    const startTime = Date.now()
    const state: AgentState = {
      scenario,
      goal: scenario,
      currentStep: 0,
      maxSteps: this.config.maxSteps,
      history: [],
      pageState: null,
      issues: [],
      isComplete: false,
    }

    const steps: TestStep[] = []
    const previousActions: string[] = []

    console.log(`\n[UX Bot] Starting scenario: "${scenario}"`)
    console.log(`[UX Bot] Max steps: ${this.config.maxSteps}`)

    // Navigate to base URL
    await this.page.goto(this.config.baseUrl)
    // Use domcontentloaded to avoid timeout on WebSocket/SSE connections
    await this.page.waitForLoadState('domcontentloaded')
    await this.page.waitForTimeout(1000) // Give React time to hydrate

    // Main agent loop
    while (!state.isComplete && state.currentStep < this.config.maxSteps) {
      state.currentStep++
      const stepStartTime = Date.now()

      console.log(`\n[UX Bot] Step ${state.currentStep}/${this.config.maxSteps}`)

      try {
        // 1. Get current page state
        state.pageState = await this.driver.getPageState()

        // 2. Take screenshot if configured
        let screenshotBase64: string | undefined
        if (this.config.screenshotOnEachStep) {
          const screenshot = await this.driver.takeScreenshot()
          screenshotBase64 = screenshot.toString('base64')
        }

        // 3. Analyze page and get next action
        const analysis = await this.analyzer.analyze(
          state.pageState,
          state.goal,
          previousActions,
          screenshotBase64
        )

        console.log(`[UX Bot] Current page: ${analysis.currentPage}`)
        console.log(`[UX Bot] Progress: ${analysis.progress}%`)

        // 4. Collect any new issues
        for (const issue of analysis.uxIssues) {
          if (!state.issues.some(i => i.id === issue.id)) {
            state.issues.push(issue)
            console.log(`[UX Bot] Issue found: [${issue.severity}] ${issue.title}`)
          }
        }

        // 5. Check if we should stop on critical issue
        if (this.config.stopOnCriticalIssue) {
          const criticalIssue = analysis.uxIssues.find(i => i.severity === 'critical')
          if (criticalIssue) {
            console.log(`[UX Bot] Stopping due to critical issue: ${criticalIssue.title}`)
            state.isComplete = true
            state.error = `Critical issue: ${criticalIssue.title}`
          }
        }

        // 6. Execute the suggested action
        const action = analysis.suggestedNextAction
        if (action && !state.isComplete) {
          console.log(`[UX Bot] Action: ${action.type} - ${action.description || ''}`)

          const actionResult = await this.driver.executeAction(action)

          const step: TestStep = {
            stepNumber: state.currentStep,
            action,
            result: actionResult.success ? 'success' : 'failure',
            duration: Date.now() - stepStartTime,
            notes: actionResult.error,
          }

          if (screenshotBase64) {
            step.screenshot = `data:image/png;base64,${screenshotBase64}`
          }

          steps.push(step)
          previousActions.push(`${action.type}: ${action.description || JSON.stringify(action)}`)

          // Wait a bit for the page to update
          await this.page.waitForTimeout(500)
        }

        // 7. Check if goal is complete
        if (analysis.progress >= 100) {
          console.log('[UX Bot] Goal appears to be complete!')
          state.isComplete = true
        }

        // 8. Check for stuck state (same page for too many steps)
        if (state.currentStep >= 5 && analysis.progress < 10) {
          console.log('[UX Bot] Progress seems stuck, continuing exploration...')
        }

      } catch (error) {
        console.error(`[UX Bot] Error in step ${state.currentStep}:`, error)
        steps.push({
          stepNumber: state.currentStep,
          action: { type: 'wait', timeout: 0, description: 'Error occurred' },
          result: 'failure',
          duration: Date.now() - stepStartTime,
          notes: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    // Generate report
    const endTime = Date.now()
    const report: UXReport = {
      scenario,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      duration: endTime - startTime,
      status: this.determineStatus(state, steps),
      steps,
      issues: state.issues,
      summary: this.generateSummary(state, steps),
      recommendations: this.generateRecommendations(state.issues),
    }

    // Generate and save report
    const reportPath = this.reporter.generateReport(report)
    console.log(`\n[UX Bot] Report saved to: ${reportPath}`)

    // Print summary
    printReportSummary(report)

    return report
  }

  private determineStatus(state: AgentState, steps: TestStep[]): UXReport['status'] {
    if (state.error || steps.some(s => s.result === 'failure')) {
      return 'failed'
    }
    if (state.isComplete && !state.issues.some(i => i.severity === 'critical' || i.severity === 'major')) {
      return 'passed'
    }
    return 'partial'
  }

  private generateSummary(state: AgentState, steps: TestStep[]): string {
    const parts: string[] = []

    parts.push(`Completed ${state.currentStep} steps.`)

    if (state.isComplete) {
      parts.push('The scenario goal appears to be achieved.')
    } else if (state.currentStep >= this.config.maxSteps) {
      parts.push('Reached maximum step limit before completing the goal.')
    }

    if (state.issues.length > 0) {
      const critical = state.issues.filter(i => i.severity === 'critical').length
      const major = state.issues.filter(i => i.severity === 'major').length
      const minor = state.issues.filter(i => i.severity === 'minor').length

      parts.push(`Found ${state.issues.length} issues: ${critical} critical, ${major} major, ${minor} minor/suggestions.`)
    } else {
      parts.push('No UX issues were detected during testing.')
    }

    const failures = steps.filter(s => s.result === 'failure').length
    if (failures > 0) {
      parts.push(`${failures} actions failed during execution.`)
    }

    return parts.join(' ')
  }

  private generateRecommendations(issues: UXIssue[]): string[] {
    const recommendations: string[] = []

    // Group issues by category
    const byCategory = issues.reduce((acc, issue) => {
      acc[issue.category] = acc[issue.category] || []
      acc[issue.category].push(issue)
      return acc
    }, {} as Record<string, UXIssue[]>)

    // Generate recommendations based on issue patterns
    if (byCategory.functionality?.length) {
      recommendations.push('Address functionality issues first as they may block user flows.')
    }

    if (byCategory.error_handling?.length) {
      recommendations.push('Improve error handling and user feedback for edge cases.')
    }

    if (byCategory.accessibility?.length) {
      recommendations.push('Run accessibility audit (WCAG compliance check).')
    }

    if (byCategory.usability?.length) {
      recommendations.push('Consider user testing to validate UX improvements.')
    }

    if (byCategory.visual?.length) {
      recommendations.push('Review visual design for consistency across the app.')
    }

    // Add specific suggestions from issues
    for (const issue of issues.filter(i => i.suggestion)) {
      if (!recommendations.includes(issue.suggestion!)) {
        recommendations.push(issue.suggestion!)
      }
    }

    return recommendations.slice(0, 10) // Limit to 10 recommendations
  }

  /**
   * Run multiple scenarios and aggregate results.
   */
  async runScenarios(scenarios: string[]): Promise<UXReport[]> {
    const reports: UXReport[] = []

    for (const scenario of scenarios) {
      const report = await this.runScenario(scenario)
      reports.push(report)

      // Reset page state between scenarios
      await this.page.goto('about:blank')
      await this.page.waitForTimeout(500)
    }

    return reports
  }
}

/**
 * Create a UX test agent with default configuration.
 */
export function createUXAgent(page: Page, config?: Partial<AgentConfig>): UXTestAgent {
  return new UXTestAgent(page, config)
}
