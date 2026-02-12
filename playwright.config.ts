import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
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
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
})
