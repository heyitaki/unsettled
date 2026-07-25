// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createBoard } from '../../model/board'
import { newGame } from '../../model/game'
import {
  MAPS_KEY,
  WORKSPACE_KEY,
  saveMap,
  saveWorkspace,
  storedTabLinks,
} from '../../persistence/localStorage'
import { storageActions, unflushedWork, withAdopted } from '../store'

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

  it('passes unflushed links through so an adoption cannot undo a fresh save', () => {
    seedWorkspace()
    const [adopt] = storageActions(event(WORKSPACE_KEY), [], ['a'])
    expect(adopt).toMatchObject({ type: 'workspace-adopt', keepLinkIds: ['a'] })
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

describe('flush tracking', () => {
  beforeEach(() => localStorage.clear())

  const tab = (id: string, mapId?: string) => ({ id, title: id, game: game(), ...(mapId ? { mapId } : {}) })

  it('reads the stored links back without validating a single board', () => {
    seedWorkspace()
    expect(storedTabLinks()).toEqual(new Map([['a', 'map-1']]))
  })

  it('claims nothing when no workspace was ever written', () => {
    // The tab this document invented at startup has never been in the blob, so
    // it is unflushed work: an adoption a moment later must not discard it
    // along with the user's first edits.
    expect(storedTabLinks()).toEqual(new Map())
    expect(unflushedWork(storedTabLinks(), [tab('a')])).toEqual({ tabIds: ['a'], linkIds: [] })
  })

  it('claims nothing from a workspace blob it cannot parse', () => {
    localStorage.setItem(WORKSPACE_KEY, 'not json')
    expect(storedTabLinks()).toEqual(new Map())
  })

  it('separates an unwritten tab from an unwritten link on a written tab', () => {
    const persisted = new Map([['a', null], ['b', 'map-1']])
    expect(unflushedWork(persisted, [tab('a', 'map-2'), tab('b', 'map-1'), tab('c')])).toEqual({
      tabIds: ['c'],
      linkIds: ['a'],
    })
  })

  it('counts an unlinking as an unflushed link change', () => {
    expect(unflushedWork(new Map([['a', 'map-1']]), [tab('a')])).toEqual({
      tabIds: [],
      linkIds: ['a'],
    })
  })

  it('records adopted tabs as flushed so closing one elsewhere sticks', () => {
    // Without this the adopted tab stays classed as local work, and the next
    // blob that omits it — because the other window closed it — sees it kept
    // and written straight back.
    const adopted = withAdopted(new Map([['a', null]]), [tab('a'), tab('b', 'map-1')], [])
    expect(adopted).toEqual(new Map([['a', null], ['b', 'map-1']]))
    expect(unflushedWork(adopted, [tab('a'), tab('b', 'map-1')])).toEqual({ tabIds: [], linkIds: [] })
  })

  it('leaves a kept link unflushed until this document writes it', () => {
    const adopted = withAdopted(new Map([['a', null]]), [tab('a', 'map-1')], ['a'])
    expect(adopted.get('a')).toBeNull()
  })
})
