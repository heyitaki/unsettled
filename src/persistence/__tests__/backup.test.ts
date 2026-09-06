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
    const blob = createLibraryBackup([
      { id: 't1', title: 'Saved', game: edited, mapId: saved.id },
      { id: 't2', title: 'Unsaved', game },
    ])
    localStorage.clear()
    expect(restoreLibraryBackup(blob)).toMatchObject({ ok: true, count: 2 })
    const maps = listMaps().maps
    expect(maps.map((map) => map.name)).toEqual(['Saved', 'Unsaved'])
    expect(loadMap(maps[0].id!)).toEqual({ ok: true, game: edited })
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
    const blob = createLibraryBackup([{ id: 'new', title: 'Extra', game }])
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
    const blob = createLibraryBackup([{ id: 'new', title: 'New', game }])
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded') })
    try {
      expect(restoreLibraryBackup(blob)).toEqual({ ok: false, error: 'Quota exceeded' })
      expect(localStorage.getItem(MAPS_KEY)).toBeNull()
    } finally { write.mockRestore() }
  })
})
