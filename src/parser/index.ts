import type { RgbaImage } from './image'
import { createSourceRegistry, DEFAULT_SOURCES } from './sources/registry'
import type { ParseBoardImageResult, ParseIssue, SourceParse } from './sources/types'
import type { TextReader } from './textReader'

export type { RgbaImage } from './image'
export type { ParseBoardImageResult, ParseIssue } from './sources/types'
export type { TextReader } from './textReader'

const registry = createSourceRegistry(DEFAULT_SOURCES)

export function parseScreenshot(image: RgbaImage): SourceParse {
  return registry.parse(image)
}

export function parseBoardImage(image: RgbaImage): ParseBoardImageResult {
  const result = registry.parse(image)
  if (!result.ok) return result
  return { ok: true, game: result.game, issues: result.issues }
}

export async function parseBoardImageWithNames(
  image: RgbaImage,
  reader: TextReader,
): Promise<ParseBoardImageResult> {
  const result = registry.parse(image)
  if (!result.ok) return result
  const game = result.game
  const issues: ParseIssue[] = [...result.issues]
  try {
    const readings: { playerId: string; name: string }[] = []
    for (const item of result.nameRects) {
      const name = await reader.read(image, item.rect)
      if (name) readings.push({ playerId: item.playerId, name })
    }
    for (const reading of readings) {
      const { playerId, name } = reading
      const player = game.board.players.find((candidate) => candidate.id === playerId)
      if (player) player.name = name
      if (name.trim().toLowerCase() === 'you') game.board.mePlayerId = playerId
    }
  } catch (error) {
    issues.push({
      stage: 'ocr',
      severity: 'warning',
      message: `Name OCR unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
    })
  }
  return { ok: true, game, issues }
}
