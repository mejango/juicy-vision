import * as fs from 'fs'
import * as path from 'path'
import type { UXReport, UXIssue, TestStep } from './types'

/**
 * Generates UX testing reports in various formats.
 */
export class ReportGenerator {
  private outputDir: string

  constructor(outputDir: string = './test-results/ux-reports') {
    this.outputDir = outputDir
    this.ensureOutputDir()
  }

  private ensureOutputDir() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true })
    }
  }

  /**
   * Generate a complete report from test results.
   */
  generateReport(report: UXReport): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `ux-report-${timestamp}`

    // Generate both HTML and JSON reports
    const htmlPath = this.generateHtmlReport(report, filename)
    this.generateJsonReport(report, filename)

    return htmlPath
  }

  /**
   * Generate an HTML report.
   */
  private generateHtmlReport(report: UXReport, filename: string): string {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UX Test Report - ${report.scenario}</title>
  <style>
    :root {
      --bg-primary: #1a1a1a;
      --bg-secondary: #2d2d2d;
      --text-primary: #ffffff;
      --text-secondary: #a0a0a0;
      --accent: #ff7b00;
      --success: #22c55e;
      --warning: #f59e0b;
      --error: #ef4444;
      --critical: #dc2626;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      padding: 2rem;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1, h2, h3 { margin-bottom: 1rem; }
    h1 { color: var(--accent); border-bottom: 2px solid var(--accent); padding-bottom: 0.5rem; }
    .summary {
      background: var(--bg-secondary);
      padding: 1.5rem;
      border-radius: 8px;
      margin-bottom: 2rem;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
    }
    .summary-item { text-align: center; }
    .summary-label { color: var(--text-secondary); font-size: 0.875rem; }
    .summary-value { font-size: 1.5rem; font-weight: bold; }
    .status-passed { color: var(--success); }
    .status-failed { color: var(--error); }
    .status-partial { color: var(--warning); }
    .issues { margin-bottom: 2rem; }
    .issue {
      background: var(--bg-secondary);
      padding: 1rem;
      border-radius: 8px;
      margin-bottom: 1rem;
      border-left: 4px solid;
    }
    .issue-critical { border-color: var(--critical); }
    .issue-major { border-color: var(--error); }
    .issue-minor { border-color: var(--warning); }
    .issue-suggestion { border-color: var(--text-secondary); }
    .issue-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    .issue-title { font-weight: bold; }
    .issue-badge {
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      text-transform: uppercase;
    }
    .badge-critical { background: var(--critical); }
    .badge-major { background: var(--error); }
    .badge-minor { background: var(--warning); color: #000; }
    .badge-suggestion { background: var(--text-secondary); }
    .steps { margin-bottom: 2rem; }
    .step {
      background: var(--bg-secondary);
      padding: 1rem;
      border-radius: 8px;
      margin-bottom: 0.5rem;
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .step-number {
      width: 2rem;
      height: 2rem;
      background: var(--accent);
      color: #000;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
    }
    .step-success .step-number { background: var(--success); }
    .step-failure .step-number { background: var(--error); }
    .step-content { flex: 1; }
    .step-duration { color: var(--text-secondary); font-size: 0.875rem; }
    .screenshot { max-width: 100%; border-radius: 4px; margin-top: 0.5rem; }
    .recommendations {
      background: var(--bg-secondary);
      padding: 1.5rem;
      border-radius: 8px;
    }
    .recommendations ul { padding-left: 1.5rem; }
    .recommendations li { margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>UX Test Report</h1>

    <div class="summary">
      <div class="summary-item">
        <div class="summary-label">Scenario</div>
        <div class="summary-value">${this.escapeHtml(report.scenario)}</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">Status</div>
        <div class="summary-value status-${report.status}">${report.status.toUpperCase()}</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">Duration</div>
        <div class="summary-value">${(report.duration / 1000).toFixed(1)}s</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">Steps</div>
        <div class="summary-value">${report.steps.length}</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">Issues Found</div>
        <div class="summary-value">${report.issues.length}</div>
      </div>
    </div>

    <h2>Summary</h2>
    <p style="margin-bottom: 2rem;">${this.escapeHtml(report.summary)}</p>

    ${this.renderIssuesSection(report.issues)}

    ${this.renderStepsSection(report.steps)}

    ${this.renderRecommendationsSection(report.recommendations)}
  </div>
</body>
</html>`

    const filePath = path.join(this.outputDir, `${filename}.html`)
    fs.writeFileSync(filePath, html)
    return filePath
  }

  private renderIssuesSection(issues: UXIssue[]): string {
    if (issues.length === 0) {
      return '<h2>Issues</h2><p style="margin-bottom: 2rem; color: var(--success);">No issues found!</p>'
    }

    // Sort by severity
    const sortedIssues = [...issues].sort((a, b) => {
      const order = { critical: 0, major: 1, minor: 2, suggestion: 3 }
      return order[a.severity] - order[b.severity]
    })

    const issueHtml = sortedIssues
      .map(
        (issue) => `
      <div class="issue issue-${issue.severity}">
        <div class="issue-header">
          <span class="issue-title">${this.escapeHtml(issue.title)}</span>
          <span class="issue-badge badge-${issue.severity}">${issue.severity}</span>
        </div>
        <p style="color: var(--text-secondary); margin-bottom: 0.5rem;">
          Category: ${issue.category}
        </p>
        <p>${this.escapeHtml(issue.description)}</p>
        ${issue.suggestion ? `<p style="margin-top: 0.5rem; color: var(--accent);">Suggestion: ${this.escapeHtml(issue.suggestion)}</p>` : ''}
        ${issue.screenshot ? `<img src="${issue.screenshot}" class="screenshot" alt="Issue screenshot">` : ''}
      </div>
    `
      )
      .join('')

    return `<h2>Issues (${issues.length})</h2><div class="issues">${issueHtml}</div>`
  }

  private renderStepsSection(steps: TestStep[]): string {
    const stepsHtml = steps
      .map(
        (step) => `
      <div class="step step-${step.result}">
        <div class="step-number">${step.stepNumber}</div>
        <div class="step-content">
          <strong>${step.action.type}</strong>: ${this.escapeHtml(step.action.description || '')}
          ${step.notes ? `<p style="color: var(--text-secondary); margin-top: 0.25rem;">${this.escapeHtml(step.notes)}</p>` : ''}
        </div>
        <div class="step-duration">${step.duration}ms</div>
      </div>
    `
      )
      .join('')

    return `<h2>Test Steps</h2><div class="steps">${stepsHtml}</div>`
  }

  private renderRecommendationsSection(recommendations: string[]): string {
    if (recommendations.length === 0) return ''

    const recHtml = recommendations.map((r) => `<li>${this.escapeHtml(r)}</li>`).join('')

    return `
      <h2>Recommendations</h2>
      <div class="recommendations">
        <ul>${recHtml}</ul>
      </div>
    `
  }

  /**
   * Generate a JSON report for programmatic access.
   */
  private generateJsonReport(report: UXReport, filename: string): string {
    const filePath = path.join(this.outputDir, `${filename}.json`)
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2))
    return filePath
  }

  /**
   * Escape HTML special characters.
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }
}

/**
 * Print a summary to console.
 */
export function printReportSummary(report: UXReport) {
  console.log('\n' + '='.repeat(60))
  console.log('UX TEST REPORT')
  console.log('='.repeat(60))
  console.log(`Scenario: ${report.scenario}`)
  console.log(`Status: ${report.status.toUpperCase()}`)
  console.log(`Duration: ${(report.duration / 1000).toFixed(1)}s`)
  console.log(`Steps: ${report.steps.length}`)
  console.log(`Issues: ${report.issues.length}`)
  console.log('')

  if (report.issues.length > 0) {
    console.log('ISSUES:')
    for (const issue of report.issues) {
      console.log(`  [${issue.severity.toUpperCase()}] ${issue.title}`)
      console.log(`    ${issue.description}`)
      if (issue.suggestion) {
        console.log(`    Suggestion: ${issue.suggestion}`)
      }
    }
    console.log('')
  }

  console.log('SUMMARY:')
  console.log(`  ${report.summary}`)
  console.log('')

  if (report.recommendations.length > 0) {
    console.log('RECOMMENDATIONS:')
    for (const rec of report.recommendations) {
      console.log(`  - ${rec}`)
    }
  }

  console.log('='.repeat(60) + '\n')
}
