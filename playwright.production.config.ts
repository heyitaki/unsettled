import { defineConfig } from '@playwright/test'

const port = Number(process.env.UNSETTLED_PWA_PORT ?? 5200)

export default defineConfig({
  testDir: './e2e/production',
  outputDir: './test-results/production',
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}/unsettled/`, trace: 'retain-on-failure' },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/unsettled/`,
    reuseExistingServer: false,
  },
})
