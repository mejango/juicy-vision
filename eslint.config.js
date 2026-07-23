import { fixupPluginRules } from '@eslint/compat'
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

// Flat config (ESLint 10). Scoped to the frontend in src/ — the code that tsc/build
// and the vitest suite gate. Non-frontend trees (deno backend, playwright e2e,
// mobile, terminal) have their own toolchains and are not linted here.
export default tseslint.config(
  {
    ignores: [
      'dist',
      'coverage',
      'node_modules',
      'backend',
      'e2e',
      'mobile',
      'terminal',
      'contracts',
      'docker',
      'docs',
      'public',
      'playwright-report',
      'test-results',
      'dev-dist',
      '**/*.config.{js,ts}',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      // These plugins still expose rules written for the ESLint 9 context API.
      // Preserve their full behavior through ESLint 10's compatibility adapter.
      'react-hooks': fixupPluginRules(reactHooks),
      'react-refresh': fixupPluginRules(reactRefresh),
    },
    rules: {
      // Preserve the established hooks correctness gate. React Hooks 7 folds
      // React Compiler readiness rules into `recommended`; those are a
      // separate refactor rather than a dependency-upgrade requirement.
      'react-hooks/rules-of-hooks': 'error',
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // ESLint 10 added these to its recommended preset. Enabling them across
      // legacy catch/reassignment sites is a separate cleanup with no runtime
      // bearing on this toolchain migration.
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      'no-empty': 'error',
      // Dynamic require() is used deliberately in a few spots to break import cycles.
      '@typescript-eslint/no-require-imports': 'error',
    },
  },
  // Test + setup files: vitest globals.
  {
    files: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/setupTests.ts', 'src/test/**'],
    languageOptions: {
      globals: { ...globals.node, vi: 'readonly', describe: 'readonly', it: 'readonly', expect: 'readonly', beforeEach: 'readonly', afterEach: 'readonly', beforeAll: 'readonly', afterAll: 'readonly' },
    },
    rules: {
      // Test doubles intentionally bridge browser/provider APIs with partial
      // shapes; production source remains strictly typed.
      '@typescript-eslint/no-explicit-any': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
  // These established UI modules intentionally colocate pure display helpers
  // with components. This only affects development hot-reload heuristics, not
  // runtime correctness; keep the exception explicit and file-scoped.
  {
    files: [
      'src/components/chat/ParticipantAvatars.tsx',
      'src/components/dynamic/charts/IssuanceScheduleChart.tsx',
      'src/components/dynamic/charts/shared.tsx',
      'src/components/dynamic/create-flow/StepBasics.tsx',
      'src/components/dynamic/create-flow/StepDeploy.tsx',
      'src/components/dynamic/create-flow/StepFlavor.tsx',
      'src/components/dynamic/create-flow/StepRulesets.tsx',
      'src/components/dynamic/create-flow/StepStages.tsx',
      'src/components/dynamic/create-flow/controls.tsx',
      'src/components/project/OverviewTab.tsx',
      'src/components/project/ProjectTabs.tsx',
      'src/components/project/backoffice/BuybackRouterCard.tsx',
      'src/components/project/backoffice/shared.tsx',
      'src/components/payment/DeployERC20Modal.tsx',
      'src/components/payment/ManageTiersModal.tsx',
      'src/components/payment/QueueRulesetModal.tsx',
      'src/components/payment/SendReservedTokensModal.tsx',
      'src/components/payment/SetSplitsModal.tsx',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
)
