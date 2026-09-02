// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBoard } from '../../model/board'
import { newGame } from '../../model/game'
import { MAPS_KEY, listMaps, saveMap } from '../../persistence/localStorage'
import { renameTab } from '../useRenameTab'
import type { StoreAction, TabState } from '../store'

const savedId = (name: string): string => {
  const result = saveMap(name, newGame(createBoard('standard4')), true)
  if (!result.ok) throw new Error(result.error)
  return result.id
}

const tab = (title: string, mapId: string | null = null): TabState => ({
  id: `tab:${title}`,
  title,
  game: newGame(createBoard('standard4')),
  past: [],
  future: [],
  activePlayerId: null,
  mapId,
})

const types = (dispatch: ReturnType<typeof vi.fn<(action: StoreAction) => void>>) =>
  dispatch.mock.calls.map(([action]) => action.type)

describe('renameTab', () => {
  beforeEach(() => localStorage.clear())

  it('keeps the title on a blank entry and dispatches nothing', () => {
    const dispatch = vi.fn<(action: StoreAction) => void>()
    expect(renameTab(tab('Board 1'), '   ', dispatch)).toBe('Board 1')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('renames an unlinked tab without touching the library', () => {
    const dispatch = vi.fn<(action: StoreAction) => void>()
    expect(renameTab(tab('Board 1'), ' Thursday ', dispatch)).toBe('Thursday')
    expect(dispatch).toHaveBeenCalledWith({ type: 'tab-rename', id: 'tab:Board 1', title: 'Thursday' })
    expect(types(dispatch)).toEqual(['tab-rename'])
  })

  it('renames the linked map first, then refreshes the library and the tab', () => {
    const mapId = savedId('Old')
    const dispatch = vi.fn<(action: StoreAction) => void>()
    expect(renameTab(tab('Old', mapId), 'New', dispatch)).toBe('New')
    expect(listMaps().maps.map((map) => map.name)).toEqual(['New'])
    expect(types(dispatch)).toEqual(['maps-changed', 'tab-rename'])
  })

  it('refuses a name another map already holds, with a notice and no tab change', () => {
    const mapId = savedId('Old')
    savedId('Taken')
    const dispatch = vi.fn<(action: StoreAction) => void>()
    expect(renameTab(tab('Old', mapId), 'Taken', dispatch)).toBeNull()
    expect(types(dispatch)).toEqual(['notice'])
    expect(listMaps().maps.map((map) => map.name)).toEqual(['Old', 'Taken'])
  })

  it('tolerates a linked map deleted in another window', () => {
    const mapId = savedId('Old')
    localStorage.removeItem(MAPS_KEY)
    const dispatch = vi.fn<(action: StoreAction) => void>()
    expect(renameTab(tab('Old', mapId), 'New', dispatch)).toBe('New')
    expect(types(dispatch)).toEqual(['maps-changed', 'tab-rename'])
  })
})
