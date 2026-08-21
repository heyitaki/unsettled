import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { computeStandings } from '../../engine/stats'
import { RESOURCES } from '../../model/types'
import { parseBoardImage, type ParseBoardImageResult, type RgbaImage } from '../index'

function image(path: string): RgbaImage {
  const png = PNG.sync.read(readFileSync(fileURLToPath(new URL(path, import.meta.url))))
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }
}

const parsedImages = new Map<string, ParseBoardImageResult>()

function parse(path: string): ParseBoardImageResult {
  const cached = parsedImages.get(path)
  if (cached) return cached
  const result = parseBoardImage(image(path))
  parsedImages.set(path, result)
  return result
}

const endgameStats = {
  p1: { handUnknown: 12, devCards: 0, knights: 1, vpCards: 0 },
  p2: { handUnknown: 4, devCards: 5, knights: 0, vpCards: 3 },
  p3: { handUnknown: 12, devCards: 0, knights: 0, vpCards: 0 },
  p4: { handUnknown: 3, devCards: 0, knights: 1, vpCards: 0 },
  p5: { handUnknown: 6, devCards: 2, knights: 3, vpCards: 2 },
} as const

describe('Settled chip counters', () => {
  it.each([
    ['raw', '../../../fixtures/board-endgame-pieces.png'],
    ['sRGB', './derived/board-endgame-pieces.srgb.png'],
  ])('reads the pinned endgame stats from the %s fixture', (_name, path) => {
    const result = parse(path)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(Object.fromEntries(Object.entries(result.game.stats).map(([id, stats]) => [
      id,
      {
        handUnknown: stats.handUnknown,
        devCards: stats.devCards,
        knights: stats.knights,
        vpCards: stats.vpCards,
      },
    ]))).toEqual(endgameStats)
    for (const stats of Object.values(result.game.stats)) {
      expect(RESOURCES.map((resource) => stats.hand[resource])).toEqual([0, 0, 0, 0, 0])
    }
    expect(result.issues.filter((issue) => issue.stage === 'stats')).toEqual([])

    // The two-digit values belong to the truncated jend… and ben chips.
    expect(result.game.stats.p1.handUnknown).toBe(12)
    expect(result.game.stats.p3.handUnknown).toBe(12)
    // The other truncated yush… chip includes red and dark counters.
    expect(result.game.stats.p5).toMatchObject({ handUnknown: 6, devCards: 2, knights: 3, vpCards: 2 })
  })

  it('reconciles chip VP cards with board-derived awards and structures', () => {
    const result = parse('../../../fixtures/board-endgame-pieces.png')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const standings = computeStandings(result.game)
    const standing = (playerId: string) => standings.find((candidate) => candidate.playerId === playerId)!
    expect(standing('p2').victoryPoints).toBe(10)
    expect(standing('p3').victoryPoints).toBe(9)
    expect(standing('p4').victoryPoints).toBe(6)
    expect(standing('p5').hasLargestArmy).toBe(true)
    expect(standing('p1').longestRoad).toBe(6)
    expect(standing('p5').longestRoad).toBe(6)
    expect(Number(standing('p1').hasLongestRoad) + Number(standing('p5').hasLongestRoad)).toBe(1)
    expect(standing('p1').victoryPoints + standing('p5').victoryPoints).toBe(18)

    // Settled's red road counter shows that p1 holds the award, but the board
    // leaves p1 and p5 tied and cannot resolve the holder. The engine replays
    // natural parser emission order, which awards this import to p5. Board
    // output must not be reordered to change that result.
    expect(standing('p5').hasLongestRoad).toBe(true)
  })

  it.each([
    ['raw', '../../../fixtures/board-draft-empty.png'],
    ['sRGB', './derived/board-draft-empty.srgb.png'],
  ])('treats absent counters as zero without unreadable issues in the %s draft', (_name, path) => {
    const result = parse(path)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const stats of Object.values(result.game.stats)) {
      expect(stats).toEqual({
        hand: { wood: 0, sheep: 0, wheat: 0, brick: 0, ore: 0 },
        handUnknown: 0,
        devCards: 0,
        knights: 0,
        vpCards: 0,
      })
    }
    expect(result.issues.filter((issue) =>
      issue.stage === 'stats' && issue.severity === 'unreadable',
    )).toEqual([])
  })

  // A three-player roster spreads the same cards over the full row, so its
  // counters sit further from the colour dot than the five-player fixtures'.
  it('reads the wider cards of a three-player roster', () => {
    const result = parse('../../../fixtures/board-draft-3player.png')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.game.stats)).toEqual(['p1', 'p2', 'p3'])
    for (const stats of Object.values(result.game.stats)) {
      expect(stats).toEqual({
        hand: { wood: 0, sheep: 0, wheat: 0, brick: 0, ore: 0 },
        handUnknown: 0,
        devCards: 0,
        knights: 0,
        vpCards: 0,
      })
    }
    expect(result.issues.filter((issue) =>
      issue.stage === 'stats' && issue.severity === 'unreadable',
    )).toEqual([])
  })
})
