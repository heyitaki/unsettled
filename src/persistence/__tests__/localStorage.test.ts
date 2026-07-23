// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBoard } from '../../model/board'
import {
  CURRENT_KEY,
  MAPS_CORRUPT_KEY,
  MAPS_KEY,
  autosaveCurrent,
  deleteMap,
  listMaps,
  loadCurrent,
  loadMap,
  markMapOpened,
  renameMap,
  saveMap,
} from '../localStorage'

describe('map persistence', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it.each(['__proto__', 'constructor', '  ', '名前 with spaces'])('stores hostile legal name %j', (name) => {
    expect(saveMap(name, createBoard('standard4'), true).ok).toBe(true)
    expect(loadMap(name)).toMatchObject({ ok: true })
    expect(deleteMap(name).ok).toBe(true)
    expect(Object.getPrototypeOf({})).toBe(Object.prototype)
  })

  it('rejects the empty name and requires overwrite confirmation', () => {
    expect(saveMap('', createBoard('standard4'), true).ok).toBe(false)
    expect(saveMap('map', createBoard('standard4'), false).ok).toBe(true)
    expect(saveMap('map', createBoard('extension6'), false).ok).toBe(false)
    expect(saveMap('map', createBoard('extension6'), true).ok).toBe(true)
  })

  it('backs up a corrupt store and reports invalid entries', () => {
    localStorage.setItem(MAPS_KEY, 'broken')
    expect(listMaps()).toMatchObject({ warning: expect.any(String), maps: [] })
    expect(saveMap('next', createBoard('standard4'), true).ok).toBe(true)
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
    const future = { name: 'future', board: { schemaVersion: 2, payload: 'keep exactly' } }
    const unrelated = { marker: 'also keep exactly' }
    localStorage.setItem(MAPS_KEY, JSON.stringify([future, unrelated]))

    expect(saveMap('new', createBoard('standard4'), true).ok).toBe(true)
    // Only the entry we write gains timestamps; foreign entries stay byte-identical.
    expect(JSON.parse(localStorage.getItem(MAPS_KEY)!)).toEqual([
      future,
      unrelated,
      { name: 'new', board: createBoard('standard4'), createdAt: 1000, modifiedAt: 1000, openedAt: 1000 },
    ])

    expect(deleteMap('new').ok).toBe(true)
    expect(JSON.parse(localStorage.getItem(MAPS_KEY)!)).toEqual([future, unrelated])
  })

  it('can overwrite and delete a named entry with no board field', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    localStorage.setItem(MAPS_KEY, JSON.stringify([{ name: 'bad' }]))

    expect(saveMap('bad', createBoard('standard4'), false).ok).toBe(false)
    expect(JSON.parse(localStorage.getItem(MAPS_KEY)!)).toEqual([{ name: 'bad' }])
    expect(saveMap('bad', createBoard('standard4'), true).ok).toBe(true)
    expect(JSON.parse(localStorage.getItem(MAPS_KEY)!)).toEqual([
      { name: 'bad', board: createBoard('standard4'), createdAt: 1000, modifiedAt: 1000, openedAt: 1000 },
    ])

    localStorage.setItem(MAPS_KEY, JSON.stringify([{ name: 'bad' }]))
    expect(deleteMap('bad').ok).toBe(true)
    expect(JSON.parse(localStorage.getItem(MAPS_KEY)!)).toEqual([])
  })

  it('handles quota failures', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(saveMap('map', createBoard('standard4'), true).ok).toBe(false)
  })

  it('autosaves and restores current board', () => {
    const board = createBoard('extension6')
    expect(autosaveCurrent(board).ok).toBe(true)
    expect(localStorage.getItem(CURRENT_KEY)).not.toBeNull()
    expect(loadCurrent()).toEqual({ ok: true, board })
  })
})

describe('map timestamps and sorting metadata', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('stamps created, modified, and opened on first save and surfaces them in listMaps', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    expect(saveMap('m', createBoard('standard4'), true).ok).toBe(true)
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
    saveMap('m', createBoard('standard4'), true)
    now.mockReturnValue(2000)
    expect(saveMap('m', createBoard('extension6'), true).ok).toBe(true)
    expect(listMaps().maps[0]).toMatchObject({ createdAt: 1000, modifiedAt: 2000, openedAt: 1000 })
  })

  it('markMapOpened updates only openedAt and no-ops safely for unknown names', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    saveMap('m', createBoard('standard4'), true)
    now.mockReturnValue(3000)
    expect(markMapOpened('m').ok).toBe(true)
    expect(listMaps().maps[0]).toMatchObject({ createdAt: 1000, modifiedAt: 1000, openedAt: 3000 })
    // An unknown name is a harmless no-op, not a failure.
    expect(markMapOpened('nope').ok).toBe(true)
  })

  it('renameMap moves an entry, preserving its board and timestamps', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    saveMap('a', createBoard('extension6'), true)
    expect(renameMap('a', 'b').ok).toBe(true)
    expect(loadMap('a')).toMatchObject({ ok: false })
    expect(loadMap('b')).toMatchObject({ ok: true })
    expect(listMaps().maps[0]).toMatchObject({ name: 'b', createdAt: 1000, modifiedAt: 1000, openedAt: 1000 })
  })

  it('renameMap rejects empty targets, missing sources, and collisions', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    saveMap('a', createBoard('standard4'), true)
    saveMap('b', createBoard('standard4'), true)
    expect(renameMap('a', '').ok).toBe(false)
    expect(renameMap('missing', 'x').ok).toBe(false)
    expect(renameMap('a', 'b').ok).toBe(false)
    // A no-op rename to the same name is allowed.
    expect(renameMap('a', 'a').ok).toBe(true)
  })
})
