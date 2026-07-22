import { defineConfig, devices } from '@playwright/test'

const isCI = Boolean(process.env.CI)
const appPort = Number(process.env.PLAYWRIGHT_APP_PORT ?? 3014)
const appOrigin = `http://127.0.0.1:${appPort}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  failOnFlakyTests: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI
    ? [['line'], ['html', { open: 'never' }]]
    : [['html', { open: 'never' }]],
  use: {
    // Browser gates exercise the production bundle, not Vite's development
    // transforms. This catches chunking, asset-path, and production-only bugs.
    baseURL: appOrigin,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'smoke',
      // Maintained transaction-safety smoke suite used by CI.
      testMatch: ['payment-review.spec.ts', 'transactions.spec.ts'],
      use: { ...devices['Desktop Chrome'], serviceWorkers: 'block' },
    },
    {
      name: 'critical',
      // Small, deterministic invariants that are strict enough to block PRs.
      // The larger historical flow suites remain available in their named
      // projects while they are progressively made non-conditional.
      testMatch: ['critical/**/*.spec.ts'],
      use: { ...devices['Desktop Chrome'], serviceWorkers: 'block' },
    },
    {
      // Older broad UI assertions remain runnable while their selectors and
      // mocked chat/auth journeys are brought in line with the current app.
      name: 'ui-regression',
      testMatch: ['app.spec.ts', 'invite.spec.ts', 'wallet.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'e2e-flows',
      testMatch: 'flows/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'api-tests',
      testMatch: 'api-tests/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'ux-bot',
      testMatch: 'ux-bot.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        // UX bot tests need more time
        actionTimeout: 10000,
        navigationTimeout: 30000,
      },
      timeout: 180000, // 3 minutes per test
    },
    {
      name: 'scenarios',
      testMatch: 'comprehensive-scenarios.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        actionTimeout: 10000,
        navigationTimeout: 30000,
      },
      timeout: 180000, // 3 minutes per test
    },
    {
      name: 'visual',
      testMatch: 'visual-regression.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
      },
      timeout: 60000,
    },
    {
      name: 'stress',
      testMatch: 'stress-test.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
      },
      timeout: 300000, // 5 minutes for stress tests
    },
    {
      name: 'responsive',
      testMatch: 'responsive.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
      },
      timeout: 120000,
    },
  ],
  webServer: {
    command: isCI
      ? `npm run preview -- --host 127.0.0.1 --port ${appPort}`
      : `npm run build && npm run preview -- --host 127.0.0.1 --port ${appPort}`,
    url: appOrigin,
    // Never let a green run come from an unrelated process already listening
    // on the expected port. A collision should fail loudly instead.
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },
})
