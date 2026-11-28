// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { addPlayer, createBoard } from '../../model/board'
import { adjustCounter, adjustHand, newGame, withUnseenCards } from '../../model/game'
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

it('shows a narrowed unseen card as the types it could be, beside plain unseen cards', async () => {
  const game = newGame(createBoard('standard4'))
  game.stats.aki = withUnseenCards(game.stats.aki, { ...game.stats.aki.hand, wood: 1 },
    [['wood', 'brick'], ['wood', 'brick'], ['sheep', 'wheat', 'ore'], ['wood', 'sheep', 'wheat', 'brick', 'ore']])
  await act(async () => root.render(<Ledger game={game} activeId="aki" previous={undefined} commit={() => {}} onUndo={() => {}} />))
  const chips = [...container.querySelectorAll('.ledger-hand [aria-label]')]
  expect(chips.map((chip) => chip.getAttribute('aria-label'))).toEqual(
    ['1 wood', '2 unseen cards, wood or brick', '1 unseen card, sheep, wheat or ore', '1 unseen card'])
  expect(chips[1].querySelectorAll('.ledger-among .stat-icon')).toHaveLength(2)
  expect(chips[1].textContent).toBe('2')
  expect(chips[3].querySelector('.ledger-among')).toBeNull()
  expect(container.querySelector('.ledger-cards')?.textContent).toBe('5')
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
  await act(async () => root.render(<Ledger game={game} activeId="b" previous={undefined} commit={() => {}} onUndo={() => {}} />))
  expect([...container.querySelectorAll('.ledger-header > span')].map((cell) => cell.textContent)).toEqual(['', 'Hand', 'Cards', 'VP'])
  expect(container.querySelector('.ledger-header')?.getAttribute('aria-hidden')).toBe('true')
  const rows = container.querySelectorAll('.ledger-row')
  expect(rows).toHaveLength(3)
  for (const row of rows) {
    const toggle = row.querySelector('.ledger-toggle')!
    const ids = toggle.getAttribute('aria-describedby')?.split(/\s+/) ?? []
    expect(ids).toHaveLength(row.querySelector('.ledger-dev') ? 5 : 4)
    const descriptions = ids.map((id) => document.getElementById(id))
    for (const description of descriptions) {
      expect(description).not.toBeNull()
      expect(toggle.contains(description)).toBe(true)
    }
    expect(descriptions).toEqual(['.ledger-player', '.ledger-hand', '.ledger-cards', '.ledger-vp', '.ledger-dev']
      .slice(0, ids.length).map((selector) => toggle.querySelector(selector)))
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
  expect(pills[0].closest('.ledger-toggle')).not.toBeNull()
  expect(empty.querySelector('.ledger-dev')).toBeNull()

  const toggle = mine.querySelector<HTMLButtonElement>('[aria-label="Correct aki"]')!
  await act(async () => toggle.click())
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(mine.querySelector('.ledger-dev')).toBeNull()
  const tabs = () => [...container.querySelectorAll('.ledger-tab')]
  const tiles = () => [...container.querySelectorAll('.ledger-tile')].map((tile) => tile.querySelector('.ledger-tile-label')?.textContent)
  expect(tabs().map((tab) => tab.textContent)).toEqual(['Hand 3', 'Dev cards 6', 'Points'])
  expect(tabs()[0].getAttribute('aria-pressed')).toBe('true')
  expect(tiles()).toEqual(['Wood', 'Sheep', 'Wheat', 'Brick', 'Ore', 'Unseen'])
  expect(mine.querySelector('[aria-label="Add one Wheat, now 2"]')).not.toBeNull()
  expect(mine.querySelector('[aria-label="Take one Wheat back"]')).not.toBeNull()
  expect(mine.querySelector('[aria-label="Take one Wood back"]')).toBeNull()
  expect(mine.querySelector('.ledger-status')?.textContent).toBe('0 settlements · 0 cities · Longest road 0')
  await act(async () => (tabs()[1] as HTMLButtonElement).click())
  expect(tiles()).toEqual(['Knight', 'Road building', 'Year of plenty', 'Monopoly', 'Unknown'])
  expect(mine.querySelector('[aria-label="Add one unknown dev card, now 2"]')).not.toBeNull()
  expect([...mine.querySelectorAll('.ledger-tile-new')].map((note) => note.textContent)).toEqual(['1 new'])
  await act(async () => (tabs()[2] as HTMLButtonElement).click())
  expect(tiles()).toEqual(['Knights played', 'Victory points'])
  expect(mine.querySelector('.ledger-tile-count.award')?.textContent).toBe('3')
  await act(async () => rival.querySelector<HTMLButtonElement>('.ledger-toggle')!.click())
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(mine.querySelector('.ledger-edit')).toBeNull()
  expect(tabs()[0].getAttribute('aria-pressed')).toBe('true')
  await act(async () => (tabs()[1] as HTMLButtonElement).click())
  expect(tiles()).toEqual(['Unknown'])
  expect(rival.querySelector('[aria-label="Add one unknown dev card, now 3"]')).not.toBeNull()
  await act(async () => rival.querySelector<HTMLButtonElement>('.ledger-toggle')!.click())
  expect(container.querySelector('.ledger-edit')).toBeNull()
  expect(container.querySelector('[aria-expanded="true"]')).toBeNull()
})

it('preserves resource colours in pressed tray cells, build costs and advice', async () => {
  await act(async () => root.render(<>
    <div className="move-tray">
      <button aria-pressed="true">Road <CardAmounts cards={CARD_COSTS.road} /></button>
      <ResourcePicker label="Gives" cards={{ brick: 1 }} onChange={() => {}} onRemove={() => {}} />
    </div>
    <button className="analysis-row-select" aria-pressed="true"><CardAmounts cards={CARD_COSTS.road} /></button>
  </>))
  const pressed = container.querySelectorAll('button[aria-pressed="true"]:not(.analysis-row-select) .stat-icon')
  expect(pressed).toHaveLength(3)
  for (const glyph of container.querySelectorAll('.stat-icon')) expect(getComputedStyle(glyph).filter).not.toContain('invert')
  expect(container.querySelectorAll('.move-minus')).toHaveLength(1)
  expect(container.querySelector('.move-minus svg path')?.getAttribute('d')).toBe('M5 10h10')
  expect(container.querySelector('[aria-label="Gives wood"]')?.textContent).toBe('0')
  expect(container.querySelector('[aria-label="Gives brick"]')?.textContent).toBe('1')
  expect(getComputedStyle(container.querySelector('.move-resource .stat-icon')!).width).toBe('18px')
  expect(getComputedStyle(container.querySelector('.move-resource')!).minHeight).toBe('32px')
  expect(getComputedStyle(container.querySelector('.move-minus')!).width).toBe('20px')
})
