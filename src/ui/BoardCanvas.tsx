import { useMemo, useState } from 'react'
import {
  axialKey,
  axialToPixel,
  edgeEndpointVertexIds,
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
import type { AxialCoord, Board, EdgeId, VertexId } from '../model/types'
import { INK_COLOR, SEA_COLOR, TILE_COLORS, TOKEN_COLOR } from './colors'
import { PortPopover } from './PortPopover'
import { activeTab, useStore } from './store'

const SIZE = 58

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
    <circle key={index} cx={x + (index - (count - 1) / 2) * 4.2} cy={y + 17} r="1.6" fill={number === 6 || number === 8 ? '#af2020' : INK_COLOR} />
  ))
}

export function BoardCanvas() {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  const { board } = tab
  const [editingPort, setEditingPort] = useState<EdgeId | null>(null)
  const grid = useMemo(() => boardGrid(board.layout), [board.layout])
  const width = board.layout === 'extension6' ? 790 : 650
  const height = board.layout === 'extension6' ? 720 : 590
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
      commit(placeRoad(board, edgeId, tab.activePlayerId))
    } else if (state.tool.kind === 'erase') {
      commit(removePort(removeRoad(board, edgeId), edgeId))
    } else if (state.tool.kind === 'port' && grid.coastalEdgeIds.includes(edgeId)) setEditingPort(edgeId)
  }
  const onVertex = (vertexId: VertexId) => {
    if (state.tool.kind === 'piece' && state.tool.tier !== 'road') {
      commit(placeBuilding(board, vertexId, tab.activePlayerId, state.tool.tier))
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
        viewBox={`${-width / 2} ${-height / 2} ${width} ${height}`}
        aria-label="Editable Catan board"
      >
        <rect x={-width / 2} y={-height / 2} width={width} height={height} rx="32" fill={SEA_COLOR} />
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
        {board.ports.map((port) => {
          const [a, b] = edgeEndpointVertexIds(port.edgeId).map(vertexPoint)
          const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
          const length = Math.max(1, Math.hypot(midpoint.x, midpoint.y))
          const point = { x: midpoint.x + midpoint.x / length * 43, y: midpoint.y + midpoint.y / length * 43 }
          return (
            <g key={`port:${port.edgeId}`} className={state.highlight === port.edgeId ? 'highlighted' : ''}>
              <line x1={a.x} y1={a.y} x2={point.x} y2={point.y} stroke="#f5e9cf" strokeWidth="2" strokeDasharray="5 5" />
              <rect x={point.x - 28} y={point.y - 15} width="56" height="30" rx="15" fill="#fbf4df" stroke={INK_COLOR} />
              <text x={point.x} y={point.y + 5} textAnchor="middle" className="port-text">
                {port.resource ? `${port.rate}:1 ${port.resource.slice(0, 1).toUpperCase()}` : `${port.rate}:1`}
              </text>
            </g>
          )
        })}
        {board.roads.map((road) => {
          const [a, b] = edgeEndpointVertexIds(road.edgeId).map(vertexPoint)
          return (
            <g key={`road:${road.edgeId}`}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#30271f" strokeWidth="14" strokeLinecap="round" />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={playerColor(road.playerId)} strokeWidth="9" strokeLinecap="round" />
            </g>
          )
        })}
        {board.buildings.map((building) => {
          const point = vertexPoint(building.vertexId)
          const color = playerColor(building.playerId)
          const scale = building.tier === 'settlement' ? 0.8 : building.tier === 'city' ? 1 : 1.18
          return (
            <g key={`building:${building.vertexId}`} transform={`translate(${point.x} ${point.y}) scale(${scale})`} fill={color} stroke="#30271f" strokeWidth="2.5" strokeLinejoin="round">
              {building.tier === 'superCity'
                ? <path d="M-17,13 V-9 L-10,-4 L-3,-11 L4,-4 L11,-11 L17,-5 V13 Z" />
                : <path d="M-15,13 V-3 L0,-15 L15,-3 V13 Z" />}
              {building.tier === 'city' && <path d="M10,13 V-4 H22 V13 Z" />}
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
