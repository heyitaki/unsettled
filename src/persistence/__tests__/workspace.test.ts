// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createBoard } from '../../model/board'
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

  it('round-trips a multi-board workspace', () => {
    const workspace: PersistedWorkspace = {
      activeTabId: 'b',
      tabs: [
        { id: 'a', title: 'Game 1', board: createBoard('standard4') },
        { id: 'b', title: 'Game 2', board: createBoard('extension6') },
      ],
    }
    expect(saveWorkspace(workspace).ok).toBe(true)
    expect(loadWorkspace()).toEqual({ ok: true, workspace })
  })

  it('returns ok false when nothing is stored', () => {
    expect(loadWorkspace().ok).toBe(false)
  })

  it('migrates the legacy single-board autosave without deleting it', () => {
    const board = createBoard('extension6')
    expect(autosaveCurrent(board).ok).toBe(true)

    const loaded = loadWorkspace()
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.workspace.tabs).toHaveLength(1)
    expect(loaded.workspace.tabs[0].title).toBe('Board 1')
    expect(loaded.workspace.tabs[0].board).toEqual(board)
    expect(loaded.workspace.activeTabId).toBe(loaded.workspace.tabs[0].id)
    expect(localStorage.getItem(CURRENT_KEY)).not.toBeNull()
  })

  it('drops invalid tabs with a warning and reconciles the active id', () => {
    const good = { id: 'g', title: 'Good', board: createBoard('standard4') }
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
      activeTabId: 'missing',
      tabs: [good, { id: 'bad', title: 'Bad', board: { schemaVersion: 9 } }],
    }))

    const loaded = loadWorkspace()
    expect(loaded).toMatchObject({ ok: true, warning: expect.stringContaining('Bad') })
    if (!loaded.ok) return
    expect(loaded.workspace.tabs.map((entry) => entry.id)).toEqual(['g'])
    expect(loaded.workspace.activeTabId).toBe('g')
  })

  it('reports ok false when no tab survives validation', () => {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
      activeTabId: 'bad',
      tabs: [{ id: 'bad', title: 'Bad', board: { schemaVersion: 9 } }],
    }))
    expect(loadWorkspace().ok).toBe(false)
  })

  it('backs up a corrupt workspace blob before the next save', () => {
    localStorage.setItem(WORKSPACE_KEY, 'broken')
    expect(loadWorkspace().ok).toBe(false)

    const workspace: PersistedWorkspace = {
      activeTabId: 'a',
      tabs: [{ id: 'a', title: 'Game 1', board: createBoard('standard4') }],
    }
    expect(saveWorkspace(workspace).ok).toBe(true)
    expect(localStorage.getItem(WORKSPACE_CORRUPT_KEY)).toBe('broken')
    expect(loadWorkspace()).toEqual({ ok: true, workspace })
  })
})
