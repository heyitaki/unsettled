// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createBoard } from '../../model/board'
import { newGame } from '../../model/game'
import {
  CURRENT_KEY,
  WORKSPACE_CORRUPT_KEY,
  WORKSPACE_KEY,
  autosaveCurrent,
  loadWorkspace,
  saveWorkspace,
  type PersistedWorkspace,
} from '../localStorage'

describe('workspace persistence', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips a multi-board workspace including per-tab active players', () => {
    const game = newGame(createBoard('standard4'))
    const workspace: PersistedWorkspace = {
      activeTabId: 'b',
      tabs: [
        { id: 'a', title: 'Game 1', game, activePlayerId: game.board.players[0].id },
        { id: 'b', title: 'Game 2', game: newGame(createBoard('extension6')) },
      ],
    }
    expect(saveWorkspace(workspace).ok).toBe(true)
    expect(loadWorkspace()).toEqual({ ok: true, workspace })
  })

  it('omits an activePlayerId that is not in the roster', () => {
    const workspace: PersistedWorkspace = {
      activeTabId: 'a',
      tabs: [{ id: 'a', title: 'Game 1', game: newGame(createBoard('standard4')), activePlayerId: 'ghost' }],
    }
    expect(saveWorkspace(workspace).ok).toBe(true)
    const loaded = loadWorkspace()
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.workspace.tabs[0].activePlayerId).toBeUndefined()
  })

  it('returns ok false when nothing is stored', () => {
    expect(loadWorkspace().ok).toBe(false)
  })

  it('round-trips a tab’s library link and leaves unlinked tabs unlinked', () => {
    const game = newGame(createBoard('standard4'))
    const workspace: PersistedWorkspace = {
      activeTabId: 'a',
      tabs: [
        { id: 'a', title: 'Alpha', game, mapId: 'map-1' },
        { id: 'b', title: 'Board 2', game },
      ],
    }
    expect(saveWorkspace(workspace).ok).toBe(true)
    expect(loadWorkspace()).toEqual({ ok: true, workspace })
  })

  it('drops a malformed mapId rather than carrying a link it cannot trust', () => {
    const game = newGame(createBoard('standard4'))
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
      activeTabId: 'a',
      tabs: [{ id: 'a', title: 'Alpha', game, mapId: 42 }],
    }))
    const loaded = loadWorkspace()
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.workspace.tabs[0].mapId).toBeUndefined()
  })

  it('loads legacy tabs that stored a bare board as zero-stat games', () => {
    const board = createBoard('standard4')
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
      activeTabId: 'a',
      tabs: [{ id: 'a', title: 'Game 1', board }],
    }))
    const loaded = loadWorkspace()
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.workspace.tabs[0].game).toEqual(newGame(board))
  })

  it('migrates the legacy single-board autosave without deleting it', () => {
    const game = newGame(createBoard('extension6'))
    expect(autosaveCurrent(game).ok).toBe(true)

    const loaded = loadWorkspace()
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.workspace.tabs).toHaveLength(1)
    expect(loaded.workspace.tabs[0].title).toBe('Board 1')
    expect(loaded.workspace.tabs[0].game).toEqual(game)
    expect(loaded.workspace.activeTabId).toBe(loaded.workspace.tabs[0].id)
    expect(localStorage.getItem(CURRENT_KEY)).not.toBeNull()
  })

  it('drops invalid tabs with a warning and ignores an unresolvable active id', () => {
    const good = { id: 'g', title: 'Good', game: newGame(createBoard('standard4')) }
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
      activeTabId: 'missing',
      tabs: [good, { id: 'bad', title: 'Bad', game: { schemaVersion: 9 } }],
    }))

    const loaded = loadWorkspace()
    expect(loaded).toMatchObject({ ok: true, warning: expect.stringContaining('Bad') })
    if (!loaded.ok) return
    expect(loaded.workspace.tabs.map((entry) => entry.id)).toEqual(['g'])
    // Which tab is in front is per-window state the blob no longer owns, so an
    // id naming no open tab is simply not carried; the store picks the fallback.
    expect(loaded.workspace.activeTabId).toBeUndefined()

    // A lossy load must preserve the original blob before the next save
    // rewrites the key, or the dropped tab is destroyed forever.
    const original = localStorage.getItem(WORKSPACE_KEY)!
    expect(saveWorkspace(loaded.workspace).ok).toBe(true)
    expect(localStorage.getItem(WORKSPACE_CORRUPT_KEY)).toBe(original)
  })

  it('drops duplicate tab ids with a warning and preserves the original blob', () => {
    const game = newGame(createBoard('standard4'))
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
      activeTabId: 'x',
      tabs: [
        { id: 'x', title: 'First', game },
        { id: 'x', title: 'Second', game },
      ],
    }))

    const loaded = loadWorkspace()
    expect(loaded).toMatchObject({ ok: true, warning: expect.stringContaining('Second') })
    if (!loaded.ok) return
    expect(loaded.workspace.tabs.map((entry) => entry.title)).toEqual(['First'])

    const original = localStorage.getItem(WORKSPACE_KEY)!
    expect(saveWorkspace(loaded.workspace).ok).toBe(true)
    expect(localStorage.getItem(WORKSPACE_CORRUPT_KEY)).toBe(original)
  })

  it('reports ok false when no tab survives validation', () => {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
      activeTabId: 'bad',
      tabs: [{ id: 'bad', title: 'Bad', game: { schemaVersion: 9 } }],
    }))
    expect(loadWorkspace().ok).toBe(false)
  })

  it('backs up a corrupt workspace blob before the next save', () => {
    localStorage.setItem(WORKSPACE_KEY, 'broken')
    expect(loadWorkspace().ok).toBe(false)

    const workspace: PersistedWorkspace = {
      activeTabId: 'a',
      tabs: [{ id: 'a', title: 'Game 1', game: newGame(createBoard('standard4')) }],
    }
    expect(saveWorkspace(workspace).ok).toBe(true)
    expect(localStorage.getItem(WORKSPACE_CORRUPT_KEY)).toBe('broken')
    expect(loadWorkspace()).toEqual({ ok: true, workspace })
  })
})
