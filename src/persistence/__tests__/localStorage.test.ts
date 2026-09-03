// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBoard } from '../../model/board'
import { newGame } from '../../model/game'
import type { LayoutId } from '../../model/types'
import {
  CURRENT_KEY,
  MAPS_CORRUPT_KEY,
  MAPS_KEY,
  autosaveCurrent,
  deleteMap,
  listMaps,
  loadCurrent,
  loadMap,
  loadMaps,
  markMapOpened,
  migrateMapIds,
  renameMap,
  saveMap,
  updateMap,
} from '../localStorage'

const game = (layout: LayoutId = 'standard4') => newGame(createBoard(layout))

// Most tests address a map by the id its save returned; this keeps that terse.
function savedId(name: string, layout: LayoutId = 'standard4'): string {
  const result = saveMap(name, game(layout), true)
  if (!result.ok) throw new Error(result.error)
  return result.id
}

describe('map persistence', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it.each(['__proto__', 'constructor', '  ', '名前 with spaces'])('stores hostile legal name %j', (name) => {
    const id = savedId(name)
    expect(loadMap(id)).toMatchObject({ ok: true })
    expect(deleteMap(id).ok).toBe(true)
    expect(Object.getPrototypeOf({})).toBe(Object.prototype)
  })

  it('rejects the empty name and requires overwrite confirmation', () => {
    expect(saveMap('', game(), true).ok).toBe(false)
    expect(saveMap('map', game(), false).ok).toBe(true)
    expect(saveMap('map', game('extension6'), false).ok).toBe(false)
    expect(saveMap('map', game('extension6'), true).ok).toBe(true)
  })

  it('loads a legacy entry holding a bare board as a zero-stat game', () => {
    const board = createBoard('standard4')
    localStorage.setItem(MAPS_KEY, JSON.stringify([{ name: 'legacy', board }]))
    expect(migrateMapIds().ok).toBe(true)
    const listed = listMaps().maps[0]
    expect(listed).toMatchObject({ name: 'legacy', valid: true, id: expect.any(String) })
    expect(loadMap(listed.id!)).toEqual({ ok: true, game: newGame(board) })
  })

  it('backs up a corrupt store and reports invalid entries', () => {
    localStorage.setItem(MAPS_KEY, 'broken')
    expect(listMaps()).toMatchObject({ warning: expect.any(String), maps: [] })
    expect(saveMap('next', game(), true).ok).toBe(true)
    expect(localStorage.getItem(MAPS_CORRUPT_KEY)).toBe('broken')
    localStorage.setItem(MAPS_KEY, JSON.stringify([{ name: 'bad', board: { schemaVersion: 9 } }]))
    expect(listMaps().maps[0].valid).toBe(false)
  })

  it('flags fabricated placeholder names as synthetic but keeps real stored names addressable', () => {
    localStorage.setItem(MAPS_KEY, JSON.stringify([42, { name: 'bad', board: { schemaVersion: 9 } }]))
    const [placeholder, named] = listMaps().maps
    // A non-object entry gets a synthetic label that saveMap cannot address.
    expect(placeholder).toMatchObject({ name: 'Invalid map 1', synthetic: true })
    // A real (if invalid) stored name is not synthetic — saveMap would overwrite it.
    expect(named.name).toBe('bad')
    expect(named.synthetic).toBeUndefined()
  })

  it('preserves future-schema entries during unrelated saves and deletes', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    const future = { name: 'future', game: { schemaVersion: 2, payload: 'keep exactly' } }
    const unrelated = { marker: 'also keep exactly' }
    localStorage.setItem(MAPS_KEY, JSON.stringify([future, unrelated]))

    const id = savedId('new')
    // Only the entry we write gains an id and timestamps; foreign entries stay
    // byte-identical, so an unrelated save never rewrites what it can't parse.
    expect(JSON.parse(localStorage.getItem(MAPS_KEY)!)).toEqual([
      future,
      unrelated,
      { id, name: 'new', game: game(), createdAt: 1000, modifiedAt: 1000, openedAt: 1000 },
    ])

    expect(deleteMap(id).ok).toBe(true)
    expect(JSON.parse(localStorage.getItem(MAPS_KEY)!)).toEqual([future, unrelated])
  })

  it('can overwrite and delete a named entry with no game field', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    localStorage.setItem(MAPS_KEY, JSON.stringify([{ name: 'bad' }]))

    expect(saveMap('bad', game(), false).ok).toBe(false)
    expect(JSON.parse(localStorage.getItem(MAPS_KEY)!)).toEqual([{ name: 'bad' }])
    const id = savedId('bad')
    expect(JSON.parse(localStorage.getItem(MAPS_KEY)!)).toEqual([
      { id, name: 'bad', game: game(), createdAt: 1000, modifiedAt: 1000, openedAt: 1000 },
    ])

    // Reset to the no-game shape so the delete half exercises that entry too,
    // routed through the migration because deleteMap is id-addressed.
    localStorage.setItem(MAPS_KEY, JSON.stringify([{ name: 'bad' }]))
    expect(migrateMapIds().ok).toBe(true)
    expect(deleteMap(listMaps().maps[0].id!).ok).toBe(true)
    expect(JSON.parse(localStorage.getItem(MAPS_KEY)!)).toEqual([])
  })

  it('handles quota failures', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(saveMap('map', game(), true).ok).toBe(false)
  })

  it('autosaves and restores the current game', () => {
    const current = game('extension6')
    expect(autosaveCurrent(current).ok).toBe(true)
    expect(localStorage.getItem(CURRENT_KEY)).not.toBeNull()
    expect(loadCurrent()).toEqual({ ok: true, game: current })
  })
})

describe('map timestamps and sorting metadata', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('stamps created, modified, and opened on first save and surfaces them in listMaps', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    expect(saveMap('m', game(), true).ok).toBe(true)
    expect(listMaps().maps[0]).toMatchObject({
      name: 'm',
      valid: true,
      createdAt: 1000,
      modifiedAt: 1000,
      openedAt: 1000,
    })
  })

  it('preserves createdAt and openedAt but bumps modifiedAt on overwrite', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    saveMap('m', game(), true)
    now.mockReturnValue(2000)
    expect(saveMap('m', game('extension6'), true).ok).toBe(true)
    expect(listMaps().maps[0]).toMatchObject({ createdAt: 1000, modifiedAt: 2000, openedAt: 1000 })
  })

  it('markMapOpened updates only openedAt and no-ops safely for unknown ids', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const id = savedId('m')
    now.mockReturnValue(3000)
    expect(markMapOpened(id).ok).toBe(true)
    expect(listMaps().maps[0]).toMatchObject({ createdAt: 1000, modifiedAt: 1000, openedAt: 3000 })
    // An unknown id is a harmless no-op, not a failure.
    expect(markMapOpened('nope').ok).toBe(true)
  })

  it('renameMap moves an entry, preserving its id, game, and timestamps', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    const id = savedId('a', 'extension6')
    expect(renameMap(id, 'b').ok).toBe(true)
    // The id is the identity: it survives the rename, and the map stays loadable
    // under it. This is what keeps a linked tab attached across a rename.
    expect(loadMap(id)).toMatchObject({ ok: true })
    expect(listMaps().maps[0]).toMatchObject({ id, name: 'b', createdAt: 1000, modifiedAt: 1000, openedAt: 1000 })
  })

  it('renameMap rejects empty targets, missing sources, and collisions', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    const a = savedId('a')
    savedId('b')
    expect(renameMap(a, '').ok).toBe(false)
    expect(renameMap('missing', 'x').ok).toBe(false)
    expect(renameMap(a, 'b').ok).toBe(false)
    // A no-op rename to the same name is allowed.
    expect(renameMap(a, 'a').ok).toBe(true)
  })
})

describe('map identity', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('keeps a map addressable by id across renames and overwrites', () => {
    const id = savedId('first')
    expect(renameMap(id, 'second').ok).toBe(true)
    // Saving over the renamed map reuses its id rather than minting a new one,
    // so a tab linked before the overwrite stays linked after it.
    expect(saveMap('second', game('extension6'), true)).toEqual({ ok: true, id })
    expect(loadMap(id)).toMatchObject({ ok: true, game: game('extension6') })
  })

  it('gives distinct maps distinct ids, including a delete-then-recreate', () => {
    const first = savedId('m')
    expect(deleteMap(first).ok).toBe(true)
    // Same name, different map: the recreated entry must not inherit the old id,
    // or a tab linked to the deleted map would silently re-attach to this one.
    const second = savedId('m')
    expect(second).not.toBe(first)
    expect(loadMap(first)).toMatchObject({ ok: false })
  })

  it('migrateMapIds stamps ids on named legacy entries and leaves the rest alone', () => {
    const board = createBoard('standard4')
    const junk = 42
    const unnamed = { marker: 'keep exactly' }
    localStorage.setItem(MAPS_KEY, JSON.stringify([{ name: 'legacy', board }, junk, unnamed]))

    expect(migrateMapIds().ok).toBe(true)
    const stored = JSON.parse(localStorage.getItem(MAPS_KEY)!)
    expect(stored[0]).toEqual({ id: expect.any(String), name: 'legacy', board })
    // Entries with no name are unaddressable, so they gain nothing.
    expect(stored[1]).toBe(junk)
    expect(stored[2]).toEqual(unnamed)
  })

  it('migrateMapIds is idempotent and does not rewrite an already-migrated store', () => {
    savedId('m')
    const before = localStorage.getItem(MAPS_KEY)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    expect(migrateMapIds().ok).toBe(true)
    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage.getItem(MAPS_KEY)).toBe(before)
  })

  it('migrateMapIds replaces a non-string id rather than keeping it', () => {
    const board = createBoard('standard4')
    localStorage.setItem(MAPS_KEY, JSON.stringify([{ id: 42, name: 'legacy', board }]))

    expect(migrateMapIds().ok).toBe(true)
    const id = listMaps().maps[0].id
    expect(typeof id).toBe('string')
    expect(loadMap(id!)).toEqual({ ok: true, game: newGame(board) })
    expect(JSON.parse(localStorage.getItem(MAPS_KEY)!)).toEqual([{ id, name: 'legacy', board }])

    // A kept-bad id would leave the entry unaddressable and mark the store dirty
    // on every launch, rewriting the whole blob forever.
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    expect(migrateMapIds().ok).toBe(true)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('migrateMapIds leaves the store untouched when the write fails', () => {
    localStorage.setItem(MAPS_KEY, JSON.stringify([{ name: 'legacy', board: createBoard('standard4') }]))
    const before = localStorage.getItem(MAPS_KEY)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    expect(migrateMapIds()).toMatchObject({ ok: false, error: expect.any(String) })
    expect(localStorage.getItem(MAPS_KEY)).toBe(before)
  })

  it('loadMaps answers for every id it is given, in one pass', () => {
    const first = savedId('a')
    const second = savedId('b', 'extension6')
    const reads = vi.spyOn(Storage.prototype, 'getItem')

    const loaded = loadMaps([first, second, 'gone'])
    expect(loaded.get(first)).toEqual({ ok: true, game: game() })
    expect(loaded.get(second)).toEqual({ ok: true, game: game('extension6') })
    // A deleted map is reported, not omitted: the autosave must be able to
    // tell "no longer saved" apart from "not linked".
    expect(loaded.get('gone')).toMatchObject({ ok: false })
    // Three ids, one read of the blob.
    expect(reads).toHaveBeenCalledTimes(1)
  })

  it('loadMaps resolves a duplicated id to the first entry, like loadMap', () => {
    const id = 'shared'
    localStorage.setItem(MAPS_KEY, JSON.stringify([
      { id, name: 'first', game: game() },
      { id, name: 'second', game: game('extension6') },
    ]))
    // Duplicate ids can only arrive by hand-edit, but both readers must agree on
    // which entry wins or a tab would load a different map than the library shows.
    expect(loadMaps([id]).get(id)).toEqual({ ok: true, game: game() })
    expect(loadMaps([id]).get(id)).toEqual(loadMap(id))
  })

  it('loadMaps touches storage at all only when asked for something', () => {
    const reads = vi.spyOn(Storage.prototype, 'getItem')
    expect(loadMaps([]).size).toBe(0)
    expect(reads).not.toHaveBeenCalled()
  })

  it('lists unaddressable entries with a null id', () => {
    localStorage.setItem(MAPS_KEY, JSON.stringify([42]))
    expect(listMaps().maps[0]).toMatchObject({ id: null, synthetic: true })
  })

  it('listMaps validates the library once per blob, not once per listing', () => {
    const id = savedId('a')
    const first = listMaps()
    // The rows are the same objects until storage changes: the library panel
    // re-lists after every autosave, and parsing each stored board again for an
    // unchanged blob would re-validate the whole library per edit burst.
    expect(listMaps()).toBe(first)
    expect(updateMap(id, 'a', game('extension6')).ok).toBe(true)
    const second = listMaps()
    expect(second).not.toBe(first)
    expect(second.maps[0]).toMatchObject({ id, valid: true })
    // Another document rewriting the key by hand is a change too.
    localStorage.setItem(MAPS_KEY, JSON.stringify([42]))
    expect(listMaps().maps[0]).toMatchObject({ id: null, synthetic: true })
  })

  it('migrateMapIds re-mints a repeated id so two rows stop sharing an identity', () => {
    const board = createBoard('standard4')
    localStorage.setItem(MAPS_KEY, JSON.stringify([
      { id: 'shared', name: 'first', board },
      { id: 'shared', name: 'second', board },
      { id: '', name: 'blank id', board },
    ]))

    expect(migrateMapIds().ok).toBe(true)
    const ids = listMaps().maps.map((map) => map.id)
    // The first claimant keeps the id; every later one is a distinct map that
    // would otherwise open — and be deleted — as the first.
    expect(ids[0]).toBe('shared')
    expect(new Set(ids).size).toBe(3)
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
  })

  it('deletes one row even when the store repeats an id', () => {
    localStorage.setItem(MAPS_KEY, JSON.stringify([
      { id: 'shared', name: 'first', game: game() },
      { id: 'shared', name: 'second', game: game('extension6') },
    ]))
    expect(deleteMap('shared').ok).toBe(true)
    // Filtering by id would have taken both: deleting one map must never
    // silently delete another.
    expect(listMaps().maps.map((map) => map.name)).toEqual(['second'])
  })
})

describe('updateMap', () => {
  beforeEach(() => localStorage.clear())

  it('writes into the map with this id whatever it is now called', () => {
    const id = savedId('Old')
    // The rename stands in for another window's: a name-addressed save would
    // miss the map and fork a second "Old" beside it.
    expect(renameMap(id, 'New').ok).toBe(true)
    expect(updateMap(id, 'New', game('extension6'))).toEqual({ ok: true, id })
    expect(listMaps().maps.map((map) => map.name)).toEqual(['New'])
    expect(loadMap(id)).toEqual({ ok: true, game: game('extension6') })
  })

  it('renames the map when the save carries a new name', () => {
    const id = savedId('Old')
    expect(updateMap(id, 'Renamed', game()).ok).toBe(true)
    expect(listMaps().maps[0]).toMatchObject({ id, name: 'Renamed' })
  })

  it('keeps createdAt and refuses a name another map already holds', () => {
    const id = savedId('a')
    savedId('b')
    const createdAt = listMaps().maps[0].createdAt
    expect(updateMap(id, 'b', game())).toMatchObject({ ok: false })
    expect(updateMap(id, 'a', game('extension6')).ok).toBe(true)
    expect(listMaps().maps[0].createdAt).toBe(createdAt)
  })

  it('reports a map that is no longer there rather than recreating it', () => {
    const id = savedId('a')
    expect(deleteMap(id).ok).toBe(true)
    expect(updateMap(id, 'a', game())).toMatchObject({ ok: false })
    expect(listMaps().maps).toEqual([])
  })
})
