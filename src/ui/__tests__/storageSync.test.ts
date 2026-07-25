// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createBoard } from '../../model/board'
import { newGame } from '../../model/game'
import { MAPS_KEY, WORKSPACE_KEY, saveMap, saveWorkspace } from '../../persistence/localStorage'
import { storageActions } from '../store'

const game = () => newGame(createBoard('standard4'))

const event = (key: string | null, newValue: string | null = 'written') => ({ key, newValue })

function seedWorkspace() {
  const result = saveWorkspace({
    activeTabId: 'a',
    tabs: [{ id: 'a', title: 'Alpha', game: game(), mapId: 'map-1' }],
  })
  if (!result.ok) throw new Error(result.error)
}

describe('storageActions', () => {
  beforeEach(() => localStorage.clear())

  it('ignores a key this app does not own', () => {
    expect(storageActions(event('something.else'), [])).toEqual([])
  })

  it('turns a library write into a maps-changed carrying the current library', () => {
    const saved = saveMap('Alpha', game(), true)
    if (!saved.ok) throw new Error(saved.error)
    expect(storageActions(event(MAPS_KEY), [])).toEqual([
      { type: 'maps-changed', library: { readable: true, maps: [{ id: saved.id, name: 'Alpha' }] } },
    ])
  })

  it('reports an unparseable library as unreadable rather than as empty', () => {
    localStorage.setItem(MAPS_KEY, 'not json')
    expect(storageActions(event(MAPS_KEY), [])).toEqual([
      { type: 'maps-changed', library: { readable: false } },
    ])
  })

  it('still syncs the library when another window removed the key', () => {
    // The newValue === null guard belongs to the workspace branch only: a
    // removed library is a change, not something to ignore.
    expect(storageActions(event(MAPS_KEY, null), [])).toEqual([
      { type: 'maps-changed', library: { readable: true, maps: [] } },
    ])
  })

  it('adopts a workspace written by another window, passing unflushed ids through', () => {
    seedWorkspace()
    const [adopt, ...rest] = storageActions(event(WORKSPACE_KEY), ['local-only'])
    expect(rest).toEqual([])
    expect(adopt).toMatchObject({
      type: 'workspace-adopt',
      keepIds: ['local-only'],
      tabs: [{ id: 'a', title: 'Alpha', mapId: 'map-1' }],
    })
  })

  it('ignores a workspace removal and a workspace that no longer parses', () => {
    seedWorkspace()
    expect(storageActions(event(WORKSPACE_KEY, null), [])).toEqual([])
    // The local tabs are the last good copy; adopting nothing is the safe move.
    localStorage.setItem(WORKSPACE_KEY, 'not json')
    expect(storageActions(event(WORKSPACE_KEY), [])).toEqual([])
  })

  it('carries the warning when the incoming workspace lost tabs', () => {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
      activeTabId: 'a',
      tabs: [
        { id: 'a', title: 'Alpha', game: game() },
        { id: 'b', title: 'Broken', game: { schemaVersion: 9 } },
      ],
    }))
    const [adopt] = storageActions(event(WORKSPACE_KEY), [])
    expect(adopt).toMatchObject({ type: 'workspace-adopt', warning: expect.any(String) })
  })

  it('treats a cleared origin as both the library and the workspace changing', () => {
    // localStorage.clear() in another document fires one event with key null;
    // without this the window keeps listing maps that no longer exist.
    seedWorkspace()
    localStorage.clear()
    expect(storageActions(event(null, null), [])).toEqual([
      { type: 'maps-changed', library: { readable: true, maps: [] } },
    ])
  })
})
