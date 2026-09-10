import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { parseBoard } from '../../model/serialization'
import type { Board } from '../../model/types'
import { parseScreenshot } from '../index'
import { createNodeTextReader } from './textReader'

import expectedDraft from './expected/board-draft-empty.json'
import expectedEndgame from './expected/board-endgame-pieces.json'
import expectedThreePlayer from './expected/board-draft-3player.json'

function image(path: string) {
  const png = PNG.sync.read(readFileSync(fileURLToPath(new URL(path, import.meta.url))))
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }
}

function normalized(board: Board): Board {
  return {
    ...board,
    ports: [...board.ports].sort((a, b) => a.edgeId.localeCompare(b.edgeId)),
    roads: [...board.roads].sort((a, b) => a.edgeId.localeCompare(b.edgeId)),
    buildings: [...board.buildings].sort((a, b) => a.vertexId.localeCompare(b.vertexId)),
  }
}

describe('screenshot parser', () => {
  it.each([
    ['draft', '../../../fixtures/board-draft-empty.png', expectedDraft],
    ['endgame', '../../../fixtures/board-endgame-pieces.png', expectedEndgame],
    ['draft sRGB', './derived/board-draft-empty.srgb.png', expectedDraft],
    ['endgame sRGB', './derived/board-endgame-pieces.srgb.png', expectedEndgame],
    // No sRGB twin: the conversion that produced the two derived fixtures is
    // not recorded in the repo, so this one is pinned raw only.
    ['three player', '../../../fixtures/board-draft-3player.png', expectedThreePlayer],
  ])('parses the %s fixture into the pinned board', (_name, path, expected) => {
    const result = parseScreenshot(image(path))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(parseBoard(result.game.board).ok).toBe(true)
    expect(normalized(result.game.board)).toEqual(normalized(expected as Board))
  })

  it('infers the robber-occluded endgame token from the distribution', () => {
    const result = parseScreenshot(image('../../../fixtures/board-endgame-pieces.png'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The robber hides one token; the standard distribution accounts for every
    // other number, so the gap at (-3,1) must be a 6 — recovered, not unreadable.
    expect(result.issues.filter((issue) => issue.severity === 'unreadable')).toEqual([])
    const occluded = result.game.board.hexes.find((hex) => hex.coord.q === -3 && hex.coord.r === 1)
    expect(occluded?.numberToken).toBe(6)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ stage: 'tokens', ref: '-3,1', severity: 'warning' }),
    )
  })

  it('parses the draft fixture without token review issues', () => {
    const result = parseScreenshot(image('../../../fixtures/board-draft-empty.png'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issues.filter((issue) =>
      issue.severity === 'unreadable' || issue.message.toLowerCase().includes('review'),
    )).toEqual([])
  })
})

const tessdata = fileURLToPath(new URL('../../../public/tessdata', import.meta.url))

describe.skipIf(!existsSync(`${tessdata}/eng.traineddata.gz`))('offline name OCR', () => {
  it('reads both chip rows with the committed local language data', async () => {
    const reader = await createNodeTextReader(tessdata)
    try {
      const cases = [
        ['../../../fixtures/board-draft-empty.png', ['ben', 'yus', 'jen', 'you', 'emi'], 'p4'],
        ['../../../fixtures/board-endgame-pieces.png', ['jen', 'you', 'ben', 'emi', 'yus'], 'p2'],
      ] as const
      for (const [path, prefixes, me] of cases) {
        const source = image(path)
        const result = parseScreenshot(source)
        expect(result.ok).toBe(true)
        if (!result.ok) continue
        const names: string[] = []
        for (const { rect } of result.nameRects) {
          names.push((await reader.read(source, rect)).toLowerCase())
        }
        expect(names.filter((name, index) => name.startsWith(prefixes[index])).length).toBeGreaterThanOrEqual(3)
        expect(result.game.board.mePlayerId).toBe(me)
      }
    } finally {
      await reader.terminate?.()
    }
  }, 30_000)
})
