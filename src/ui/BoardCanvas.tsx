import { useEffect, useMemo, useState } from 'react'
import {
  axialKey,
  axialToPixel,
  edgeEndpointVertexIds,
  parseEdgeId,
  parseVertexId,
} from '../model/coords'
import { boardGrid } from '../model/layouts'
import {
  placeBuilding,
  placeRoad,
  removeBuilding,
  removePort,
  removeRoad,
  setHexTile,
  setNumberToken,
  setRobber,
  upsertPort,
} from '../model/board'
import type { AxialCoord, Board, EdgeId, Port, VertexId } from '../model/types'
import { INK_COLOR, PAPER_COLOR, readableInk, SEA_COLOR, TILE_COLORS, TOKEN_COLOR } from './colors'
import { PortPopover } from './PortPopover'
import { activeTab, useStore } from './store'

const SIZE = 58
// How far the port bubble sits beyond its coastal edge, radially outward from
// the board center. Large enough that both dotted leader lines stay visible.
const PORT_OFFSET = 50
const PORT_HALF_W = 25
const PORT_HALF_H = 13
// Sea margin kept around the outermost drawn content on every side.
const BOARD_MARGIN = 18
// Shared outline width for every piece (buildings + roads), in unscaled board
// units. Matches the settlement's original border (2.5 stroke × 0.8 scale).
const PIECE_STROKE = 2
// Colored core width of a road; its casing adds PIECE_STROKE on each side.
const ROAD_CORE = 9
// Conservative half-extent a placed building reaches from its vertex, across all
// tiers/scales (city annex ≈ 20 + outline). Used to keep edge pieces in-frame.
const PIECE_REACH = 22

const center = (coord: AxialCoord) => axialToPixel(coord, SIZE)

function vertexPoint(vertexId: VertexId) {
  const points = parseVertexId(vertexId).map(center)
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / 3,
    y: points.reduce((sum, point) => sum + point.y, 0) / 3,
  }
}

function hexPoints(coord: AxialCoord): string {
  const point = center(coord)
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (-90 + index * 60) * Math.PI / 180
    return `${point.x + SIZE * Math.cos(angle)},${point.y + SIZE * Math.sin(angle)}`
  }).join(' ')
}

function pipDots(number: number, x: number, y: number) {
  const count = 6 - Math.abs(7 - number)
  return Array.from({ length: count }, (_, index) => (
    <circle key={index} cx={x + (index - (count - 1) / 2) * 4.2} cy={y + 12} r="1.6" fill={number === 6 || number === 8 ? '#af2020' : INK_COLOR} />
  ))
}

interface PortLayout {
  port: Port
  a: { x: number; y: number }
  b: { x: number; y: number }
  point: { x: number; y: number }
}

export function BoardCanvas() {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  const { board } = tab
  const [editingPort, setEditingPort] = useState<EdgeId | null>(null)
  // The popover edge belongs to the tab it was opened on; keeping it across a
  // tab switch would edit (or crash on) a different board's coastline.
  useEffect(() => setEditingPort(null), [state.activeTabId])
  const grid = useMemo(() => boardGrid(board.layout), [board.layout])
  const ports = useMemo<PortLayout[]>(
    () =>
      board.ports.map((port) => {
        const [a, b] = edgeEndpointVertexIds(port.edgeId).map(vertexPoint)
        const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        // Push the bubble straight out along the coastal edge's outward normal
        // (away from its land hex), so it stays clear of both endpoint vertices
        // — a building on either one won't occlude it.
        const [c1, c2] = parseEdgeId(port.edgeId)
        const landCenter = center(grid.landKeys.has(axialKey(c1)) ? c1 : c2)
        const outward = { x: midpoint.x - landCenter.x, y: midpoint.y - landCenter.y }
        const length = Math.max(1, Math.hypot(outward.x, outward.y))
        const point = {
          x: midpoint.x + (outward.x / length) * PORT_OFFSET,
          y: midpoint.y + (outward.y / length) * PORT_OFFSET,
        }
        return { port, a, b, point }
      }),
    [board.ports, grid],
  )
  // Fit the viewBox to everything drawn (hexes + port bubbles + placed buildings)
  // plus an even margin, so the board is centered in the sea with room for the
  // port leaders and no edge piece gets clipped.
  const viewBox = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    const include = (x: number, y: number) => {
      minX = Math.min(minX, x); minY = Math.min(minY, y)
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    }
    for (const hex of board.hexes) {
      const point = center(hex.coord)
      for (let index = 0; index < 6; index += 1) {
        const angle = ((-90 + index * 60) * Math.PI) / 180
        include(point.x + SIZE * Math.cos(angle), point.y + SIZE * Math.sin(angle))
      }
    }
    for (const { point } of ports) {
      include(point.x - PORT_HALF_W, point.y - PORT_HALF_H)
      include(point.x + PORT_HALF_W, point.y + PORT_HALF_H)
    }
    for (const building of board.buildings) {
      const point = vertexPoint(building.vertexId)
      include(point.x - PIECE_REACH, point.y - PIECE_REACH)
      include(point.x + PIECE_REACH, point.y + PIECE_REACH)
    }
    return {
      x: minX - BOARD_MARGIN,
      y: minY - BOARD_MARGIN,
      width: maxX - minX + BOARD_MARGIN * 2,
      height: maxY - minY + BOARD_MARGIN * 2,
    }
  }, [board.hexes, board.buildings, ports])
  const playerColor = (id: string) => board.players.find((player) => player.id === id)?.color ?? '#333'
  const commit = (nextBoard: Board) => dispatch({ type: 'commit', board: nextBoard })
  const onHex = (coord: AxialCoord) => {
    const hex = board.hexes.find((candidate) => axialKey(candidate.coord) === axialKey(coord))
    if (!hex) return
    if (state.tool.kind === 'tile') commit(setHexTile(board, coord, state.tool.tile))
    else if (state.tool.kind === 'token') {
      if (hex.tile === 'desert') {
        dispatch({ type: 'notice', message: 'Desert hexes cannot have number tokens.' })
        return
      }
      commit(setNumberToken(board, coord, state.tool.number))
    }
    else if (state.tool.kind === 'robber') commit(setRobber(board, coord))
    else if (state.tool.kind === 'erase') {
      let nextBoard = setHexTile(board, coord, null)
      if (nextBoard.robber && axialKey(nextBoard.robber) === axialKey(coord)) {
        nextBoard = setRobber(nextBoard, null)
      }
      commit(nextBoard)
    }
  }
  const onEdge = (edgeId: EdgeId) => {
    if (state.tool.kind === 'piece' && state.tool.tier === 'road') {
      // Clicking your own road again toggles it off.
      const existing = board.roads.find((road) => road.edgeId === edgeId)
      if (existing?.playerId === tab.activePlayerId) commit(removeRoad(board, edgeId))
      else commit(placeRoad(board, edgeId, tab.activePlayerId))
    } else if (state.tool.kind === 'erase') {
      commit(removePort(removeRoad(board, edgeId), edgeId))
    } else if (state.tool.kind === 'port' && grid.coastalEdgeIds.includes(edgeId)) setEditingPort(edgeId)
  }
  const onVertex = (vertexId: VertexId) => {
    if (state.tool.kind === 'piece' && state.tool.tier !== 'road') {
      // Clicking your own building of the same tier toggles it off; a different
      // tier (or a different player's piece) upgrades/replaces it instead.
      const existing = board.buildings.find((building) => building.vertexId === vertexId)
      if (existing?.playerId === tab.activePlayerId && existing.tier === state.tool.tier) {
        commit(removeBuilding(board, vertexId))
      } else commit(placeBuilding(board, vertexId, tab.activePlayerId, state.tool.tier))
    } else if (state.tool.kind === 'erase') commit(removeBuilding(board, vertexId))
  }
  return (
    <section className="board-stage">
      <div className="board-status">
        <span><strong>{board.layout === 'extension6' ? '5–6 player' : '4 player'}</strong> layout</span>
        <span>{board.hexes.filter((hex) => hex.tile).length}/{board.hexes.length} terrain</span>
        <span>{board.roads.length + board.buildings.length} pieces</span>
      </div>
      <svg
        className="board-canvas"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        aria-label="Editable Catan board"
      >
        <rect x={viewBox.x} y={viewBox.y} width={viewBox.width} height={viewBox.height} rx="32" fill={SEA_COLOR} />
        {board.hexes.map((hex) => (
          <polygon
            key={axialKey(hex.coord)}
            points={hexPoints(hex.coord)}
            fill={hex.tile ? TILE_COLORS[hex.tile] : '#d8d7cc'}
            stroke="#f8f1dc"
            strokeWidth="4"
            className={state.highlight === axialKey(hex.coord) ? 'highlighted' : ''}
          />
        ))}
        {board.hexes.map((hex) => {
          if (hex.numberToken === null) return null
          const point = center(hex.coord)
          const hot = hex.numberToken === 6 || hex.numberToken === 8
          return (
            <g key={`token:${axialKey(hex.coord)}`}>
              <circle cx={point.x} cy={point.y} r="23" fill={TOKEN_COLOR} stroke={INK_COLOR} strokeWidth="2.5" />
              <text x={point.x} y={point.y + 6} textAnchor="middle" className={hot ? 'token-text hot' : 'token-text'}>{hex.numberToken}</text>
              {pipDots(hex.numberToken, point.x, point.y)}
            </g>
          )
        })}
        {board.robber && (() => {
          const point = center(board.robber)
          return (
            <g transform={`translate(${point.x} ${point.y})`}>
              <circle cy="-10" r="9" fill="#1c1c1c" />
              <path d="M-12,21 C-14,2 -8,-4 0,-4 C8,-4 14,2 12,21 Z" fill="#1c1c1c" />
            </g>
          )
        })()}
        {ports.map(({ port, a, b, point }) => {
          const fill = port.resource ? TILE_COLORS[port.resource] : PAPER_COLOR
          const ink = port.resource ? readableInk(TILE_COLORS[port.resource]) : INK_COLOR
          const portTool = state.tool.kind === 'port'
          return (
            <g
              key={`port:${port.edgeId}`}
              className={state.highlight === port.edgeId ? 'highlighted' : ''}
              onClick={portTool ? () => setEditingPort(port.edgeId) : undefined}
              style={portTool ? { cursor: 'pointer' } : undefined}
            >
              <line x1={a.x} y1={a.y} x2={point.x} y2={point.y} stroke="#f5e9cf" strokeWidth="2" strokeDasharray="5 5" />
              <line x1={b.x} y1={b.y} x2={point.x} y2={point.y} stroke="#f5e9cf" strokeWidth="2" strokeDasharray="5 5" />
              <rect x={point.x - PORT_HALF_W} y={point.y - PORT_HALF_H} width={PORT_HALF_W * 2} height={PORT_HALF_H * 2} rx={PORT_HALF_H} fill={fill} stroke={INK_COLOR} strokeWidth="1.6" />
              <text x={point.x} y={point.y + 4} textAnchor="middle" className="port-text" fill={ink}>{port.rate}:1</text>
            </g>
          )
        })}
        {board.roads.map((road) => {
          const [a, b] = edgeEndpointVertexIds(road.edgeId).map(vertexPoint)
          // Pull both ends toward the midpoint so roads meeting at a vertex keep
          // their shape but leave a small gap instead of piling on top of each other.
          const inset = 0.16
          const a2 = { x: a.x + (b.x - a.x) * inset, y: a.y + (b.y - a.y) * inset }
          const b2 = { x: b.x + (a.x - b.x) * inset, y: b.y + (a.y - b.y) * inset }
          return (
            <g key={`road:${road.edgeId}`}>
              {/* Casing = colored core + PIECE_STROKE outline on each side, matching buildings. */}
              <line x1={a2.x} y1={a2.y} x2={b2.x} y2={b2.y} stroke="#30271f" strokeWidth={ROAD_CORE + PIECE_STROKE * 2} strokeLinecap="round" />
              <line x1={a2.x} y1={a2.y} x2={b2.x} y2={b2.y} stroke={playerColor(road.playerId)} strokeWidth={ROAD_CORE} strokeLinecap="round" />
            </g>
          )
        })}
        {board.buildings.map((building) => {
          const point = vertexPoint(building.vertexId)
          const color = playerColor(building.playerId)
          const scale = building.tier === 'settlement' ? 0.8 : building.tier === 'city' ? 1 : 1.18
          return (
            <g key={`building:${building.vertexId}`} transform={`translate(${point.x} ${point.y}) scale(${scale})`} fill={color} stroke="#30271f" strokeWidth={PIECE_STROKE / scale} strokeLinejoin="round">
              {/* One closed silhouette per tier, matching the source app's pieces:
                  a house, a house with a rectangle annex, and a twin-gable keep.
                  strokeWidth is divided by scale so every piece renders the same border. */}
              {building.tier === 'settlement' && <path d="M-15,13 V-3 L0,-15 L15,-3 V13 Z" />}
              {building.tier === 'city' && <path d="M-13,12.2 V-2.8 L0,-14.1 L13,-2.8 H20 V12.2 Z" />}
              {building.tier === 'superCity' && <path d="M-15,11.3 V-2.6 L-9,-11.3 L-4,-3.5 V-11.3 H4 V-3.5 L9,-11.3 L15,-2.6 V11.3 Z" />}
            </g>
          )
        })}
        <g className="hit-layers">
          {board.hexes.map((hex) => (
            <polygon key={`hit:${axialKey(hex.coord)}`} points={hexPoints(hex.coord)} onClick={() => onHex(hex.coord)} />
          ))}
          {grid.edgeIds.map((edgeId) => {
            const [a, b] = edgeEndpointVertexIds(edgeId).map(vertexPoint)
            return <line key={`hit:${edgeId}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} onClick={() => onEdge(edgeId)} />
          })}
          {grid.vertexIds.map((vertexId) => {
            const point = vertexPoint(vertexId)
            return <circle key={`hit:${vertexId}`} cx={point.x} cy={point.y} r="9" onClick={() => onVertex(vertexId)} />
          })}
        </g>
      </svg>
      {editingPort && (
        <PortPopover
          edgeId={editingPort}
          port={board.ports.find((port) => port.edgeId === editingPort)}
          onCancel={() => setEditingPort(null)}
          onDelete={() => {
            commit(removePort(board, editingPort))
            setEditingPort(null)
          }}
          onSave={(resource, rate) => {
            if (!Number.isInteger(rate) || rate < 2) {
              dispatch({ type: 'notice', message: 'Port rates must be whole numbers of at least 2.' })
              return
            }
            commit(upsertPort(board, editingPort, resource, rate))
            setEditingPort(null)
          }}
        />
      )}
    </section>
  )
}
