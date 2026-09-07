// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBoard, setTile } from '../../model/board'
import { newGame } from '../../model/game'
import { createLibraryBackup, restoreLibraryBackup } from '../backup'
import { MAPS_KEY, MAX_MAPS, listMaps, loadMap, saveMap } from '../localStorage'

const game = newGame(createBoard('standard4'))
beforeEach(() => localStorage.clear())

describe('library backup', () => {
  it('exports saved maps plus the latest unsaved edits and unlinked boards', () => {
    const saved = saveMap('Saved', game)
    if (!saved.ok) throw new Error(saved.error)
    const edited = newGame(setTile(game.board, { q: 0, r: 0 }, 'wheat', 6))
    const unsaved = newGame(setTile(game.board, { q: 1, r: 0 }, 'ore', 8))
    const blob = createLibraryBackup([
      { id: 't1', title: 'Saved', game: edited, mapId: saved.id },
      { id: 't2', title: 'Unsaved', game: unsaved },
    ])
    localStorage.clear()
    expect(restoreLibraryBackup(blob)).toMatchObject({ ok: true, count: 2 })
    const maps = listMaps().maps
    expect(maps.map((map) => map.name)).toEqual(['Saved', 'Unsaved'])
    expect(loadMap(maps[0].id!)).toEqual({ ok: true, game: edited })
    expect(loadMap(maps[1].id!)).toEqual({ ok: true, game: unsaved })
  })

  it('leaves blank unsaved boards out, so a library at the cap still restores', () => {
    localStorage.setItem(MAPS_KEY, JSON.stringify(Array.from({ length: MAX_MAPS }, (_, i) => ({ id: `m${i}`, name: `Map ${i}`, game }))))
    const blob = createLibraryBackup([{ id: 'fresh', title: 'Board 2', game }])
    expect(JSON.parse(blob).maps).toHaveLength(MAX_MAPS)
    localStorage.clear()
    expect(restoreLibraryBackup(blob)).toEqual({ ok: true, count: MAX_MAPS })
  })

  it('skips content the library already holds under any id, so a repeated restore adds nothing', () => {
    const saved = saveMap('Original', game)
    if (!saved.ok) throw new Error(saved.error)
    const blob = createLibraryBackup([])
    saveMap('Original', newGame(setTile(game.board, { q: 0, r: 0 }, 'wheat', 6)), true)
    expect(restoreLibraryBackup(blob)).toMatchObject({ ok: true, count: 1 })
    expect(restoreLibraryBackup(blob)).toMatchObject({ ok: true, count: 0 })
    expect(listMaps().maps.map((map) => map.name)).toEqual(['Original', 'Original (1)'])
  })

  it('restores a board whose content sits under a hand-picked name that merely starts alike', () => {
    saveMap('Layout (final)', game)
    const blob = createLibraryBackup([{ id: 'other', title: 'Layout', game, mapId: 'other' }])
    expect(restoreLibraryBackup(blob)).toMatchObject({ ok: true, count: 1 })
    expect(listMaps().maps.map((map) => map.name)).toEqual(['Layout (final)', 'Layout'])
  })

  it('says when the backup itself is too large for the library', () => {
    const blob = JSON.stringify({ format: 'unsettled-library', version: 1, maps: Array.from({ length: MAX_MAPS + 1 }, (_, i) => ({
      id: `m${i}`, name: `Map ${i}`, game: newGame(setTile(game.board, { q: 0, r: 0 }, 'wheat', [2, 3, 4, 5, 6, 8, 9, 10, 11, 12][i % 10])),
    })), recovery: {} })
    expect(restoreLibraryBackup(blob)).toEqual({ ok: false, error: `This backup holds ${MAX_MAPS + 1} new boards and the library holds at most ${MAX_MAPS}` })
    expect(localStorage.getItem(MAPS_KEY)).toBeNull()
  })

  it('names the unreadable library when it refuses a restore', () => {
    localStorage.setItem(MAPS_KEY, '{broken')
    expect(restoreLibraryBackup(createLibraryBackup([]))).toEqual({
      ok: false, error: 'Export and recover the unreadable library before restoring a backup',
    })
  })

  it('merges without overwriting existing boards and is idempotent for unchanged imports', () => {
    saveMap('Game', game)
    const blob = createLibraryBackup([])
    localStorage.clear()
    const other = newGame(createBoard('extension6'))
    saveMap('Game', other)
    expect(restoreLibraryBackup(blob)).toMatchObject({ ok: true, count: 1 })
    expect(listMaps().maps.map((map) => map.name)).toEqual(['Game', 'Game (1)'])
    expect(restoreLibraryBackup(blob)).toMatchObject({ ok: true, count: 0 })
  })

  it('validates every board before writing anything', () => {
    saveMap('Keep', game)
    const before = localStorage.getItem(MAPS_KEY)
    const backup = JSON.parse(createLibraryBackup([]))
    backup.maps.push({ id: 'bad', name: 'Broken', game: {} })
    expect(restoreLibraryBackup(backup)).toMatchObject({ ok: false })
    expect(localStorage.getItem(MAPS_KEY)).toBe(before)
  })

  it('refuses a restore over the library cap without evicting existing boards', () => {
    const extra = newGame(setTile(game.board, { q: 0, r: 0 }, 'wheat', 6))
    const blob = createLibraryBackup([{ id: 'new', title: 'Extra', game: extra }])
    localStorage.setItem(MAPS_KEY, JSON.stringify(Array.from({ length: MAX_MAPS }, (_, i) => ({ id: `m${i}`, name: `Map ${i}`, game }))))
    const before = localStorage.getItem(MAPS_KEY)
    expect(restoreLibraryBackup(blob)).toMatchObject({ ok: false })
    expect(localStorage.getItem(MAPS_KEY)).toBe(before)
  })

  it('preserves unreadable data in the exported file and refuses to overwrite a corrupt library on restore', () => {
    localStorage.setItem(MAPS_KEY, '{broken')
    const blob = createLibraryBackup([{ id: 'open', title: 'Open', game }])
    expect(JSON.parse(blob).recovery[MAPS_KEY]).toBe('{broken')
    expect(restoreLibraryBackup(blob)).toMatchObject({ ok: false })
    expect(localStorage.getItem(MAPS_KEY)).toBe('{broken')
  })

  it('reports quota failure without partially restoring', () => {
    const blob = createLibraryBackup([{ id: 'new', title: 'New', game: newGame(setTile(game.board, { q: 0, r: 0 }, 'wheat', 6)) }])
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded') })
    try {
      expect(restoreLibraryBackup(blob)).toEqual({ ok: false, error: 'Quota exceeded' })
      expect(localStorage.getItem(MAPS_KEY)).toBeNull()
    } finally { write.mockRestore() }
  })
})
