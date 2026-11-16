// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBoard, randomizeBoard } from '../../model/board'
import { newGame } from '../../model/game'
import { PLAYER_PALETTE } from '../../model/types'
import type { SourceParse } from '../../parser'
import { savePeople, WORKSPACE_KEY } from '../../persistence/localStorage'
import { ImportDialog } from '../ImportDialog'
import { activeTab, StoreProvider, useStore } from '../store'

const parsed = vi.hoisted(() => ({ result: null as SourceParse | null }))
vi.mock('../../parser', () => ({ parseScreenshot: () => parsed.result }))
const print = '123456'.repeat(64)
let root: Root
let container: HTMLDivElement
let store: ReturnType<typeof useStore>
const Probe = () => { store = useStore(); return null }

beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('createImageBitmap', async () => ({ width: 1, height: 1, close() {} }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  } as unknown as CanvasRenderingContext2D)
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value() {} },
    close: { configurable: true, value() {} },
  })
  localStorage.clear()
  sessionStorage.clear()
  savePeople([{ name: 'alice', prints: [print] }])
  const saved = newGame({ ...randomizeBoard(createBoard('standard4')), players: [
    { id: 'saved-red', name: 'alice', color: PLAYER_PALETTE.red },
  ], mePlayerId: null })
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ tabs: [{ id: 'saved', title: 'Saved board', game: saved }] }))
  const shot = newGame({ ...saved.board, players: [
    { id: 'p1', name: 'Red', color: PLAYER_PALETTE.red },
    { id: 'p2', name: 'Orange', color: PLAYER_PALETTE.orange },
  ] })
  shot.avatars = { p2: print }
  parsed.result = { ok: true, game: shot, issues: [], read: { roster: true, order: true, picks: true, unorderedPicks: [], hands: [], points: {}, knights: [] } }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root.render(<StoreProvider><Probe /><ImportDialog onClose={() => {}} /></StoreProvider>))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function importAs(action: 'Update' | 'Import as new') {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
  Object.defineProperty(input, 'files', { value: [new File([], 'later.png')] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  expect(container.textContent).toContain('You already have this board')
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent === action)!
  act(() => button.click())
}

it('names an Update only after merging, so a newcomer cannot take a saved seat name', async () => {
  await importAs('Update')
  expect(activeTab(store.state).game.board.players.map(({ name }) => name)).toEqual(['alice', 'Orange'])
  expect(store.state.tabs).toHaveLength(1)
})

it('names recognised players when importing the screenshot as a new board', async () => {
  await importAs('Import as new')
  expect(activeTab(store.state).game.board.players.map(({ name }) => name)).toEqual(['Red', 'alice'])
  expect(store.state.tabs).toHaveLength(2)
})

it('titles a new screenshot from its recognised roster, keeping the file name in the notice', async () => {
  await importAs('Import as new')
  const today = new Date()
  expect(activeTab(store.state).title).toBe(`${today.getMonth() + 1}/${today.getDate()} Red, alice`)
  expect(store.state.notice).toBe('Imported later.png')
})

it('uses a Board number for an import with only default names', async () => {
  savePeople([])
  act(() => store.dispatch({ type: 'tab-rename', id: 'saved', title: 'Board 1' }))
  await importAs('Import as new')
  expect(activeTab(store.state).title).toBe('Board 2')
})

it('retitles an automatic board after Update names the merged roster', async () => {
  act(() => store.dispatch({ type: 'tab-rename', id: 'saved', title: 'Board 1' }))
  await importAs('Update')
  const today = new Date()
  expect(activeTab(store.state).title).toBe(`${today.getMonth() + 1}/${today.getDate()} alice, Orange`)
  expect(activeTab(store.state).past).toHaveLength(1)
})
