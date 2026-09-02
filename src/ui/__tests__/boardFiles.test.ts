import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard } from '../../model/board'
import { newGame } from '../../model/game'
import { copyTitle, inPlaceTarget, savedMap, tabIsDirty } from '../boardFiles'

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

describe('copyTitle', () => {
  it('names a copy after its source, skipping titles already on the strip', () => {
    expect(copyTitle('Board 1', new Set(['Board 1']))).toBe('Board 1 (1)')
    expect(copyTitle('Board 1', new Set(['Board 1', 'Board 1 (1)']))).toBe('Board 1 (2)')
  })

  it('counts up from an existing copy rather than nesting suffixes', () => {
    // Duplicating a duplicate is "Board 1 (2)", not "Board 1 (1) (1)".
    expect(copyTitle('Board 1 (1)', new Set(['Board 1', 'Board 1 (1)']))).toBe('Board 1 (2)')
    expect(copyTitle('Board 1 (2)', new Set(['Board 1 (2)']))).toBe('Board 1 (1)')
  })

  it('only strips a suffix that is exactly a trailing copy number', () => {
    expect(copyTitle('Game (ben)', new Set())).toBe('Game (ben) (1)')
    expect(copyTitle('Round (2) rematch', new Set())).toBe('Round (2) rematch (1)')
    // No leading space, so this is a name in its own right, not a copy suffix.
    expect(copyTitle('(1)', new Set())).toBe('(1) (1)')
    // A title that is *only* a suffix has no base to count up from, so it keeps
    // the whole thing — stripping would leave nothing to name the copy after.
    expect(copyTitle(' (1)', new Set())).toBe(' (1) (1)')
  })
})
