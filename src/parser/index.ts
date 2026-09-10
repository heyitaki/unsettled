import { axialKey } from '../model/coords'
import { newGame, reconcileStats, type Game } from '../model/game'
import { defaultPortEdges, inferMissingNumberToken } from '../model/layouts'
import { parseBoard } from '../model/serialization'
import { PLAYER_PALETTE, type Board, type Hex, type Player } from '../model/types'
import type { RgbaImage } from './image'
import { detectPieces, type PieceOwner } from './pieces'
import { detectPorts } from './ports'
import { registerBoard } from './registration'
import { detectRoster } from './sources/settled/chips'
import { readCounters } from './sources/settled/counters'
import { choosePalette } from './sources/settled/palette'
import type { ParseIssue, SourceParse } from './sources/types'

export type { SourceParse } from './sources/types'
import { analyzeToken } from './tokens'

export type { RgbaImage } from './image'
export type { ParseIssue } from './sources/types'
export type { TextReader } from './textReader'

export function parseScreenshot(image: RgbaImage): SourceParse {
  const failure = (error: string): SourceParse => ({ ok: false, error })
  let palette
  try {
    palette = choosePalette(image)
  } catch {
    return failure('not a recognizable board')
  }
  if (!palette) return failure('not a recognizable board')
  try {
    if (image.width < 32 || image.height < 32 || image.data.length < image.width * image.height * 4) {
      return failure('not a recognizable board')
    }
    const registration = registerBoard(image, palette)
    if (!registration) return failure('could not register a Catan board')
    const issues: ParseIssue[] = []
    if (Math.abs(registration.hexWidth - Math.sqrt(3) * registration.size) > 0.02 * registration.hexWidth ||
      registration.maxResidual >= 0.12 * registration.size) {
      issues.push({
        stage: 'registration',
        severity: 'warning',
        message: 'Board registration is uncertain',
      })
    }
    if (registration.softInput) {
      issues.push({
        stage: 'sharpness',
        severity: 'warning',
        message: `Soft input detected (${(registration.sharpness * 100).toFixed(1)}% palette sharpness)`,
      })
    }
    const roster = detectRoster(image, palette, registration)
    const fallbackColors = Object.entries(palette.player).map(([name, anchor]): PieceOwner & { player: Player } => ({
      id: `s-${name}`,
      anchor,
      player: {
        id: `s-${name}`,
        name: name[0].toUpperCase() + name.slice(1),
        color: PLAYER_PALETTE[name as keyof typeof palette.player],
      },
    }))
    const rosterOwners = roster.players.map((entry) => ({ id: entry.player.id, anchor: entry.anchor }))
    const rosterColors = new Set(roster.players.map((entry) => entry.player.color))
    const missingColorOwners = fallbackColors.filter((entry) => !rosterColors.has(entry.player.color))
    const owners: PieceOwner[] = roster.players.length > 0
      ? [...rosterOwners, ...missingColorOwners]
      : fallbackColors
    const pieces = detectPieces(image, registration, owners)
    let players: Player[]
    let mePlayerId: string | null
    if (roster.players.length > 0) {
      players = roster.players.map((entry) => entry.player)
      for (const fallback of missingColorOwners) {
        if (pieces.usedPlayerIds.has(fallback.id) && players.length < 6) {
          players.push(fallback.player)
          issues.push({
            stage: 'roster',
            severity: 'warning',
            message: `Synthesized a player for an unmatched ${fallback.player.name.toLowerCase()} piece`,
          })
        }
      }
      mePlayerId = roster.mePlayerId
      if (mePlayerId === null) {
        issues.push({ stage: 'roster', severity: 'warning', message: 'Could not identify the You chip' })
      }
    } else {
      players = fallbackColors.filter((entry) => pieces.usedPlayerIds.has(entry.id)).map((entry) => entry.player)
      if (players.length === 0) players = [fallbackColors[0].player]
      mePlayerId = null
      issues.push({ stage: 'roster', severity: 'warning', message: 'Roster was synthesized from detected pieces' })
    }
    const playerIds = new Set(players.map((player) => player.id))
    const roads = pieces.roads.filter((road) => playerIds.has(road.playerId))
    const buildings = pieces.buildings.filter((building) => playerIds.has(building.playerId))
    if (pieces.ignored > 0) {
      issues.push({
        stage: 'pieces',
        severity: 'warning',
        message: `Ignored ${pieces.ignored} colored overlay component${pieces.ignored === 1 ? '' : 's'}`,
      })
    }
    if (pieces.duplicates > 0) {
      issues.push({
        stage: 'pieces',
        severity: 'warning',
        message: `Resolved ${pieces.duplicates} duplicate piece claim${pieces.duplicates === 1 ? '' : 's'}`,
      })
    }
    const portDetection = detectPorts(image, palette, registration)
    for (const port of portDetection.ports) {
      if (port.ambiguous) {
        issues.push({
          stage: 'ports',
          severity: 'warning',
          message: 'Port is nearly equidistant from two coastal edges',
          ref: port.edgeId,
        })
      }
    }
    for (const edgeId of portDetection.duplicateEdgeIds) {
      issues.push({
        stage: 'ports',
        severity: 'warning',
        message: 'Discarded a duplicate port pill for an already claimed edge',
        ref: edgeId,
      })
    }
    const portOrder = defaultPortEdges(registration.layout)
    const ports = portDetection.ports
      .map(({ ambiguous: _ambiguous, ...port }) => port)
      .sort((a, b) => portOrder.indexOf(a.edgeId) - portOrder.indexOf(b.edgeId))
    const hexes: Hex[] = []
    const robberCandidates: { coord: Hex['coord']; corePixels: number }[] = []
    for (const tile of registration.tiles) {
      const [centerX, centerY] = registration.center(tile)
      const analysis = analyzeToken(image, palette, centerX, centerY, registration.size)
      const ref = axialKey(tile)
      if (analysis.robber) {
        robberCandidates.push({
          coord: { q: tile.q, r: tile.r },
          corePixels: analysis.corePixels,
        })
      }
      let numberToken = analysis.number
      if (tile.tile === 'desert') numberToken = null
      if (analysis.robber && tile.tile !== 'desert') {
        issues.push({
          stage: 'tokens',
          severity: 'unreadable',
          message: 'Number token is occluded by the robber',
          ref,
        })
      } else if (tile.tile !== 'desert' && numberToken === null) {
        issues.push({
          stage: 'tokens',
          severity: 'unreadable',
          message: analysis.hasToken ? 'Number token needs review' : 'Number token is missing or unreadable',
          ref,
        })
      } else if (numberToken !== null && (registration.softInput || analysis.redMismatch)) {
        issues.push({
          stage: 'tokens',
          severity: 'warning',
          message: registration.softInput ? 'Number token needs review on a soft input' : 'Number token color cross-check failed',
          ref,
        })
      }
      hexes.push({
        coord: { q: tile.q, r: tile.r },
        tile: tile.tile,
        numberToken,
      })
    }
    if (robberCandidates.length === 0) {
      issues.push({ stage: 'tokens', severity: 'warning', message: 'No robber was detected' })
    } else if (robberCandidates.length > 1) {
      issues.push({ stage: 'tokens', severity: 'warning', message: 'Multiple robber candidates were detected' })
    }
    const robber = robberCandidates.sort((a, b) => b.corePixels - a.corePixels)[0]?.coord ?? null

    // A single hidden token is recoverable from the fixed distribution.
    const inferred = inferMissingNumberToken(hexes, registration.layout)
    if (inferred) {
      const ref = axialKey(inferred.coord)
      const hex = hexes.find((candidate) => axialKey(candidate.coord) === ref)
      if (hex) hex.numberToken = inferred.number
      const issue = issues.find((candidate) => candidate.stage === 'tokens' && candidate.ref === ref)
      if (issue) {
        issue.severity = 'warning'
        issue.message = `Number token was hidden — inferred ${inferred.number} from the standard number distribution`
      }
    }
    const board: Board = {
      schemaVersion: 1,
      layout: registration.layout,
      hexes,
      ports,
      robber,
      roads,
      buildings,
      players,
      mePlayerId,
    }
    const validated = parseBoard(board)
    if (!validated.ok) return failure(`Parsed board was invalid: ${validated.errors.join('; ')}`)
    const statDetection = readCounters(image, palette, registration, roster)
    const game: Game = {
      ...newGame(board),
      stats: reconcileStats(statDetection.stats, players),
    }
    return {
      ok: true,
      game,
      issues: [...issues, ...statDetection.issues],
      nameRects: roster.players.map((entry) => ({ playerId: entry.player.id, rect: entry.labelRect })),
    }
  } catch {
    return failure('could not parse this image')
  }
}
