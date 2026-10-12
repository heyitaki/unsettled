import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, setMe } from '../../model/board'
import { newGame } from '../../model/game'
import { boardGrid } from '../../model/layouts'
import { PLAYER_PALETTE, type Board } from '../../model/types'
import { activeTab, reducer, type StoreState, type TabState } from '../store'

// Every sixth vertex, so no two picks land on adjacent corners.
const SPACED = boardGrid('standard4').vertexIds.filter((_, index) => index % 6 === 0)

// Seats aki, b, c, d: the snake runs aki b c d d c b aki, and c is claimed (slots 2 and 5).
function fourPlayers(): Board {
  let board = createBoard('standard4')
  board = addPlayer(board, { id: 'b', name: 'Bee', color: PLAYER_PALETTE.blue })
  board = addPlayer(board, { id: 'c', name: 'Cee', color: PLAYER_PALETTE.white })
  board = addPlayer(board, { id: 'd', name: 'Dee', color: PLAYER_PALETTE.orange })
  return setMe(board, 'c')
}

function tab(id: string, board: Board): TabState {
  return { id, title: id, game: newGame(board), past: [], future: [], activePlayerId: null, mapId: null }
}

function state(tabs: TabState[]): StoreState {
  return {
    tabs,
    activeTabId: tabs[0].id,
    tool: { kind: 'none' },
    notice: null,
    noticeSeq: 0,
    highlight: null,
    mapsRevision: 0,
  }
}

const viewing = (board: Board, slot: number | null): StoreState =>
  reducer(state([tab('one', board), tab('two', board)]), { type: 'view-pick', slot })
const viewed = (next: StoreState): number | null => next.viewedPick ?? null

describe('the viewed pick', () => {
  it('holds a later pick of the claimed player', () => {
    expect(viewed(viewing(fourPlayers(), 5))).toBe(5)
  })

  it('stays empty for the claimed player\'s next pick, which is the default view', () => {
    const board = fourPlayers()
    const before = state([tab('one', board)])
    expect(viewed(viewing(board, 2))).toBeNull()
    // Nothing changed, so nothing downstream (a pinned card, the analysis) is disturbed.
    expect(reducer(before, { type: 'view-pick', slot: 2 })).toBe(before)
  })

  it('holds a rival\'s pick, first or later, and leaves the claim alone', () => {
    const board = fourPlayers()
    for (const slot of [0, 7, 3]) {
      const next = viewing(board, slot)
      expect(viewed(next)).toBe(slot)
      expect(activeTab(next).game.board).toBe(board)
    }
  })

  it('refuses a slot that is out of range, already placed, or on an unclaimed board', () => {
    const board = fourPlayers()
    expect(viewed(viewing(board, 99))).toBeNull()
    expect(viewed(viewing(board, -1))).toBeNull()
    expect(viewed(viewing(placeBuilding(board, SPACED[0], 'aki', 'settlement'), 0))).toBeNull()
    expect(viewed(viewing(setMe(board, null), 5))).toBeNull()
  })

  it('follows a rival\'s pick to the next open pick once it is placed', () => {
    const board = fourPlayers()
    const next = reducer(viewing(board, 0), {
      type: 'commit',
      board: placeBuilding(board, SPACED[0], 'aki', 'settlement'),
    })
    expect(viewed(next)).toBe(1)
  })

  it('clears on request', () => {
    expect(viewed(reducer(viewing(fourPlayers(), 5), { type: 'view-pick', slot: null }))).toBeNull()
  })

  it('survives an edit that leaves the slot still to come', () => {
    const board = fourPlayers()
    expect(viewed(reducer(viewing(board, 1), {
      type: 'commit',
      board: placeBuilding(board, SPACED[0], 'aki', 'settlement'),
    }))).toBe(1)
    const next = reducer(viewing(board, 5), {
      type: 'commit',
      board: placeBuilding(board, SPACED[0], 'aki', 'settlement'),
    })
    expect(viewed(next)).toBe(5)
  })

  it('clears when the claim moves to another player, whatever was viewed', () => {
    const board = fourPlayers()
    expect(viewed(reducer(viewing(board, 5), { type: 'commit', board: setMe(board, 'd') }))).toBeNull()
    expect(viewed(reducer(viewing(board, 0), { type: 'commit', board: setMe(board, 'd') }))).toBeNull()
  })

  it('clears once my earlier pick is placed and the slot is simply my next one', () => {
    let board = fourPlayers()
    const start = viewing(board, 5)
    ;['aki', 'b', 'c'].forEach((playerId, pick) => {
      board = placeBuilding(board, SPACED[pick], playerId, 'settlement')
    })
    expect(viewed(reducer(start, { type: 'commit', board }))).toBeNull()
  })

  it('comes back empty from an undo that leaves it without a slot', () => {
    const board = fourPlayers()
    // Claim d, view d's later pick, then undo the claim: slot 4 is no longer mine.
    const claimed = reducer(state([tab('one', board)]), { type: 'commit', board: setMe(board, 'd') })
    const later = reducer(claimed, { type: 'view-pick', slot: 4 })
    expect(viewed(later)).toBe(4)
    expect(viewed(reducer(later, { type: 'undo' }))).toBeNull()
  })

  it('clears when another board is selected', () => {
    expect(viewed(reducer(viewing(fourPlayers(), 5), { type: 'tab-select', id: 'two' }))).toBeNull()
  })
})
