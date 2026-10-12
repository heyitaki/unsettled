import type { Board, EdgeId, VertexId } from '../model/types'
import { fetchEngine } from './advice/fetchEngine'
import type { Engine } from './advice/wasm'

let engine: Promise<Engine> | null = null

/** The setup road for a corner placed by hand, or null when it opens nothing worth walking to. */
export async function setupRoad(board: Board, playerId: string, vertexId: VertexId): Promise<EdgeId | null> {
  let response: ReturnType<Engine['setupRoad']>
  try {
    engine ??= fetchEngine(() => {})
    response = (await engine).setupRoad(JSON.stringify({ board, playerId, vertexId }))
  } catch (error) {
    // A trap can leave wasm state half-written; the next tap needs a fresh instance.
    engine = null
    throw error
  }
  // A refused request leaves the instance healthy, so it is kept.
  if ('error' in response) throw new Error(response.error)
  return response.road
}
