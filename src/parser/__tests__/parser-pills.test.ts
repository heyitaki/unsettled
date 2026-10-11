import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { inferDraftState } from '../../engine/draft'
import { emptyStats } from '../../model/game'
import { PLAYER_PALETTE, type Board } from '../../model/types'
import { parseScreenshot } from '../index'
import { registerBoard } from '../registration'
import { detectRoster } from '../sources/settled/pills'
import { choosePalette } from '../sources/settled/palette'

function image(name: string) {
  const path = fileURLToPath(new URL(`../../../fixtures/${name}.png`, import.meta.url))
  const png = PNG.sync.read(readFileSync(path))
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }
}

// Row by row, left to right, so each string reads like the screenshot.
const hexRows = (board: Board): string => [...board.hexes]
  .sort((a, b) => a.coord.r - b.coord.r || a.coord.q - b.coord.q)
  .map((hex) => `${hex.tile}:${hex.numberToken}`)
  .join(' ')

const portKinds = (board: Board): string[] => board.ports
  .map((port) => `${port.resource ?? 'any'} ${port.rate}:1`)
  .sort()

type Color = keyof typeof PLAYER_PALETTE

interface Expected {
  layout: Board['layout']
  colors: Color[]
  turn: string
  vp: number[]
  hexes: string
  robber: Board['robber']
  ports: string[]
  buildings: Board['buildings']
  roads: Board['roads']
}

const FIXTURES: [string, Expected][] = [
  ['settled-2p-first-pick', {
    layout: 'standard4',
    colors: ['white', 'brown'],
    turn: 'p2',
    vp: [1, 0],
    hexes: 'brick:3 sheep:6 wood:2 ' +
      'ore:8 wheat:9 desert:null wood:5 ' +
      'wood:10 wheat:5 wood:4 sheep:11 brick:10 ' +
      'brick:9 wheat:6 wheat:3 ore:8 ' +
      'sheep:12 ore:11 sheep:4',
    robber: { q: 1, r: -1 },
    ports: ['any 3:1', 'any 3:1', 'any 3:1', 'any 3:1', 'brick 2:1', 'ore 2:1', 'sheep 2:1', 'wheat 2:1', 'wood 2:1'],
    buildings: [{ vertexId: 'v:-1,-1;-1,0;0,-1', playerId: 'p1', tier: 'settlement' }],
    roads: [{ edgeId: 'e:-1,-1;0,-1', playerId: 'p1' }],
  }],
  ['settled-3p-pick-cards', {
    layout: 'standard4',
    colors: ['red', 'white', 'green'],
    turn: 'p1',
    vp: [0, 0, 0],
    hexes: 'wood:8 wood:5 desert:null ' +
      'wheat:4 sheep:11 brick:10 wheat:2 ' +
      'wood:11 ore:3 brick:4 sheep:9 ore:6 ' +
      'sheep:12 brick:6 wheat:5 wood:3 ' +
      'wheat:9 sheep:10 ore:8',
    robber: { q: 2, r: -2 },
    ports: ['any 3:1', 'any 3:1', 'any 3:1', 'any 3:1', 'brick 2:1', 'ore 2:1', 'sheep 2:1', 'wheat 2:1', 'wood 2:1'],
    buildings: [],
    roads: [],
  }],
  ['settled-5p-draft-start', {
    layout: 'extension6',
    colors: ['white', 'brown', 'blue', 'red', 'green'],
    turn: 'p1',
    vp: [0, 0, 0, 0, 0],
    hexes: 'brick:3 brick:6 wheat:11 ' +
      'sheep:5 brick:9 ore:11 brick:5 ' +
      'wood:6 sheep:10 wood:12 wood:8 wood:3 ' +
      'desert:null ore:4 ore:8 sheep:10 sheep:4 wood:4 ' +
      'sheep:9 wheat:12 wheat:9 wheat:3 wheat:2 ' +
      'ore:8 brick:5 sheep:10 wood:2 ' +
      'wheat:11 ore:6 desert:null',
    robber: { q: -1, r: 3 },
    ports: [
      'any 3:1', 'any 3:1', 'any 3:1', 'any 3:1', 'any 3:1',
      'brick 2:1', 'ore 2:1', 'sheep 2:1', 'sheep 2:1', 'wheat 2:1', 'wood 2:1',
    ],
    buildings: [],
    roads: [],
  }],
]

describe('Settled player pills', () => {
  it('measures brown from the Settled dot', () => {
    expect(PLAYER_PALETTE.brown).toBe('#684d43')
  })

  describe.each(FIXTURES)('%s', (name, expected) => {
    const source = image(name)
    const result = parseScreenshot(source)
    if (!result.ok) throw new Error(result.error)
    const { board } = result.game

    it('reads the pills in turn order with their colours', () => {
      expect(board.players).toEqual(expected.colors.map((color, index) => ({
        id: `p${index + 1}`,
        name: color[0].toUpperCase() + color.slice(1),
        color: PLAYER_PALETTE[color],
      })))
    })

    // The highlighted pill is the player to move. Claiming that seat is what
    // opens Best picks on their turn, and the turn inferred from the pieces has
    // to agree or the ribbon would ring a different player.
    it('claims the highlighted player, who is the one to move', () => {
      expect(board.mePlayerId).toBe(expected.turn)
      expect(inferDraftState(board).currentPlayerId).toBe(expected.turn)
    })

    it('reads victory points and hand size from each pill', () => {
      const palette = choosePalette(source)
      if (!palette) throw new Error('no palette')
      const registration = registerBoard(source, palette)
      if (!registration) throw new Error('no registration')
      const roster = detectRoster(source, palette, registration)
      expect(roster.turnPlayerId).toBe(expected.turn)
      expect(roster.players.map((entry) => entry.vp)).toEqual(expected.vp)
      expect(roster.players.map((entry) => entry.hand)).toEqual(expected.vp.map(() => 0))
      expect(result.game.stats).toEqual(Object.fromEntries(board.players.map((player) => [player.id, emptyStats()])))
    })

    it('parses the board content', () => {
      expect(board.layout).toBe(expected.layout)
      expect(hexRows(board)).toBe(expected.hexes)
      expect(board.robber).toEqual(expected.robber)
      expect(portKinds(board)).toEqual(expected.ports)
      expect(board.buildings).toEqual(expected.buildings)
      expect(board.roads).toEqual(expected.roads)
    })

    // Chrome, avatars and the blinking placement circles must not surface as
    // phantom ports, stray pieces, soft-input warnings or unread tokens.
    it('raises no issues', () => {
      expect(result.issues).toEqual([])
    })
  })
})
