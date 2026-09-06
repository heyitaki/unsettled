import { defineConfig } from '@playwright/test'

// A port of its own, so a run never shares an origin — and therefore never
// shares localStorage — with a dev server the developer is using by hand.
// UNSETTLED_E2E_PORT points a run at a dev server someone else started — a
// worktree of an older commit, say, to check that a regression test really does
// fail against the code it was written for.
const PORT = Number(process.env.UNSETTLED_E2E_PORT ?? 5199)

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/production/**',
  // The races these tests exist to catch are between two documents on one
  // origin. Running files in parallel would put unrelated tests on that same
  // origin at the same time and make the workspace key a shared variable.
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}/unsettled/`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    cwd: process.env.UNSETTLED_E2E_ROOT ?? undefined,
    url: `http://localhost:${PORT}/unsettled/`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
