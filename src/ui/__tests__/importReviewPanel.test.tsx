// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { inferDraftState } from '../../engine/draft'
import { addPlayer, createBoard, placeBuilding, placeRoad, setHexTile } from '../../model/board'
import { hexEdgeIds, hexVertexIds } from '../../model/coords'
import { newGame, type Game, type ScreenshotRead } from '../../model/game'
import { setActivePlayer } from '../../model/turn'
import { WORKSPACE_KEY } from '../../persistence/localStorage'
import { AdviceProvider } from '../AdviceProvider'
import { AnalysisPanel } from '../AnalysisPanel'
import { activeTab, StoreProvider, useStore } from '../store'
import { useBuildMode } from '../useBuildMode'
import { AnalysisContext } from '../useAnalysis'
import { vertexDescription } from '../vertexParts'

const A = hexVertexIds({ q: 0, r: -2 })[0]
const B = hexVertexIds({ q: 0, r: 2 })[3]
const read: ScreenshotRead = { roster: true, order: false, picks: false,
  hands: [], unorderedPicks: ['aki'], points: { aki: 4, b: 2 }, knights: [] }
function imported(): Game {
  let board = addPlayer(setHexTile(createBoard('standard4'), { q: 0, r: 0 }, 'wood'), { id: 'b', name: 'Bee', color: '#3063ba' })
  board = placeBuilding(placeBuilding(board, A, 'aki', 'settlement'), B, 'aki', 'settlement')
  for (const edge of hexEdgeIds({ q: 0, r: 0 }).slice(0, 5)) board = placeRoad(board, edge, 'aki')
  for (const edge of hexEdgeIds({ q: 2, r: -2 }).slice(0, 5)) board = placeRoad(board, edge, 'b')
  return { ...newGame(board), pendingImport: read }
}

let container: HTMLDivElement
let root: Root
let store: ReturnType<typeof useStore>
let restMarks: unknown
function RestMarks() {
  restMarks = useBuildMode().restMarks
  return null
}
const RANKED = { firstPick: hexVertexIds({ q: 1, r: 0 })[0], firstRoad: null, secondRoad: null, plannedSecond: [], survival: 1, score: 1, rankScore: 1,
  breakdown: { production: 0, scarcity: 0, robber: 0, diversity: 0, port: 0, handValue: 0, expansion: 0 } }
let ranked = false
function Column({ className }: { className?: string }) {
  store = useStore()
  const { board } = activeTab(store.state).game
  const draft = inferDraftState(board)
  return <AdviceProvider><AnalysisContext.Provider value={{ analysis: ranked
    ? { status: 'ready', draft, recommendations: [RANKED], takenBeforeFirstPick: [], warnings: [] }
    : { status: 'no-production', draft, recommendations: [], takenBeforeFirstPick: [], warnings: [] }, pending: false, error: null, retry() {} }}>
    <AnalysisPanel className={className} />
    <RestMarks />
  </AnalysisContext.Provider></AdviceProvider>
}
const game = () => activeTab(store.state).game
const group = (label: string) => container.querySelector(`[role="group"][aria-label="${label}"]`)!
const button = (label: string, scope: Element = container) => {
  const match = [...scope.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === label || node.getAttribute('aria-label') === label)
  if (!match) throw new Error(`Missing button ${label}`)
  return match
}
const doneButton = () => container.querySelector<HTMLButtonElement>('.import-review-panel .confirm-actions .primary')!
const click = (label: string, scope?: Element) => act(() => button(label, scope).click())
const headings = () => [...container.querySelectorAll('h2')].map((node) => node.textContent)
const mount = (className?: string) => act(() => root.render(<StoreProvider><Column className={className} /></StoreProvider>))

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  sessionStorage.clear()
  ranked = false
  vi.stubGlobal('Worker', class { postMessage() {} terminate() {} })
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ tabs: [{ id: 'imported', title: 'Imported', game: imported() }] }))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

it.each(['panel analysis-panel', 'phone-block phone-analysis'])('shows the Ledger and review instead of rankings, using %s', (className) => {
  mount(className)
  expect(headings()).toEqual(['Ledger', 'Finish import'])
  const cards = [...container.children]
  expect(cards).toHaveLength(2)
  expect(cards.every((card) => card.className.includes(`${className} best-moves-panel`))).toBe(true)
  expect(cards[0].classList.contains('ledger-panel')).toBe(true)
  expect(container.querySelectorAll('.ledger-row')).toHaveLength(2)
  // The roads tie, but the card asks the holder, so the Ledger shows no tie line.
  expect(container.querySelector('.tie-line')).toBeNull()
  expect(container.textContent).toContain("The screenshot doesn't show these. Best picks and Best moves open once they're answered.")
  expect(doneButton().disabled).toBe(true)
})

it('requires every answer, commits once, and returns unanswered after undo', () => {
  mount()
  const before = game()
  click('Bee', group('Turn order'))
  expect(doneButton().disabled).toBe(true)
  click(`aki's settlement on ${vertexDescription(before.board, A)}`, group('Second settlement'))
  expect(doneButton().disabled).toBe(true)
  expect(store.state.highlight?.map((mark) => [mark.ref, mark.label])).toEqual([[A, '2'], [B, '1']])
  click('aki', group('Longest road'))
  expect([...group('Largest army').querySelectorAll('button')].map((node) => node.textContent)).toEqual(['aki', 'Bee'])
  expect(doneButton().disabled).toBe(true)
  click('Bee', group('Largest army'))
  expect(doneButton().disabled).toBe(false)
  expect(game()).toBe(before)
  act(() => doneButton().click())
  expect(store.state.highlight).toBeNull()
  expect(activeTab(store.state).past).toEqual([before])
  expect(game()).not.toHaveProperty('pendingImport')
  expect(game().board.players.map((player) => player.id)).toEqual(['b', 'aki'])
  expect(game().board.buildings.map((building) => building.vertexId)).toEqual([B, A])
  expect(game().awards).toEqual({ longestRoad: 'aki', largestArmy: 'b' })
  expect(game().stats.b.knights).toBe(3)
  expect(headings()).toEqual(['Best picks'])
  const answered = game()
  act(() => store.dispatch({ type: 'undo' }))
  expect(game()).toBe(before)
  expect(headings()).toEqual(['Ledger', 'Finish import'])
  expect(doneButton().disabled).toBe(true)
  expect(container.querySelectorAll('.import-questions [aria-pressed="true"]')).toHaveLength(0)
  act(() => store.dispatch({ type: 'redo' }))
  expect(game()).toBe(answered)
  expect(headings()).toEqual(['Best picks'])
})

it('Skip keeps the guesses, removes only pendingImport, and is undoable', () => {
  mount()
  const before = game()
  click('Bee', group('Turn order'))
  click('Skip')
  const { pendingImport: _pending, ...guesses } = before
  expect(game()).toEqual(guesses)
  expect(activeTab(store.state).past).toEqual([before])
  expect(headings()).toEqual(['Best picks'])
  act(() => store.dispatch({ type: 'undo' }))
  expect(headings()).toEqual(['Ledger', 'Finish import'])
  expect(doneButton().disabled).toBe(true)
})

it('discards answers on a game edit, tab switch and new import', () => {
  mount()
  click('Bee', group('Turn order'))
  click('Correct aki')
  click('Add one Wood, now 0')
  expect(game().stats.aki.hand.wood).toBe(1)
  expect(game().pendingImport).toEqual(read)
  expect(button('Bee', group('Turn order')).getAttribute('aria-pressed')).toBe('false')
  click('Bee', group('Turn order'))
  act(() => store.dispatch({ type: 'tab-add', game: game(), title: 'Another import' }))
  expect(button('Bee', group('Turn order')).getAttribute('aria-pressed')).toBe('false')
  act(() => store.dispatch({ type: 'tab-select', id: 'imported' }))
  expect(button('Bee', group('Turn order')).getAttribute('aria-pressed')).toBe('false')
  click('Bee', group('Turn order'))
  act(() => store.dispatch({ type: 'commit-game', game: imported() }))
  expect(button('Bee', group('Turn order')).getAttribute('aria-pressed')).toBe('false')
})

it('bypasses a pending read when no questions remain', () => {
  mount()
  act(() => store.dispatch({ type: 'commit-game', game: { ...game(), pendingImport: {
    ...read, order: true, unorderedPicks: [], points: { aki: 4, b: 0 },
  } } }))
  expect(headings()).toEqual(['Best picks'])
  expect(game().pendingImport).toBeUndefined()
})

it('keeps Best picks circles off the board until the card is answered or skipped', () => {
  ranked = true
  mount()
  expect(restMarks).toBeNull()
  act(() => button('Skip').click())
  expect(restMarks).toEqual([expect.objectContaining({ ref: RANKED.firstPick, placeable: true })])
})

it('hides the Ledger History toggle while the card is up', () => {
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ tabs: [{ id: 'imported', title: 'Imported', game: setActivePlayer(imported(), 'aki') }] }))
  mount()
  expect(headings()).toEqual(['Ledger', 'Finish import'])
  expect(container.querySelector('.history-toggle')).toBeNull()
})
