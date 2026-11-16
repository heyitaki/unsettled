import { axialKey } from '../../../model/coords'
import { boardGrid } from '../../../model/layouts'
import type { AxialCoord, Board, Hex, TileKind } from '../../../model/types'
import { pixel, type RgbaImage } from '../../image'
import { synthesizeRoster } from '../../roster'
import type { ParseIssue } from '../types'
import { classifyTerrain } from './palette'
import { detectPieces, orderPieces } from './pieces'
import { readPanel, type PanelPlayer } from './panel'
import { detectPorts } from './ports'
import { registerBoard } from './registration'
import { hasRobber, readNumber } from './tokens'

export function parseColonist(image: RgbaImage): {
  board: Omit<Board, 'schemaVersion'>
  roster: PanelPlayer[]
  // The roster is in turn order: the panel told the first player and no piece needed a synthesized seat.
  ordered: boolean
  unorderedPicks: string[]
  issues: ParseIssue[]
} | null {
  const registration = registerBoard(image)
  if (!registration) return null
  const issues: ParseIssue[] = []
  const hexes: Hex[] = []
  const robbers: AxialCoord[] = []
  for (const coord of boardGrid('standard4').landCoords) {
    const [x, y] = registration.center(coord)
    const votes = new Map<TileKind, number>()

    // Sample beside the square, below the artwork and away from edge pieces.
    for (let row = 0; row < 10; row += 1) {
      for (const side of [-1, 1]) {
        for (let column = 0; column < 5; column += 1) {
          const tile = classifyTerrain(pixel(image,
            x + side * (0.4 + 0.05 * column) * registration.size,
            y + (-0.1 + 0.06 * row) * registration.size,
          ))
          if (tile) votes.set(tile, (votes.get(tile) ?? 0) + 1)
        }
      }
    }
    const best = [...votes].sort((a, b) => b[1] - a[1])[0]
    if (!best || best[1] < 60) return null
    const tile = best[0]
    const square = registration.squares.find((candidate) => axialKey(candidate) === axialKey(coord))
    if ((tile === 'desert') !== (square === undefined)) return null
    const reading = square ? readNumber(image, square) : null
    const numberToken = reading?.number ?? null
    if (tile !== 'desert' && numberToken === null) issues.push({
      stage: 'tokens',
      severity: 'unreadable',
      message: 'Number token is missing or unreadable',
      ref: axialKey(coord),
    })
    if (reading?.colorMismatch) issues.push({
      stage: 'tokens',
      severity: 'unreadable',
      message: 'Number token color cross-check failed',
      ref: axialKey(coord),
    })
    hexes.push({ coord: { ...coord }, tile, numberToken })
    if (hasRobber(image, x, y, registration.size)) robbers.push(coord)
  }
  if (robbers.length !== 1) issues.push({
    stage: 'tokens',
    severity: 'unreadable',
    message: robbers.length === 0 ? 'No robber was detected' : 'Multiple robber candidates were detected',
  })
  const ports = detectPorts(image, registration, issues)
  const pieces = detectPieces(image, registration, issues)
  const panel = readPanel(image, registration, pieces.buildings)
  let ordered = panel?.ordered ?? false
  const detected = pieces.players
  const used = new Set([...pieces.buildings, ...pieces.roads].map((piece) => piece.playerId))
  pieces.players = panel?.players.map((entry) => entry.player) ?? []
  if (panel) issues.push(...panel.issues)
  const candidates = panel ? detected.filter((entry) => used.has(entry.id)) : detected
  if (synthesizeRoster(pieces.players, candidates, issues)) ordered = false
  const orderedPieces = orderPieces(pieces)
  return {
    board: {
      layout: 'standard4',
      hexes,
      ports,
      robber: robbers.length === 1 ? { ...robbers[0] } : null,
      roads: orderedPieces.roads,
      buildings: orderedPieces.buildings,
      players: pieces.players,
      mePlayerId: panel?.mePlayerId ?? null,
    },
    roster: panel?.players ?? [],
    ordered,
    unorderedPicks: orderedPieces.unorderedPicks,
    issues,
  }
}
