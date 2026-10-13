import { edgeEndpointVertexIds, vertexIncidentEdgeIds } from '../model/coords'
import { boardGrid } from '../model/layouts'
import type { Board, EdgeId, VertexId } from '../model/types'
import type { Recommendation } from './analysisProtocol'
import { blockedVertices } from './legality'

export interface RowContest {
  spots: VertexId[]
  contested: { vertexId: VertexId; playerId: string }[]
}

function steps(board: Board, vertexId: VertexId): { edgeId: EdgeId; to: VertexId }[] {
  const { edgeIds } = boardGrid(board.layout)
  return vertexIncidentEdgeIds(vertexId)
    .filter((edgeId) => edgeIds.includes(edgeId))
    .map((edgeId) => ({ edgeId, to: edgeEndpointVertexIds(edgeId).find((end) => end !== vertexId)! }))
}

const roadOwner = (board: Board, edgeId: EdgeId): string | undefined =>
  board.roads.find((road) => road.edgeId === edgeId)?.playerId

const built = (board: Board, vertexId: VertexId): boolean =>
  board.buildings.some((building) => building.vertexId === vertexId)

const isRoadEnd = (board: Board, playerId: string, vertexId: VertexId): boolean =>
  !built(board, vertexId) && steps(board, vertexId).some(({ edgeId }) => roadOwner(board, edgeId) === playerId)

export function expansionSpots(
  board: Board,
  playerId: string,
  firstPick: VertexId,
  firstRoad: EdgeId | null,
): VertexId[] {
  if (firstRoad === null) return []
  const far = steps(board, firstPick).find(({ edgeId }) => edgeId === firstRoad)?.to
  if (far === undefined || (roadOwner(board, firstRoad) ?? playerId) !== playerId) return []
  const blocked = blockedVertices(board.layout, [...board.buildings.map((building) => building.vertexId), firstPick])
  return steps(board, far)
    .filter(({ edgeId, to }) => !blocked.has(to) && (roadOwner(board, edgeId) ?? playerId) === playerId)
    .map(({ to }) => to)
}

export function contestRivals(board: Board, playerId: string, site: VertexId): string[] {
  return board.players
    .map((player) => player.id)
    .filter((rival) => rival !== playerId && (
      isRoadEnd(board, rival, site)
      || steps(board, site).some(({ edgeId, to }) =>
        (roadOwner(board, edgeId) ?? rival) === rival && isRoadEnd(board, rival, to))
    ))
}

export function rowContest(
  board: Board,
  playerId: string,
  row: Pick<Recommendation, 'firstPick' | 'firstRoad'>,
): RowContest {
  const spots = expansionSpots(board, playerId, row.firstPick, row.firstRoad)
  return {
    spots,
    contested: spots.flatMap((vertexId) =>
      contestRivals(board, playerId, vertexId).map((rival) => ({ vertexId, playerId: rival }))),
  }
}
