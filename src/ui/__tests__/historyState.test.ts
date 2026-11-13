import { expect, it } from 'vitest'
import { createBoard } from '../../model/board'
import { adjustHand, newGame } from '../../model/game'
import { endTurn, setActivePlayer } from '../../model/turn'
import { persistedWorkspace } from '../workspaceSync'
import { activeTab, reducer, type StoreAction, type StoreState } from '../store'

function viewing(): StoreState {
  const game = endTurn(setActivePlayer(newGame(createBoard('standard4')), 'aki'))
  return {
    tabs: ['one', 'two'].map((id) => ({ id, title: id, game, past: [game], future: [game], activePlayerId: 'aki', mapId: null })),
    activeTabId: 'one', tool: { kind: 'none' }, notice: null, noticeSeq: 0, highlight: null, mapsRevision: 0,
    historyOpen: true, viewedTurn: 0,
  }
}

it('keeps history navigation outside persisted and undo state', () => {
  const start = viewing()
  const next = reducer(start, { type: 'view-turn', index: 1 })
  expect(next.viewedTurn).toBe(1)
  expect(next.tabs).toBe(start.tabs)
  expect(persistedWorkspace(next.tabs)).toEqual(persistedWorkspace(start.tabs))
  expect(reducer(next, { type: 'history', open: false })).toMatchObject({ historyOpen: false, viewedTurn: null })
  expect(reducer(next, { type: 'view-turn', index: 2 }).viewedTurn).toBeNull()
})

it.each<StoreAction['type']>(['commit', 'commit-game', 'undo', 'redo', 'tab-select'])('returns to Now on %s', (type) => {
  const state = viewing()
  const next = adjustHand(activeTab(state).game, 'aki', 'wood', 1)
  const action: StoreAction = type === 'commit' ? { type, board: { ...next.board } }
    : type === 'commit-game' ? { type, game: next }
      : type === 'tab-select' ? { type, id: 'two' } : { type: type as 'undo' | 'redo' }
  expect(reducer(state, action).viewedTurn).toBeNull()
})

it('closes history when a reset removes the recorded turn', () => {
  expect(reducer(viewing(), { type: 'commit-game', game: newGame(createBoard('standard4')) }))
    .toMatchObject({ historyOpen: false, viewedTurn: null })
})
