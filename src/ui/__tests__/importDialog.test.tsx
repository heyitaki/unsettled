// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addPlayer, createBoard, placeBuilding, randomizeBoard, renamePlayer, setMe } from '../../model/board'
import { newGame, type Game } from '../../model/game'
import { boardGrid } from '../../model/layouts'
import { PLAYER_PALETTE, type Board } from '../../model/types'
import type { SourceParse } from '../../parser'
import { loadMap, saveMap } from '../../persistence/localStorage'
import { ImportDialog } from '../ImportDialog'
import { AUTOSAVE_DELAY } from '../libraryAutosave'
import { activeTab, StoreProvider, useStore, type StoreAction, type StoreState } from '../store'

const parsed = vi.hoisted(() => ({ result: null as SourceParse | null }))
vi.mock('../../parser', () => ({ parseScreenshot: () => parsed.result }))

describe('screenshot dialog native lifecycle', () => {
  let root: Root
  let container: HTMLDivElement
  const close = vi.fn()
  const showModal = vi.fn()
  const closeModal = vi.fn()
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))

    // jsdom has no dialog implementation. Chromium covers focus and Escape.
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: { configurable: true, value: showModal },
      close: { configurable: true, value: closeModal },
    })
    showModal.mockClear()
    closeModal.mockClear()
    localStorage.clear()
    sessionStorage.clear()
    close.mockClear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(<StoreProvider><ImportDialog onClose={close} /></StoreProvider>))
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
    vi.unstubAllGlobals()
  })
  it('opens a native modal and closes it before removal', () => {
    expect(container.querySelector('dialog')).not.toBeNull()
    expect(showModal).toHaveBeenCalledOnce()
    act(() => root.render(null))
    expect(closeModal).toHaveBeenCalledOnce()
  })
  it('handles the native cancel event used by Escape', () => {
    const dialog = container.querySelector('dialog')!
    act(() => dialog.dispatchEvent(new Event('cancel', { cancelable: true })))
    expect(close).toHaveBeenCalledOnce()
  })
})

describe('a screenshot of a board the library already holds', () => {
  let root: Root
  let container: HTMLDivElement
  let store: StoreState
  let dispatch: (action: StoreAction) => void
  let mapId: string
  const close = vi.fn()
  const vertex = boardGrid('standard4').vertexIds[0]
  const terrain = randomizeBoard(createBoard('standard4'))

  // The parser's view of the saved game one settlement later: its own id and a colour name.
  const shot = (base: Board = terrain): Game => {
    let board: Board = { ...base, players: [], mePlayerId: null }
    board = setMe(addPlayer(board, { id: 'p1', name: 'Red', color: PLAYER_PALETTE.red }), 'p1')
    const game = newGame(placeBuilding(board, vertex, 'p1', 'settlement'))
    game.stats.p1.handUnknown = 3
    return game
  }
  const Probe = () => {
    ;({ state: store, dispatch } = useStore())
    return null
  }
  const stored = (): Game => {
    const result = loadMap(mapId)
    if (!result.ok) throw new Error(result.errors.join(', '))
    return result.game
  }
  const button = (label: string) =>
    [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === label)
  const choose = async (game: Game) => {
    parsed.result = { ok: true, game, issues: [], read: { roster: true, order: true, picks: true, hands: ['p1'] } }
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { configurable: true, value: [new File([], 'later.png')] })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('createImageBitmap', async () => ({ width: 1, height: 1, close() {} }))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage() {},
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    } as unknown as CanvasRenderingContext2D)
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: { configurable: true, value() {} },
      close: { configurable: true, value() {} },
    })
    localStorage.clear()
    sessionStorage.clear()
    close.mockClear()
    const saved = saveMap('Friday game', newGame(terrain))
    if (!saved.ok) throw new Error(saved.error)
    mapId = saved.id
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(<StoreProvider><Probe /><ImportDialog onClose={close} /></StoreProvider>))
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('asks before importing, and adds nothing until answered', async () => {
    const tabs = store.tabs.length
    await choose(shot())
    expect(container.textContent).toContain('"Friday game"')
    expect(store.tabs).toHaveLength(tabs)
    expect(close).not.toHaveBeenCalled()
  })

  it('updates the saved map in its own tab, keeping the saved player', async () => {
    const tabs = store.tabs.length
    await choose(shot())
    act(() => button('Update')!.click())
    // The map was not open, so it gains the one tab every opened map gets.
    expect(store.tabs).toHaveLength(tabs + 1)
    const tab = activeTab(store)
    expect(tab.mapId).toBe(mapId)
    expect(tab.title).toBe('Friday game')
    expect(tab.game.board.players).toEqual(terrain.players)
    expect(tab.game.board.buildings).toEqual([{ vertexId: vertex, playerId: 'aki', tier: 'settlement' }])
    expect(tab.game.stats.aki.handUnknown).toBe(3)
    // One undo step back to the map as it was saved.
    expect(tab.past).toHaveLength(1)
    expect(close).toHaveBeenCalledOnce()
  })

  it('writes the update back into the same library entry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await choose(shot())
      act(() => button('Update')!.click())
      act(() => { vi.advanceTimersByTime(AUTOSAVE_DELAY) })
      expect(stored().board.buildings).toEqual([{ vertexId: vertex, playerId: 'aki', tier: 'settlement' }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('updates a map already open in a background tab, from what the tab holds', async () => {
    // Open the map, rename its player there, then leave it for a fresh board.
    act(() => dispatch({ type: 'tab-add', game: stored(), title: 'Friday game', mapId }))
    act(() => dispatch({ type: 'commit', board: renamePlayer(activeTab(store).game.board, 'aki', 'Aki R') }))
    act(() => dispatch({ type: 'tab-add' }))
    const tabs = store.tabs.length
    await choose(shot())
    act(() => button('Update')!.click())
    expect(store.tabs).toHaveLength(tabs)
    const tab = activeTab(store)
    expect(tab.mapId).toBe(mapId)
    expect(tab.game.board.players[0].name).toBe('Aki R')
    expect(tab.game.board.buildings).toHaveLength(1)
    expect(tab.past).toHaveLength(2)
  })

  it('imports a separate board when asked to', async () => {
    const tabs = store.tabs.length
    await choose(shot())
    act(() => button('Import as new')!.click())
    expect(store.tabs).toHaveLength(tabs + 1)
    const tab = activeTab(store)
    expect(tab.mapId).toBeNull()
    expect(tab.title).toBe('later')
    expect(tab.game.board.players[0].id).toBe('p1')
    expect(close).toHaveBeenCalledOnce()
  })

  it('asks about an earlier import that was never edited, so is in no map yet', async () => {
    // A terrain the library does not hold: the first screenshot just imports.
    const hex = terrain.hexes.find((candidate) => candidate.numberToken !== null)!
    const fresh = { ...terrain, hexes: terrain.hexes.map((candidate) =>
      candidate === hex ? { ...hex, numberToken: hex.numberToken === 5 ? 9 : 5 } : candidate) }
    await choose(shot(fresh))
    const first = activeTab(store)
    expect(first.mapId).toBeNull()
    act(() => dispatch({ type: 'tab-add' }))
    const tabs = store.tabs.length
    // The same game one settlement later.
    const later = shot(fresh)
    const next = placeBuilding(later.board, boardGrid('standard4').vertexIds.at(-1)!, 'p1', 'settlement')
    await choose({ ...later, board: next })
    expect(container.textContent).toContain('"later"')
    act(() => button('Update')!.click())
    expect(store.tabs).toHaveLength(tabs)
    const tab = activeTab(store)
    expect(tab.id).toBe(first.id)
    expect(tab.game.board.buildings).toHaveLength(2)
    expect(tab.past).toEqual([first.game])
  })

  it('imports without asking when no saved map has the same terrain', async () => {
    const tabs = store.tabs.length
    const hex = terrain.hexes.find((candidate) => candidate.numberToken !== null)!
    const other = terrain.hexes.map((candidate) =>
      candidate === hex ? { ...hex, numberToken: hex.numberToken === 5 ? 9 : 5 } : candidate)
    await choose(shot({ ...terrain, hexes: other }))
    expect(button('Update')).toBeUndefined()
    expect(store.tabs).toHaveLength(tabs + 1)
    expect(activeTab(store).mapId).toBeNull()
    expect(close).toHaveBeenCalledOnce()
  })
})
