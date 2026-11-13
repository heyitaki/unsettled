// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { addPlayer, createBoard, placeRoad, setMe } from '../../model/board'
import { hexEdgeIds } from '../../model/coords'
import { adjustCounter, newGame, type Game } from '../../model/game'
import { WORKSPACE_KEY } from '../../persistence/localStorage'
import { AdviceProvider } from '../AdviceProvider'
import { BestMovesPanel } from '../BestMovesPanel'
import { ContextMenu } from '../ContextMenu'
import { Ledger } from '../Ledger'
import { activeTab, StoreProvider, useStore } from '../store'

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let store: ReturnType<typeof useStore>

function Capture() {
  const current = useStore()
  useEffect(() => { store = current }, [current])
  return null
}

function army(first = 3, second = 3): Game {
  const board = addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })
  return adjustCounter(adjustCounter(newGame(board), 'aki', 'knights', first), 'b', 'knights', second)
}

const button = (label: string) => {
  const match = [...container.querySelectorAll('button')].find((button) =>
    button.getAttribute('aria-label') === label || button.textContent === label)
  if (!match) throw new Error(`Missing button ${label}`)
  return match
}
const click = async (label: string) => act(async () => button(label).click())
const choices = () => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  sessionStorage.clear()
  Object.defineProperties(HTMLElement.prototype, {
    showPopover: { configurable: true, value() {} },
    hidePopover: { configurable: true, value() {} },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

it.each([true, false])('corrects a tied award in one undo step with an active player: %s', async (active) => {
  const initial = army()
  const game = active ? initial : { ...initial, board: setMe(initial.board, null) }
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ tabs: [{ id: 'awards', title: 'Awards', game }] }))
  await act(async () => root.render(<StoreProvider><AdviceProvider>
    <Capture /><BestMovesPanel />
  </AdviceProvider></StoreProvider>))

  expect(container.querySelector('section')?.classList.contains('ledger-panel')).toBe(true)
  expect(container.querySelectorAll('.ledger-row')).toHaveLength(2)
  expect(container.querySelectorAll('.ledger-row.active')).toHaveLength(active ? 1 : 0)
  if (!active) expect(container.textContent).toContain('Tap a player to start tracking turns')
  const trigger = button('Award holders')
  expect(trigger.closest('.panel-heading')?.querySelector('h2')?.textContent).toBe('Ledger')
  expect(trigger.classList.contains('panel-dots')).toBe(true)
  expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  await click('Award holders')
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(container.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('Award holders')
  expect(choices().map((choice) => choice.textContent)).toEqual([
    'Largest army: aki', 'Largest army: Bee', 'Largest army: Unknown',
  ])
  expect(choices().map((choice) => choice.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true'])
  expect(choices().every((choice) => choice.querySelector('.menu-tick'))).toBe(true)
  expect(button('Largest army: Unknown').classList.contains('active')).toBe(true)

  const before = activeTab(store.state).game
  await click('Largest army: Bee')
  expect(activeTab(store.state).game.awards?.largestArmy).toBe('b')
  expect(activeTab(store.state).past).toEqual([before])
  expect(container.querySelector('[role="menu"]')).toBeNull()
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  await act(async () => store.dispatch({ type: 'undo' }))
  expect(activeTab(store.state).game).toBe(before)
  await act(async () => store.dispatch({ type: 'redo' }))
  expect(activeTab(store.state).game.awards?.largestArmy).toBe('b')
  await click('Award holders')
  expect(choices().map((choice) => choice.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
  await click('Largest army: Unknown')
  expect(activeTab(store.state).game.awards?.largestArmy).toBeNull()
  expect(activeTab(store.state).past).toHaveLength(2)
})

it.each([[0, 0], [2, 2], [3, 2], [3, 4]])('hides the menu without a qualifying tie at %i and %i knights', async (first, second) => {
  await act(async () => root.render(<Ledger game={army(first, second)} activeId="aki" previous={undefined} commit={() => {}} onUndo={() => {}} />))
  expect(container.querySelector('[aria-label="Award holders"]')).toBeNull()
})

it('lists both tied awards in award and seat order and marks their incumbents', async () => {
  let game = army()
  let board = game.board
  for (const edge of hexEdgeIds({ q: 0, r: 0 }).slice(0, 5)) board = placeRoad(board, edge, 'aki')
  for (const edge of hexEdgeIds({ q: 2, r: -2 }).slice(0, 5)) board = placeRoad(board, edge, 'b')
  game = { ...game, board, awards: { longestRoad: 'aki', largestArmy: 'b' } }
  const commit = vi.fn<(game: Game) => void>()
  await act(async () => root.render(<Ledger game={game} activeId="aki" previous={undefined} commit={commit} onUndo={() => {}} />))
  await click('Award holders')
  expect(choices().map((choice) => choice.textContent)).toEqual([
    'Longest road: aki', 'Longest road: Bee', 'Longest road: Unknown',
    'Largest army: aki', 'Largest army: Bee', 'Largest army: Unknown',
  ])
  expect(choices().map((choice) => choice.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false', 'true', 'false'])
  await click('Longest road: Bee')
  expect(commit).toHaveBeenCalledExactlyOnceWith({ ...game, awards: { longestRoad: 'b', largestArmy: 'b' } })
})

it('keeps ordinary ContextMenu items as menuitem without a checked state or tick', async () => {
  const onClick = vi.fn()
  const onClose = vi.fn()
  const trigger = document.createElement('button')
  await act(async () => root.render(<ContextMenu ariaLabel="Files" trigger={trigger}
    items={[{ label: 'Export', onClick }]} onClose={onClose} />))
  const item = button('Export')
  expect(item.getAttribute('role')).toBe('menuitem')
  expect(item.hasAttribute('aria-checked')).toBe(false)
  expect(item.hasAttribute('class')).toBe(false)
  expect(item.querySelector('.menu-tick')).toBeNull()
  await click('Export')
  expect(onClick).toHaveBeenCalledOnce()
  expect(onClose).toHaveBeenCalledOnce()
})
