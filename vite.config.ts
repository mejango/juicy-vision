import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { execSync } from 'child_process'

// Get build identifier - try git, then Railway env, then timestamp
const getBuildId = () => {
  // Try git first (works locally)
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    // Railway provides commit SHA as env var
    if (process.env.RAILWAY_GIT_COMMIT_SHA) {
      return process.env.RAILWAY_GIT_COMMIT_SHA.slice(0, 7)
    }
    // Fallback to timestamp-based ID
    return new Date().toISOString().slice(5, 16).replace(/[-T:]/g, '')
  }
}

export default defineConfig({
  define: {
    __BUILD_HASH__: JSON.stringify(getBuildId()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'process', 'util', 'stream', 'crypto'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
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
    minify: 'esbuild',
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-ui': ['react-markdown', 'react-syntax-highlighter', 'remark-gfm', 'rehype-raw'],
          'vendor-state': ['zustand', '@tanstack/react-query'],
          'vendor-web3': ['viem'],
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
