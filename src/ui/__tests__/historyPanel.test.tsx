// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { addPlayer, createBoard, placeBuilding, removePlayer } from '../../model/board'
import { adjustCounter, newGame, withBoard, type Game } from '../../model/game'
import { boardGrid } from '../../model/layouts'
import { appendLog, endTurn, recordRoll, setActivePlayer } from '../../model/turn'
import { AdviceProvider } from '../AdviceProvider'
import { BestMovesPanel } from '../BestMovesPanel'
import { BoardCanvas } from '../BoardCanvas'
import { HistoryControls } from '../HistoryControls'
import { activeTab, StoreProvider, useStore } from '../store'

let root: Root
let container: HTMLDivElement
let seen: ReturnType<typeof useStore>
function Capture() {
  const store = useStore()
  useEffect(() => { seen = store }, [store])
  return null
}
const game = () => activeTab(seen.state).game
const button = (label: string) => {
  const match = [...container.querySelectorAll('button')].find((node) => node.getAttribute('aria-label') === label || node.textContent === label)
  if (!match) throw new Error(`Missing button ${label}`)
  return match
}
const click = async (label: string) => { await act(async () => button(label).click()) }
const commit = async (next: Game) => { await act(async () => seen.dispatch({ type: 'commit-game', game: next })) }

function seed(): Game {
  let board = addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })
  board = addPlayer(board, { id: 'c', name: 'Cee', color: '#ffffff' })
  const vertex = boardGrid(board.layout).vertexIds[0]
  board = placeBuilding(board, vertex, 'aki', 'settlement')
  let next = setActivePlayer(newGame(board), 'aki')
  for (let n = 0; n < 4; n += 1) {
    next = recordRoll(next, n === 1 ? 7 : 8, n === 0 ? { aki: { wood: 2, sheep: 0, wheat: 0, brick: 0, ore: 0 } } : {})
    if (n === 0) next = appendLog(next, 'Built a road')
    if (n === 1) next = appendLog(next, 'Robber to Ore 6 · Stole from Cee')
    if (n === 2) next = withBoard(next, placeBuilding(next.board, vertex, 'aki', 'city'))
    next = endTurn(next)
  }
  return next
}

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal('Worker', class { postMessage() {} terminate() {} })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<StoreProvider><AdviceProvider>
    <Capture /><BoardCanvas /><HistoryControls /><BestMovesPanel />
  </AdviceProvider></StoreProvider>))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

it('shows the toggle only after a turn starts and swaps the panels with Now selected', async () => {
  expect(container.querySelector('.history-toggle')).toBeNull()
  await commit(seed())
  expect(button('History').getAttribute('aria-pressed')).toBe('false')
  await click('History')
  expect(button('History').getAttribute('aria-pressed')).toBe('true')
  expect(container.querySelector('.move-steps')).toBeNull()
  expect([...container.querySelectorAll('h2')].map((node) => node.textContent)).toEqual(['Ledger', 'History'])
  expect(container.querySelector('.history-count')?.textContent).toBe('4 turns')
  expect([...container.querySelectorAll('.history-select')].map((node) => node.getAttribute('aria-label')))
    .toEqual(['Turn 5: Bee', 'Turn 4: aki', 'Turn 3: Cee', 'Turn 2: Bee', 'Turn 1: aki', 'Game start'])
  expect([...container.querySelectorAll('.history-round')].map((node) => node.textContent)).toEqual(['Round 2', 'Round 1', 'Setup'])
  expect(button('Turn 5: Bee').getAttribute('aria-pressed')).toBe('true')
  expect(button('Turn 5: Bee').textContent).toContain('Now')
  expect(button('Turn 2: Bee').textContent).toContain('Robbed Cee')
  expect(button('Turn 3: Cee').querySelector('.history-disc')?.classList.contains('light')).toBe(true)
  expect(button('Turn 1: aki').querySelectorAll('.history-pips i')).toHaveLength(5)
  expect(button('Turn 2: Bee').querySelector('.history-roll.seven svg')).not.toBeNull()
  await click('History')
  expect(container.querySelector('.history-panel')).toBeNull()
  expect(container.querySelector('.history-controls')).toBeNull()
  expect(container.querySelector('.move-steps')).not.toBeNull()
})

it('opens details, replaces the summary, and steps newer and older with the keyboard', async () => {
  await commit(seed())
  await click('History')
  await click('Turn 1: aki')
  const row = button('Turn 1: aki').closest('.history-row')!
  expect(row.querySelector('.history-summary')).toBeNull()
  expect(row.querySelector('.move-log')?.textContent).toBe('Built a road')
  expect(row.querySelectorAll('.move-prod-cards svg')).toHaveLength(2)
  expect(container.querySelector('.ledger-asof')?.textContent).toBe('After turn 1')
  await act(async () => button('Turn 1: aki').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })))
  expect(button('Turn 2: Bee').getAttribute('aria-pressed')).toBe('true')
  expect(button('Turn 2: Bee').closest('.history-row')?.querySelector('.move-prod')).toBeNull()
  await act(async () => button('Turn 2: Bee').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  expect(button('Turn 1: aki').getAttribute('aria-pressed')).toBe('true')
  await click('Turn 4: aki')
  expect(container.querySelector('.history-detail')?.textContent).toBe('Nobody produces')
})

it('shows past pieces and hands without allowing Ledger edits or board input', async () => {
  await commit(seed())
  await click('Correct aki')
  expect(container.querySelector('.ledger-edit')).not.toBeNull()
  await click('History')
  const live = game()
  const boardNow = container.querySelector('[filter="url(#piece-shadow)"]')!.innerHTML
  await click('Game start')
  expect(container.querySelector('.ledger-asof')?.textContent).toBe('At game start')
  expect(container.querySelector('.ledger-edit')).toBeNull()
  expect([...container.querySelectorAll<HTMLButtonElement>('.ledger-toggle')].every((node) => node.disabled)).toBe(true)
  expect(container.querySelector('.ledger-cards')?.textContent).toBe('0')
  expect(container.querySelector('[filter="url(#piece-shadow)"]')!.innerHTML).not.toBe(boardNow)
  await act(async () => seen.dispatch({ type: 'tool', tool: { kind: 'tile', tile: 'ore' } }))
  expect(container.querySelector('.hit-layers polygon')).toBeNull()
  await act(async () => seen.dispatch({ type: 'pick', target: { want: 'hex' } }))
  expect(container.querySelector('.blink')).toBeNull()
  await act(async () => {
    container.querySelector('.board-canvas')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  expect(game()).toBe(live)
  expect(seen.state.pick?.ref).toBeUndefined()
  await act(async () => {
    seen.dispatch({ type: 'tool', tool: { kind: 'none' } })
    seen.dispatch({ type: 'pick-clear' })
  })
  await click('Back to now')
  expect(container.querySelector('.ledger-asof')).toBeNull()
  expect(container.querySelector('[filter="url(#piece-shadow)"]')!.innerHTML).toBe(boardNow)
  expect(button('Correct aki').disabled).toBe(false)
})

it('disables the controls at either end and names the current roll', async () => {
  await commit(seed())
  await click('History')
  expect(button('Earlier turn').disabled).toBe(false)
  expect(button('Later turn').disabled).toBe(true)
  expect(button('Back to now').disabled).toBe(true)
  expect(container.querySelector('.history-controls')?.textContent).toContain('Turn 5· Bee')
  await click('Earlier turn')
  expect(button('Later turn').disabled).toBe(false)
  expect(button('Back to now').disabled).toBe(false)
  expect(container.querySelector('.history-controls')?.textContent).toContain('Turn 4· aki rolled 8')
  await click('Game start')
  expect(button('Earlier turn').disabled).toBe(true)
  expect(button('Later turn').disabled).toBe(false)
  await click('Later turn')
  expect(seen.state.viewedTurn).toBe(1)
})

it('hides the award tie lines in a past view and labels removed players', async () => {
  let next = seed()
  next = adjustCounter(adjustCounter(next, 'aki', 'knights', 3), 'b', 'knights', 3)
  next = { ...next, history: { ...next.history!, start: { ...next.history!.start, stats: next.stats } } }
  await commit(next)
  expect(container.querySelector('.tie-line')).not.toBeNull()
  await click('History')
  await click('Game start')
  expect(container.querySelector('.tie-line')).toBeNull()
  await commit(withBoard(next, removePlayer(next.board, 'c')))
  expect(button('Turn 3: Removed player').querySelector<HTMLElement>('.history-disc')?.style.background).toBe('rgb(197, 191, 181)')
  await click('Turn 3: Removed player')
  expect(container.querySelector('.history-controls')?.textContent).toContain('Removed player rolled 8')
})

it('scrolls only the list to reveal selection and shows the heading shadow only after scrolling', async () => {
  await commit(seed())
  await click('History')
  const list = container.querySelector<HTMLElement>('.history-list')!
  const row = button('Turn 1: aki').closest('.history-row')!
  Object.defineProperty(list, 'clientHeight', { value: 80 })
  Object.defineProperties(row, { offsetTop: { value: 300 }, offsetHeight: { value: 60 } })
  document.documentElement.scrollTop = 37
  await click('Turn 1: aki')
  expect(list.scrollTop).toBe(280)
  expect(document.documentElement.scrollTop).toBe(37)
  expect(container.querySelector('.history-panel.scrolled')).not.toBeNull()
  await act(async () => {
    list.scrollTop = 0
    list.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  expect(container.querySelector('.history-panel.scrolled')).toBeNull()
})

it('reveals a phone board only when it has scrolled past the header', async () => {
  await commit(seed())
  container.className = 'phone-shell'
  const header = document.createElement('header')
  header.className = 'phone-head'
  header.getBoundingClientRect = () => new DOMRect(0, 0, 390, 70)
  container.prepend(header)
  const board = container.querySelector<SVGSVGElement>('.board-canvas')!
  board.getBoundingClientRect = () => new DOMRect(0, -350, 390, 300)
  document.documentElement.scrollTop = 400
  await click('History')
  await click('Turn 1: aki')
  expect(document.documentElement.scrollTop).toBe(0)
  board.getBoundingClientRect = () => new DOMRect(0, 70, 390, 300)
  document.documentElement.scrollTop = 20
  await click('Turn 2: Bee')
  expect(document.documentElement.scrollTop).toBe(20)
})
