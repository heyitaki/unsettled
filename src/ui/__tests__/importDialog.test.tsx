// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addPlayer, createBoard, placeBuilding, placeRoad, randomizeBoard, renamePlayer, setMe } from '../../model/board'
import { adjustCounter, newGame, type Game, type ScreenshotRead } from '../../model/game'
import { hexEdgeIds, hexVertexIds } from '../../model/coords'
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
  const choose = async (game: Game, read: Partial<ScreenshotRead> = {}, issues: Extract<SourceParse, { ok: true }>['issues'] = []) => {
    parsed.result = { ok: true, game, issues, read: { roster: true, order: true, picks: true, hands: ['p1'], unorderedPicks: [], points: {}, knights: [], ...read } }
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

  const unreadDraft = () => {
    const hexes = terrain.hexes.map((hex) => hex.numberToken === 5 ? { ...hex, numberToken: 9 } : hex.numberToken === 9 ? { ...hex, numberToken: 5 } : hex)
    let board = addPlayer(shot({ ...terrain, hexes }).board, { id: 'p2', name: 'Blue', color: PLAYER_PALETTE.blue })
    board = placeBuilding(board, hexVertexIds({ q: 0, r: 2 })[3], 'p1', 'settlement')
    return newGame(board)
  }

  it('lands unread picks at once in one tab with pendingImport and the parser guesses', async () => {
    const game = unreadDraft()
    const tabs = store.tabs.length
    await choose(game, { order: false, picks: false, unorderedPicks: ['p1'] })
    expect(store.tabs).toHaveLength(tabs + 1)
    const tab = activeTab(store)
    expect(tab.game.board).toEqual(game.board)
    expect(tab.game.pendingImport).toEqual(parsed.result?.ok ? parsed.result.read : null)
    expect(tab.past).toEqual([])
    expect(container.querySelector('[aria-label="Second settlement"]')).toBeNull()
    expect(button('Skip')).toBeUndefined()
    expect(close).toHaveBeenCalledOnce()
  })

  it('omits pendingImport when the screenshot leaves no questions', async () => {
    await choose(unreadDraft())
    expect(activeTab(store).game).not.toHaveProperty('pendingImport')
    expect(close).toHaveBeenCalledOnce()
  })

  it('Import as new lands at once and keeps issues usable over the imported board', async () => {
    const game = unreadDraft()
    game.board.hexes = terrain.hexes
    const tabs = store.tabs.length
    await choose(game, { picks: false, unorderedPicks: ['p1'] }, [
      { stage: 'tokens', severity: 'unreadable', message: 'Review token', ref: '0,0' },
    ])
    act(() => button('Import as new')!.click())
    expect(store.tabs).toHaveLength(tabs + 1)
    expect(activeTab(store).game.pendingImport?.unorderedPicks).toEqual(['p1'])
    expect(container.querySelector('[aria-label="Second settlement"]')).toBeNull()
    expect(close).not.toHaveBeenCalled()
    act(() => container.querySelector<HTMLButtonElement>('.issue-list button')!.click())
    expect(store.highlight).toEqual([{ ref: '0,0' }])
  })

  it.each([true, false])('updates from the latest saved game with only awards pending, roster read: %s', async (roster) => {
    const saved = newGame(addPlayer(terrain, { id: 'blue', name: 'Bee', color: PLAYER_PALETTE.blue }))
    act(() => dispatch({ type: 'tab-add', game: saved, title: 'Friday game', mapId }))
    const before = activeTab(store)
    let board: Board = { ...terrain, buildings: [], roads: [], players: [
      { id: 'p1', name: 'Red', color: PLAYER_PALETTE.red },
      { id: 'p2', name: 'Blue', color: PLAYER_PALETTE.blue },
    ], mePlayerId: 'p1' }
    for (const edge of hexEdgeIds({ q: 0, r: 0 }).slice(0, 5)) board = placeRoad(board, edge, 'p1')
    for (const edge of hexEdgeIds({ q: 2, r: -2 }).slice(0, 5)) board = placeRoad(board, edge, 'p2')
    await choose(newGame(board), { roster, order: false, picks: false, unorderedPicks: ['p1'], points: { p1: 2, p2: 2 } })
    act(() => dispatch({ type: 'commit', board: renamePlayer(activeTab(store).game.board, 'aki', 'Aki R') }))
    const latest = activeTab(store)
    act(() => button('Update')!.click())
    const tab = activeTab(store)
    expect(tab.id).toBe(before.id)
    expect(tab.game.board.players.map((player) => player.id)).toEqual(['aki', 'blue'])
    expect(tab.game.board.players[0].name).toBe('Aki R')
    expect(tab.game.awards).toEqual({ longestRoad: null, largestArmy: null })
    expect(tab.game.pendingImport).toEqual({
      roster: true, order: true, picks: true, unorderedPicks: [], points: { aki: 2, blue: 2 }, hands: ['aki'], knights: [],
    })
    expect(tab.past).toEqual([...latest.past, latest.game])
    expect(container.querySelector('[aria-label="Longest road"]')).toBeNull()
    act(() => dispatch({ type: 'undo' }))
    expect(activeTab(store).game).toEqual(latest.game)
    expect(close).toHaveBeenCalledOnce()
  })

  it('applies a forced award before landing and leaves no pendingImport', async () => {
    await choose(unreadDraft(), { points: { p1: 2, p2: 2 } })
    expect(activeTab(store).game.awards?.largestArmy).toBe('p2')
    expect(activeTab(store).game.stats.p2.knights).toBe(3)
    expect(activeTab(store).game).not.toHaveProperty('pendingImport')
    expect(close).toHaveBeenCalledOnce()
  })

  it('remaps read knight ids into the open award review on Update', async () => {
    const saved = adjustCounter(adjustCounter(newGame(addPlayer(terrain, {
      id: 'blue', name: 'Bee', color: PLAYER_PALETTE.blue,
    })), 'aki', 'knights', 3), 'blue', 'knights', 3)
    act(() => dispatch({ type: 'tab-add', game: saved, title: 'Friday game', mapId }))
    const before = activeTab(store)
    const board = addPlayer(shot().board, { id: 'p2', name: 'Blue', color: PLAYER_PALETTE.blue })
    await choose(newGame(board), { knights: ['p1', 'p2'] })
    act(() => button('Update')!.click())
    expect(activeTab(store).game.awards?.largestArmy).toBeNull()
    expect(activeTab(store).game.pendingImport?.knights).toEqual(['aki', 'blue'])
    expect(activeTab(store).past).toEqual([before.game])
    expect(close).toHaveBeenCalledOnce()
  })

  it('clears an older pendingImport when an update leaves nothing unanswered', async () => {
    const pendingImport = { roster: true, order: false, picks: false, hands: [], unorderedPicks: [], points: {}, knights: [] }
    act(() => dispatch({ type: 'tab-add', game: { ...newGame(terrain), pendingImport }, title: 'Friday game', mapId }))
    await choose(shot())
    act(() => button('Update')!.click())
    expect(activeTab(store).game).not.toHaveProperty('pendingImport')
    expect(close).toHaveBeenCalledOnce()
  })
})
