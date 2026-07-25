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
import {
  NOTHING_UNFLUSHED,
  storageActions,
  unflushedWork,
  withAdopted,
  writeVerdict,
  type UnflushedWork,
} from '../store'

const game = () => newGame(createBoard('standard4'))

const event = (key: string | null, newValue: string | null = 'written') => ({ key, newValue })

const unflushed = (work: Partial<UnflushedWork> = {}): UnflushedWork => ({
  ...NOTHING_UNFLUSHED,
  ...work,
})

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
    expect(storageActions(event('something.else'))).toEqual([])
  })

  it('turns a library write into a maps-changed carrying the current library', () => {
    const saved = saveMap('Alpha', game(), true)
    if (!saved.ok) throw new Error(saved.error)
    expect(storageActions(event(MAPS_KEY))).toEqual([
      { type: 'maps-changed', library: { readable: true, maps: [{ id: saved.id, name: 'Alpha' }] } },
    ])
  })

  it('reports an unparseable library as unreadable rather than as empty', () => {
    localStorage.setItem(MAPS_KEY, 'not json')
    expect(storageActions(event(MAPS_KEY))).toEqual([
      { type: 'maps-changed', library: { readable: false } },
    ])
  })

  it('still syncs the library when another window removed the key', () => {
    // The newValue === null guard belongs to the workspace branch only: a
    // removed library is a change, not something to ignore.
    expect(storageActions(event(MAPS_KEY, null))).toEqual([
      { type: 'maps-changed', library: { readable: true, maps: [] } },
    ])
  })

  it('adopts a workspace written by another window, passing unflushed work through', () => {
    seedWorkspace()
    const [adopt, ...rest] = storageActions(event(WORKSPACE_KEY), unflushed({ added: ['local-only'] }))
    expect(rest).toEqual([])
    expect(adopt).toMatchObject({
      type: 'workspace-adopt',
      unflushed: { added: ['local-only'], relinked: [], closed: [] },
      tabs: [{ id: 'a', title: 'Alpha', mapId: 'map-1' }],
    })
  })

  it('ignores a workspace removal and a workspace that no longer parses', () => {
    seedWorkspace()
    expect(storageActions(event(WORKSPACE_KEY, null))).toEqual([])
    // The local tabs are the last good copy; adopting nothing is the safe move.
    localStorage.setItem(WORKSPACE_KEY, 'not json')
    expect(storageActions(event(WORKSPACE_KEY))).toEqual([])
  })

  it('carries the warning when the incoming workspace lost tabs', () => {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
      activeTabId: 'a',
      tabs: [
        { id: 'a', title: 'Alpha', game: game() },
        { id: 'b', title: 'Broken', game: { schemaVersion: 9 } },
      ],
    }))
    const [adopt] = storageActions(event(WORKSPACE_KEY))
    expect(adopt).toMatchObject({ type: 'workspace-adopt', warning: expect.any(String) })
  })

  it('passes unflushed links through so an adoption cannot undo a fresh save', () => {
    seedWorkspace()
    const [adopt] = storageActions(event(WORKSPACE_KEY), unflushed({ relinked: ['a'] }))
    expect(adopt).toMatchObject({ type: 'workspace-adopt', unflushed: { relinked: ['a'] } })
  })

  it('treats a cleared origin as both the library and the workspace changing', () => {
    // localStorage.clear() in another document fires one event with key null;
    // without this the window keeps listing maps that no longer exist.
    seedWorkspace()
    localStorage.clear()
    expect(storageActions(event(null, null))).toEqual([
      { type: 'maps-changed', library: { readable: true, maps: [] } },
    ])
  })
})

describe('writeVerdict', () => {
  it('writes when storage still holds the blob this document last saw', () => {
    expect(writeVerdict('next', 'seen', 'seen')).toBe('write')
  })

  it('skips a write that would store what is already stored', () => {
    // The echo that used to land inside another window's autosave debounce and
    // resurrect the tabs it had just closed.
    expect(writeVerdict('same', 'same', 'same')).toBe('skip')
  })

  it('resyncs rather than overwrite a blob this document never saw', () => {
    // A window restored from bfcache: it missed the events that produced what
    // storage now holds, so its own state is the stale one.
    expect(writeVerdict('mine', 'written by another window', 'seen')).toBe('resync')
  })

  it('writes the first workspace when nothing has ever been stored', () => {
    expect(writeVerdict('first', null, null)).toBe('write')
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
    expect(unflushedWork(storedTabLinks(), [tab('a')])).toEqual(unflushed({ added: ['a'] }))
  })

  it('claims nothing from a workspace blob it cannot parse', () => {
    localStorage.setItem(WORKSPACE_KEY, 'not json')
    expect(storedTabLinks()).toEqual(new Map())
  })

  it('separates an unwritten tab from an unwritten link on a written tab', () => {
    const persisted = new Map([['a', null], ['b', 'map-1']])
    expect(unflushedWork(persisted, [tab('a', 'map-2'), tab('b', 'map-1'), tab('c')]))
      .toEqual(unflushed({ added: ['c'], relinked: ['a'] }))
  })

  it('counts an unlinking as an unflushed link change', () => {
    expect(unflushedWork(new Map([['a', 'map-1']]), [tab('a')]))
      .toEqual(unflushed({ relinked: ['a'] }))
  })

  it('counts a tab dropped since the last write as an unflushed close', () => {
    // The close the incoming blob cannot know about, because it was serialized
    // before the user made it.
    expect(unflushedWork(new Map([['a', null], ['b', 'map-1']]), [tab('a')]))
      .toEqual(unflushed({ closed: ['b'] }))
  })

  it('claims nothing at all while no write is in flight', () => {
    // Not "every tab was just closed": an empty outbox means storage is already
    // up to date, and reading it as a pile of closes would make this document
    // refuse every tab the blob offers.
    expect(unflushedWork(new Map([['a', null], ['b', null]]), null)).toEqual(NOTHING_UNFLUSHED)
  })

  it('records adopted tabs as flushed so closing one elsewhere sticks', () => {
    // Without this the adopted tab stays classed as local work, and the next
    // blob that omits it — because the other window closed it — sees it kept
    // and written straight back.
    const adopted = withAdopted(new Map([['a', null]]), [tab('a'), tab('b', 'map-1')], NOTHING_UNFLUSHED)
    expect(adopted).toEqual(new Map([['a', null], ['b', 'map-1']]))
    expect(unflushedWork(adopted, [tab('a'), tab('b', 'map-1')])).toEqual(NOTHING_UNFLUSHED)
  })

  it('mirrors the adopted blob, dropping tabs it no longer holds', () => {
    // The map means "what shared storage holds"; a leftover id would later read
    // as a tab this document closed.
    expect(withAdopted(new Map([['a', null], ['b', null]]), [tab('a')], NOTHING_UNFLUSHED))
      .toEqual(new Map([['a', null]]))
  })

  it('keeps an unflushed close recognisable across a repeat of the same blob', () => {
    // The blob still lists the closed tab, so the id stays on record and the
    // next event for it is refused too — right up until this document's own
    // write lands and takes the tab out of the blob.
    const closed = unflushedWork(new Map([['a', null], ['b', null]]), [tab('a')])
    const adopted = withAdopted(new Map([['a', null], ['b', null]]), [tab('a'), tab('b')], closed)
    expect(unflushedWork(adopted, [tab('a')])).toEqual(unflushed({ closed: ['b'] }))
  })

  it('leaves a kept link unflushed until this document writes it', () => {
    const adopted = withAdopted(
      new Map([['a', null]]),
      [tab('a', 'map-1')],
      unflushed({ relinked: ['a'] }),
    )
    expect(adopted.get('a')).toBeNull()
  })
})
