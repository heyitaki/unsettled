import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, renamePlayer, setMe } from '../../model/board'
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

  it('does not recreate a tab closed before the names arrive', () => {
    const closed = { ...state, tabs: [state.tabs[1]] }
    expect(reducer(closed, {
      type: 'import-names', id: tab.id, original, names: [{ playerId: 'b', name: 'Sam' }],
    })).toBe(closed)
  })
})
