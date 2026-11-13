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

const lines = () => [...container.querySelectorAll<HTMLElement>('.tie-line')]
const line = (award: string) => {
  const match = lines().find((line) => line.getAttribute('aria-label') === `${award} tie`)
  if (!match) throw new Error(`Missing ${award} tie line`)
  return match
}
const picks = (award: string) => [...line(award).querySelectorAll<HTMLButtonElement>('button.tie-pick')]
const pick = async (award: string, name: string) => act(async () => picks(award).find((button) => button.textContent === name)!.click())
const pressed = (award: string) => picks(award).map((button) => button.getAttribute('aria-pressed'))

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  sessionStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

it.each([true, false])('settles and clears a tied award in one undo step each with an active player: %s', async (active) => {
  const initial = army()
  const game = active ? initial : { ...initial, board: setMe(initial.board, null) }
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ tabs: [{ id: 'awards', title: 'Awards', game }] }))
  await act(async () => root.render(<StoreProvider><AdviceProvider>
    <Capture /><BestMovesPanel />
  </AdviceProvider></StoreProvider>))

  expect(container.querySelectorAll('.ledger-row.active')).toHaveLength(active ? 1 : 0)
  expect(container.querySelector('[aria-label="Award holders"]')).toBeNull()
  // The line sits above the column headings.
  expect(line('Largest army').nextElementSibling?.classList.contains('ledger-header')).toBe(true)
  expect(line('Largest army').getAttribute('role')).toBe('group')
  expect(document.getElementById(line('Largest army').getAttribute('aria-describedby')!)?.textContent).toBe('Largest army tie · Who got there first?')
  expect(line('Largest army').classList.contains('settled')).toBe(false)
  expect(line('Largest army').textContent).toContain('Largest army tie · Who got there first?')
  expect(picks('Largest army').map((button) => button.textContent)).toEqual(['aki', 'Bee'])
  expect(pressed('Largest army')).toEqual(['false', 'false'])

  const before = activeTab(store.state).game
  await pick('Largest army', 'Bee')
  expect(activeTab(store.state).game.awards?.largestArmy).toBe('b')
  expect(activeTab(store.state).past).toEqual([before])
  expect(line('Largest army').classList.contains('settled')).toBe(true)
  expect(line('Largest army').textContent).toContain('Largest army · Bee got there first')
  expect(pressed('Largest army')).toEqual(['false', 'true'])
  expect(container.querySelectorAll('.ledger-row')[1].querySelector('[aria-label="Largest army, +2 VP"]')).not.toBeNull()

  await act(async () => store.dispatch({ type: 'undo' }))
  expect(activeTab(store.state).game).toBe(before)
  expect(pressed('Largest army')).toEqual(['false', 'false'])
  await act(async () => store.dispatch({ type: 'redo' }))
  expect(pressed('Largest army')).toEqual(['false', 'true'])
  // Picking the holder again clears it back to unknown.
  await pick('Largest army', 'Bee')
  expect(activeTab(store.state).game.awards?.largestArmy).toBeNull()
  expect(activeTab(store.state).past).toHaveLength(2)
  expect(line('Largest army').textContent).toContain('Who got there first?')
  expect(line('Largest army').classList.contains('settled')).toBe(false)
  expect(pressed('Largest army')).toEqual(['false', 'false'])
})

it.each([[0, 0], [2, 2], [3, 2], [3, 4]])('shows no tie line without a qualifying tie at %i and %i knights', async (first, second) => {
  await act(async () => root.render(<Ledger game={army(first, second)} activeId="aki" previous={undefined} commit={() => {}} onUndo={() => {}} />))
  expect(lines()).toHaveLength(0)
})

it('shows one line per tied award in award and seat order with their incumbents', async () => {
  let game = army()
  let board = game.board
  for (const edge of hexEdgeIds({ q: 0, r: 0 }).slice(0, 5)) board = placeRoad(board, edge, 'aki')
  for (const edge of hexEdgeIds({ q: 2, r: -2 }).slice(0, 5)) board = placeRoad(board, edge, 'b')
  game = { ...game, board, awards: { longestRoad: 'aki', largestArmy: 'b' } }
  const commit = vi.fn<(game: Game) => void>()
  await act(async () => root.render(<Ledger game={game} activeId="aki" previous={undefined} commit={commit} onUndo={() => {}} />))
  expect(lines().map((line) => line.getAttribute('aria-label'))).toEqual(['Longest road tie', 'Largest army tie'])
  expect(line('Longest road').textContent).toContain('Longest road · aki got there first')
  expect(pressed('Longest road')).toEqual(['true', 'false'])
  expect(pressed('Largest army')).toEqual(['false', 'true'])
  await pick('Longest road', 'Bee')
  expect(commit).toHaveBeenCalledExactlyOnceWith({ ...game, awards: { longestRoad: 'b', largestArmy: 'b' } })
})
