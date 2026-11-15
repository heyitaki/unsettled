import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, removePlayer, setMe } from '../../model/board'
import { adjustHand, newGame } from '../../model/game'
import { boardGrid } from '../../model/layouts'
import { endTurn, setActivePlayer } from '../../model/turn'
import { activeTab, reducer, type StoreAction, type StoreState, type TabState } from '../store'

function viewing(): StoreState {
  let board = addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })
  board = addPlayer(board, { id: 'c', name: 'Cee', color: '#ffffff' })
  board = placeBuilding(board, boardGrid(board.layout).vertexIds[0], 'aki', 'city')
  const game = setActivePlayer(newGame(board), 'aki')
  const tab = (id: string): TabState => ({ id, title: id, game, past: [], future: [], activePlayerId: 'aki', mapId: null })
  return {
    tabs: [tab('one'), tab('two')], activeTabId: 'one', viewedPlayer: 'b',
    tool: { kind: 'none' }, notice: null, noticeSeq: 0, highlight: null, mapsRevision: 0,
  }
}

describe('viewed turn player', () => {
  it('stores views outside the game and undo history, normalizing the turn player and invalid ids to null', () => {
    const state = viewing()
    expect(reducer(state, { type: 'view-player', playerId: 'b' })).toBe(state)
    for (const playerId of ['aki', 'missing', null]) {
      const next = reducer(state, { type: 'view-player', playerId })
      expect(next.viewedPlayer).toBeNull()
      expect(next.tabs).toBe(state.tabs)
    }
  })

  it('keeps the view across same-turn edits, claims, undo and redo', () => {
    const state = viewing()
    const edited = reducer(state, { type: 'commit-game', game: adjustHand(activeTab(state).game, 'b', 'ore', 1) })
    expect(edited.viewedPlayer).toBe('b')
    const undone = reducer(edited, { type: 'undo' })
    expect(undone.viewedPlayer).toBe('b')
    expect(reducer(undone, { type: 'redo' }).viewedPlayer).toBe('b')
    expect(reducer(state, { type: 'commit', board: setMe(activeTab(state).game.board, 'b') }).viewedPlayer).toBe('b')
  })

  it.each(['commit-game', 'undo', 'redo'] as const)('resets on %s even when the viewed player is neither turn player', (type) => {
    const state = { ...viewing(), viewedPlayer: 'c' }
    const tab = activeTab(state)
    const nextGame = endTurn(tab.game)
    if (type === 'undo') state.tabs[0] = { ...tab, game: nextGame, past: [tab.game] }
    if (type === 'redo') state.tabs[0] = { ...tab, future: [nextGame] }
    expect(activeTab(state).game.turn?.playerId).not.toBe('c')
    expect(nextGame.turn?.playerId).toBe('b')
    const next = reducer(state, type === 'commit-game' ? { type, game: nextGame } : { type })
    expect(next.viewedPlayer).toBeNull()
  })

  it('rejects and clears a viewed player while the draft is unfinished', () => {
    const state = viewing()
    const board = { ...activeTab(state).game.board, buildings: [] }
    const unfinished = reducer(state, { type: 'commit', board })
    expect(activeTab(unfinished).game.turn?.playerId).toBe('aki')
    expect(unfinished.viewedPlayer).toBeNull()
    expect(reducer(unfinished, { type: 'view-player', playerId: 'b' }).viewedPlayer).toBeNull()
  })

  it.each(['aki', 'b'])('resets when a board edit removes %s', (playerId) => {
    const state = viewing()
    expect(reducer(state, { type: 'commit', board: removePlayer(activeTab(state).game.board, playerId) }).viewedPlayer).toBeNull()
  })

  it.each<StoreAction>([
    { type: 'tab-select', id: 'two' },
    { type: 'tab-add', id: 'new', game: activeTab(viewing()).game },
    { type: 'tab-close', id: 'one' },
    { type: 'workspace-adopt', tabs: [{ id: 'new', title: 'New', game: activeTab(viewing()).game }] },
  ])('resets when $type changes the active tab', (action) => {
    expect(reducer(viewing(), action).viewedPlayer).toBeNull()
  })

  it('keeps the view when closing another tab or adopting without changing the local turn', () => {
    const state = viewing()
    expect(reducer(state, { type: 'tab-close', id: 'two' }).viewedPlayer).toBe('b')
    const { id, title, game } = activeTab(state)
    expect(reducer(state, { type: 'workspace-adopt', tabs: [{ id, title, game }] }).viewedPlayer).toBe('b')
    const adopted = reducer(state, { type: 'workspace-adopt', tabs: [{ id, title, game: endTurn(game) }] })
    expect(activeTab(adopted).game).toBe(game)
    expect(adopted.viewedPlayer).toBe('b')
  })
})
