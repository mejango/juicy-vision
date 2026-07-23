import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'child_process'

const buildTime = () => {
  const epoch = process.env.SOURCE_DATE_EPOCH
  if (epoch && /^\d+$/.test(epoch)) return new Date(Number(epoch) * 1000).toISOString()
  return new Date().toISOString()
}

// Prefer CI-provided immutable revision metadata, then use git for local builds.
const getBuildId = () => {
  const supplied = process.env.BUILD_SHA || process.env.GITHUB_SHA || process.env.RAILWAY_GIT_COMMIT_SHA
  if (supplied) return supplied.slice(0, 12)
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'source-unknown'
  }
}

export default defineConfig({
  define: {
    __BUILD_HASH__: JSON.stringify(getBuildId()),
    __BUILD_TIME__: JSON.stringify(buildTime()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'mascot.svg'],
      manifest: {
        name: 'Juice AI',
        short_name: 'JuiceAI',
        description: 'AI-powered capital formation with Juicebox protocol',
        theme_color: '#F5A623',
        background_color: '#1a1a1a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.anthropic\.com\/.*/i,
            handler: 'NetworkOnly'
          }
        ]
      }
    })
  ],
  base: '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    minify: 'oxc',
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Vite 8's Rolldown bundler accepts a chunk classifier rather than
        // Rollup's object shorthand.
        manualChunks(id) {
          const groups: Record<string, string[]> = {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-ui': ['react-markdown', 'react-syntax-highlighter', 'remark-gfm'],
            'vendor-state': ['zustand', '@tanstack/react-query'],
            'vendor-web3': ['viem'],
            // Keep Recharts' mutually dependent cartesian modules together.
            // Splitting these across lazy page chunks can create a circular
            // execution-order dependency in Rolldown's output.
            'vendor-charts': ['recharts'],
          }
          for (const [chunk, packages] of Object.entries(groups)) {
            if (packages.some(packageName => id.includes(`/node_modules/${packageName}/`))) {
              return chunk
            }
          }
        }
      }
    }
  },
  server: {
    port: 3000,
    strictPort: true
  },
  preview: {
    port: 3014,
    strictPort: true
  }
})
