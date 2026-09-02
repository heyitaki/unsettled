import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard } from '../../model/board'
import { newGame } from '../../model/game'
import { firstFreeName, inPlaceTarget, savedMap, tabIsDirty } from '../boardFiles'

const pristine = (layout: 'standard4' | 'extension6' = 'standard4') => newGame(createBoard(layout))

const edited = () => {
  const board = createBoard('standard4')
  return newGame(addPlayer(board, { id: 'z', name: 'Zed', color: '#3063ba' }))
}

const unlinked = { linked: false } as const

describe('firstFreeName', () => {
  it('keeps the base name when nothing has claimed it', () => {
    expect(firstFreeName('Thursday game', new Set())).toBe('Thursday game')
    expect(firstFreeName('Thursday game', new Set(['Friday game']))).toBe('Thursday game')
  })

  it('counts past every suffix already taken', () => {
    expect(firstFreeName('Board', new Set(['Board']))).toBe('Board (1)')
    expect(firstFreeName('Board', new Set(['Board', 'Board (1)']))).toBe('Board (2)')
    // A gap in the run is still a free name: the count stops at the first one.
    expect(firstFreeName('Board', new Set(['Board', 'Board (2)']))).toBe('Board (1)')
  })
})

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

describe('inPlaceTarget', () => {
  const maps = [{ id: 'map-1', name: 'Alpha' }, { id: null, name: 'Legacy' }]

  it('resolves the linked tab to its own map under the map’s current name', () => {
    // The tab's title can be a rename behind the library. Saving under the
    // stale name would miss the map by name and fork it into a second entry;
    // the link says which map this is, and the library says what it is called.
    expect(inPlaceTarget(maps, 'map-1')).toEqual({ id: 'map-1', name: 'Alpha' })
  })

  it('never matches an unlinked tab against an entry that has no id', () => {
    // Both sides null would read as "my own map" and overwrite a stranger's
    // map with no confirmation at all.
    expect(inPlaceTarget(maps, null)).toBeNull()
  })

  it('resolves nothing when the link points at a map that is gone', () => {
    expect(inPlaceTarget(maps, 'deleted')).toBeNull()
  })
})
