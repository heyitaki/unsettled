import { useEffect, useMemo, useState } from 'react'
import {
  axialKey,
  axialToPixel,
  edgeEndpointVertexIds,
  parseEdgeId,
  parseVertexId,
  vertexAdjacentVertexIds,
} from '../model/coords'
import { boardGrid } from '../model/layouts'
import {
  placeBuilding,
  placeRoad,
  removeBuilding,
  removePort,
  removeRoad,
  setHexTile,
  setLayout,
  setNumberToken,
  setRobber,
  upsertPort,
} from '../model/board'
import type { AxialCoord, Board, BuildingTier, EdgeId, LayoutId, Port, VertexId } from '../model/types'
import { INK_COLOR, PAPER_COLOR, readableInk, SEA_COLOR, TILE_COLORS, TOKEN_COLOR } from './colors'
import { ConfirmDialog } from './ConfirmDialog'
import { ROBBER_BODY, ROBBER_HEAD } from './glyphs'
import { MenuSelect } from './MenuSelect'
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
const ROAD_CORE = 7
// Corner rounding on the road's rectangular ends (SVG rx on the casing/core
// rects). Small enough to read as a squared-off plank, not a capsule.
const ROAD_RADIUS = 2.5
// Render scale per tier, and the y of each silhouette's base in its own
// unscaled path units — a highlight number sits just above that footing.
const TIER_SCALE: Record<BuildingTier, number> = { settlement: 0.8, city: 1, superCity: 1.18 }
const TIER_BASE_Y: Record<BuildingTier, number> = { settlement: 13, city: 12.2, superCity: 11.3 }
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

function pipDots(number: number, x: number, y: number, override?: { fill: string; stroke: string }) {
  const count = 6 - Math.abs(7 - number)
  const fill = override?.fill ?? (number === 6 || number === 8 ? '#af2020' : INK_COLOR)
  return Array.from({ length: count }, (_, index) => (
    <circle
      key={index}
      cx={x + (index - (count - 1) / 2) * 4.2}
      cy={y + 12}
      r="1.6"
      fill={fill}
      stroke={override?.stroke}
      strokeWidth={override ? 0.8 : undefined}
    />
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
  const { board } = tab.game
  const [editingPort, setEditingPort] = useState<EdgeId | null>(null)
  const [pendingLayout, setPendingLayout] = useState<LayoutId | null>(null)
  // The popover edge belongs to the tab it was opened on; keeping it across a
  // tab switch would edit (or crash on) a different board's coastline.
  useEffect(() => {
    setEditingPort(null)
    // A pending layout change belongs to the tab it was raised on; drop it on a
    // switch so confirming can't reset a different board.
    setPendingLayout(null)
  }, [state.activeTabId])
  const grid = useMemo(() => boardGrid(board.layout), [board.layout])
  const gridVertexSet = useMemo<ReadonlySet<string>>(() => new Set(grid.vertexIds), [grid])
  const highlightSet = useMemo(
    () => new Set((state.highlight ?? []).map((mark) => mark.ref)),
    [state.highlight],
  )
  // Marks that land on a vertex someone has already built on. The piece itself
  // takes the emphasis — thick border, deeper shadow, the pick number stamped
  // on it — instead of a circle parked on top of it, hiding whose it is.
  const markedBuildings = useMemo(
    () => new Map(board.buildings
      .filter((building) => (state.highlight ?? []).some((mark) => mark.ref === building.vertexId))
      .map((building) => [building.vertexId as string, building] as const)),
    [state.highlight, board.buildings],
  )
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
  // Placement dots (and click gate) for the active building tool: any tier drops
  // straight onto a distance-legal empty vertex — these are admin controls for
  // mirroring a live game, so a city needs no settlement under it — or re-tiers
  // one of your own pieces.
  const placeableVertices = useMemo<VertexId[]>(() => {
    if (state.tool.kind !== 'piece' || state.tool.tier === 'road') return []
    // With nobody selected there is no owner to place for; the empty-vertex branch
    // below is legality-only, so it would otherwise light up every empty vertex.
    if (tab.activePlayerId === null) return []
    const tier = state.tool.tier
    const byVertex = new Map(board.buildings.map((building) => [building.vertexId, building] as const))
    return grid.vertexIds.filter((vertexId) => {
      const here = byVertex.get(vertexId)
      if (!here) return vertexAdjacentVertexIds(vertexId).every((adj) => !byVertex.has(adj))
      // Own pieces only, or the city tool would take over an opponent's settlement
      // and its VP. Same-tier is left to the toggle-off targets below, which draw
      // no dot over the piece.
      return here.playerId === tab.activePlayerId && here.tier !== tier
    })
  }, [state.tool, board.buildings, tab.activePlayerId, grid])
  // Edges where the active player may legally build a road: empty and touching
  // their own building, or their own road via a vertex no opponent building blocks.
  const placeableEdges = useMemo<EdgeId[]>(() => {
    if (state.tool.kind !== 'piece' || state.tool.tier !== 'road') return []
    if (tab.activePlayerId === null) return []
    const roadEdges = new Set(board.roads.map((road) => road.edgeId))
    const mine = tab.activePlayerId
    const myBuildings = new Set(board.buildings.filter((b) => b.playerId === mine).map((b) => b.vertexId))
    const oppBuildings = new Set(board.buildings.filter((b) => b.playerId !== mine).map((b) => b.vertexId))
    const myRoadVerts = new Set(board.roads.filter((r) => r.playerId === mine).flatMap((r) => edgeEndpointVertexIds(r.edgeId)))
    return grid.edgeIds.filter((edgeId) => {
      if (roadEdges.has(edgeId)) return false
      return edgeEndpointVertexIds(edgeId).some((v) => myBuildings.has(v) || (myRoadVerts.has(v) && !oppBuildings.has(v)))
    })
  }, [state.tool, board.roads, board.buildings, tab.activePlayerId, grid])
  const playerColor = (id: string | null) => board.players.find((player) => player.id === id)?.color ?? '#333'
  const commit = (nextBoard: Board) => dispatch({ type: 'commit', board: nextBoard })
  const choose = (layout: LayoutId) => {
    if (layout === board.layout) return
    const hasContent = board.hexes.some((hex) => hex.tile || hex.numberToken !== null) ||
      board.roads.length > 0 ||
      board.buildings.length > 0 ||
      board.ports.length > 0 ||
      Boolean(board.robber)
    if (hasContent) setPendingLayout(layout)
    else commit(setLayout(board, layout))
  }
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
    if (state.tool.kind === 'piece' && state.tool.tier === 'road' && tab.activePlayerId !== null) {
      // Clicking your own road again toggles it off.
      const existing = board.roads.find((road) => road.edgeId === edgeId)
      if (existing?.playerId === tab.activePlayerId) commit(removeRoad(board, edgeId))
      else commit(placeRoad(board, edgeId, tab.activePlayerId))
    } else if (state.tool.kind === 'erase') {
      commit(removePort(removeRoad(board, edgeId), edgeId))
    } else if (state.tool.kind === 'port' && grid.coastalEdgeIds.includes(edgeId)) setEditingPort(edgeId)
  }
  const onVertex = (vertexId: VertexId) => {
    if (state.tool.kind === 'piece' && state.tool.tier !== 'road' && tab.activePlayerId !== null) {
      // Clicking your own building of the same tier toggles it off; a different
      // tier upgrades it. placeableVertices keeps opponents' pieces unreachable.
      const existing = board.buildings.find((building) => building.vertexId === vertexId)
      if (existing?.playerId === tab.activePlayerId && existing.tier === state.tool.tier) {
        commit(removeBuilding(board, vertexId))
      } else commit(placeBuilding(board, vertexId, tab.activePlayerId, state.tool.tier))
    } else if (state.tool.kind === 'erase') commit(removeBuilding(board, vertexId))
  }
  const buildTier = state.tool.kind === 'piece' && state.tool.tier !== 'road' ? state.tool.tier : null
  const buildActive = buildTier !== null
  const roadActive = state.tool.kind === 'piece' && state.tool.tier === 'road'
  const eraseActive = state.tool.kind === 'erase'
  const portActive = state.tool.kind === 'port'
  const hexActive = state.tool.kind === 'tile' || state.tool.kind === 'token' || state.tool.kind === 'robber'
  return (
    <section className="board-stage">
      <div className="board-status">
        <MenuSelect
          ariaLabel="Board layout"
          value={board.layout}
          options={[
            { value: 'standard4', label: '4 player' },
            { value: 'extension6', label: '5–6 player' },
          ]}
          onSelect={choose}
        >
          <strong>{board.layout === 'extension6' ? '5–6 player' : '4 player'}</strong> layout
        </MenuSelect>
        <span>{board.hexes.filter((hex) => hex.tile).length}/{board.hexes.length} terrain</span>
        <span>{board.roads.length + board.buildings.length} pieces</span>
      </div>
      <svg
        className="board-canvas"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        aria-label="Editable Catan board"
      >
        <defs>
          {/* Buildings (not roads) sit slightly proud of the board. The filter
              region is widened past the default 120% so the blur isn't clipped. */}
          <filter id="piece-shadow" x="-30%" y="-30%" width="160%" height="160%">
            {/* Near-centred: the piece is opaque, so a large dy would hide the
                shadow above it and smear it below. Blur carries the lift, and a
                small dy keeps the piece grounded rather than glowing. */}
            <feDropShadow dx="0" dy="1" stdDeviation="2.6" floodColor={INK_COLOR} floodOpacity="0.68" />
          </filter>
          {/* Highlighted pieces: the same shadow, deeper and wider, so a hovered
              draft pick reads as lifted off the board. */}
          <filter id="piece-highlight" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="2" stdDeviation="4.4" floodColor={INK_COLOR} floodOpacity="0.95" />
          </filter>
        </defs>
        <rect x={viewBox.x} y={viewBox.y} width={viewBox.width} height={viewBox.height} rx="32" fill={SEA_COLOR} />
        {board.hexes.map((hex) => (
          <polygon
            key={axialKey(hex.coord)}
            points={hexPoints(hex.coord)}
            fill={hex.tile ? TILE_COLORS[hex.tile] : '#d8d7cc'}
            stroke="#f8f1dc"
            strokeWidth="4"
            className={highlightSet.has(axialKey(hex.coord)) ? 'highlighted' : ''}
          />
        ))}
        {board.hexes.map((hex) => {
          if (hex.numberToken === null) return null
          const point = center(hex.coord)
          const hot = hex.numberToken === 6 || hex.numberToken === 8
          // On the robber's hex, draw only the disc here; its number + pips are
          // re-drawn in white above the robber below so they stay readable.
          const underRobber = board.robber !== null && axialKey(hex.coord) === axialKey(board.robber)
          return (
            <g key={`token:${axialKey(hex.coord)}`}>
              <circle cx={point.x} cy={point.y} r="23" fill={TOKEN_COLOR} stroke={INK_COLOR} strokeWidth="2.5" />
              {!underRobber && (
                <>
                  <text x={point.x} y={point.y + 6} textAnchor="middle" className={hot ? 'token-text hot' : 'token-text'}>{hex.numberToken}</text>
                  {pipDots(hex.numberToken, point.x, point.y)}
                </>
              )}
            </g>
          )
        })}
        {board.robber && (() => {
          const point = center(board.robber)
          return (
            <g transform={`translate(${point.x} ${point.y})`}>
              <circle cy={ROBBER_HEAD.cy} r={ROBBER_HEAD.r} fill="#1c1c1c" />
              <path d={ROBBER_BODY} fill="#1c1c1c" />
            </g>
          )
        })()}
        {board.robber && (() => {
          // The robber's own number + pips, redrawn in white with a dark halo so
          // they read over both the robber and the paper rim still showing
          // around it.
          const robberHex = board.hexes.find((hex) => axialKey(hex.coord) === axialKey(board.robber!))
          if (!robberHex || robberHex.numberToken === null) return null
          const point = center(board.robber)
          return (
            <g key="robber-token-label">
              <text
                x={point.x}
                y={point.y + 6}
                textAnchor="middle"
                className="token-text"
                style={{ fill: '#fff' }}
                stroke="#1c1c1c"
                strokeWidth="2.8"
                paintOrder="stroke"
                strokeLinejoin="round"
              >
                {robberHex.numberToken}
              </text>
              {pipDots(robberHex.numberToken, point.x, point.y, { fill: '#fff', stroke: '#1c1c1c' })}
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
              className={highlightSet.has(port.edgeId) ? 'highlighted' : ''}
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
          const [vaId, vbId] = edgeEndpointVertexIds(road.edgeId)
          const a = vertexPoint(vaId)
          const b = vertexPoint(vbId)
          const length = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
          const dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
          // Pull both ends toward the midpoint by the same gap, so every road is
          // drawn the same length no matter what sits at its endpoints: roads
          // meeting at a bare vertex don't pile up, and a road running into a
          // building is simply hidden by it — buildings paint after roads, and
          // the inset already tucks the road's tip inside the silhouette.
          const inset = length * 0.07
          const a2 = { x: a.x + dir.x * inset, y: a.y + dir.y * inset }
          const b2 = { x: b.x - dir.x * inset, y: b.y - dir.y * inset }
          // Draw the road as a slim rounded rectangle rather than a round-capped
          // stroke: squarer ends read as a plank, not a capsule. Rotate a
          // midpoint-centred rect to the edge's angle; the casing is the same
          // rect grown by PIECE_STROKE on every side.
          const roadLength = Math.max(0, Math.hypot(b2.x - a2.x, b2.y - a2.y))
          const mid = { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 }
          const angle = (Math.atan2(b2.y - a2.y, b2.x - a2.x) * 180) / Math.PI
          return (
            <g key={`road:${road.edgeId}`} transform={`translate(${mid.x} ${mid.y}) rotate(${angle})`}>
              {/* Casing = colored core + PIECE_STROKE outline on each side, matching buildings. */}
              <rect
                x={-roadLength / 2 - PIECE_STROKE}
                y={-(ROAD_CORE / 2 + PIECE_STROKE)}
                width={roadLength + PIECE_STROKE * 2}
                height={ROAD_CORE + PIECE_STROKE * 2}
                rx={ROAD_RADIUS + PIECE_STROKE}
                fill="#30271f"
              />
              <rect
                x={-roadLength / 2}
                y={-ROAD_CORE / 2}
                width={roadLength}
                height={ROAD_CORE}
                rx={ROAD_RADIUS}
                fill={playerColor(road.playerId)}
              />
            </g>
          )
        })}
        {board.buildings.map((building) => {
          const point = vertexPoint(building.vertexId)
          const color = playerColor(building.playerId)
          const scale = TIER_SCALE[building.tier]
          return (
            // The shadow lives on an outer group so the tier's scale can't shrink
            // or grow it — every piece casts the same shadow.
            <g
              key={`building:${building.vertexId}`}
              filter={markedBuildings.has(building.vertexId) ? 'url(#piece-highlight)' : 'url(#piece-shadow)'}
            >
              <g
                transform={`translate(${point.x} ${point.y}) scale(${scale})`}
                fill={color}
                stroke={markedBuildings.has(building.vertexId) ? '#100c06' : '#30271f'}
                // paint-order draws the stroke first and the fill over it, so the
                // inner half is covered and the thicker highlight border grows
                // outward instead of eating into the silhouette.
                paintOrder={markedBuildings.has(building.vertexId) ? 'stroke' : undefined}
                strokeWidth={(markedBuildings.has(building.vertexId) ? PIECE_STROKE * 2.6 : PIECE_STROKE) / scale}
                strokeLinejoin="round"
              >
                {/* One closed silhouette per tier, matching the source app's pieces:
                    a house, a house with a rectangle annex, and a twin-gable keep.
                    strokeWidth is divided by scale so every piece renders the same border. */}
                {building.tier === 'settlement' && <path d="M-15,13 V-3 L0,-15 L15,-3 V13 Z" />}
                {building.tier === 'city' && <path d="M-13,12.2 V-2.8 L0,-14.1 L13,-2.8 H20 V12.2 Z" />}
                {building.tier === 'superCity' && <path d="M-15,11.3 V-2.6 L-9,-11.3 L-4,-3.5 V-11.3 H4 V-3.5 L9,-11.3 L15,-2.6 V11.3 Z" />}
              </g>
            </g>
          )
        })}
        {(state.highlight ?? [])
          .filter((mark) => mark.ref.startsWith('v:') && gridVertexSet.has(mark.ref))
          .map((mark) => {
            const point = vertexPoint(mark.ref as VertexId)
            // A player-tinted circle names who takes the spot; a plain circle
            // (default accent) is the generic "look here". A label stamps the
            // pick number, in ink or paper for contrast against the fill.
            // On a vertex that is already built, the piece carries the emphasis
            // (see markedBuildings) and only the number is drawn over it.
            const marked = markedBuildings.get(mark.ref)
            // On a piece the number drops to just above its base, where the
            // silhouette is widest; on a bare circle it stays centred.
            const labelY = marked
              ? point.y + TIER_BASE_Y[marked.tier] * TIER_SCALE[marked.tier] - 4.2
              : point.y + 3.6
            const fill = mark.color
            const ink = mark.color ? readableInk(mark.color) : undefined
            return (
              <g key={`hl:${mark.ref}`} pointerEvents="none">
                {!marked && (
                  <circle
                    className="vertex-highlight"
                    cx={point.x}
                    cy={point.y}
                    r="11"
                    style={fill ? { fill, stroke: '#30271f' } : undefined}
                  />
                )}
                {mark.label && (
                  <text
                    x={point.x}
                    y={labelY}
                    textAnchor="middle"
                    className="vertex-highlight-label"
                    fill={ink}
                  >
                    {mark.label}
                  </text>
                )}
              </g>
            )
          })}
        <g className="hit-layers">
          {(hexActive || eraseActive) && board.hexes.map((hex) => (
            <polygon key={`hit:${axialKey(hex.coord)}`} points={hexPoints(hex.coord)} onClick={() => onHex(hex.coord)} />
          ))}
          {(eraseActive || portActive) && grid.edgeIds.map((edgeId) => {
            const [a, b] = edgeEndpointVertexIds(edgeId).map(vertexPoint)
            return <line key={`hit:${edgeId}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} onClick={() => onEdge(edgeId)} />
          })}
          {eraseActive && grid.vertexIds.map((vertexId) => {
            const point = vertexPoint(vertexId)
            return <circle key={`hit:${vertexId}`} cx={point.x} cy={point.y} r="9" onClick={() => onVertex(vertexId)} />
          })}
        </g>
        {/* Placement affordances: visible, normal-cursor dots at every rule-legal
            vertex/edge for the active building or road tool. */}
        <g className="placement-layer">
          {buildActive && placeableVertices.map((vertexId) => {
            const point = vertexPoint(vertexId)
            return <circle key={`slot:${vertexId}`} className="placement-slot" cx={point.x} cy={point.y} r="8" fill="rgba(250,246,235,.5)" stroke={playerColor(tab.activePlayerId)} strokeWidth="2.5" onClick={() => onVertex(vertexId)} />
          })}
          {roadActive && placeableEdges.map((edgeId) => {
            const [a, b] = edgeEndpointVertexIds(edgeId).map(vertexPoint)
            return <circle key={`slot:${edgeId}`} className="placement-slot" cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} r="7" fill="rgba(250,246,235,.5)" stroke={playerColor(tab.activePlayerId)} strokeWidth="2.5" onClick={() => onEdge(edgeId)} />
          })}
          {/* Invisible targets over the active player's own same-tier pieces so
              clicking one with the same tool still toggles it off (onVertex /
              onEdge route to remove); no visible dot, just a normal-cursor hit. */}
          {buildTier && board.buildings
            .filter((piece) => piece.playerId === tab.activePlayerId && piece.tier === buildTier)
            .map((piece) => {
              const point = vertexPoint(piece.vertexId)
              return <circle key={`rm:${piece.vertexId}`} className="placement-remove" cx={point.x} cy={point.y} r="12" onClick={() => onVertex(piece.vertexId)} />
            })}
          {roadActive && board.roads
            .filter((road) => road.playerId === tab.activePlayerId)
            .map((road) => {
              const [a, b] = edgeEndpointVertexIds(road.edgeId).map(vertexPoint)
              return <line key={`rm:${road.edgeId}`} className="placement-remove" x1={a.x} y1={a.y} x2={b.x} y2={b.y} onClick={() => onEdge(road.edgeId)} />
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
      {pendingLayout && (
        <ConfirmDialog
          title="Change layout?"
          message="Switching layouts clears the tiles, tokens, and pieces on this board. Your players are kept."
          actions={[
            {
              label: 'Change layout',
              variant: 'danger',
              onClick: () => {
                commit(setLayout(board, pendingLayout))
                setPendingLayout(null)
              },
            },
            { label: 'Cancel', onClick: () => setPendingLayout(null) },
          ]}
          onCancel={() => setPendingLayout(null)}
        />
      )}
    </section>
  )
}
