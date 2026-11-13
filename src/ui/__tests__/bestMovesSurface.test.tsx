// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { addPlayer, createBoard } from '../../model/board'
import { adjustCounter, adjustHand, newGame } from '../../model/game'
import { adjustDevHand, CARD_COSTS } from '../../model/turn'
import { Ledger } from '../Ledger'
import { CardAmounts, ResourcePicker } from '../MoveInputs'

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let style: HTMLStyleElement
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  style = document.createElement('style')
  style.textContent = readFileSync('src/ui/editor.css', 'utf8')
  document.head.append(style)
  container = document.createElement('div')
  container.className = 'best-moves-panel'
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  style.remove()
})

it('renders the Ledger hands, dev pills and awards, with one inline row editor', async () => {
  const board = addPlayer(addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' }), { id: 'c', name: 'Cee', color: '#fff' })
  let game = adjustHand(newGame(board), 'aki', 'wheat', 2)
  game = adjustCounter(game, 'aki', 'handUnknown', 1)
  game = adjustDevHand(game, 'playable', 'knight', 1)
  game = adjustDevHand(game, 'playable', 'roadBuilding', 2)
  game = adjustDevHand(game, 'bought', 'monopoly', 1)
  game = adjustCounter(game, 'aki', 'devCards', 2)
  game = adjustCounter(game, 'aki', 'vpCards', 1)
  game = adjustCounter(adjustCounter(game, 'aki', 'knights', 3), 'b', 'knights', 3)
  game = adjustCounter(adjustCounter(adjustHand(game, 'b', 'ore', 1), 'b', 'handUnknown', 2), 'b', 'devCards', 3)
  game = { ...game, awards: { longestRoad: null, largestArmy: 'aki' } }
  await act(async () => root.render(<Ledger game={game} activeId="b" commit={() => {}} />))
  expect([...container.querySelectorAll('.ledger-header > span')].map((cell) => cell.textContent)).toEqual(['', 'Hand', 'Cards', 'VP'])
  expect(container.querySelector('.ledger-header')?.getAttribute('aria-hidden')).toBe('true')
  const rows = container.querySelectorAll('.ledger-row')
  expect(rows).toHaveLength(3)
  for (const row of rows) {
    const toggle = row.querySelector('.ledger-toggle')!
    const ids = toggle.getAttribute('aria-describedby')?.split(/\s+/) ?? []
    expect(ids).toHaveLength(4)
    const descriptions = ids.map((id) => document.getElementById(id))
    for (const description of descriptions) {
      expect(description).not.toBeNull()
      expect(toggle.contains(description)).toBe(true)
    }
    expect(descriptions).toEqual(['.ledger-player', '.ledger-hand', '.ledger-cards', '.ledger-vp']
      .map((selector) => toggle.querySelector(selector)))
  }
  const [mine, rival, empty] = rows
  expect(rival.classList.contains('active')).toBe(true)
  expect(mine.querySelector('.you-chip')?.textContent).toBe('YOU')
  expect(rival.querySelector('.you-chip')).toBeNull()
  expect(mine.querySelector('[aria-label="Largest army, +2 VP"]')).not.toBeNull()
  expect(rival.querySelector('[aria-label="Largest army, +2 VP"]')).toBeNull()
  expect([...mine.querySelectorAll('.ledger-hand [aria-label]')].map((chip) => chip.getAttribute('aria-label'))).toEqual(['2 wheat', '1 unseen card', '2 dev cards'])
  expect([...rival.querySelectorAll('.ledger-hand [aria-label]')].map((chip) => chip.getAttribute('aria-label'))).toEqual(['1 ore', '2 unseen cards', '3 dev cards'])
  expect(mine.querySelector('.ledger-cards')?.textContent).toBe('3')
  expect(mine.querySelector('.ledger-vp')?.textContent).toBe('3')
  expect(empty.querySelector('.ledger-hand')?.textContent).toBe('No cards')
  const pills = mine.querySelectorAll('.ledger-dev-pill')
  expect([...pills].map((pill) => pill.textContent)).toEqual(['Knight', 'Road building 2', 'Victory point', 'Monopoly new'])
  expect(pills[0].querySelector('.ledger-dev-count')).toBeNull()
  expect(pills[1].querySelector('.ledger-dev-count')?.textContent?.trim()).toBe('2')
  expect(pills[3].getAttribute('title')).toBe('Bought this turn, playable next turn')
  expect(pills[0].closest('button')).toBeNull()
  expect(empty.querySelector('.ledger-dev')).toBeNull()

  const toggle = mine.querySelector<HTMLButtonElement>('[aria-label="Correct aki"]')!
  await act(async () => toggle.click())
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(mine.querySelector('.ledger-stats')?.textContent).toBe('0 settlements0 citiesLongest road 03 knights played6 dev cards')
  expect(mine.querySelector('.ledger-stats .award')?.textContent).toBe('3 knights played')
  expect(mine.querySelector('.ledger-stats')?.closest('button')).toBeNull()
  expect(mine.querySelector('[aria-label="More Knight"]')).not.toBeNull()
  expect(mine.querySelector('[aria-label="More wheat"]')).not.toBeNull()
  expect(mine.textContent).toContain('Each change is one undo step')
  await act(async () => rival.querySelector<HTMLButtonElement>('.ledger-toggle')!.click())
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(mine.querySelector('.ledger-edit')).toBeNull()
  expect(rival.querySelector('[aria-label="More Dev"]')).not.toBeNull()
  await act(async () => rival.querySelector<HTMLButtonElement>('.ledger-done')!.click())
  expect(container.querySelector('.ledger-edit')).toBeNull()
  expect(container.querySelector('[aria-expanded="true"]')).toBeNull()
})

it('makes selected build and resource glyphs white while preserving advice glyph colours', async () => {
  await act(async () => root.render(<>
    <button aria-pressed="true">Road <CardAmounts cards={CARD_COSTS.road} /></button>
    <ResourcePicker label="Gives" value="brick" onChange={() => {}} />
    <button className="analysis-row-select" aria-pressed="true"><CardAmounts cards={CARD_COSTS.road} /></button>
  </>))
  const pressed = container.querySelectorAll('button[aria-pressed="true"]:not(.analysis-row-select) .stat-icon')
  expect(pressed).toHaveLength(3)
  for (const glyph of pressed) expect(getComputedStyle(glyph).filter).toBe('brightness(0) invert(1)')
  for (const glyph of container.querySelectorAll('button[aria-pressed="false"] .stat-icon, .analysis-row-select .stat-icon')) expect(getComputedStyle(glyph).filter).toBe('none')
})
