// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { addPlayer, createBoard } from '../../model/board'
import { newGame, type Game } from '../../model/game'
import { MAPS_KEY, readLibrary, saveMap } from '../../persistence/localStorage'
import { adoptLegacyLinks, type TabState } from '../store'

const pristine = () => newGame(createBoard('standard4'))

const edited = (): Game => {
  const board = createBoard('standard4')
  return newGame(addPlayer(board, { id: 'z', name: 'Zed', color: '#3063ba' }))
}

function tab(id: string, title: string, game: Game, mapId: string | null = null): TabState {
  return { id, title, game, past: [], future: [], activePlayerId: game.board.players[0].id, mapId }
}

function savedId(name: string, game: Game): string {
  const result = saveMap(name, game)
  if (!result.ok) throw new Error(result.error)
  return result.id
}

describe('adoptLegacyLinks', () => {
  beforeEach(() => localStorage.clear())

  it('relinks a pre-id tab whose board still matches its saved map', () => {
    const game = edited()
    const id = savedId('Alpha', game)
    const [linked] = adoptLegacyLinks([tab('t1', 'Alpha', game)], readLibrary())
    expect(linked.mapId).toBe(id)
  })

  it('leaves a same-named tab holding different content unlinked', () => {
    savedId('Alpha', edited())
    // This is the case the id was introduced for: a blank board that merely
    // shares a saved map's name is not that map, so it must not claim it.
    const [blank] = adoptLegacyLinks([tab('t1', 'Alpha', pristine())], readLibrary())
    expect(blank.mapId).toBeNull()
  })

  it('gives a map to at most one tab when titles are duplicated', () => {
    const game = edited()
    const id = savedId('Alpha', game)
    const adopted = adoptLegacyLinks([tab('t1', 'Alpha', game), tab('t2', 'Alpha', game)], readLibrary())
    expect(adopted.map((entry) => entry.mapId)).toEqual([id, null])
  })

  it('never overwrites a link a tab already has', () => {
    const game = edited()
    savedId('Alpha', game)
    const [kept] = adoptLegacyLinks([tab('t1', 'Alpha', game, 'other-map')], readLibrary())
    expect(kept.mapId).toBe('other-map')
  })

  it('ignores unaddressable and unparseable library entries', () => {
    localStorage.setItem(MAPS_KEY, JSON.stringify([
      { name: 'Alpha', game: { schemaVersion: 9 } },
      42,
    ]))
    const tabs = [tab('t1', 'Alpha', pristine())]
    expect(adoptLegacyLinks(tabs, readLibrary())).toBe(tabs)
  })

  it('returns the same array when every tab is already linked', () => {
    const tabs = [tab('t1', 'Alpha', edited(), 'map-1')]
    expect(adoptLegacyLinks(tabs, readLibrary())).toBe(tabs)
  })
})
