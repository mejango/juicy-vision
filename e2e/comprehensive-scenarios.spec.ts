import { test as authTest, seedTestUsers } from './fixtures/auth'
import { createUXAgent } from './ux-bot'
import {
  ALL_COMPREHENSIVE_SCENARIOS,
  getAllMainScenarios,
  getAllEdgeScenarios,
} from './ux-bot/scenarios/comprehensive'

/**
 * Comprehensive UX Bot Scenario Suite
 *
 * Runs all 50+ AI-powered test scenarios across different categories.
 * Each scenario uses Claude to analyze pages and discover UX issues.
 *
 * Run with: npm run test:scenarios
 * Run specific category: npm run test:scenarios -- --grep "Ruleset"
 */

// Test users - each describe block uses a dedicated user to avoid OTP conflicts
const TEST_USERS = {
  ruleset: 'e2e-user@test.juicy.vision',
  payout: 'e2e-power@test.juicy.vision',
  search: 'e2e-anon@test.juicy.vision',
  nftTier: 'e2e-ghost@test.juicy.vision',
  chat: 'e2e-user@test.juicy.vision',
  omnichain: 'e2e-power@test.juicy.vision',
  errorRecovery: 'e2e-anon@test.juicy.vision',
}

// Global setup - seed users once
let seeded = false
async function ensureSeeded() {
  if (seeded) return
  seeded = true
  await seedTestUsers()
  try {
    await fetch('http://localhost:3001/debug/seed-full-test-data', { method: 'POST' })
  } catch {
    console.log('Could not seed full test data - some tests may have limited data')
  }
}

// ============================================================================
// Ruleset Management Scenarios
// ============================================================================

authTest.describe('Comprehensive - Ruleset Management', () => {
  authTest.setTimeout(180000)

  authTest.beforeAll(async () => {
    await ensureSeeded()
  })

  for (const scenario of ALL_COMPREHENSIVE_SCENARIOS.ruleset.main) {
    authTest(`main: ${scenario.slice(0, 60)}...`, async ({ page, realAuth }) => {
      await realAuth(page, TEST_USERS.ruleset)

      const agent = createUXAgent(page, {
        maxSteps: 20,
        screenshotOnEachStep: true,
      })

      const report = await agent.runScenario(scenario)

      console.log(`[Ruleset] ${report.status} - ${report.steps.length} steps, ${report.issues.length} issues`)
    })
  }

  for (const scenario of ALL_COMPREHENSIVE_SCENARIOS.ruleset.edge) {
    authTest(`edge: ${scenario.slice(0, 60)}...`, async ({ page, realAuth }) => {
      await realAuth(page, TEST_USERS.ruleset)

      const agent = createUXAgent(page, {
        maxSteps: 15,
        screenshotOnEachStep: true,
      })

      const report = await agent.runScenario(scenario)
      console.log(`[Ruleset Edge] ${report.status} - ${report.issues.length} issues`)
    })
  }
})

// ============================================================================
// Payout Distribution Scenarios
// ============================================================================

authTest.describe('Comprehensive - Payout Distribution', () => {
  authTest.setTimeout(180000)

  authTest.beforeAll(async () => {
    await ensureSeeded()
  })

  for (const scenario of ALL_COMPREHENSIVE_SCENARIOS.payout.main) {
    authTest(`main: ${scenario.slice(0, 60)}...`, async ({ page, realAuth }) => {
      await realAuth(page, TEST_USERS.payout)

      const agent = createUXAgent(page, {
        maxSteps: 20,
        screenshotOnEachStep: true,
      })

      const report = await agent.runScenario(scenario)
      console.log(`[Payout] ${report.status} - ${report.steps.length} steps`)
    })
  }

  for (const scenario of ALL_COMPREHENSIVE_SCENARIOS.payout.edge) {
    authTest(`edge: ${scenario.slice(0, 60)}...`, async ({ page, realAuth }) => {
      await realAuth(page, TEST_USERS.payout)

      const agent = createUXAgent(page, {
        maxSteps: 15,
        screenshotOnEachStep: true,
      })

      const report = await agent.runScenario(scenario)
      console.log(`[Payout Edge] ${report.status}`)
    })
  }
})

// ============================================================================
// Search & Discovery Scenarios
// ============================================================================

authTest.describe('Comprehensive - Search & Discovery', () => {
  authTest.setTimeout(120000)

  authTest.beforeAll(async () => {
    await ensureSeeded()
  })

  for (const scenario of ALL_COMPREHENSIVE_SCENARIOS.search.main) {
    authTest(`main: ${scenario.slice(0, 60)}...`, async ({ page, realAuth }) => {
      await realAuth(page, TEST_USERS.search)

      const agent = createUXAgent(page, {
        maxSteps: 15,
        screenshotOnEachStep: true,
      })

      const report = await agent.runScenario(scenario)
      console.log(`[Search] ${report.status}`)
    })
  }

  for (const scenario of ALL_COMPREHENSIVE_SCENARIOS.search.edge) {
    authTest(`edge: ${scenario.slice(0, 60)}...`, async ({ page, realAuth }) => {
      await realAuth(page, TEST_USERS.search)

      const agent = createUXAgent(page, {
        maxSteps: 10,
        screenshotOnEachStep: true,
      })

      const report = await agent.runScenario(scenario)
      console.log(`[Search Edge] ${report.status}`)
    })
  }
})

// ============================================================================
// NFT Tier Scenarios
// ============================================================================

authTest.describe('Comprehensive - NFT Tiers', () => {
  authTest.setTimeout(180000)

  authTest.beforeAll(async () => {
    await ensureSeeded()
  })

  for (const scenario of ALL_COMPREHENSIVE_SCENARIOS.nftTier.main) {
    authTest(`main: ${scenario.slice(0, 60)}...`, async ({ page, realAuth }) => {
      await realAuth(page, TEST_USERS.nftTier)

      const agent = createUXAgent(page, {
        maxSteps: 20,
        screenshotOnEachStep: true,
      })

      const report = await agent.runScenario(scenario)
      console.log(`[NFT Tier] ${report.status} - ${report.issues.length} issues`)
    })
  }

  for (const scenario of ALL_COMPREHENSIVE_SCENARIOS.nftTier.edge) {
    authTest(`edge: ${scenario.slice(0, 60)}...`, async ({ page, realAuth }) => {
      await realAuth(page, TEST_USERS.nftTier)

      const agent = createUXAgent(page, {
        maxSteps: 15,
        screenshotOnEachStep: true,
      })

      const report = await agent.runScenario(scenario)
      console.log(`[NFT Tier Edge] ${report.status}`)
    })
  }
})

// ============================================================================
// Chat & AI Scenarios
// ============================================================================

authTest.describe('Comprehensive - Chat & AI', () => {
  authTest.setTimeout(180000)

  authTest.beforeAll(async () => {
    await ensureSeeded()
  })

  for (const scenario of ALL_COMPREHENSIVE_SCENARIOS.chat.main) {
    authTest(`main: ${scenario.slice(0, 60)}...`, async ({ page, realAuth }) => {
      await realAuth(page, TEST_USERS.chat)

      const agent = createUXAgent(page, {
        maxSteps: 20,
        screenshotOnEachStep: true,
      })

      const report = await agent.runScenario(scenario)
      console.log(`[Chat] ${report.status} - ${report.steps.length} steps`)
    })
  }

  for (const scenario of ALL_COMPREHENSIVE_SCENARIOS.chat.edge) {
    authTest(`edge: ${scenario.slice(0, 60)}...`, async ({ page, realAuth }) => {
      await realAuth(page, TEST_USERS.chat)

      const agent = createUXAgent(page, {
        maxSteps: 15,
        screenshotOnEachStep: true,
      })

      const report = await agent.runScenario(scenario)
      console.log(`[Chat Edge] ${report.status}`)
    })
  }
})

// ============================================================================
// Omnichain Scenarios
// ============================================================================

authTest.describe('Comprehensive - Omnichain', () => {
  authTest.setTimeout(180000)

  authTest.beforeAll(async () => {
    await ensureSeeded()
  })

  for (const scenario of ALL_COMPREHENSIVE_SCENARIOS.omnichain.main) {
    authTest(`main: ${scenario.slice(0, 60)}...`, async ({ page, realAuth }) => {
      await realAuth(page, TEST_USERS.omnichain)

      const agent = createUXAgent(page, {
        maxSteps: 20,
        screenshotOnEachStep: true,
      })

      const report = await agent.runScenario(scenario)
      console.log(`[Omnichain] ${report.status}`)
    })
  }

  for (const scenario of ALL_COMPREHENSIVE_SCENARIOS.omnichain.edge) {
    authTest(`edge: ${scenario.slice(0, 60)}...`, async ({ page, realAuth }) => {
      await realAuth(page, TEST_USERS.omnichain)

      const agent = createUXAgent(page, {
        maxSteps: 15,
        screenshotOnEachStep: true,
      })

      const report = await agent.runScenario(scenario)
      console.log(`[Omnichain Edge] ${report.status}`)
    })
  }
})

// ============================================================================
// Error Recovery Scenarios
// ============================================================================

authTest.describe('Comprehensive - Error Recovery', () => {
  authTest.setTimeout(120000)

  authTest.beforeAll(async () => {
    await ensureSeeded()
  })

  for (const scenario of ALL_COMPREHENSIVE_SCENARIOS.errorRecovery.main) {
    authTest(`main: ${scenario.slice(0, 60)}...`, async ({ page, realAuth }) => {
      await realAuth(page, TEST_USERS.errorRecovery)

      const agent = createUXAgent(page, {
        maxSteps: 15,
        screenshotOnEachStep: true,
      })

      const report = await agent.runScenario(scenario)
      console.log(`[Error Recovery] ${report.status}`)
    })
  }

  for (const scenario of ALL_COMPREHENSIVE_SCENARIOS.errorRecovery.edge) {
    authTest(`edge: ${scenario.slice(0, 60)}...`, async ({ page, realAuth }) => {
      await realAuth(page, TEST_USERS.errorRecovery)

      const agent = createUXAgent(page, {
        maxSteps: 10,
        screenshotOnEachStep: true,
      })

      const report = await agent.runScenario(scenario)
      console.log(`[Error Recovery Edge] ${report.status}`)
    })
  }
})

// ============================================================================
// Summary Report
// ============================================================================

authTest.describe('Comprehensive - Full Suite Summary', () => {
  authTest.setTimeout(600000) // 10 minutes

  authTest.skip('runs ALL main scenarios and generates report', async ({ page, realAuth }) => {
    // This test is skipped by default due to length
    // Run with: npm run test:scenarios -- --grep "ALL main" --no-skip

    const allScenarios = getAllMainScenarios()
    const results: Array<{ scenario: string; status: string; issues: number }> = []

    for (const scenario of allScenarios.slice(0, 10)) { // Limit for demo
      await realAuth(page, TEST_USERS.ruleset)

      const agent = createUXAgent(page, {
        maxSteps: 15,
        screenshotOnEachStep: false, // Faster
      })

      const report = await agent.runScenario(scenario)
      results.push({
        scenario: scenario.slice(0, 50),
        status: report.status,
        issues: report.issues.length,
      })

      // Reset page between scenarios
      await page.goto('about:blank')
    }

    // Print summary
    console.log('\n' + '='.repeat(60))
    console.log('COMPREHENSIVE SCENARIO SUMMARY')
    console.log('='.repeat(60))

    const passed = results.filter(r => r.status === 'passed').length
    const failed = results.filter(r => r.status === 'failed').length
    const partial = results.filter(r => r.status === 'partial').length
    const totalIssues = results.reduce((sum, r) => sum + r.issues, 0)

    console.log(`Passed: ${passed}`)
    console.log(`Failed: ${failed}`)
    console.log(`Partial: ${partial}`)
    console.log(`Total Issues: ${totalIssues}`)
    console.log('='.repeat(60))

    for (const result of results) {
      console.log(`[${result.status.toUpperCase()}] ${result.scenario}... (${result.issues} issues)`)
    }
  })
})
