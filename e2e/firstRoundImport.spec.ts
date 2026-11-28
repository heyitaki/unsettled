import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { setupGrants } from '../src/model/board'
import { emptyStats } from '../src/model/game'
import type { Board } from '../src/model/types'
import midgame from '../src/parser/__tests__/expected/settled-5p-midgame-hand.json' with { type: 'json' }
import { seedBoard } from './seed'

// The fixture is Brown's turn in the first round; the draft as it ended has no roads and every hand only as a count.
const drafted = { ...(midgame as Board), roads: [] }
const grants = setupGrants(drafted)!
const counted = Object.fromEntries(Object.entries(grants).map(([id, hand]) =>
  [id, { ...emptyStats(), handUnknown: Object.values(hand).reduce((sum, cards) => sum + cards, 0) }]))

test('a first-round screenshot update names each hand from the draft', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('')
  await seedBoard(page, drafted, counted, {
    playerId: drafted.players[0].id, rolled: null, devPlayed: false, progressPlayed: { roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 },
  })
  const dialog = page.getByRole('dialog', { name: 'Import screenshot' })
  await page.locator('.head-controls .head-title').click()
  await page.locator('.maps-panel').getByRole('button', { name: 'Import screenshot', exact: true }).click()
  await dialog.locator('input[type="file"]').setInputFiles(resolve('fixtures/settled-5p-midgame-hand.png'))
  await dialog.getByRole('button', { name: 'Update', exact: true }).click({ timeout: 30_000 })
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Done', exact: true }).click()

  const card = page.locator('.import-review-panel')
  const question = card.getByRole('group', { name: 'First round' })
  await expect(question).toContainText('Is this the first round?')
  await question.getByRole('button', { name: 'Yes', exact: true }).click()
  await card.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(card).toHaveCount(0)

  // Red and White have not moved yet: Red's three cards are its starting hand, and White's fourth came from a roll.
  const row = (name: string) => page.locator('.ledger-row').filter({ has: page.getByRole('button', { name: `Correct ${name}`, exact: true }) })
  for (const [name, id, unseen] of [['Red', 'p4', 0], ['White', 'p5', 1]] as const) {
    for (const [resource, count] of Object.entries(grants[id])) {
      if (count > 0) await expect(row(name).getByRole('img', { name: `${count} ${resource}`, exact: true })).toBeVisible()
    }
    await expect(row(name).getByRole('img', { name: /unseen/ })).toHaveCount(unseen)
  }
  await expect(row('White').getByRole('img', { name: '1 unseen card', exact: true })).toBeVisible()
})
