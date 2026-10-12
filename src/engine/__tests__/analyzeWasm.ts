import { readFileSync } from 'node:fs'
import type { Board } from '../../model/types'
import { createEngine } from '../advice/wasm'
import type { DraftAnalysis } from '../analysisProtocol'

// Awaited at import, so the engine is loaded before a test that imports this runs and `analyze` is synchronous.
const engine = await createEngine(readFileSync(new URL('../advice/engine.wasm', import.meta.url)), () => {})

/** The committed engine's analysis of `board`, for a test that needs a real ranking. */
export function analyze(
  board: Board,
  { targetPick, ...options }: { targetPick?: number; seed?: number; rollouts?: number; maxResults?: number } = {},
): DraftAnalysis {
  const response = engine.analyze(JSON.stringify({ board, targetPick, options }))
  if ('error' in response) throw new Error(response.error)
  return response
}
