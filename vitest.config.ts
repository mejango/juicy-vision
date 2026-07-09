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
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
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
