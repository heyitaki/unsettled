// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createBoard } from '../../model/board'
import { newGame } from '../../model/game'
import {
  WORKSPACE_CORRUPT_KEY,
  WORKSPACE_KEY,
  loadWorkspace,
  saveWorkspaceBlob,
  type PersistedWorkspace,
} from '../localStorage'

describe('workspace persistence', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips a multi-board workspace including per-tab active players', () => {
    const game = newGame(createBoard('standard4'))
    const workspace: PersistedWorkspace = {
      tabs: [
        { id: 'a', title: 'Game 1', game, activePlayerId: game.board.players[0].id },
        { id: 'b', title: 'Game 2', game: newGame(createBoard('extension6')) },
      ],
    }
    expect(saveWorkspaceBlob(JSON.stringify(workspace)).ok).toBe(true)
    expect(loadWorkspace()).toEqual({ ok: true, workspace })
  })

  it('omits an activePlayerId that is not in the roster', () => {
    const workspace: PersistedWorkspace = {
      tabs: [{ id: 'a', title: 'Game 1', game: newGame(createBoard('standard4')), activePlayerId: 'ghost' }],
    }
    expect(saveWorkspaceBlob(JSON.stringify(workspace)).ok).toBe(true)
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
      tabs: [
        { id: 'a', title: 'Alpha', game, mapId: 'map-1' },
        { id: 'b', title: 'Board 2', game },
      ],
    }
    expect(saveWorkspaceBlob(JSON.stringify(workspace)).ok).toBe(true)
    expect(loadWorkspace()).toEqual({ ok: true, workspace })
  })

  it('drops a malformed mapId rather than carrying a link it cannot trust', () => {
    const game = newGame(createBoard('standard4'))
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
      tabs: [{ id: 'a', title: 'Alpha', game, mapId: 42 }],
    }))
    const loaded = loadWorkspace()
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.workspace.tabs[0].mapId).toBeUndefined()
  })

  it('drops invalid tabs with a warning', () => {
    const good = { id: 'g', title: 'Good', game: newGame(createBoard('standard4')) }
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
      tabs: [good, { id: 'bad', title: 'Bad', game: { schemaVersion: 9 } }],
    }))

    const loaded = loadWorkspace()
    expect(loaded).toMatchObject({ ok: true, warning: expect.stringContaining('Bad') })
    if (!loaded.ok) return
    expect(loaded.workspace.tabs.map((entry) => entry.id)).toEqual(['g'])

    // A lossy load must preserve the original blob before the next save
    // rewrites the key, or the dropped tab is destroyed forever.
    const original = localStorage.getItem(WORKSPACE_KEY)!
    expect(saveWorkspaceBlob(JSON.stringify(loaded.workspace)).ok).toBe(true)
    expect(localStorage.getItem(WORKSPACE_CORRUPT_KEY)).toBe(original)
  })

  it('drops duplicate tab ids with a warning and preserves the original blob', () => {
    const game = newGame(createBoard('standard4'))
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
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
    expect(saveWorkspaceBlob(JSON.stringify(loaded.workspace)).ok).toBe(true)
    expect(localStorage.getItem(WORKSPACE_CORRUPT_KEY)).toBe(original)
  })

  it('reports ok false when no tab survives validation', () => {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
      tabs: [{ id: 'bad', title: 'Bad', game: { schemaVersion: 9 } }],
    }))
    expect(loadWorkspace().ok).toBe(false)
  })

  it('backs up a corrupt workspace blob before the next save', () => {
    localStorage.setItem(WORKSPACE_KEY, 'broken')
    expect(loadWorkspace().ok).toBe(false)

    const workspace: PersistedWorkspace = {
      tabs: [{ id: 'a', title: 'Game 1', game: newGame(createBoard('standard4')) }],
    }
    expect(saveWorkspaceBlob(JSON.stringify(workspace)).ok).toBe(true)
    expect(localStorage.getItem(WORKSPACE_CORRUPT_KEY)).toBe('broken')
    expect(loadWorkspace()).toEqual({ ok: true, workspace })
  })
})
