import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Hosted under akshath.me/unsettled, so emitted asset URLs are prefixed.
  base: '/unsettled/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Unsettled — Catan Draft Analyzer',
        short_name: 'Unsettled',
        description: 'An offline Catan board editor and starting-position draft analyzer.',
        id: '/unsettled/',
        start_url: '/unsettled/',
        scope: '/unsettled/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#efe8d9',
        theme_color: '#efe8d9',
        icons: [
          { src: '/unsettled/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/unsettled/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/unsettled/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm}'],
        navigateFallback: '/unsettled/index.html',
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: 'node',
    // .claude/worktrees holds full repo copies (agent worktrees); without this
    // vitest runs every test twice and heavy parser tests hit their timeouts.
    // e2e/ is Playwright's: its specs import @playwright/test, which vitest
    // cannot run.
    exclude: [...configDefaults.exclude, '.claude/**', 'e2e/**'],
    // The parser decodes real screenshots, so its slowest cases run seconds even
    // when healthy and stretch further on a loaded machine. The 5s default sits
    // close enough to turn contention into a failure that reads like a
    // regression. Nothing here relies on the timeout as a perf tripwire: the
    // perf suite asserts elapsed time explicitly.
    testTimeout: 20_000,
  },
})
