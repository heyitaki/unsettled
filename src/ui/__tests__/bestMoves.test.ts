import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, placeRoad, validateBoard } from '../../model/board'
import { adjustCounter, adjustHand, emptyStats, newGame, type Game } from '../../model/game'
import { vertexAdjacentVertexIds } from '../../model/coords'
import { boardGrid } from '../../model/layouts'
import { setActivePlayer } from '../../model/turn'
import type { AdviceAction, PreRollPlay } from '../../engine/advice/protocol'
import { actionLabel, adviceBlockers, adviceMarks, applyAdvice, canCover, cardRange, discardInputCards, playLabel, recordedMoveLabel, sevenDiscards, tradeVerdictRequest } from '../bestMoves'

const [edge, second] = boardGrid('standard4').edgeIds
const vertex = boardGrid('standard4').vertexIds[0]
const hex = { q: 0, r: 0 }
const game = () => newGame(addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' }))
const committed = (result: ReturnType<typeof applyAdvice>): Game => {
  if ('open' in result) throw new Error('Expected a game')
  return result
}

describe('best moves', () => {
  it('groups blocking board warnings and permits a missing robber on a desert board', () => {
    const base = game().board
    const board = { ...base, robber: hex, hexes: base.hexes.map((tile) => ({ ...tile, tile: 'wood' as const, numberToken: 6 })) }
    expect(adviceBlockers(board)).toEqual([])
    expect(adviceBlockers({ ...board, robber: null })).toEqual(['Place the robber'])
    expect(adviceBlockers({ ...board, robber: null, hexes: board.hexes.map((tile, index) => index === 0 ? { ...tile, tile: 'desert', numberToken: null } : tile) })).toEqual([])
    const unfinished = { ...board, players: [board.players[0]], hexes: board.hexes.map((tile, index) => index < 3 ? { ...tile, tile: null } : index < 5 ? { ...tile, numberToken: null } : tile) }
    expect(adviceBlockers(unfinished)).toEqual(['3 hexes have no tile', '2 resource hexes have no number', 'Add a second player'])
    const adjacent = placeBuilding(placeBuilding(board, vertex, 'aki', 'settlement'), vertexAdjacentVertexIds(vertex)[0], 'b', 'settlement')
    expect(adviceBlockers(adjacent)).toEqual(['Two buildings sit on adjacent corners'])
  })

  it('blocks every validation error and collapses repeated errors', () => {
    const base = game().board
    const board = { ...base, robber: hex, hexes: base.hexes.map((tile) => ({ ...tile, tile: 'wood' as const, numberToken: 6 })) }
    const invalid = { ...board, mePlayerId: 'missing', hexes: board.hexes.map((tile, index) => index < 2 ? { ...tile, numberToken: 7 } : tile) }
    const blockers = adviceBlockers(invalid)
    expect(blockers).toHaveLength(2)
    for (const issue of validateBoard(invalid).filter((issue) => issue.severity === 'error')) {
      expect(blockers.some((message) => message.includes(issue.message))).toBe(true)
    }
    expect(blockers[0]).toContain('2')
  })

  it('a known hand is one number and an unknown one is a range', () => {
    const stats = { ...emptyStats(), handUnknown: 3 }
    stats.hand.wood = 2
    expect(cardRange(stats, 'wood', true)).toEqual({ lo: 2, hi: 2 })
    expect(cardRange(stats, 'wood', false)).toEqual({ lo: 2, hi: 5 })
    expect(cardRange(emptyStats(), 'wood', false)).toEqual({ lo: 0, hi: 0 })
  })

  it('covers a mix only when its combined shortfall fits the unseen hand', () => {
    const stats = { ...emptyStats(), hand: { ...emptyStats().hand, wood: 2 }, handUnknown: 2 }
    expect(canCover(stats, { wood: 3, ore: 1 })).toBe(true)
    expect(canCover(stats, { wood: 3, ore: 2 })).toBe(false)
    expect(canCover({ ...stats, handUnknown: 0 }, { wood: 2 })).toBe(true)
    expect(canCover({ ...stats, handUnknown: 0 }, { wood: 3 })).toBe(false)
  })

  it('labels advised bank and port trades in the same order as manual entries', () => {
    expect(recordedMoveLabel({ type: 'tradeBank', give: 'ore', rate: 2, count: 2, get: 'brick' })).toBe('Traded 4 ore to the port for 2 brick')
    expect(recordedMoveLabel({ type: 'tradeBank', give: 'wood', rate: 4, count: 1, get: 'ore' })).toBe('Traded 4 wood to the bank for 1 ore')
  })

  it('labels every action kind', () => {
    const board = game().board
    const cases: [AdviceAction, string][] = [
      [{ type: 'buildRoad', edgeId: edge }, 'Build road'],
      [{ type: 'buildSettlement', vertexId: vertex }, 'Build settlement'],
      [{ type: 'upgradeCity', vertexId: vertex }, 'Upgrade to city'],
      [{ type: 'buyDev' }, 'Buy a development card'],
      [{ type: 'playKnight', hex, victim: 'b' }, 'Play Knight: robber to Unassigned, steal from Bee'],
      [{ type: 'tradeBank', give: 'wheat', get: 'ore', count: 2, rate: 3 }, 'Trade 6 wheat for 2 ore with the bank'],
      [{ type: 'offerTrade', give: 'wood', get: 'brick', count: 2 }, 'Offer 2 wood for 1 brick'],
      [{ type: 'pass' }, 'Pass'],
    ]
    for (const [action, label] of cases) expect(actionLabel(action, board)).toContain(label)
    expect(playLabel({ type: 'roadBuilding', first: edge, second }, board)).toContain('Road building')
    expect(playLabel({ type: 'yearOfPlenty', first: 'wood', second: 'ore' }, board)).toBe('Play Year of plenty: take wood and ore')
    expect(playLabel({ type: 'monopoly', resource: 'wheat' }, board)).toBe('Play Monopoly: name wheat')
    expect(playLabel({ type: 'playKnight', hex, victim: null }, board)).toContain('nobody')
  })

  it('a build marks its spot, a road its edge and a robber move its hex', () => {
    expect(adviceMarks({ type: 'buildSettlement', vertexId: vertex }, 'red')).toEqual([{ ref: vertex, color: 'red' }])
    expect(adviceMarks({ type: 'upgradeCity', vertexId: vertex }, 'red')).toEqual([{ ref: vertex, color: 'red' }])
    expect(adviceMarks({ type: 'buildRoad', edgeId: edge }, 'red')).toEqual([{ ref: edge, color: 'red', kind: 'road' }])
    expect(adviceMarks({ type: 'playKnight', hex, victim: null }, 'red')).toEqual([{ ref: '0,0', color: 'red', kind: 'hex' }])
    expect(adviceMarks({ type: 'roadBuilding', first: edge, second }, 'red')).toHaveLength(2)
    expect(adviceMarks({ type: 'buyDev' }, 'red')).toEqual([])
  })

  it('applying a build places the piece and spends its cost in one game', () => {
    const before = adjustHand(adjustHand(game(), 'aki', 'wood', 3), 'aki', 'brick', 2)
    const next = committed(applyAdvice(before, { type: 'buildRoad', edgeId: edge }))
    expect(next.board.roads).toContainEqual({ edgeId: edge, playerId: 'aki' })
    expect(next.stats.aki.hand).toMatchObject({ wood: 2, brick: 1 })
    expect(before.board.roads).toEqual([])
  })

  it('applying a bank trade pays the rate times the count', () => {
    const next = committed(applyAdvice(adjustHand(game(), 'aki', 'wood', 9), { type: 'tradeBank', give: 'wood', get: 'ore', rate: 3, count: 2 }))
    expect(next.stats.aki.hand).toMatchObject({ wood: 3, ore: 2 })
  })

  it('an unchanged build preserves the game and spends no cards', () => {
    const base = adjustHand(game(), 'aki', 'wood', 9)
    const road = { ...base, board: placeRoad(base.board, edge, 'aki') }
    expect(applyAdvice(road, { type: 'buildRoad', edgeId: edge })).toBe(road)
    for (const tier of ['settlement', 'city'] as const) {
      const current = { ...base, board: placeBuilding(base.board, vertex, 'aki', tier) }
      expect(applyAdvice(current, { type: tier === 'city' ? 'upgradeCity' : 'buildSettlement', vertexId: vertex })).toBe(current)
    }
  })

  it('rival discard inputs start at zero even when advice suggests cards', () => {
    const advised = { ...emptyStats().hand, wood: 3, ore: 1 }
    expect(discardInputCards(false, advised)).toEqual(emptyStats().hand)
    expect(discardInputCards(true, advised)).toEqual(advised)
    expect(discardInputCards(true)).toEqual(emptyStats().hand)
  })

  it('applying pass ends the turn', () => {
    expect(committed(applyAdvice(game(), { type: 'pass' })).turn?.playerId).toBe('b')
  })

  it('an offer, a knight and a monopoly ask for more input instead of committing', () => {
    const actions: (AdviceAction | PreRollPlay)[] = [
      { type: 'offerTrade', give: 'wood', get: 'brick', count: 2 },
      { type: 'playKnight', hex, victim: 'b' },
      { type: 'monopoly', resource: 'ore' },
    ]
    for (const action of actions) expect(applyAdvice(game(), action)).toEqual({ open: action.type === 'offerTrade' ? 'trade' : 'play', fill: action })
  })

  it('a dev card buy commits for a rival and asks the claimed player what was drawn', () => {
    expect(applyAdvice(game(), { type: 'buyDev' })).toEqual({ open: 'buy', fill: { type: 'buyDev' } })
    const rival = adjustHand(setActivePlayer(game(), 'b'), 'b', 'wheat', 2)
    const next = committed(applyAdvice(rival, { type: 'buyDev' }))
    expect(next.stats.b.devCards).toBe(1)
    expect(next.stats.b.hand.wheat).toBe(1)
  })

  it('a trade qualifies for a verdict only when the claimed player gives one card for one or two of another', () => {
    const current = game()
    for (const count of [1, 2]) expect(tradeVerdictRequest(current, 'aki', 'b', { resource: 'wood', count: 1 }, { resource: 'ore', count })?.kind).toBe('tradeResponse')
    for (const count of [0, 3, 1.5]) expect(tradeVerdictRequest(current, 'aki', 'b', { resource: 'wood', count: 1 }, { resource: 'ore', count })).toBeNull()
    expect(tradeVerdictRequest(current, 'aki', 'b', { resource: 'wood', count: 2 }, { resource: 'ore', count: 1 })).toBeNull()
    expect(tradeVerdictRequest(current, 'aki', 'b', { resource: 'wood', count: 1 }, { resource: 'wood', count: 1 })).toBeNull()
    expect(tradeVerdictRequest(current, 'b', null, { resource: 'wood', count: 1 }, { resource: 'ore', count: 1 })).toBeNull()
  })

  it('the verdict request names the other party as proposer', () => {
    const current = game()
    expect(tradeVerdictRequest(current, 'aki', 'b', { resource: 'wood', count: 1 }, { resource: 'ore', count: 2 })).toEqual({ kind: 'tradeResponse', proposer: 'b', give: 'ore', get: 'wood', count: 2 })
    expect(tradeVerdictRequest(current, 'b', 'aki', { resource: 'ore', count: 2 }, { resource: 'wood', count: 1 })).toEqual({ kind: 'tradeResponse', proposer: 'b', give: 'ore', get: 'wood', count: 2 })
  })

  it('a seven lists every player over seven cards with half their hand rounded down', () => {
    const current = adjustCounter(adjustHand(game(), 'aki', 'wood', 9), 'b', 'handUnknown', 8)
    expect(sevenDiscards(current)).toEqual([{ playerId: 'aki', total: 9, count: 4 }, { playerId: 'b', total: 8, count: 4 }])
    expect(sevenDiscards(adjustCounter(game(), 'b', 'handUnknown', 7))).toEqual([])
  })

  it('applies progress cards as one game and preserves free road costs', () => {
    const current = adjustHand(game(), 'aki', 'wood', 2)
    const roads = committed(applyAdvice(current, { type: 'roadBuilding', first: edge, second }))
    expect(roads.board.roads).toHaveLength(2)
    expect(roads.stats.aki.hand.wood).toBe(2)
    expect(roads.turn?.devPlayed).toBe(true)
    const plenty = committed(applyAdvice(current, { type: 'yearOfPlenty', first: 'ore', second: 'ore' }))
    expect(plenty.stats.aki.hand.ore).toBe(2)
  })
})
