// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  saveMap,
} from '../localStorage'

describe('map persistence', () => {
  beforeEach(() => localStorage.clear())

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

  it('preserves future-schema entries during unrelated saves and deletes', () => {
    const future = { name: 'future', board: { schemaVersion: 2, payload: 'keep exactly' } }
    const unrelated = { marker: 'also keep exactly' }
    localStorage.setItem(MAPS_KEY, JSON.stringify([future, unrelated]))

    expect(saveMap('new', createBoard('standard4'), true).ok).toBe(true)
    expect(JSON.parse(localStorage.getItem(MAPS_KEY)!)).toEqual([
      future,
      unrelated,
      { name: 'new', board: createBoard('standard4') },
    ])

    expect(deleteMap('new').ok).toBe(true)
    expect(JSON.parse(localStorage.getItem(MAPS_KEY)!)).toEqual([future, unrelated])
  })

  it('can overwrite and delete a named entry with no board field', () => {
    localStorage.setItem(MAPS_KEY, JSON.stringify([{ name: 'bad' }]))

    expect(saveMap('bad', createBoard('standard4'), false).ok).toBe(false)
    expect(JSON.parse(localStorage.getItem(MAPS_KEY)!)).toEqual([{ name: 'bad' }])
    expect(saveMap('bad', createBoard('standard4'), true).ok).toBe(true)
    expect(JSON.parse(localStorage.getItem(MAPS_KEY)!)).toEqual([
      { name: 'bad', board: createBoard('standard4') },
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
    vi.restoreAllMocks()
  })

  it('autosaves and restores current board', () => {
    const board = createBoard('extension6')
    expect(autosaveCurrent(board).ok).toBe(true)
    expect(localStorage.getItem(CURRENT_KEY)).not.toBeNull()
    expect(loadCurrent()).toEqual({ ok: true, board })
  })
})
