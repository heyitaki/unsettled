import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/**
 * Two browser tabs of the app, in one context so they share an origin — and so
 * a write in one really does fire a `storage` event in the other. Everything
 * below is a race between those two documents, which no amount of unit testing
 * can observe: the timings that matter are React's commit-to-effect gap and the
 * 500ms autosave debounce, and both are real here.
 */

const strip = (page: Page) => page.locator('.open-boards .list-row')
const titles = (page: Page) => strip(page).locator('.list-row-name')
const active = (page: Page) => page.locator('.open-boards .list-row.current .list-row-name')

async function open(context: BrowserContext): Promise<Page> {
  const page = await context.newPage()
  await page.goto('')
  await expect(strip(page)).not.toHaveCount(0)
  return page
}

async function addBoards(page: Page, count: number) {
  for (let index = 0; index < count; index += 1) {
    await page.getByRole('button', { name: 'New board' }).click()
  }
}

/**
 * Close the leftmost board, one at a time. The pace has to EXCEED the 500ms
 * autosave debounce or these tests prove nothing: below it every close
 * coalesces into a single write, the other window never answers mid-sequence,
 * and no cross-window race forms at all. Above it each close is its own write,
 * each write wakes the other window, and its answer lands inside the next
 * close's debounce — which is the collision the whole protocol is about.
 */
const CLOSE_PACE_MS = 700

async function closeLeftmost(page: Page, count: number) {
  for (let index = 0; index < count; index += 1) {
    await page.locator('.open-boards .list-row-x').first().click()
    await page.waitForTimeout(CLOSE_PACE_MS)
  }
}

// Long enough for both documents' debounces to fire and for each to have
// adopted whatever the other wrote.
const settle = (page: Page) => page.waitForTimeout(2_000)

test('closing every board while the other window is in use leaves one blank board', async ({ context }) => {
  const a = await open(context)
  await addBoards(a, 3)
  await expect(strip(a)).toHaveCount(4)
  await a.waitForTimeout(800)

  const b = await open(context)
  await expect(strip(b)).toHaveCount(4)
  // A second window merely being open is not enough to race anything: with no
  // writes of its own it has nothing to answer with, and the closes converge
  // even on code that has none of the protections here. It takes a window that
  // is also being used, whose own pending write still describes the workspace
  // as it was before the close.
  await b.getByRole('button', { name: 'New board' }).click()
  await expect(strip(a)).toHaveCount(5)

  await closeLeftmost(a, 5)
  await settle(a)

  // Closing the last board mints a blank one; nothing else may come back with
  // it. This is the reported symptom, verbatim.
  await expect(strip(a)).toHaveCount(1)
  await expect(strip(b)).toHaveCount(1)

  // And it has to still be true after a reload, or the blob kept what the
  // strip did not.
  await a.reload()
  await expect(strip(a)).toHaveCount(1)
})

test('closes made while the other window is writing stay closed', async ({ context }) => {
  const a = await open(context)
  await addBoards(a, 3)
  await a.waitForTimeout(800)

  const b = await open(context)
  await expect(strip(b)).toHaveCount(4)
  // Give B something of its own to write, so its debounce is running while A
  // closes — the collision that used to resurrect a tab one write later.
  await b.getByRole('button', { name: 'New board' }).click()
  await expect(strip(a)).toHaveCount(5)

  await closeLeftmost(a, 2)
  await settle(a)

  await expect(titles(a)).toHaveText(['Board 3', 'Board 4', 'Board 5'])
  await expect(titles(b)).toHaveText(['Board 3', 'Board 4', 'Board 5'])
})

test('each window keeps its own place in the strip', async ({ context }) => {
  // The active board is per-window now. Two windows disagreeing about it must
  // not be a difference either of them tries to write away.
  const a = await open(context)
  await addBoards(a, 2)
  await a.waitForTimeout(800)
  // Adding a board selects it, so A is on the last one.
  await expect(active(a)).toHaveText('Board 3')

  // A window with no session of its own starts at the front of the strip
  // rather than inheriting where another window happens to be looking.
  const b = await open(context)
  await expect(strip(b)).toHaveCount(3)
  await expect(active(b)).toHaveText('Board 1')

  // Selecting in one window must not move the other. (The row selects; its
  // name is the rename gesture, not a selection.)
  await b.getByRole('button', { name: 'Switch to Board 2', exact: true }).click()
  await settle(a)
  await expect(active(b)).toHaveText('Board 2')
  await expect(active(a)).toHaveText('Board 3')

  // A reload keeps this window's place rather than inheriting the other's.
  await b.reload()
  await expect(active(b)).toHaveText('Board 2')
  await expect(active(a)).toHaveText('Board 3')
})
