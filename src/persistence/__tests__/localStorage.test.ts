// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBoard } from '../../model/board'
import { newGame } from '../../model/game'
import type { LayoutId } from '../../model/types'
import {
  MAPS_CORRUPT_KEY,
  MAPS_KEY,
  MAX_MAPS,
  deleteMap,
  listMaps,
  loadMap,
  loadMaps,
  markMapOpened,
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

    // Reset to the no-game shape so the delete half exercises that entry too.
    localStorage.setItem(MAPS_KEY, JSON.stringify([{ id, name: 'bad' }]))
    expect(deleteMap(id).ok).toBe(true)
    expect(JSON.parse(localStorage.getItem(MAPS_KEY)!)).toEqual([])
  })

  it('handles quota failures', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(saveMap('map', game(), true).ok).toBe(false)
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

describe('map cap', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  // `count` maps named m1..m<count>, each stamped a second after the last.
  const fill = (count: number): string[] => {
    const now = vi.spyOn(Date, 'now')
    return Array.from({ length: count }, (_, i) => {
      now.mockReturnValue(1000 * (i + 1))
      return savedId(`m${i + 1}`)
    })
  }

  it('drops the least recently touched map once a new save passes MAX_MAPS, never the one just saved', () => {
    const ids = fill(MAX_MAPS)
    // Looking at the oldest board counts as touching it, so the next one goes instead.
    vi.spyOn(Date, 'now').mockReturnValue(1000 * (MAX_MAPS + 1))
    expect(markMapOpened(ids[0]).ok).toBe(true)
    vi.spyOn(Date, 'now').mockReturnValue(1000 * (MAX_MAPS + 2))
    const result = saveMap('newest', game())
    expect(result).toEqual({ ok: true, id: expect.any(String), evicted: [ids[1]] })
    const names = listMaps().maps.map((map) => map.name)
    expect(names).toHaveLength(MAX_MAPS)
    expect(names).toContain('m1')
    expect(names).not.toContain('m2')
    expect(names).toContain('newest')
  })

  it('never evicts on an overwrite, which cannot grow the library', () => {
    // Seeded past the cap by hand, so an overwrite that evicted would show.
    fill(MAX_MAPS)
    const entries = JSON.parse(localStorage.getItem(MAPS_KEY) as string) as unknown[]
    localStorage.setItem(MAPS_KEY, JSON.stringify([...entries, { id: 'extra', name: 'extra', game: game() }]))
    expect(saveMap('m7', game('extension6'), true)).toEqual({ ok: true, id: expect.any(String) })
    expect(listMaps().maps).toHaveLength(MAX_MAPS + 1)
  })

  it('keeps the map just saved even when the clock has gone backwards', () => {
    // Two documents share one clock; a save stamped earlier than every map
    // in the library must still be the one that stays.
    const ids = fill(MAX_MAPS)
    vi.spyOn(Date, 'now').mockReturnValue(0)
    expect(saveMap('backdated', game())).toEqual({ ok: true, id: expect.any(String), evicted: [ids[0]] })
    expect(listMaps().maps.map((map) => map.name)).toContain('backdated')
  })

  it('never evicts a map the caller asks to keep', () => {
    const ids = fill(MAX_MAPS)
    vi.spyOn(Date, 'now').mockReturnValue(1000 * (MAX_MAPS + 2))
    expect(saveMap('newest', game(), false, new Set([ids[0]]))).toEqual({ ok: true, id: expect.any(String), evicted: [ids[1]] })
  })

  it('drops legacy entries with no stamps before any stamped map', () => {
    // One legacy entry and MAX_MAPS - 2 stamped maps: room for one more, not two.
    fill(MAX_MAPS - 2)
    const entries = JSON.parse(localStorage.getItem(MAPS_KEY) as string) as unknown[]
    // Last in row order, so only its missing stamps can be what picks it.
    localStorage.setItem(MAPS_KEY, JSON.stringify([...entries, { id: 'legacy', name: 'old', board: game().board }]))
    vi.spyOn(Date, 'now').mockReturnValue(1000 * (MAX_MAPS + 5))
    expect(saveMap('fits', game())).toEqual({ ok: true, id: expect.any(String) })
    expect(saveMap('over', game())).toEqual({ ok: true, id: expect.any(String), evicted: ['legacy'] })
    expect(listMaps().maps.map((map) => map.name)).not.toContain('old')
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
