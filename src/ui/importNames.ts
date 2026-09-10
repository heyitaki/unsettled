import type { Dispatch } from 'react'
import type { RgbaImage } from '../parser'
import type { SourceParse } from '../parser'
import type { StoreAction } from './store'

export async function importNames(
  id: string,
  image: RgbaImage,
  parsed: Extract<SourceParse, { ok: true }>,
  dispatch: Dispatch<StoreAction>,
) {
  if (parsed.nameRects.length === 0) return
  try {
    const { createBrowserTextReader } = await import('../parser/textReader')
    const reader = await createBrowserTextReader()
    try {
      const names: { playerId: string; name: string }[] = []
      for (const { playerId, rect } of parsed.nameRects) {
        const name = await reader.read(image, rect)
        if (name) names.push({ playerId, name })
      }
      dispatch({ type: 'import-names', id, original: parsed.game.board, names })
    } finally {
      await reader.terminate?.()
    }
  } catch {
    dispatch({ type: 'notice', message: 'Board imported. Player names could not be read. You can rename them in Players.' })
  }
}
