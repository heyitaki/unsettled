// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createBoard } from '../../model/board'
import { setTile } from '../../model/__tests__/helpers'
import { newGame } from '../../model/game'
import { listMaps, loadMap, MAPS_KEY, saveMap } from '../../persistence/localStorage'
import { createLibraryAutosave } from '../libraryAutosave'
import type { TabState } from '../store'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('keeps a failed closing save available for export and a later retry', () => {
  vi.useFakeTimers()
  localStorage.clear()
  const blank: TabState = {
    id: 'closing', title: 'Closing', game: newGame(createBoard('standard4')),
    past: [], future: [], activePlayerId: 'aki', mapId: null,
  }
  const edited = { ...blank, game: newGame(setTile(blank.game.board, { q: 0, r: 0 }, 'wheat', 6)) }
  const report = vi.fn()
  const autosave = createLibraryAutosave(vi.fn(), [blank], 500, report)
  const write = Storage.prototype.setItem
  const failing = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === MAPS_KEY) throw new Error('Quota exceeded')
    write.call(this, key, value)
  })
  try {
    autosave.arm([edited])
    autosave.arm([])
    expect(report).toHaveBeenLastCalledWith('library:closing', expect.objectContaining({
      tab: expect.objectContaining({ game: edited.game }),
    }))
    expect(listMaps().maps).toEqual([])
    failing.mockRestore()
    autosave.flush()
    const saved = listMaps().maps
    expect(saved).toHaveLength(1)
    expect(loadMap(saved[0].id!)).toEqual({ ok: true, game: edited.game })
    expect(report).toHaveBeenLastCalledWith('library:closing', null)
  } finally { autosave.dispose() }
})

it('keeps a closed rescue as a separate board once another tab has saved the same map', () => {
  vi.useFakeTimers()
  localStorage.clear()
  const game = newGame(createBoard('standard4'))
  const saved = saveMap('Map', game)
  if (!saved.ok) throw new Error(saved.error)
  const linked: TabState = { id: 'first', title: 'Map', game, past: [], future: [], activePlayerId: 'aki', mapId: saved.id }
  const stale = { ...linked, game: newGame(setTile(game.board, { q: 0, r: 0 }, 'wheat', 6)) }
  const report = vi.fn()
  const autosave = createLibraryAutosave(vi.fn(), [linked], 500, report)
  const write = Storage.prototype.setItem
  const failing = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === MAPS_KEY) throw new Error('Quota exceeded')
    write.call(this, key, value)
  })
  try {
    autosave.arm([stale])
    autosave.arm([])
    expect(report).toHaveBeenLastCalledWith('library:first', expect.objectContaining({ message: expect.stringContaining('Quota') }))
    failing.mockRestore()
    const reopened = { ...linked, id: 'second' }
    const newer = { ...reopened, game: newGame(setTile(game.board, { q: 0, r: 0 }, 'ore', 8)) }
    autosave.arm([reopened])
    autosave.arm([newer])
    vi.advanceTimersByTime(500)
    expect(loadMap(saved.id)).toEqual({ ok: true, game: newer.game })
    expect(report).toHaveBeenLastCalledWith('library:first', expect.objectContaining({
      message: expect.stringContaining('separate board'), tab: expect.not.objectContaining({ mapId: expect.anything() }),
    }))
    autosave.flush()
    expect(loadMap(saved.id)).toEqual({ ok: true, game: newer.game })
    const maps = listMaps().maps
    expect(maps.map((map) => map.name)).toEqual(['Map', 'Map (1)'])
    expect(loadMap(maps[1].id!)).toEqual({ ok: true, game: stale.game })
    expect(report).toHaveBeenLastCalledWith('library:first', null)
  } finally { autosave.dispose() }
})
