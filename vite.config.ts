import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
// `--mode native` is the iOS app's bundle: served from capacitor://localhost/,
// where WKWebView runs no service worker, so the PWA plugin only stubs its
// virtual module.
export default defineConfig(({ mode }) => ({
  // Hosted under akshath.me/unsettled, so emitted asset URLs are prefixed.
  base: mode === 'native' ? '/' : '/unsettled/',
  build: mode === 'native' ? { outDir: 'dist-native' } : {},
  plugins: [
    react(),
    VitePWA({
      disable: mode === 'native',
      registerType: 'autoUpdate',
      manifest: {
        name: 'Unsettled: Catan Analyzer',
        short_name: 'Unsettled',
        description: 'A Catan analyzer: ranks the best starting settlements and the best move on every turn.',
        id: '/unsettled/',
        start_url: '/unsettled/',
        scope: '/unsettled/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#3c7fbf',
        theme_color: '#3c7fbf',
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
        // The link-preview image is fetched by scrapers, never by the app.
        globIgnores: ['og.png'],
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
}))
