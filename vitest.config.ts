import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['node_modules', 'dist', 'e2e'],
    // Some component tests (heavy jsdom renders like ChatContainer/WelcomeScreen)
    // are timing-marginal. Cap worker oversubscription and give tests headroom so
    // they don't flake on CPU-starvation timeouts under full-suite parallelism.
    maxWorkers: 5,
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      provider: 'v8',
      // Keep a human report, machine-readable summaries for CI, and lcov for
      // downstream tooling. These floors deliberately sit just below the
      // measured baseline so coverage can ratchet upward without turning this
      // hardening pass into an unrelated app-wide rewrite.
      reporter: ['text', 'json-summary', 'html', 'lcov'],
      reportOnFailure: true,
      // Count every production TypeScript module, including an entry point or
      // transaction component that no test imports. This keeps the global
      // number honest; focused trust-boundary floors below carry the stronger
      // safety signal.
      include: [
        'src/**/*.{ts,tsx}',
        // These root-level shared modules are imported into the Vite frontend
        // (the remaining shared/prompts tree is backend-only).
        'shared/chains.ts',
        'shared/addressRegistry.ts',
        'shared/terminalPreview.ts',
      ],
      thresholds: {
        statements: 33,
        branches: 24,
        functions: 29,
        lines: 34,
        'src/components/payment/TransactionReviewModal.tsx': {
          statements: 70,
          branches: 44,
          functions: 60,
          lines: 72,
        },
        'src/components/payment/TransactionStatusCenter.tsx': {
          statements: 68,
          branches: 34,
          functions: 75,
          lines: 74,
        },
        'src/hooks/useGuardedTx.ts': {
          statements: 100,
          branches: 85,
          functions: 100,
          lines: 100,
        },
        'src/hooks/useTransactionExecutor.ts': {
          statements: 67,
          branches: 57,
          functions: 60,
          lines: 70,
        },
        'src/hooks/relayr/useOmnichainDeployERC20.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/hooks/relayr/useOmnichainQueueRuleset.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/services/projectTx.ts': {
          statements: 65,
          branches: 39,
          functions: 88,
          lines: 67,
        },
        'src/utils/transactionReview.ts': {
          statements: 82,
          branches: 68,
          functions: 83,
          lines: 80,
        },
        'shared/addressRegistry.ts': {
          statements: 95,
          branches: 90,
          functions: 100,
          lines: 97,
        },
        'shared/chains.ts': {
          statements: 52,
          branches: 0,
          functions: 14,
          lines: 56,
        },
        'shared/terminalPreview.ts': {
          statements: 92,
          branches: 89,
          functions: 100,
          lines: 94,
        },
      },
      exclude: [
        'node_modules/',
        'src/test/',
        'src/**/*.{test,spec}.{ts,tsx}',
        '**/*.d.ts',
        '**/*.config.*',
        '**/types/**',
      ],
    },
    // Mock browser APIs
    alias: {
      '@/': resolve(__dirname, './src/'),
    },
  },
  resolve: {
    alias: {
      '@/': resolve(__dirname, './src/'),
    },
  },
})
