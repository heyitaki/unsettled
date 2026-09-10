import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, renamePlayer, setMe } from '../../model/board'
import { setTile } from '../../model/__tests__/helpers'
import { newGame } from '../../model/game'
import { reducer, type StoreState, type TabState } from '../store'

const original = addPlayer(createBoard('standard4'), { id: 'b', name: 'Blue', color: '#123456' })
const tab: TabState = {
  id: 'imported', title: 'Imported', game: newGame(original), past: [], future: [], activePlayerId: 'aki', mapId: null,
}
const state: StoreState = {
  tabs: [tab, { ...tab, id: 'other' }], activeTabId: 'other', tool: { kind: 'none' },
  notice: null, noticeSeq: 0, highlight: null, mapsRevision: 0,
}

describe('background imported names', () => {
  it('enriches the imported tab without changing the active board', () => {
    const next = reducer(state, {
      type: 'import-names', id: tab.id, original,
      names: [{ playerId: 'b', name: 'Sam' }],
    })
    expect(next.activeTabId).toBe('other')
    expect(next.tabs[0].game.board.players[1].name).toBe('Sam')
    expect(next.tabs[0].past).toEqual([])
    expect(next.tabs[1]).toBe(state.tabs[1])
  })

  it('preserves manual renames and claimed-player changes made while OCR was running', () => {
    const board = setMe(renamePlayer(original, 'b', 'My name'), 'b')
    const edited = { ...state, tabs: [{ ...tab, game: newGame(board) }, state.tabs[1]] }
    const next = reducer(edited, {
      type: 'import-names', id: tab.id, original,
      names: [{ playerId: 'b', name: 'Sam' }, { playerId: 'aki', name: 'You' }],
    })
    expect(next.tabs[0].game.board.players[1].name).toBe('My name')
    expect(next.tabs[0].game.board.mePlayerId).toBe('b')
  })

  it('carries the names into undo history so an unrelated undo keeps them', () => {
    const before = newGame(setTile(original, { q: 0, r: 0 }, 'wheat', 6))
    const history = {
      ...state, activeTabId: tab.id,
      tabs: [{ ...tab, past: [before], future: [newGame(setTile(original, { q: 1, r: 0 }, 'ore', 8))] }, state.tabs[1]],
    }
    const named = reducer(history, {
      type: 'import-names', id: tab.id, original,
      names: [{ playerId: 'b', name: 'Sam' }, { playerId: 'aki', name: 'You' }],
    })
    for (const game of [named.tabs[0].game, ...named.tabs[0].past, ...named.tabs[0].future]) {
      expect(game.board.players[1].name).toBe('Sam')
      expect(game.board.mePlayerId).toBe('aki')
    }
    expect(named.tabs[0].past[0].board.hexes.find((hex) => hex.tile === 'wheat')).toBeDefined()
    const undone = reducer(named, { type: 'undo' })
    expect(undone.tabs[0].game.board.players[1].name).toBe('Sam')
  })

  it('does not recreate a tab closed before the names arrive', () => {
    const closed = { ...state, tabs: [state.tabs[1]] }
    expect(reducer(closed, {
      type: 'import-names', id: tab.id, original, names: [{ playerId: 'b', name: 'Sam' }],
    })).toBe(closed)
  })
})
