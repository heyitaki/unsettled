// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addPlayer, createBoard } from '../../model/board'
import { newGame, type Game } from '../../model/game'
import { MAPS_KEY, listMaps, loadMap, saveMap } from '../../persistence/localStorage'
import { saveTab } from '../boardFiles'

const pristine = () => newGame(createBoard('standard4'))

const edited = (id = 'z'): Game =>
  newGame(addPlayer(createBoard('standard4'), { id, name: 'Zed', color: '#3063ba' }))

const savedId = (name: string, game: Game = pristine()): string => {
  const result = saveMap(name, game, true)
  if (!result.ok) throw new Error(result.error)
  return result.id
}

const loaded = (id: string): Game => {
  const result = loadMap(id)
  if (!result.ok) throw new Error(result.errors.join(', '))
  return result.game
}

describe('saveTab', () => {
  beforeEach(() => localStorage.clear())

  it('saves an unlinked tab as a new map under its title', () => {
    const game = edited()
    const result = saveTab({ title: 'Thursday game', game, mapId: null })

    expect(result).toMatchObject({ ok: true, name: 'Thursday game' })
    if (!result.ok) return
    expect(loaded(result.id)).toEqual(game)
  })

  it('writes a linked tab back into its own map, under its own name', () => {
    const mapId = savedId('Thursday game')
    const game = edited()

    const result = saveTab({ title: 'Thursday game', game, mapId })

    // Same entry, not a second one: the link is what a save follows.
    expect(result).toEqual({ ok: true, id: mapId, name: 'Thursday game' })
    expect(listMaps().maps).toHaveLength(1)
    expect(loaded(mapId)).toEqual(game)
  })

  it('never renames the map it writes into', () => {
    // A save is not a rename. Titles and map names are kept in step by the
    // rename paths; a save that also renamed would let any drift between them —
    // a stray space, a rename that landed in another window — quietly move
    // somebody's map to a name they never typed.
    const mapId = savedId('Thursday game ')

    expect(saveTab({ title: 'Thursday game', game: edited(), mapId })).toEqual(
      { ok: true, id: mapId, name: 'Thursday game ' },
    )
    expect(listMaps().maps.map((map) => map.name)).toEqual(['Thursday game '])
  })

  it('leaves another map alone when a linked tab is retitled onto its name', () => {
    savedId('Thursday game')
    const mine = savedId('Friday game')

    expect(saveTab({ title: 'Thursday game', game: edited(), mapId: mine }))
      .toEqual({ ok: true, id: mine, name: 'Friday game' })
    expect(listMaps().maps.map((map) => map.name)).toEqual(['Thursday game', 'Friday game'])
  })

  it('saves beside a name someone else owns rather than overwriting it', () => {
    // Closing a board is not permission to replace a different map that happens
    // to share its title — there is no prompt to answer on the way out.
    const theirs = savedId('Thursday game')
    const game = edited()

    const result = saveTab({ title: 'Thursday game', game, mapId: null })

    expect(result).toMatchObject({ ok: true, name: 'Thursday game (1)' })
    expect(loaded(theirs)).toEqual(pristine())
    if (result.ok) expect(loaded(result.id)).toEqual(game)
  })

  it('dodges a name held by an entry the library cannot address', () => {
    // Named but id-less: written before ids existed and left that way by a
    // failed migration. saveMap still refuses over it, so a save that only
    // consulted the addressable maps would pick a name and then be rejected,
    // leaving the board unsaveable from a close prompt that offers no way out.
    localStorage.setItem(MAPS_KEY, JSON.stringify([{ name: 'Thursday game', game: pristine() }]))
    const game = edited()

    const result = saveTab({ title: 'Thursday game', game, mapId: null })

    expect(result).toMatchObject({ ok: true, name: 'Thursday game (1)' })
    expect(listMaps().maps.map((map) => map.name)).toEqual(['Thursday game', 'Thursday game (1)'])
  })

  it('re-saves a linked tab whose map was deleted, as the only copy left', () => {
    const game = edited()

    const result = saveTab({ title: 'Thursday game', game, mapId: 'deleted-elsewhere' })

    expect(result).toMatchObject({ ok: true, name: 'Thursday game' })
    if (!result.ok) return
    expect(result.id).not.toBe('deleted-elsewhere')
    expect(loaded(result.id)).toEqual(game)
  })

  it('refuses a blank title and reports a failed write', () => {
    expect(saveTab({ title: '   ', game: edited(), mapId: null }))
      .toEqual({ ok: false, error: 'Map name cannot be empty' })

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    try {
      expect(saveTab({ title: 'Thursday game', game: edited(), mapId: null }))
        .toEqual({ ok: false, error: 'QuotaExceededError' })
    } finally {
      setItem.mockRestore()
    }
    expect(localStorage.getItem(MAPS_KEY)).toBeNull()
  })
})
