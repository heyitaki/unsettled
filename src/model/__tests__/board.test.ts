import { describe, expect, it } from 'vitest'
import {
  addPlayer,
  clearBoard,
  createBoard,
  draftOrder,
  isBlank,
  movePlayer,
  pips,
  placeBuilding,
  placeRoad,
  randomizeBoard,
  removeBuilding,
  removePlayer,
  removePort,
  removeRoad,
  renamePlayer,
  setHexTile,
  setLayout,
  setMe,
  setNumberToken,
  setRobber,
  upsertPort,
  validateBoard,
  vertexProduction,
} from '../board'
import { setTile } from './helpers'
import { axialKey, neighbor } from '../coords'
import { boardGrid, defaultPortEdges, NUMBER_TOKEN_COUNTS } from '../layouts'
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
    // The draft views map a player's k-th building to their k-th pick.
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

describe('no-op edits keep the board identity', () => {
  // The store keys its undo stack on board identity, so a mutator that hands
  // back its input is what keeps a stray click off the stack.
  const grid = boardGrid('standard4')
  const edge = grid.edgeIds[0]
  const coastal = grid.coastalEdgeIds[0]
  const vertex = grid.vertexIds[0]
  const coord = { q: 0, r: 0 }

  it('repaints a tile and a token with their current value', () => {
    const board = setTile(createBoard('standard4'), coord, 'wheat', 6)
    expect(setHexTile(board, coord, 'wheat')).toBe(board)
    expect(setNumberToken(board, coord, 6)).toBe(board)
    expect(setHexTile(board, coord, 'ore')).not.toBe(board)
    expect(setNumberToken(board, coord, 8)).not.toBe(board)
  })

  it('erases a hex that has no tile, and clears a desert token exactly once', () => {
    const blank = createBoard('standard4')
    expect(setHexTile(blank, coord, null)).toBe(blank)

    // Painting desert over a numbered hex drops the token, so it is a real edit
    // even though the tile lands on the value it would have had.
    const numbered = setTile(blank, coord, 'wheat', 6)
    const desert = setHexTile(numbered, coord, 'desert')
    expect(desert).not.toBe(numbered)
    expect(setHexTile(desert, coord, 'desert')).toBe(desert)
  })

  it('drops the robber on the hex it already occupies', () => {
    const board = setRobber(createBoard('standard4'), coord)
    expect(setRobber(board, coord)).toBe(board)
    expect(setRobber(board, { q: 1, r: 0 })).not.toBe(board)
    const lifted = setRobber(board, null)
    expect(lifted).not.toBe(board)
    expect(setRobber(lifted, null)).toBe(lifted)
  })

  it('re-saves a port with its current resource and rate', () => {
    const board = upsertPort(createBoard('standard4'), coastal, 'ore', 2)
    expect(upsertPort(board, coastal, 'ore', 2)).toBe(board)
    expect(upsertPort(board, coastal, 'ore', 3)).not.toBe(board)
    expect(upsertPort(board, coastal, null, 2)).not.toBe(board)
  })

  it('erases an edge and a vertex that hold nothing', () => {
    const board = createBoard('standard4')
    // The eraser hits both in one commit, so both must preserve identity for a
    // sweep across open water to stay off the undo stack.
    expect(removePort(removeRoad(board, coastal), coastal)).toBe(board)
    expect(removeBuilding(board, vertex)).toBe(board)
  })

  it('re-places a road and a building that are already yours', () => {
    let board = placeRoad(createBoard('standard4'), edge, 'aki')
    board = placeBuilding(board, vertex, 'aki', 'settlement')
    expect(placeRoad(board, edge, 'aki')).toBe(board)
    expect(placeBuilding(board, vertex, 'aki', 'settlement')).toBe(board)
    expect(placeBuilding(board, vertex, 'aki', 'city')).not.toBe(board)

    const opponent = addPlayer(board, { id: 'b', name: 'Bee', color: '#3063ba' })
    expect(placeRoad(opponent, edge, 'b')).not.toBe(opponent)
    expect(placeBuilding(opponent, vertex, 'b', 'settlement')).not.toBe(opponent)
  })

  it('treats a fresh board as blank despite its seeded ports', () => {
    // The layout switcher confirms before wiping a board with content on it.
    // createBoard seeds the layout's default ports, so counting any port as
    // content would make every board look non-blank.
    for (const layout of ['standard4', 'extension6'] as LayoutId[]) {
      expect(createBoard(layout).ports.length).toBeGreaterThan(0)
      expect(isBlank(createBoard(layout))).toBe(true)
    }
    expect(isBlank(setHexTile(createBoard('standard4'), coord, 'wheat'))).toBe(false)
  })

  it('clears a board that is already blank', () => {
    const blank = createBoard('standard4')
    expect(clearBoard(blank)).toBe(blank)

    // A default port deleted and redrawn is still blank, reordered or not.
    const rebuilt = upsertPort(removePort(blank, blank.ports[0].edgeId), blank.ports[0].edgeId, null, 3)
    expect(rebuilt.ports.map((port) => port.edgeId)).not.toEqual(blank.ports.map((port) => port.edgeId))
    expect(clearBoard(rebuilt)).toBe(rebuilt)

    for (const dirty of [
      setHexTile(blank, coord, 'wheat'),
      setNumberToken(blank, coord, 6),
      setRobber(blank, coord),
      placeRoad(blank, edge, 'aki'),
      placeBuilding(blank, vertex, 'aki', 'settlement'),
      removePort(blank, blank.ports[0].edgeId),
      upsertPort(blank, blank.ports[0].edgeId, 'ore', 2),
    ]) {
      expect(clearBoard(dirty)).not.toBe(dirty)
    }
  })

  it('renames a player to their current name and drags one onto its own slot', () => {
    const board = addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })
    expect(renamePlayer(board, 'b', 'Bee')).toBe(board)
    expect(renamePlayer(board, 'b', 'Cee')).not.toBe(board)
    expect(movePlayer(board, 'b', 1)).toBe(board)
    expect(movePlayer(board, 'b', 9)).toBe(board)
    expect(movePlayer(board, 'b', 0)).not.toBe(board)
    const claimed = setMe(board, 'b')
    expect(claimed).not.toBe(board)
    expect(setMe(claimed, 'b')).toBe(claimed)
  })
})

describe('randomizeBoard', () => {
  const layouts: LayoutId[] = ['standard4', 'extension6']
  const RESOURCE_TOTALS: Record<LayoutId, Record<TileKind, number>> = {
    standard4: { wood: 4, sheep: 4, wheat: 4, brick: 3, ore: 3, desert: 1 },
    extension6: { wood: 6, sheep: 6, wheat: 6, brick: 5, ore: 5, desert: 2 },
  }
  // The harbours a physical frame carries: one 2:1 per resource (the six-player
  // frame adds a second sheep) and 3:1 for the rest.
  const PORT_TOTALS: Record<LayoutId, Record<string, number>> = {
    standard4: { wood: 1, sheep: 1, wheat: 1, brick: 1, ore: 1, generic: 4 },
    extension6: { wood: 1, sheep: 2, wheat: 1, brick: 1, ore: 1, generic: 5 },
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

        // Every port edge of the frame carries one harbour from the box's set,
        // 2:1 when it names a resource and 3:1 otherwise.
        expect(board.ports.map((port) => port.edgeId).sort()).toEqual([...defaultPortEdges(layout)].sort())
        const portCounts: Record<string, number> = {}
        for (const port of board.ports) {
          expect(port.rate).toBe(port.resource ? 2 : 3)
          const kind = port.resource ?? 'generic'
          portCounts[kind] = (portCounts[kind] ?? 0) + 1
        }
        expect(portCounts).toEqual(PORT_TOTALS[layout])

        // The robber sits on a desert; pieces are cleared.
        expect(board.roads).toHaveLength(0)
        expect(board.buildings).toHaveLength(0)
        const robberHex = board.hexes.find((hex) => board.robber && axialKey(hex.coord) === axialKey(board.robber))
        expect(robberHex?.tile).toBe('desert')
      }
    })
  }

  it('keeps players and redeals the ports', () => {
    const base = addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })
    const board = randomizeBoard(base)
    expect(board.players).toEqual(base.players)
    expect(board.mePlayerId).toBe(base.mePlayerId)
    expect(board.ports.filter((port) => port.rate === 2)).toHaveLength(5)
  })

  it('shuffles the harbours across draws', () => {
    const draws = new Set<string>()
    for (let trial = 0; trial < 40; trial += 1) {
      draws.add(randomizeBoard(createBoard('standard4')).ports.map((port) => port.resource ?? '-').join(','))
    }
    expect(draws.size).toBeGreaterThan(1)
  })
})
