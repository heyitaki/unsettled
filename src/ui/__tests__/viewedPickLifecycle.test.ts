import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, setMe } from '../../model/board'
import { newGame } from '../../model/game'
import { boardGrid } from '../../model/layouts'
import { viewedPlayerId } from '../draftSlots'
import { activeTab, reducer, type StoreAction, type StoreState, type TabState } from '../store'

function viewing(): StoreState {
  const game = newGame(addPlayer(createBoard('standard4'), { id: 'b', name: 'Blue', color: '#333333' }))
  const tab = (id: string): TabState => ({ id, title: id, game, past: [], future: [], activePlayerId: null, mapId: null })
  return {
    tabs: [tab('one'), tab('two')], activeTabId: 'one', viewedPick: 3,
    tool: { kind: 'none' }, notice: null, noticeSeq: 0, highlight: null, mapsRevision: 0,
  }
}

describe('viewed pick lifecycle', () => {
  it('derives the viewed player without moving the claim', () => {
    const board = activeTab(viewing()).game.board
    expect(viewedPlayerId(board, undefined)).toBe('aki')
    expect(viewedPlayerId(board, null)).toBe('aki')
    expect(viewedPlayerId(board, 1)).toBe('b')
    expect(viewedPlayerId(board, 2)).toBe('b')
    expect(viewedPlayerId(setMe(board, null), null)).toBeNull()
    expect(board.mePlayerId).toBe('aki')
  })

  it('keeps a rival view when it becomes their first remaining pick', () => {
    const start = reducer(viewing(), { type: 'view-pick', slot: 2 })
    const vertices = boardGrid('standard4').vertexIds
    let board = activeTab(start).game.board
    board = placeBuilding(board, vertices[0], 'aki', 'settlement')
    board = placeBuilding(board, vertices[10], 'b', 'settlement')
    const next = reducer(start, { type: 'commit', board })
    expect(next.viewedPick).toBe(2)
    expect(viewedPlayerId(board, next.viewedPick)).toBe('b')
    expect(reducer(next, { type: 'view-pick', slot: 2 })).toBe(next)
  })

  it('follows the draft through a placement, undo and redo from the default view', () => {
    const state = viewing()
    let board = activeTab(state).game.board
    board = addPlayer(board, { id: 'c', name: 'Orange', color: '#e58331' })
    board = addPlayer(board, { id: 'd', name: 'White', color: '#ffffff' })
    const start = reducer(reducer(state, { type: 'commit', board }), { type: 'view-pick', slot: null })
    const committed = reducer(start, {
      type: 'commit', board: placeBuilding(board, boardGrid('standard4').vertexIds[0], 'aki', 'settlement'),
    })
    expect(committed.viewedPick).toBe(1)
    const undone = reducer(committed, { type: 'undo' })
    expect(undone.viewedPick).toBeNull()
    expect(reducer(undone, { type: 'redo' }).viewedPick).toBe(1)
  })

  it('returns to an earlier rival pick when undo starts from the default view', () => {
    const state = viewing()
    const board = setMe(activeTab(state).game.board, 'b')
    const start = reducer(reducer(state, { type: 'commit', board }), { type: 'view-pick', slot: 0 })
    const committed = reducer(start, {
      type: 'commit', board: placeBuilding(board, boardGrid('standard4').vertexIds[0], 'aki', 'settlement'),
    })
    expect(committed.viewedPick).toBeNull()
    expect(reducer(committed, { type: 'undo' }).viewedPick).toBe(0)
  })

  it('keeps a later pick viewed on purpose when another player places a settlement', () => {
    const start = reducer(viewing(), { type: 'view-pick', slot: 2 })
    const board = activeTab(start).game.board
    const committed = reducer(start, {
      type: 'commit', board: placeBuilding(board, boardGrid('standard4').vertexIds[0], 'aki', 'settlement'),
    })
    expect(committed.viewedPick).toBe(2)
  })

  it('keeps no-op views and edits identical, with no history entry for a view', () => {
    const state = viewing()
    expect(reducer(state, { type: 'view-pick', slot: 3 })).toBe(state)
    expect(reducer(state, { type: 'commit', board: activeTab(state).game.board })).toBe(state)
    const cleared = reducer(state, { type: 'view-pick', slot: null })
    expect(cleared.tabs).toBe(state.tabs)
  })

  it('reconciles whole-game edits and redo without restoring a prior view', () => {
    const state = viewing()
    const game = newGame(setMe(activeTab(state).game.board, 'b'))
    const committed = reducer(state, { type: 'commit-game', game })
    expect(committed.viewedPick).toBeNull()
    const undone = reducer(committed, { type: 'undo' })
    expect(undone.viewedPick).toBeNull()
    const selected = reducer(undone, { type: 'view-pick', slot: 3 })
    expect(reducer(selected, { type: 'redo' }).viewedPick).toBeNull()
  })

  it.each<StoreAction>([
    { type: 'tab-add', id: 'new' },
    { type: 'tab-close', id: 'one' },
    { type: 'workspace-adopt', tabs: [{ id: 'new', title: 'New', game: newGame(createBoard('standard4')) }] },
  ])('clears when $type switches the active tab', (action) => {
    expect(reducer(viewing(), action).viewedPick).toBeNull()
  })

  it('keeps the view when closing another tab or adopting while the active board stays', () => {
    const state = viewing()
    expect(reducer(state, { type: 'tab-close', id: 'two' }).viewedPick).toBe(3)
    const { id, title, game } = state.tabs[0]
    expect(reducer(state, { type: 'workspace-adopt', tabs: [{ id, title, game }] }).viewedPick).toBe(3)
  })
})
