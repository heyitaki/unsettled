import { AWARD_VP, buildingPoints, RESOURCE_COUNTS } from '../model/board'
import { axialKey } from '../model/coords'
import { newGame, type Game } from '../model/game'
import { defaultPortEdges, inferMissingNumberToken, NUMBER_TOKEN_COUNTS } from '../model/layouts'
import { parseBoard } from '../model/serialization'
import type { Board, Hex, Player } from '../model/types'
import type { RgbaImage } from './image'
import { playerFromSeed } from './palette'
import { detectPieces, orderDraftSettlements, type PieceOwner } from './pieces'
import { detectPorts } from './ports'
import { registerBoard } from './registration'
import { synthesizeRoster } from './roster'
import { parseColonist } from './sources/colonist'
import { detectRoster } from './sources/settled/pills'
import { choosePalette } from './sources/settled/palette'
import type { ParseIssue, SourceParse } from './sources/types'

export type { SourceParse } from './sources/types'
import { analyzeToken } from './tokens'

export type { RgbaImage } from './image'
export type { ParseIssue } from './sources/types'

export function parseScreenshot(image: RgbaImage): SourceParse {
  return parseColonistScreenshot(image) ?? parseSettled(image)
}

function parseColonistScreenshot(image: RgbaImage): Extract<SourceParse, { ok: true }> | null {
  try {
    const colonist = parseColonist(image)
    if (!colonist) return null
    const assembled = assembleBoard(colonist.board, colonist.issues)
    if (!assembled.ok) return null
    const { game } = assembled
    checkDistributions(game.board, colonist.issues)
    const hands = applyPlayerStats(game, colonist.roster, colonist.issues)
    return {
      ok: true,
      game,
      issues: colonist.issues,
      read: {
        roster: colonist.roster.length > 0 && colonist.roster.length === game.board.players.length,
        order: colonist.ordered,
        picks: false,
        hands,
        unorderedPicks: colonist.unorderedPicks,
        points: readPoints(colonist.roster),
        knights: colonist.roster.filter((entry) => entry.knights !== null).map((entry) => entry.player.id),
      },
    }
  } catch {
    // Registration and malformed images can fail without a usable board.
    return null
  }
}

function parseSettled(image: RgbaImage): SourceParse {
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
    issues.push(...roster.issues)
    const fallbackColors = Object.entries(palette.player).map(([name, anchor]): PieceOwner & { player: Player } => ({
      id: `s-${name}`,
      anchor,
      player: playerFromSeed(`s-${name}`, name as keyof typeof palette.player),
    }))
    const rosterOwners = roster.players.map((entry) => ({ id: entry.player.id, anchor: entry.anchor }))
    const rosterColors = new Set(roster.players.map((entry) => entry.player.color))
    const missingColorOwners = fallbackColors.filter((entry) => !rosterColors.has(entry.player.color))
    const owners: PieceOwner[] = roster.players.length > 0
      ? [...rosterOwners, ...missingColorOwners]
      : fallbackColors
    const pieces = detectPieces(image, palette, registration, owners)
    const players = roster.players.map((entry) => entry.player)
    const detected = missingColorOwners.filter((entry) => pieces.usedPlayerIds.has(entry.id))
      .map((entry) => entry.player)
    if (players.length === 0 && detected.length === 0) detected.push(fallbackColors[0].player)
    synthesizeRoster(players, detected, issues, roster.players.length > 0 ? 6 : Infinity)
    let mePlayerId: string | null
    if (roster.players.length > 0) {
      mePlayerId = roster.turnPlayerId
      if (mePlayerId === null) {
        issues.push({
          stage: 'roster',
          severity: 'warning',
          message: 'The player to move could not be identified',
        })
      }
    } else {
      mePlayerId = null
    }
    const playerIds = new Set(players.map((player) => player.id))
    const roads = pieces.roads.filter((road) => playerIds.has(road.playerId))
    const { buildings, unorderedPlayerIds, ordered } = orderDraftSettlements(
      image, palette, registration,
      pieces.buildings.filter((building) => playerIds.has(building.playerId)),
      players.map((player) => player.id),
    )
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
      issues.push({
        stage: 'tokens',
        severity: 'warning',
        message: 'No robber was detected',
      })
    } else if (robberCandidates.length > 1) {
      issues.push({
        stage: 'tokens',
        severity: 'warning',
        message: 'Multiple robber candidates were detected',
      })
    }
    const robber = robberCandidates.sort((a, b) => b.corePixels - a.corePixels)[0]?.coord ?? null

    const assembled = assembleBoard({
      layout: registration.layout,
      hexes,
      ports,
      robber,
      roads,
      buildings,
      players,
      mePlayerId,
    }, issues)
    if (!assembled.ok) return assembled
    const { game } = assembled
    const hands = applyPlayerStats(game, roster.players, issues)

    const read = {
      roster: roster.players.length > 0,
      order: roster.players.length > 0,
      picks: roster.players.length > 0 && ordered,
      hands,
      unorderedPicks: unorderedPlayerIds,
      points: readPoints(roster.players),
      knights: [],
    }
    return { ok: true, game, issues, read }
  } catch {
    return failure('could not parse this image')
  }
}

const readPoints = (entries: readonly { player: Player; vp: number | null }[]): Record<string, number> =>
  Object.fromEntries(entries.flatMap((entry) => entry.vp === null ? [] : [[entry.player.id, entry.vp]]))

function applyPlayerStats(game: Game, entries: {
  player: Player
  hand: number | null
  vp: number | null
  devCards?: number | null
  knights?: number | null
}[], issues: ParseIssue[]): string[] {
  const hands: string[] = []
  for (const entry of entries) {
    if (entry.hand !== null) {
      game.stats[entry.player.id].handUnknown = entry.hand
      hands.push(entry.player.id)
    } else issues.push({
      stage: 'stats',
      severity: 'unreadable',
      message: `Could not read hand cards for ${entry.player.name}`,
    })
    if (entry.vp === null) {
      issues.push({
        stage: 'stats',
        severity: 'unreadable',
        message: `Could not read victory points for ${entry.player.name}`,
      })
    } else {
      const buildingVP = game.board.buildings.filter((building) => building.playerId === entry.player.id)
        .reduce((sum, building) => sum + buildingPoints(building.tier), 0)
      if (![0, AWARD_VP, 2 * AWARD_VP].includes(entry.vp - buildingVP)) {
        issues.push({
          stage: 'stats',
          severity: 'warning',
          message: `Victory points disagree with parsed buildings for ${entry.player.name}`,
        })
      }
    }
    for (const [field, label] of [['devCards', 'development cards'], ['knights', 'knights played']] as const) {
      const count = entry[field]
      if (count === undefined) continue
      if (count !== null) game.stats[entry.player.id][field] = count
      else issues.push({
        stage: 'stats',
        severity: 'unreadable',
        message: `Could not read ${label} for ${entry.player.name}`,
      })
    }
  }
  return hands
}

function assembleBoard(fields: Omit<Board, 'schemaVersion'>, issues: ParseIssue[]):
  { ok: true; game: Game } | { ok: false; error: string } {
  const { hexes, layout } = fields

  // A single hidden token is recoverable from the fixed distribution.
  const inferred = inferMissingNumberToken(hexes, layout)
  if (inferred) {
    const ref = axialKey(inferred.coord)
    const hex = hexes.find((candidate) => axialKey(candidate.coord) === ref)
    if (hex) hex.numberToken = inferred.number
    const issue = issues.find((candidate) => candidate.stage === 'tokens' && candidate.ref === ref)
    if (issue) {
      issue.severity = 'warning'
      issue.message = `Number token was hidden, inferred ${inferred.number} from the standard number distribution`
    }
  }
  const board: Board = { schemaVersion: 1, ...fields }
  const validated = parseBoard(board)
  if (!validated.ok) return { ok: false, error: `Parsed board was invalid: ${validated.errors.join('; ')}` }
  return { ok: true, game: newGame(board) }
}

function checkDistributions(board: Board, issues: ParseIssue[]): void {

  // ponytail: Colonist variants and custom maps would be flagged by these base-game counts.
  checkCounts(board.hexes, (hex) => hex.tile, RESOURCE_COUNTS[board.layout], 'Tiles', 'registration', issues)
  checkCounts(board.hexes.filter((hex) => hex.tile !== 'desert'),
    (hex) => hex.numberToken === null ? null : String(hex.numberToken), NUMBER_TOKEN_COUNTS[board.layout], 'Number tokens', 'tokens', issues)
}

function checkCounts(
  hexes: Hex[], value: (hex: Hex) => string | null, expected: Readonly<Record<string, number>>,
  noun: string, stage: ParseIssue['stage'], issues: ParseIssue[],
): void {
  const counts = new Map<string | null, number>()
  for (const hex of hexes) counts.set(value(hex), (counts.get(value(hex)) ?? 0) + 1)
  if (Object.entries(expected).every(([key, count]) => counts.get(key) === count)) return
  const suspects = hexes.filter((hex) => {
    const key = value(hex)
    return key === null || counts.get(key)! > (expected[key] ?? 0)
  })
  issues.push({
    stage,
    severity: 'unreadable',
    message: `${noun} disagree with the standard distribution`,
    ...(suspects.length === 1 ? { ref: axialKey(suspects[0].coord) } : {}),
  })
}
