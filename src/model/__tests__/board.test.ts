import { describe, expect, it } from 'vitest'
import {
  addPlayer,
  createBoard,
  draftOrder,
  pips,
  placeBuilding,
  placeRoad,
  randomizeBoard,
  removePlayer,
  setLayout,
  setTile,
  validateBoard,
  vertexProduction,
} from '../board'
import { axialKey, neighbor } from '../coords'
import { boardGrid, NUMBER_TOKEN_COUNTS } from '../layouts'
import type { LayoutId, TileKind } from '../types'

describe('board operations', () => {
  it('creates both blank layouts with default ports', () => {
    expect(createBoard('standard4').hexes).toHaveLength(19)
    expect(createBoard('extension6').ports).toHaveLength(11)
  })

  it('derives snake order and production', () => {
    let board = createBoard('standard4')
    board = addPlayer(board, { id: 'b', name: 'Bee', color: '#3063ba' })
    expect(draftOrder(board)).toEqual(['aki', 'b', 'b', 'aki'])
    const vertexId = boardGrid('standard4').vertexIds.find((id) =>
      id.includes('0,0'),
    )!
    board = setTile(board, { q: 0, r: 0 }, 'wood', 6)
    expect(vertexProduction(board, vertexId).wood).toBe(5)
    expect(pips(8)).toBe(5)
  })

  it('upgrades a building in place, keeping array order', () => {
    // The draft strip maps a player's k-th building to their k-th pick.
    const vertices = boardGrid('standard4').vertexIds
    let board = addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })
    board = placeBuilding(board, vertices[0], 'aki', 'settlement')
    board = placeBuilding(board, vertices[10], 'b', 'settlement')
    board = placeBuilding(board, vertices[0], 'aki', 'city')
    expect(board.buildings.map((building) => building.vertexId)).toEqual([vertices[0], vertices[10]])
    expect(board.buildings[0].tier).toBe('city')

    // Taking over another player's vertex is that player's first building there,
    // so it appends rather than inheriting the previous owner's index.
    const stolen = placeBuilding(board, vertices[0], 'b', 'city')
    expect(stolen.buildings.map((building) => building.playerId)).toEqual(['b', 'b'])
    expect(stolen.buildings.map((building) => building.vertexId)).toEqual([vertices[10], vertices[0]])
  })

  it('replaces occupants and strips a removed player pieces', () => {
    let board = addPlayer(createBoard('standard4'), {
      id: 'b',
      name: 'Bee',
      color: '#3063ba',
    })
    board = placeRoad(board, boardGrid('standard4').edgeIds[0], 'b')
    board = placeBuilding(board, boardGrid('standard4').vertexIds[0], 'b', 'city')
    board = removePlayer(board, 'b')
    expect(board.roads).toEqual([])
    expect(board.buildings).toEqual([])
  })

  it('keeps roster when changing layout', () => {
    const board = addPlayer(createBoard('standard4'), {
      id: 'b',
      name: 'Bee',
      color: '#3063ba',
    })
    expect(setLayout(board, 'extension6').players).toEqual(board.players)
  })

  it('reports schema and placement errors without throwing', () => {
    const board = createBoard('standard4')
    const broken = {
      ...board,
      schemaVersion: 2,
      ports: [...board.ports, board.ports[0]],
    } as never
    expect(validateBoard(broken).filter((issue) => issue.severity === 'error')).not.toHaveLength(0)
  })
})

describe('randomizeBoard', () => {
  const layouts: LayoutId[] = ['standard4', 'extension6']
  const RESOURCE_TOTALS: Record<LayoutId, Record<TileKind, number>> = {
    standard4: { wood: 4, sheep: 4, wheat: 4, brick: 3, ore: 3, desert: 1 },
    extension6: { wood: 6, sheep: 6, wheat: 6, brick: 5, ore: 5, desert: 2 },
  }

  for (const layout of layouts) {
    // Run many times: placement is random, so invariants must hold every draw.
    it(`deals a legal ${layout} map every time`, () => {
      for (let trial = 0; trial < 40; trial += 1) {
        const board = randomizeBoard(createBoard(layout))

        const tileCounts: Record<string, number> = {}
        for (const hex of board.hexes) tileCounts[hex.tile as string] = (tileCounts[hex.tile as string] ?? 0) + 1
        expect(tileCounts).toEqual(RESOURCE_TOTALS[layout])

        const tokenCounts: Record<number, number> = {}
        for (const hex of board.hexes) {
          if (hex.tile === 'desert') {
            expect(hex.numberToken).toBeNull()
            continue
          }
          expect(hex.numberToken).not.toBeNull()
          tokenCounts[hex.numberToken as number] = (tokenCounts[hex.numberToken as number] ?? 0) + 1
        }
        expect(tokenCounts).toEqual(NUMBER_TOKEN_COUNTS[layout])

        // No two red (6/8) tokens may be adjacent.
        const redKeys = new Set(
          board.hexes.filter((hex) => hex.numberToken === 6 || hex.numberToken === 8).map((hex) => axialKey(hex.coord)),
        )
        for (const hex of board.hexes) {
          if (!redKeys.has(axialKey(hex.coord))) continue
          for (let dir = 0; dir < 6; dir += 1) {
            expect(redKeys.has(axialKey(neighbor(hex.coord, dir)))).toBe(false)
          }
        }

        // The robber sits on a desert; pieces are cleared.
        expect(board.roads).toHaveLength(0)
        expect(board.buildings).toHaveLength(0)
        const robberHex = board.hexes.find((hex) => board.robber && axialKey(hex.coord) === axialKey(board.robber))
        expect(robberHex?.tile).toBe('desert')
      }
    })
  }

  it('keeps players and ports', () => {
    const base = addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })
    const board = randomizeBoard(base)
    expect(board.players).toEqual(base.players)
    expect(board.ports).toEqual(base.ports)
    expect(board.mePlayerId).toBe(base.mePlayerId)
  })
})
