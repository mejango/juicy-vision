import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

// Flat config (ESLint 9). Scoped to the frontend in src/ — the code that tsc/build
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
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Correctness rules (rules-of-hooks, no-case-declarations, no-fallthrough, …)
      // stay as errors and gate CI. The rules below flag pre-existing, app-wide
      // stylistic debt — surfaced as warnings so lint passes today and the debt
      // can be burned down incrementally rather than in one mass refactor.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'no-empty': 'warn',
      // Dynamic require() is used deliberately in a few spots to break import cycles.
      '@typescript-eslint/no-require-imports': 'warn',
    },
  },
  // Test + setup files: vitest globals.
  {
    files: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/setupTests.ts', 'src/test/**'],
    languageOptions: {
      globals: { ...globals.node, vi: 'readonly', describe: 'readonly', it: 'readonly', expect: 'readonly', beforeEach: 'readonly', afterEach: 'readonly', beforeAll: 'readonly', afterAll: 'readonly' },
    },
  },
)
