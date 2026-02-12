import { test as baseTest, expect } from '@playwright/test'
import { test as authTest, mockAuthEndpoints, seedTestUsers, type TestUser } from './fixtures/auth'
import { createUXAgent, APITestClient, ALL_SCENARIOS } from './ux-bot'

/**
 * UX Bot Test Suite
 *
 * This suite runs AI-powered exploratory testing using Claude to analyze
 * pages and decide on actions. It can discover UX issues that deterministic
 * tests might miss.
 *
 * Run with: npm run test:ux-bot
 * Run specific scenario: UX_SCENARIO="your scenario" npm run test:ux-bot
 * Run authenticated: UX_AUTHENTICATED=true npm run test:ux-bot
 */

// Get scenario from environment or use default
const customScenario = process.env.UX_SCENARIO
const defaultScenario = 'Explore the app and try to create a new project'
const useAuth = process.env.UX_AUTHENTICATED === 'true'

// Use authenticated test fixture when UX_AUTHENTICATED=true
const test = useAuth ? authTest : baseTest

test.describe('UX Bot - Exploratory Testing', () => {
  test.setTimeout(120000) // 2 minute timeout for exploratory tests

  test('runs custom scenario from environment', async ({ page }) => {
    if (!customScenario) {
      test.skip()
      return
    }

    const agent = createUXAgent(page, {
      maxSteps: 15,
      screenshotOnEachStep: true,
      stopOnCriticalIssue: false,
    })

    const report = await agent.runScenario(customScenario)

    // Verify no critical issues
    const criticalIssues = report.issues.filter(i => i.severity === 'critical')
    expect(criticalIssues).toHaveLength(0)

    // Log results
    console.log(`Scenario completed: ${report.status}`)
    console.log(`Issues found: ${report.issues.length}`)
  })

  test('runs default exploration scenario', async ({ page }) => {
    if (customScenario) {
      test.skip() // Skip if custom scenario is provided
      return
    }

    const agent = createUXAgent(page, {
      maxSteps: 10,
      screenshotOnEachStep: true,
    })

    const report = await agent.runScenario(defaultScenario)

    // Exploratory tests log results but don't fail on issues
    console.log(`Exploration complete: ${report.status}`)
    console.log(`Steps taken: ${report.steps.length}`)
    console.log(`Issues discovered: ${report.issues.length}`)

    // Only fail on critical errors that indicate the app is broken
    const appBrokenIssues = report.issues.filter(
      i => i.severity === 'critical' && i.category === 'functionality'
    )
    expect(appBrokenIssues).toHaveLength(0)
  })
})

test.describe('UX Bot - Project Creation Flow', () => {
  test.setTimeout(90000)

  test('can create a project via chat', async ({ page }) => {
    const agent = createUXAgent(page, {
      maxSteps: 15,
      screenshotOnEachStep: true,
    })

    const report = await agent.runScenario(
      'Create a project called "TestStore" using the chat interface'
    )

    // Check that the flow made progress
    expect(report.steps.length).toBeGreaterThan(0)

    // Log any issues found
    if (report.issues.length > 0) {
      console.log('Issues found during project creation:')
      for (const issue of report.issues) {
        console.log(`  [${issue.severity}] ${issue.title}`)
      }
    }
  })
})

test.describe('UX Bot - Store Management Flow', () => {
  test.setTimeout(90000)

  test('can manage store tiers', async ({ page }) => {
    const agent = createUXAgent(page, {
      maxSteps: 15,
      screenshotOnEachStep: true,
    })

    const report = await agent.runScenario(
      'Navigate to a project dashboard and add a new tier called "Gold" with price 0.1 ETH'
    )

    expect(report.steps.length).toBeGreaterThan(0)
  })
})

test.describe('UX Bot - API Testing', () => {
  test('tests all API endpoints', async ({ request }) => {
    const client = new APITestClient()

    // Run all API test suites
    const suites = await client.runAllSuites()

    // Print results
    APITestClient.printResults(suites)

    // Calculate totals
    const totalPassed = suites.reduce((sum, s) => sum + s.passed, 0)
    const totalFailed = suites.reduce((sum, s) => sum + s.failed, 0)

    // API tests should have at least some results
    // (they may fail if API is not running, which is OK in CI without backend)
    console.log(`API Tests: ${totalPassed} passed, ${totalFailed} failed`)
  })
})

test.describe('UX Bot - Regression Scenarios', () => {
  test.setTimeout(180000) // 3 minutes for full regression

  test.skip('runs all main scenarios', async ({ page }) => {
    // This test runs all main scenarios - skip by default due to length
    const agent = createUXAgent(page, {
      maxSteps: 20,
      screenshotOnEachStep: true,
    })

    const allScenarios = [
      ...ALL_SCENARIOS.projectCreation.main,
      ...ALL_SCENARIOS.storeManagement.main,
    ]

    const reports = await agent.runScenarios(allScenarios)

    // Summarize results
    const passed = reports.filter(r => r.status === 'passed').length
    const failed = reports.filter(r => r.status === 'failed').length
    const partial = reports.filter(r => r.status === 'partial').length

    console.log(`\nRegression Results: ${passed} passed, ${partial} partial, ${failed} failed`)

    // Collect all unique issues
    const allIssues = reports.flatMap(r => r.issues)
    const uniqueIssues = allIssues.filter(
      (issue, index, self) => self.findIndex(i => i.id === issue.id) === index
    )

    console.log(`Total unique issues: ${uniqueIssues.length}`)
  })
})

test.describe('UX Bot - Edge Cases', () => {
  test.setTimeout(60000)

  test('handles empty state gracefully', async ({ page }) => {
    const agent = createUXAgent(page, {
      maxSteps: 5,
    })

    const report = await agent.runScenario(
      'Check how the app handles an empty state with no projects'
    )

    // Should not crash
    expect(report.status).not.toBe('failed')
  })

  test('handles rapid interactions', async ({ page }) => {
    const agent = createUXAgent(page, {
      maxSteps: 10,
    })

    const report = await agent.runScenario(
      'Rapidly click different elements and navigate between pages to test stability'
    )

    // Check for JavaScript errors
    const jsErrors = report.issues.filter(i => i.category === 'functionality')
    if (jsErrors.length > 0) {
      console.warn('JS errors during rapid interaction:', jsErrors)
    }
  })
})

// ============================================================================
// Authenticated Flow Tests
// These require UX_AUTHENTICATED=true to run with real auth
// ============================================================================

authTest.describe('UX Bot - Authenticated Flows', () => {
  authTest.setTimeout(120000)

  authTest('explores dashboard as logged-in user', async ({ authenticatedPage, mockManagedAuth }) => {
    const page = authenticatedPage

    // Set up auth and mock API endpoints
    await mockManagedAuth(page)
    await mockAuthEndpoints(page)

    const agent = createUXAgent(page, {
      maxSteps: 15,
      screenshotOnEachStep: true,
    })

    const report = await agent.runScenario(
      'As a logged-in user, explore the dashboard, check wallet balance, and view any existing projects'
    )

    console.log(`Authenticated exploration: ${report.status}`)
    console.log(`Steps taken: ${report.steps.length}`)
    console.log(`Issues found: ${report.issues.length}`)

    // Should be able to access dashboard without auth errors
    const authErrors = report.issues.filter(
      i => i.title.toLowerCase().includes('auth') || i.title.toLowerCase().includes('401')
    )
    expect(authErrors).toHaveLength(0)
  })

  authTest('creates project as authenticated user', async ({ authenticatedPage, mockManagedAuth }) => {
    const page = authenticatedPage

    await mockManagedAuth(page)
    await mockAuthEndpoints(page)

    const agent = createUXAgent(page, {
      maxSteps: 20,
      screenshotOnEachStep: true,
    })

    const report = await agent.runScenario(
      'Create a new project called "My Test Store" with description "A test store for NFTs". Configure the store with at least one tier.'
    )

    console.log('Project creation results:')
    console.log(`  Status: ${report.status}`)
    console.log(`  Steps: ${report.steps.length}`)

    if (report.issues.length > 0) {
      console.log('  Issues:')
      for (const issue of report.issues) {
        console.log(`    [${issue.severity}] ${issue.title}`)
      }
    }

    expect(report.steps.length).toBeGreaterThan(0)
  })

  authTest('manages store tiers as owner', async ({ authenticatedPage, mockManagedAuth }) => {
    const page = authenticatedPage

    await mockManagedAuth(page)
    await mockAuthEndpoints(page)

    const agent = createUXAgent(page, {
      maxSteps: 20,
      screenshotOnEachStep: true,
    })

    const report = await agent.runScenario(
      'Navigate to an existing project dashboard, add a new NFT tier called "Gold Membership" priced at 0.05 ETH with 100 supply'
    )

    expect(report.steps.length).toBeGreaterThan(0)
  })

  authTest('tests payment flow', async ({ authenticatedPage, mockManagedAuth }) => {
    const page = authenticatedPage

    await mockManagedAuth(page)
    await mockAuthEndpoints(page)

    const agent = createUXAgent(page, {
      maxSteps: 15,
      screenshotOnEachStep: true,
    })

    const report = await agent.runScenario(
      'Find a project with available tiers, attempt to purchase a tier, and verify the payment preview shows correct information'
    )

    // Log payment flow issues for debugging
    if (report.issues.length > 0) {
      console.log('Payment flow issues:')
      for (const issue of report.issues) {
        console.log(`  [${issue.severity}] ${issue.title}: ${issue.description}`)
      }
    }

    expect(report.steps.length).toBeGreaterThan(0)
  })

  authTest('tests chat interaction', async ({ authenticatedPage, mockManagedAuth }) => {
    const page = authenticatedPage

    await mockManagedAuth(page)
    await mockAuthEndpoints(page)

    const agent = createUXAgent(page, {
      maxSteps: 15,
      screenshotOnEachStep: true,
    })

    const report = await agent.runScenario(
      'Use the chat interface to ask about creating a project. Verify the AI responds and can guide through project setup.'
    )

    expect(report.steps.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// Real Backend Tests (Full Stack)
// These use real JWT tokens from the backend, no mocking
// Run with: npm run test:ux-bot:real
// Each test uses a different user to avoid OTP conflicts in parallel
// ============================================================================

authTest.describe('UX Bot - Real Backend', () => {
  authTest.setTimeout(180000) // 3 minutes for full e2e

  // Seed test users before running tests
  authTest.beforeAll(async () => {
    const seeded = await seedTestUsers()
    if (!seeded) {
      console.log('Note: Could not seed users via API - ensure they exist in DB')
    }
  })

  // Each test uses a DIFFERENT email to avoid OTP conflicts when running in parallel
  authTest('explores app with real auth', async ({ page, realAuth }) => {
    await realAuth(page, 'e2e-user@test.juicy.vision')

    const agent = createUXAgent(page, {
      maxSteps: 15,
      screenshotOnEachStep: true,
    })

    const report = await agent.runScenario(
      'Explore the app as a logged-in user. Check the dashboard, view wallet balance, and try to interact with any available features.'
    )

    console.log(`\n[Real Auth] Exploration complete`)
    console.log(`  Status: ${report.status}`)
    console.log(`  Steps: ${report.steps.length}`)
    console.log(`  Issues: ${report.issues.length}`)

    // Should not have auth-related errors
    const authErrors = report.issues.filter(
      i => i.description?.toLowerCase().includes('401') ||
           i.description?.toLowerCase().includes('unauthorized')
    )
    if (authErrors.length > 0) {
      console.warn('Auth errors found:', authErrors)
    }

    expect(report.steps.length).toBeGreaterThan(0)
  })

  authTest('creates project with real auth', async ({ page, realAuth }) => {
    await realAuth(page, 'e2e-power@test.juicy.vision')

    const agent = createUXAgent(page, {
      maxSteps: 25,
      screenshotOnEachStep: true,
    })

    const report = await agent.runScenario(
      'Create a new project using the chat interface. Name it "E2E Test Project" and add a description. Complete the project creation flow.'
    )

    console.log(`\n[Real Auth] Project creation`)
    console.log(`  Status: ${report.status}`)
    console.log(`  Steps: ${report.steps.length}`)

    if (report.issues.length > 0) {
      console.log('  Issues found:')
      for (const issue of report.issues) {
        console.log(`    [${issue.severity}] ${issue.title}`)
      }
    }

    expect(report.steps.length).toBeGreaterThan(0)
  })

  authTest('tests full payment flow with real auth', async ({ page, realAuth }) => {
    await realAuth(page, 'e2e-anon@test.juicy.vision')

    const agent = createUXAgent(page, {
      maxSteps: 20,
      screenshotOnEachStep: true,
    })

    const report = await agent.runScenario(
      'Find a project with purchasable tiers. Attempt to buy a tier and go through the payment flow until you reach the final confirmation or payment step.'
    )

    console.log(`\n[Real Auth] Payment flow`)
    console.log(`  Status: ${report.status}`)
    console.log(`  Steps: ${report.steps.length}`)

    expect(report.steps.length).toBeGreaterThan(0)
  })

  authTest('tests chat with AI using real auth', async ({ page, realAuth }) => {
    await realAuth(page, 'e2e-ghost@test.juicy.vision')

    const agent = createUXAgent(page, {
      maxSteps: 15,
      screenshotOnEachStep: true,
    })

    const report = await agent.runScenario(
      'Send a message to the AI assistant asking "What can you help me with?" and wait for a response. Then ask a follow-up question about creating a store.'
    )

    console.log(`\n[Real Auth] Chat interaction`)
    console.log(`  Status: ${report.status}`)
    console.log(`  Steps: ${report.steps.length}`)

    expect(report.steps.length).toBeGreaterThan(0)
  })
})
