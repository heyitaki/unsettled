import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard } from '../../model/board'
import { newGame, type Game } from '../../model/game'
import type { ParseGameResult } from '../../model/serialization'
import { dirtyTabIds, savedMap, savesInPlace, tabIsDirty } from '../boardFiles'

const pristine = (layout: 'standard4' | 'extension6' = 'standard4') => newGame(createBoard(layout))

const edited = () => {
  const board = createBoard('standard4')
  return newGame(addPlayer(board, { id: 'z', name: 'Zed', color: '#3063ba' }))
}

const unlinked = { linked: false } as const

describe('tabIsDirty', () => {
  it('treats an unlinked tab as clean only while it is a fresh board', () => {
    expect(tabIsDirty(pristine(), unlinked)).toBe(false)
    expect(tabIsDirty(pristine('extension6'), unlinked)).toBe(false)
    expect(tabIsDirty(edited(), unlinked)).toBe(true)
  })

  it('compares a linked tab against its saved map, not against a blank board', () => {
    const game = edited()
    // Matching the library exactly is clean even though the board is far from
    // pristine — the old blank-board comparison called this dirty.
    expect(tabIsDirty(game, { linked: true, game })).toBe(false)
    expect(tabIsDirty(game, { linked: true, game: pristine() })).toBe(true)
  })

  it('treats a linked tab whose map is gone as dirty even when the board is blank', () => {
    // The map was deleted in this or another window, so the tab is the only
    // copy left; closing it silently would throw the board away.
    expect(tabIsDirty(pristine(), { linked: true, game: null })).toBe(true)
    expect(tabIsDirty(edited(), { linked: true, game: null })).toBe(true)
  })

  it('compares by value, not by object identity', () => {
    // Two structurally equal games are the same board; a fresh parse of the
    // saved map must not read as drift just because it is a new object.
    expect(tabIsDirty(edited(), { linked: true, game: edited() })).toBe(false)
  })
})

describe('savedMap', () => {
  it('turns a library lookup into the three states a tab can be in', () => {
    const game = edited()
    expect(savedMap({ ok: true, game })).toEqual({ linked: true, game })
    expect(savedMap({ ok: false, errors: ['gone'] })).toEqual({ linked: true, game: null })
    // No answer means the same as a failed load: not in the library.
    expect(savedMap(undefined)).toEqual({ linked: true, game: null })
  })
})

describe('savesInPlace', () => {
  const maps = [{ id: 'map-1', name: 'Alpha' }, { id: null, name: 'Legacy' }]

  it('is true only for the linked tab writing back to its own map', () => {
    expect(savesInPlace(maps, 'Alpha', 'map-1')).toBe(true)
    // Same map, new name: that is a save-as, so it must go through the prompt.
    expect(savesInPlace(maps, 'Beta', 'map-1')).toBe(false)
    // Same name, someone else's map.
    expect(savesInPlace(maps, 'Alpha', 'map-2')).toBe(false)
  })

  it('never matches an unlinked tab against an entry that has no id', () => {
    // Both sides null would read as "my own map" and overwrite a stranger's
    // map with no confirmation at all.
    expect(savesInPlace(maps, 'Legacy', null)).toBe(false)
    expect(savesInPlace(maps, 'Alpha', null)).toBe(false)
  })
})

describe('dirtyTabIds', () => {
  const tab = (id: string, game: Game, mapId: string | null = null) => ({ id, game, mapId })

  it('picks out exactly the tabs holding unsaved work', () => {
    const drifted = edited()
    const tabs = [
      tab('clean-unlinked', pristine()),
      tab('edited-unlinked', drifted),
      tab('clean-linked', drifted, 'map-1'),
      tab('drifted-linked', drifted, 'map-2'),
      tab('orphaned-linked', pristine(), 'map-3'),
    ]
    const saved = new Map<string, ParseGameResult>([
      ['map-1', { ok: true, game: drifted }],
      ['map-2', { ok: true, game: pristine() }],
      ['map-3', { ok: false, errors: ['gone'] }],
    ])
    expect(dirtyTabIds(tabs, saved)).toEqual(
      new Set(['edited-unlinked', 'drifted-linked', 'orphaned-linked']),
    )
  })

  it('treats a link with no answer as a map that is no longer there', () => {
    const tabs = [tab('t1', pristine(), 'map-1')]
    expect(dirtyTabIds(tabs, new Map())).toEqual(new Set(['t1']))
  })
})
