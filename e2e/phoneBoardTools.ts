import { expect, type Page } from '@playwright/test'

export async function randomizePhoneBoard(page: Page) {
  const pencil = page.getByRole('button', { name: 'Edit the board' })
  if (await pencil.getAttribute('aria-pressed') !== 'true') await pencil.click()
  const tools = page.locator('.phone-build')
  await tools.getByRole('button', { name: 'Randomize board' }).click()
  const dialog = page.getByRole('dialog', { name: 'Randomize this board?' })
  // Every caller starts from a blank board, which deals without asking.
  await expect(dialog).toHaveCount(0)
  await tools.getByRole('button', { name: 'Done', exact: true }).click()

  // Done's spot now holds an analysis card, and a pointer resting there previews it.
  await page.mouse.move(0, 0)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
}
