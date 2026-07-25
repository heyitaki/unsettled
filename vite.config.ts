import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Hosted under akshath.me/unsettled, so every emitted asset URL (and the
  // BASE_URL the OCR reader reads for its tesseract/tessdata paths) is prefixed.
  base: '/unsettled/',
  plugins: [react()],
  test: {
    environment: 'node',
    // .claude/worktrees holds full repo copies (agent worktrees); without this
    // vitest runs every test twice and heavy parser tests hit their timeouts.
    // e2e/ is Playwright's: its specs import @playwright/test, which vitest
    // cannot run.
    exclude: [...configDefaults.exclude, '.claude/**', 'e2e/**'],
  },
})
