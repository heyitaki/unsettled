import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, placeRoad, removeBuilding, setupGrants } from '../board'
import { axialKey, hexEdgeIds, hexVertexIds, parseVertexId, vertexIdOf, vertexTripleAt } from '../coords'
import { adjustCounter, adjustHand, mergeScreenshot, newGame, withBoard, type Game } from '../game'
import type { Board, VertexId } from '../types'
import { setTile } from './helpers'

const CENTER = { q: 0, r: 0 }
const NONE = { wood: 0, sheep: 0, wheat: 0, brick: 0, ore: 0 }
const corner = (index: number): VertexId => vertexIdOf(vertexTripleAt(CENTER, index))

// Aki's first settlement touches wood and two ore; the second touches wood, wheat and the desert.
const A1 = corner(0)
const A2 = corner(3)
const A3 = corner(5)
const [B1, , , B2] = hexVertexIds({ q: 2, r: -2 })
const AKI_HAND = { ...NONE, wood: 1, wheat: 1 }

function terrain(): Board {
  let board = addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })
  for (const hex of board.hexes) board = setTile(board, hex.coord, 'brick', 5)
  board = setTile(board, CENTER, 'wood', 6)
  const others = (vertexId: VertexId) => parseVertexId(vertexId).filter((coord) => axialKey(coord) !== axialKey(CENTER))
  for (const coord of others(A1)) board = setTile(board, coord, 'ore', 8)
  const [wheat, desert] = others(A2)
  board = setTile(board, wheat, 'wheat', 9)
  return setTile(board, desert, 'desert')
}

/** Every pick but Aki's last, in snake order. */
function openDraft(): Board {
  let board = placeBuilding(terrain(), A1, 'aki', 'settlement')
  board = placeBuilding(board, B1, 'b', 'settlement')
  return placeBuilding(board, B2, 'b', 'settlement')
}

const finish = (game: Game, vertexId: VertexId = A2): Game =>
  withBoard(game, placeBuilding(game.board, vertexId, 'aki', 'settlement'))

describe('setupGrants', () => {
  it('is null until every player owns exactly two settlements', () => {
    expect(setupGrants(terrain())).toBeNull()
    expect(setupGrants(openDraft())).toBeNull()
    expect(setupGrants(placeBuilding(openDraft(), A2, 'aki', 'city'))).toBeNull()
    expect(setupGrants(placeBuilding(placeBuilding(openDraft(), A2, 'aki', 'settlement'), A3, 'aki', 'settlement'))).toBeNull()
  })

  it('deals one card per resource hex at the second settlement, and nothing for the desert', () => {
    const grants = setupGrants(placeBuilding(openDraft(), A2, 'aki', 'settlement'))
    expect(grants?.aki).toEqual(AKI_HAND)
    expect(Object.keys(grants ?? {}).sort()).toEqual(['aki', 'b'])
  })

  it('deals for a resource hex that has no number token', () => {
    const board = placeBuilding(openDraft(), A2, 'aki', 'settlement')
    expect(setupGrants(setTile(board, CENTER, 'wood', null))?.aki).toEqual(AKI_HAND)
  })
})

describe('starting hands follow the draft', () => {
  it('deals every hand when the last settlement lands', () => {
    const game = finish(newGame(openDraft()))
    expect(game.stats.aki.hand).toEqual(AKI_HAND)
    expect(game.stats.b.hand).toEqual(setupGrants(game.board)?.b)
    expect(game.stats.aki.handUnknown).toBe(0)
  })

  it('takes the hands back when a settlement is removed', () => {
    const dealt = finish(newGame(openDraft()))
    const reopened = withBoard(dealt, removeBuilding(dealt.board, B2))
    expect(reopened.stats.aki.hand).toEqual(NONE)
    expect(reopened.stats.b.hand).toEqual(NONE)
  })

  it('swaps the hand when the second settlement moves', () => {
    const dealt = finish(newGame(openDraft()))
    const moved = finish(withBoard(dealt, removeBuilding(dealt.board, A2)), A3)
    expect(moved.stats.aki.hand).toEqual(setupGrants(moved.board)?.aki)
    expect(moved.stats.aki.hand).not.toEqual(AKI_HAND)
  })

  it('leaves a hand corrected by the user alone, dealing and taking back', () => {
    const corrected = finish(adjustHand(newGame(openDraft()), 'aki', 'ore', 1))
    expect(corrected.stats.aki.hand).toEqual({ ...NONE, ore: 1 })
    expect(corrected.stats.b.hand).toEqual(setupGrants(corrected.board)?.b)

    const dealt = adjustHand(finish(newGame(openDraft())), 'aki', 'ore', 1)
    const reopened = withBoard(dealt, removeBuilding(dealt.board, B2))
    expect(reopened.stats.aki.hand).toEqual({ ...AKI_HAND, ore: 1 })
    expect(reopened.stats.b.hand).toEqual(NONE)
  })

  it('leaves a hand with cards of unknown type alone', () => {
    const game = finish(adjustCounter(newGame(openDraft()), 'aki', 'handUnknown', 3))
    expect(game.stats.aki.hand).toEqual(NONE)
    expect(game.stats.aki.handUnknown).toBe(3)
  })

  it('deals nothing once a turn is recorded', () => {
    const started: Game = { ...newGame(openDraft()), turn: {
      playerId: 'aki', rolled: null, devPlayed: false,
      progressPlayed: { roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 },
    } }
    expect(finish(started).stats.aki.hand).toEqual(NONE)
  })

  it('leaves every hand alone when a later screenshot is merged', () => {
    const dealt = finish(newGame(openDraft()))
    const shot = adjustCounter(newGame(placeBuilding(dealt.board, A2, 'aki', 'city')), 'aki', 'handUnknown', 2)
    const merged = mergeScreenshot(dealt, shot, { roster: true, order: true, picks: true, hands: ['aki'] })
    expect(merged.stats.aki.hand).toEqual(AKI_HAND)
    expect(merged.stats.b.hand).toEqual(dealt.stats.b.hand)
  })

  it('keeps the same references when no hand changes', () => {
    const dealt = finish(newGame(openDraft()))
    expect(withBoard(dealt, dealt.board)).toBe(dealt)
    const road = withBoard(dealt, placeRoad(dealt.board, hexEdgeIds(CENTER)[0], 'aki'))
    expect(road.stats).toBe(dealt.stats)
  })
})
