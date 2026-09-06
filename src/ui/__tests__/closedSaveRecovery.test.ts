// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createBoard, setTile } from '../../model/board'
import { newGame } from '../../model/game'
import { listMaps, loadMap, MAPS_KEY } from '../../persistence/localStorage'
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
