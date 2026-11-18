import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  axialKey,
  axialToPixel,
  edgeEndpointVertexIds,
  parseAxialKey,
  parseEdgeId,
  parseVertexId,
} from '../model/coords'
import { setupRoad } from '../engine/setupRoad'
import { draftIsComplete, inferDraftState, restoreDraftPick } from '../engine/draft'
import { activePlayerId } from '../model/turn'
import { historyGame } from '../model/history'
import { boardGrid, defaultPortEdges } from '../model/layouts'
import {
  placeBuilding,
  placeRoad,
  removeBuilding,
  removePort,
  removeRoad,
  setHexTile,
  setNumberToken,
  setRobber,
  settlementOrdinals,
  upsertPort,
} from '../model/board'
import type { AxialCoord, Board, BuildingTier, EdgeId, Port, VertexId } from '../model/types'
import { BLANK_TILE_COLOR, INK_COLOR, readableInk, SEA_COLOR, TILE_COLORS, TOKEN_COLOR } from './colors'
import { NumberTokenFace, ResourceMarks, ROBBER_BODY, ROBBER_HEAD_CY, ROBBER_HEAD_R, TokenPips } from './glyphs'
import { overlayOpen } from './overlayPosition'
import { buildingSlots, clickTarget, newPortEdges, nextBuildingTier, roadSlots } from './placementSlots'
import { activeTab, useStore, type HighlightMark } from './store'
import {
  IDENTITY,
  clampTransform,
  clientToUnits,
  panBy,
  transformedViewBox,
  zoomAbout,
  type Box,
  type ViewTransform,
} from './boardViewport'
import { useCoarsePointer } from './useMediaQuery'

const SIZE = 58
// A click this near the previous one repeats it, unless it lands this near another target.
const REPEAT_DISTANCE = 10
const DIRECT_DISTANCE = 8
const PAN_THRESHOLD = 8
const PORT_RADIUS = 14
const PORT_RIM = 2.5
const PORT_EXTENT = PORT_RADIUS + PORT_RIM / 2
// How far a port token's centre sits beyond its coastal edge, along the outward normal: at least
// twice its extent, so every point of the token is nearer the port than the coastal road's midpoint.
const PORT_OFFSET = 31
// The hover ring clears a port token's rim instead of sitting on it.
const PORT_HOVER_RADIUS = PORT_EXTENT + 4
// A pier starts this far from its corner, under where a building would sit.
const PIER_CORNER_GAP = 7
const PORT_DOT_COARSE = 3.6
const PORT_DOT_FINE = 2.8
// Sea margin kept around the outermost drawn content on every side.
const BOARD_MARGIN = 18
// Rounding on the sea's corners, in unscaled board units. The clip frame that
// carries it while zoomed divides it by the scale, so the on-screen radius is
// the same at 6x as it is at fit. 5 units is about 6px (`--radius`) on the
// desktop board at fit; the phone's board is half as wide, so 3px there.
const SEA_RADIUS = 5
// Shared outline width for every piece (buildings + roads), in unscaled board units. The piece
// sizes, outline, road ends and shadow were tuned together, so change them as a set.
const PIECE_STROKE = 1.8
// Colored core width of a road; its casing adds PIECE_STROKE on each side.
const ROAD_CORE = 6
// Corner rounding on the road's rectangular ends (SVG rx on the casing/core
// rects). Small enough to read as a squared-off plank, not a capsule.
const ROAD_RADIUS = 1.95
const SETTLEMENT_PATH = 'M-12.5,13 V-3 L0,-15 L12.5,-3 V13 Z'
// Render scale per tier, and the y of each silhouette's base in its own
// unscaled path units — a highlight number sits just above that footing.
const TIER_SCALE: Record<BuildingTier, number> = { settlement: 0.72, city: 0.828, superCity: 0.972 }
const TIER_BASE_Y: Record<BuildingTier, number> = { settlement: 13, city: 12.2, superCity: 11.3 }
// How far a number's baseline sits above that footing, in board units.
const LABEL_LIFT = 3.7
// Conservative half-extent a placed building reaches from its vertex, across all
// tiers and scales, outline included. Used to keep edge pieces in-frame.
const PIECE_REACH = 22

type Point = { x: number; y: number }
const pointOf = (event: { clientX: number; clientY: number }): Point => ({ x: event.clientX, y: event.clientY })
const midpoint = (points: readonly Point[]): Point => ({
  x: (points[0].x + points[1].x) / 2,
  y: (points[0].y + points[1].y) / 2,
})
const distance = (points: readonly Point[]): number =>
  Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)

const center = (coord: AxialCoord) => axialToPixel(coord, SIZE)

function contentBox(svg: SVGSVGElement): Box {
  const rect = svg.getBoundingClientRect()
  const style = getComputedStyle(svg)
  const left = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.borderLeftWidth) || 0)
  const right = (parseFloat(style.paddingRight) || 0) + (parseFloat(style.borderRightWidth) || 0)
  const top = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.borderTopWidth) || 0)
  const bottom = (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.borderBottomWidth) || 0)
  return {
    x: rect.x + left,
    y: rect.y + top,
    width: Math.max(0, rect.width - left - right),
    height: Math.max(0, rect.height - top - bottom),
  }
}

function vertexPoint(vertexId: VertexId) {
  const points = parseVertexId(vertexId).map(center)
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / 3,
    y: points.reduce((sum, point) => sum + point.y, 0) / 3,
  }
}

const PORT_REF_PREFIX = 'port:'
const portRef = (edgeId: EdgeId): string => `${PORT_REF_PREFIX}${edgeId}`
const parsePortRef = (ref: string): EdgeId | null => ref.startsWith(PORT_REF_PREFIX) ? ref.slice(PORT_REF_PREFIX.length) as EdgeId : null

/** Pushes the token away from its land hex so a building on the edge never covers it. */
function portGeometry(edgeId: EdgeId, landKeys: ReadonlySet<string>) {
  const [a, b] = edgeEndpointVertexIds(edgeId).map(vertexPoint)
  const mid = midpoint([a, b])
  const [c1, c2] = parseEdgeId(edgeId)
  const landCenter = center(landKeys.has(axialKey(c1)) ? c1 : c2)
  const outward = { x: mid.x - landCenter.x, y: mid.y - landCenter.y }
  const length = Math.max(1, Math.hypot(outward.x, outward.y))
  const point = {
    x: mid.x + (outward.x / length) * PORT_OFFSET,
    y: mid.y + (outward.y / length) * PORT_OFFSET,
  }
  return { a, b, point }
}

/** The point `distance` along the line from `from` toward `to`. */
function toward(from: Point, to: Point, distance: number): Point {
  const length = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y))
  return { x: from.x + (to.x - from.x) / length * distance, y: from.y + (to.y - from.y) / length * distance }
}

/** A road's drawn length, centre and angle; the hover preview shares it so the two cannot drift. */
function roadGeometry(edgeId: EdgeId) {
  const [vaId, vbId] = edgeEndpointVertexIds(edgeId)
  const a = vertexPoint(vaId)
  const b = vertexPoint(vbId)
  const length = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
  const dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
  // Pull both ends toward the midpoint by the same gap, so every road is
  // drawn the same length no matter what sits at its endpoints: roads
  // meeting at a bare vertex don't pile up, and a road running into a
  // building is simply hidden by it — buildings paint after roads, and
  // the inset already tucks the road's tip inside the silhouette.
  const inset = length * 0.07 - 0.5
  const a2 = { x: a.x + dir.x * inset, y: a.y + dir.y * inset }
  const b2 = { x: b.x - dir.x * inset, y: b.y - dir.y * inset }
  const roadLength = Math.max(0, Math.hypot(b2.x - a2.x, b2.y - a2.y))
  const mid = { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 }
  const angle = (Math.atan2(b2.y - a2.y, b2.x - a2.x) * 180) / Math.PI
  return { roadLength, mid, angle }
}

// A slim rounded rectangle rather than a round-capped stroke, so the ends read as a plank. The
// casing is the core grown by PIECE_STROKE on every side, matching the buildings' outline.
function Road({ edgeId, color }: { edgeId: EdgeId; color: string }) {
  const { roadLength, mid, angle } = roadGeometry(edgeId)
  return (
    <g transform={`translate(${mid.x} ${mid.y}) rotate(${angle})`}>
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
        fill={color}
      />
    </g>
  )
}

function hexPoints(coord: AxialCoord, radius = SIZE): string {
  const point = center(coord)
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (-90 + index * 60) * Math.PI / 180
    return `${point.x + radius * Math.cos(angle)},${point.y + radius * Math.sin(angle)}`
  }).join(' ')
}

interface PortLayout {
  port: Port
  a: { x: number; y: number }
  b: { x: number; y: number }
  point: { x: number; y: number }
}

/**
 * `restMarks` is what the board wears while nothing has been selected: the
 * ranked picks (spec S5, D4). A selection in the store always wins, and a
 * clear (`highlight: null`) falls back to them, so no panel has to reinstate
 * them after another panel's clear.
 */
const NO_MARKS: readonly HighlightMark[] = []

export function BoardCanvas({ restMarks = null }: { restMarks?: readonly HighlightMark[] | null } = {}) {
  const { state, dispatch } = useStore()
  const coarse = useCoarsePointer()
  const tab = activeTab(state)
  const readOnly = !!state.historyOpen && state.viewedTurn != null
  const game = useMemo(() => readOnly ? historyGame(tab.game, state.viewedTurn!) : tab.game, [tab.game, readOnly, state.viewedTurn])
  const { board } = game
  const [transform, setTransformState] = useState<ViewTransform>(IDENTITY)
  const [hoveredTarget, setHoveredTarget] = useState<string | null>(null)
  const transformRef = useRef<ViewTransform>(IDENTITY)
  const svgRef = useRef<SVGSVGElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const onePointer = useRef<{ x: number; y: number; panning: boolean } | null>(null)
  const gestureHadPinch = useRef(false)
  const suppressClick = useRef(false)
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null)
  const lastClick = useRef<{ ref: string; x: number; y: number } | null>(null)
  const finePointer = useRef<Point | null>(null)
  const finePointerDown = useRef<Point | null>(null)
  const draftTapPending = useRef(false)
  const setTransform = (next: ViewTransform) => {
    transformRef.current = next
    setTransformState(next)
  }
  const grid = useMemo(() => boardGrid(board.layout), [board.layout])
  // Positions depend on the layout alone; the candidates below filter them per board.
  const targetPositions = useMemo(() => [
    ...grid.vertexIds.map((ref) => ({ ref, ...vertexPoint(ref) })),
    ...grid.edgeIds.map((ref) => ({ ref, ...midpoint(edgeEndpointVertexIds(ref).map(vertexPoint)) })),
  ], [grid])
  const gridVertexSet = useMemo<ReadonlySet<string>>(() => new Set(grid.vertexIds), [grid])
  const highlight = state.historyOpen ? NO_MARKS : state.highlight ?? restMarks ?? NO_MARKS
  const gridEdgeSet = useMemo<ReadonlySet<string>>(() => new Set(grid.edgeIds), [grid])
  // Road marks are left out: they share the edge-id namespace with ports, and a recommended road
  // that happens to run along a port edge must not light the port up.
  const highlightSet = useMemo(
    () => new Set(highlight
      .filter((mark) => mark.kind === undefined)
      .map((mark) => mark.ref)),
    [highlight],
  )
  // Marks that land on a vertex someone has already built on. The piece itself
  // takes the emphasis — thick border, deeper shadow, the pick number stamped
  // on it — instead of a circle parked on top of it, hiding whose it is.
  const markedBuildings = useMemo(
    () => new Map(board.buildings
      .filter((building) => highlight.some((mark) => mark.ref === building.vertexId))
      .map((building) => [building.vertexId as string, building] as const)),
    [highlight, board.buildings],
  )
  const ports = useMemo<PortLayout[]>(
    () => board.ports.map((port) => ({ port, ...portGeometry(port.edgeId, grid.landKeys) })),
    [board.ports, grid],
  )
  const portSlots = useMemo(() => newPortEdges(board).map((edgeId) => ({
    edgeId, ref: portRef(edgeId), ...portGeometry(edgeId, grid.landKeys).point,
  })), [board, grid])
  // Fit the viewBox to everything drawn (hexes + port tokens + placed buildings)
  // plus an even margin, so the board is centered in the sea and no edge piece gets clipped.
  const viewBox = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    const include = (x: number, y: number) => {
      minX = Math.min(minX, x); minY = Math.min(minY, y)
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    }
    const includeBox = (point: Point, halfW: number, halfH: number) => {
      include(point.x - halfW, point.y - halfH)
      include(point.x + halfW, point.y + halfH)
    }
    for (const hex of board.hexes) {
      const point = center(hex.coord)
      for (let index = 0; index < 6; index += 1) {
        const angle = ((-90 + index * 60) * Math.PI) / 180
        include(point.x + SIZE * Math.cos(angle), point.y + SIZE * Math.sin(angle))
      }
    }
    for (const { point } of ports) includeBox(point, PORT_EXTENT, PORT_EXTENT)

    // An empty default port spot reserves its token, so deleting or restoring that
    // port leaves the frame alone. Any other open spot reserves only its dot.
    const defaultEdges = new Set(defaultPortEdges(board.layout))
    for (const slot of portSlots) {
      const reach = defaultEdges.has(slot.edgeId) ? PORT_EXTENT : PORT_DOT_COARSE
      includeBox(slot, reach, reach)
    }
    for (const building of board.buildings) includeBox(vertexPoint(building.vertexId), PIECE_REACH, PIECE_REACH)
    return {
      x: minX - BOARD_MARGIN,
      y: minY - BOARD_MARGIN,
      width: maxX - minX + BOARD_MARGIN * 2,
      height: maxY - minY + BOARD_MARGIN * 2,
    }
  }, [board.layout, board.hexes, board.buildings, ports, portSlots])
  // A layout or tab switch is a different board, so a zoom held over from the
  // old one means nothing and resets. Every other fit change is the same board growing
  // its box — a coastal piece reaching past the hexes — where snapping back to
  // fit would undo the zoom the user set to place that piece. Those only
  // re-clamp, which is enough to keep the window inside the new bounds.
  const fittedLayout = useRef(board.layout)
  // A tab switch is a different board too, and one whose fitted box can be
  // numerically identical (same layout), so the box numbers alone would neither
  // re-run this effect nor read as a switch.
  const fittedTabId = useRef(state.activeTabId)
  // Depends on the fitted box's numbers, never the object: the memo above
  // rebuilds on every piece placement, so an object dependency would re-run
  // this on edits that did not move the box at all.
  const { x: fitX, y: fitY, width: fitWidth, height: fitHeight } = viewBox
  useEffect(() => {
    const switched = fittedLayout.current !== board.layout || fittedTabId.current !== state.activeTabId
    fittedLayout.current = board.layout
    fittedTabId.current = state.activeTabId
    setTransform(switched
      ? IDENTITY
      : clampTransform(transformRef.current, { x: fitX, y: fitY, width: fitWidth, height: fitHeight }))
  }, [state.activeTabId, board.layout, fitX, fitY, fitWidth, fitHeight])
  const renderedViewBox = transformedViewBox(viewBox, transform)
  const pick = state.historyOpen ? null : state.pick
  const pieceMode = !readOnly && !pick && state.tool.kind === 'piece'
  const portTerrain = !readOnly && !pick && state.tool.kind === 'tile' && state.tool.tile !== 'desert' ? state.tool.tile : null
  const portsTappable = pieceMode || portTerrain !== null
  const draft = useMemo(() => inferDraftState(board), [board])
  const draftComplete = draftIsComplete(board, draft)
  const viewedSlot = state.viewedPick ?? draft.myRemainingPickIndices[0]

  // With the tools closed, a draft tap places only the viewed player's settlement, and only on a Best picks circle.
  const draftPlayer = !readOnly && !pick && state.tool.kind === 'none' && !draftComplete &&
    board.hexes.some((hex) => hex.tile !== null) && draft.remainingPickIndices.includes(viewedSlot)
    ? draft.sequence[viewedSlot] : null
  const placementPlayer = pick ? activePlayerId(tab.game) : draftPlayer ?? tab.activePlayerId
  const placeableVertices = useMemo<VertexId[]>(() => {
    if (readOnly) return []
    if (pick) return pick.want === 'vertex' ? buildingSlots(board, placementPlayer, pick.piece, 'build') : []
    if (state.tool.kind !== 'piece' && draftPlayer === null) return []
    const occupied = new Set(board.buildings.map((building) => building.vertexId))
    // Planned second picks and likely-gone picks are previews only: a tap places on a placeable mark alone.
    const circles = draftPlayer === null ? null
      : new Set(highlight.filter((mark) => mark.placeable).map((mark) => mark.ref))
    return buildingSlots(board, placementPlayer, 'settlement', 'edit')
      .filter((vertexId) => !occupied.has(vertexId) && (circles === null || circles.has(vertexId)))
  }, [state.tool, board, placementPlayer, pick, draftPlayer, highlight, readOnly])
  const placeableEdges = useMemo<EdgeId[]>(() => {
    if (readOnly) return []
    if (pick ? pick.want !== 'edge' : state.tool.kind !== 'piece') return []
    return roadSlots(board, placementPlayer, pick?.want === 'edge' ? pick.edges : undefined)
  }, [state.tool, board, placementPlayer, pick, readOnly])
  const candidates = useMemo(() => {
    const refs = new Set<string>([...placeableVertices, ...placeableEdges])
    if (pieceMode) {
      for (const building of board.buildings) refs.add(building.vertexId)
      for (const road of board.roads) refs.add(road.edgeId)
    }
    return [
      ...targetPositions.filter((target) => refs.has(target.ref)),
      ...(portsTappable ? [
        ...ports.map(({ port, point }) => ({ ref: portRef(port.edgeId), ...point })),
        ...portSlots,
      ] : []),
      ...(pieceMode ? board.hexes.filter((hex) => hex.tile !== null && (!board.robber || axialKey(hex.coord) !== axialKey(board.robber)))
        .map((hex) => ({ ref: axialKey(hex.coord), ...center(hex.coord) })) : []),
    ]
  }, [targetPositions, placeableVertices, placeableEdges, board, ports, portSlots, pieceMode, portsTappable])
  const targetAt = useCallback((point: Point) => {
    const rect = svgRef.current && contentBox(svgRef.current)
    // An unmeasured board has no point to resolve; clientToUnits would answer with the view centre.
    if (!rect || rect.width === 0 || rect.height === 0) return null
    const units = clientToUnits(point, rect, viewBox, transformRef.current)
    const ref = clickTarget(units, candidates, lastClick.current, { max: SIZE / 2, repeat: REPEAT_DISTANCE, direct: DIRECT_DISTANCE })
    return ref === null ? null : { ref, ...units }
  }, [candidates, viewBox])
  // Stable across renders that don't change the roster, so the piece layers
  // below can list it as a dependency without re-rendering on every render.
  const playerColor = useCallback(
    (id: string | null) => board.players.find((player) => player.id === id)?.color ?? '#333',
    [board.players],
  )
  const commit = (nextBoard: Board) => dispatch({ type: 'commit', board: nextBoard })
  const onHex = (coord: AxialCoord) => {
    if (pick) {
      if (pick.want === 'hex' && (!board.robber || axialKey(coord) !== axialKey(board.robber))) dispatch({ type: 'picked', ref: axialKey(coord) })
      return
    }
    const hex = board.hexes.find((candidate) => axialKey(candidate.coord) === axialKey(coord))
    if (!hex) return
    if (state.tool.kind === 'tile') {
      const tile = hex.tile === state.tool.tile ? null : state.tool.tile
      let nextBoard = setHexTile(board, coord, tile)
      if (tile === null && board.robber && axialKey(board.robber) === axialKey(coord)) nextBoard = setRobber(nextBoard, null)
      commit(nextBoard)
    } else if (state.tool.kind === 'token') {
      if (hex.tile === 'desert') {
        dispatch({ type: 'notice', message: 'Desert hexes cannot have number tokens.' })
        return
      }
      commit(setNumberToken(board, coord, hex.numberToken === state.tool.number ? null : state.tool.number))
    }
  }
  const onEdge = (edgeId: EdgeId) => {
    if (pick) {
      if (pick.want === 'edge') dispatch({ type: 'picked', ref: edgeId })
      return
    }
    if (state.tool.kind === 'piece') {
      const existing = board.roads.find((road) => road.edgeId === edgeId)
      if (existing) commit(removeRoad(board, edgeId))
      else if (tab.activePlayerId !== null) commit(placeRoad(board, edgeId, tab.activePlayerId))
    }
  }
  const onVertex = (vertexId: VertexId) => {
    if (pick) {
      if (pick.want === 'vertex') dispatch({ type: 'picked', ref: vertexId })
      return
    }
    if (draftPlayer !== null) {
      // One tap at a time: the first one waits for the engine to load, and a second tap meanwhile would place on a stale board.
      if (draftTapPending.current) return
      draftTapPending.current = true
      // Chosen before the settlement lands, as a ranking of this seat would choose it. With no engine the settlement lands without a road.
      void setupRoad(board, draftPlayer, vertexId).catch(() => null).then((road) => {
        draftTapPending.current = false
        const nextBoard = restoreDraftPick(board, { vertexId, playerId: draftPlayer, roads: road === null ? [] : [road] })
        commit(nextBoard)
        dispatch({ type: 'view-pick', slot: inferDraftState(nextBoard).remainingPickIndices[0] ?? null })
      })
      return
    }
    if (state.tool.kind === 'piece') {
      const existing = board.buildings.find((building) => building.vertexId === vertexId)
      const tier = nextBuildingTier(existing?.tier, {
        city: draftComplete,
        superCity: board.buildings.some((building) => building.tier === 'superCity'),
      })
      const owner = existing?.playerId ?? tab.activePlayerId
      if (tier === null) commit(removeBuilding(board, vertexId))
      else if (owner !== null) commit(placeBuilding(board, vertexId, owner, tier))
    }
  }
  const buildActive = pick ? pick.want === 'vertex' : state.tool.kind === 'piece' || draftPlayer !== null
  const roadActive = pick ? pick.want === 'edge' : state.tool.kind === 'piece'
  const pieceActive = buildActive || roadActive
  const placementActive = pieceActive || portTerrain !== null
  const hover = coarse || readOnly ? undefined : candidates.find((target) => target.ref === hoveredTarget)
  const hoverBuilding = hover && board.buildings.find((building) => building.vertexId === hover.ref)
  const hoverRoad = hover && board.roads.find((road) => road.edgeId === hover.ref)
  const hoverPort = hover ? parsePortRef(hover.ref) : null
  const hoverPlayer = hover && hoverPort === null
    ? hoverBuilding?.playerId ?? hoverRoad?.playerId ?? placementPlayer
    : null
  const preview = hover && hoverPort === null && !hoverBuilding && !hoverRoad ? hover : undefined
  const previewRoad = preview?.ref.startsWith('e:') ? roadGeometry(preview.ref as EdgeId) : undefined
  useEffect(() => {
    lastClick.current = null
    finePointer.current = null
    finePointerDown.current = null
  }, [placementActive, portTerrain, state.activeTabId, board.layout])
  useEffect(() => {
    const target = !coarse && placementActive && finePointer.current ? targetAt(finePointer.current) : null
    setHoveredTarget(target && !grid.landKeys.has(target.ref) ? target.ref : null)
  }, [targetAt, coarse, placementActive, state.activeTabId, board.layout, transform, grid])
  const actOnTarget = (target: { ref: string; x: number; y: number }) => {
    lastClick.current = target
    const port = parsePortRef(target.ref)
    if (port !== null) {
      const existing = board.ports.find((candidate) => candidate.edgeId === port)
      if (portTerrain !== null) {
        const alreadyThis = existing?.resource === portTerrain && existing.rate === 2
        commit(upsertPort(board, port, alreadyThis ? null : portTerrain, alreadyThis ? 3 : 2))
      } else commit(existing ? removePort(board, port) : upsertPort(board, port, null, 3))
    } else if (target.ref.startsWith('v:')) onVertex(target.ref as VertexId)
    else if (target.ref.startsWith('e:')) onEdge(target.ref as EdgeId)
    else commit(setRobber(board, parseAxialKey(target.ref)))
  }
  // The dots take no pointer events (editor.css), so a pointer always goes through the svg's
  // handler; only a click dispatched on a dot itself arrives here, and it names its target.
  const onSlotClick = (event: ReactMouseEvent<SVGCircleElement>, slot: { ref: string; x: number; y: number }) => {
    event.stopPropagation()
    actOnTarget(slot)
  }
  const hexActive = !readOnly && (pick ? pick.want === 'hex' : state.tool.kind === 'tile' || state.tool.kind === 'token')
  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (overlayOpen()) return
    const point = pointOf(event)
    if (!coarse) {
      finePointerDown.current = point
      return
    }
    pointers.current.set(event.pointerId, point)
    if (pointers.current.size > 1) {
      for (const pointerId of pointers.current.keys()) {
        // A pointer whose up/cancel never arrived (an iOS system gesture, or the
        // tab backgrounding mid-pinch) lingers here but is gone as far as the
        // browser is concerned, so capturing it throws NotFoundError. Prune it
        // instead of letting the throw abort the rest of this handler: left in
        // place it makes one finger pinch and jams suppressClick on forever.
        try {
          event.currentTarget.setPointerCapture(pointerId)
        } catch {
          pointers.current.delete(pointerId)
        }
      }
    }
    if (pointers.current.size > 1) {
      gestureHadPinch.current = true
      suppressClick.current = true
      onePointer.current = null
    } else {
      // First finger of a gesture — or the only live one left after pruning, in
      // which case this also clears the flags the phantom kept latched.
      suppressClick.current = false
      gestureHadPinch.current = false
      onePointer.current = { ...point, panning: false }
    }
  }
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!coarse && !placementActive) return
    if (overlayOpen()) return
    if (!coarse) {
      finePointer.current = pointOf(event)
      const target = targetAt(finePointer.current)
      setHoveredTarget(target && !grid.landKeys.has(target.ref) ? target.ref : null)
      return
    }
    if (!pointers.current.has(event.pointerId)) return
    const rect = contentBox(event.currentTarget)
    const beforePoints = [...pointers.current.values()]
    const point = pointOf(event)
    pointers.current.set(event.pointerId, point)
    const afterPoints = [...pointers.current.values()]
    if (afterPoints.length >= 2) {
      const previousPair = beforePoints.slice(0, 2)
      const nextPair = afterPoints.slice(0, 2)
      const previousDistance = distance(previousPair)
      if (previousDistance === 0) return
      const previousMidpoint = midpoint(previousPair)
      const nextMidpoint = midpoint(nextPair)
      const current = transformRef.current
      const anchor = clientToUnits(previousMidpoint, rect, viewBox, current)
      const nextAtCurrent = clientToUnits(nextMidpoint, rect, viewBox, current)
      const panned = panBy(
        current,
        anchor.x - nextAtCurrent.x,
        anchor.y - nextAtCurrent.y,
        viewBox,
      )
      setTransform(zoomAbout(
        panned,
        distance(nextPair) / previousDistance,
        anchor,
        viewBox,
      ))
      suppressClick.current = true
      return
    }
    const start = onePointer.current
    const previous = beforePoints[0]
    if (!start || !previous) return
    const wasPanning = start.panning
    if (!wasPanning && Math.hypot(point.x - start.x, point.y - start.y) <= PAN_THRESHOLD) return
    if (!wasPanning) event.currentTarget.setPointerCapture(event.pointerId)
    start.panning = true
    suppressClick.current = true
    const current = transformRef.current
    const from = wasPanning ? previous : { x: start.x, y: start.y }
    const previousUnits = clientToUnits(from, rect, viewBox, current)
    const nextUnits = clientToUnits(point, rect, viewBox, current)
    setTransform(panBy(
      current,
      previousUnits.x - nextUnits.x,
      previousUnits.y - nextUnits.y,
      viewBox,
    ))
  }
  const endPointer = (event: ReactPointerEvent<SVGSVGElement>, cancelled: boolean) => {
    if (!coarse || !pointers.current.has(event.pointerId)) return
    const wasSingleTap = pointers.current.size === 1 &&
      !onePointer.current?.panning &&
      !gestureHadPinch.current &&
      !cancelled
    pointers.current.delete(event.pointerId)
    if (pointers.current.size === 1) {
      const remaining = [...pointers.current.values()][0]
      onePointer.current = { ...remaining, panning: false }
    } else onePointer.current = null
    if (!wasSingleTap) return
    // Double-tap-to-zoom only exists outside build mode, with no pick live
    // and, in a draft, away from the Best picks circles. The
    // first tap of a pair is never suppressed — suppressing it would mean
    // holding every single placement for the full double-tap window — so with a
    // tool active a double tap would zoom *and* edit the board under the first
    // tap, and tapping neighbouring hexes quickly is ordinary editing. With a
    // tool selected, taps place and pinch is the way to zoom. Clearing the
    // stored tap keeps one made under a tool from later pairing with a tap made
    // after the tool was dropped.
    if (pick || state.tool.kind !== 'none' || (draftPlayer !== null && targetAt(pointOf(event)) !== null)) {
      lastTap.current = null
      return
    }
    const now = event.timeStamp
    const previousTap = lastTap.current
    const closeInTime = previousTap !== null && now - previousTap.time <= 300
    const closeInSpace = previousTap !== null &&
      Math.hypot(event.clientX - previousTap.x, event.clientY - previousTap.y) <= 24
    if (!closeInTime || !closeInSpace) {
      lastTap.current = { time: now, x: event.clientX, y: event.clientY }
      return
    }
    lastTap.current = null
    suppressClick.current = true
    if (transformRef.current.scale > 1) setTransform(IDENTITY)
    else {
      const anchor = clientToUnits(pointOf(event), contentBox(event.currentTarget), viewBox, IDENTITY)
      setTransform(zoomAbout(IDENTITY, 2.5, anchor, viewBox))
    }
  }
  const cancelPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!coarse || !pointers.current.has(event.pointerId)) return
    endPointer(event, true)
    onePointer.current = null
    lastTap.current = null
  }
  // Capture is released implicitly just after pointerup/pointercancel, which
  // already pruned the id — so an id still here has lost its capture without any
  // end event (system gesture, backgrounded tab) and would otherwise be stuck in
  // the map forever, jamming taps and clicks. A touch is captured implicitly by
  // the hex or piece it lands on, so the svg taking it over for a pinch or pan
  // fires this from that child while the svg already holds the pointer: that
  // is a hand-over, not a loss.
  const onLostCapture = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(event.pointerId) || event.currentTarget.hasPointerCapture(event.pointerId)) return
    cancelPointer(event)
  }
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || overlayOpen()) return
      event.preventDefault()
      const anchor = clientToUnits(
        { x: event.clientX, y: event.clientY },
        contentBox(svg),
        viewBox,
        transformRef.current,
      )
      setTransform(zoomAbout(
        transformRef.current,
        Math.exp(-event.deltaY * 0.01),
        anchor,
        viewBox,
      ))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [viewBox])
  // Panning and pinching change nothing but the <svg>'s viewBox, yet a plain
  // render rebuilds and diffs every one of the ~300 presentation elements on
  // each pointermove. Memoizing the layers that don't read the transform makes
  // a gesture frame diff a single attribute. Only the presentation layers are
  // memoized: the hit and placement layers close over the board-editing
  // handlers, which are rebuilt every render anyway, and are far smaller.
  const hexLayer = useMemo(() => board.hexes.map((hex) => (
    <polygon
      key={axialKey(hex.coord)}
      data-hex={axialKey(hex.coord)}
      points={hexPoints(hex.coord)}
      fill={hex.tile ? TILE_COLORS[hex.tile] : BLANK_TILE_COLOR}
      stroke={TOKEN_COLOR}
      strokeWidth="4"
      className={highlightSet.has(axialKey(hex.coord)) ? 'highlighted' : ''}
    />
  )), [board.hexes, highlightSet])
  const tokenLayer = useMemo(() => board.hexes.map((hex) => {
    if (hex.numberToken === null) return null
    const point = center(hex.coord)
    // On the robber's hex, draw only the disc here; its number + pips are
    // re-drawn in white above the robber below so they stay readable.
    const underRobber = board.robber !== null && axialKey(hex.coord) === axialKey(board.robber)
    return (
      <g key={`token:${axialKey(hex.coord)}`} className={pick?.want === 'hex' && !underRobber ? 'blink' : undefined}>
        <NumberTokenFace number={hex.numberToken} x={point.x} y={point.y} discOnly={underRobber} />
      </g>
    )
  }), [board.hexes, board.robber, pick?.want])
  const robberLayer = useMemo(() => {
    if (!board.robber) return null
    const point = center(board.robber)
    return (
      <g transform={`translate(${point.x} ${point.y})`}>
        <circle cy={ROBBER_HEAD_CY} r={ROBBER_HEAD_R} fill="#1c1c1c" />
        <path d={ROBBER_BODY} fill="#1c1c1c" />
      </g>
    )
  }, [board.robber])
  const robberTokenLayer = useMemo(() => {
    if (!board.robber) return null
    // The robber's own number + pips, redrawn in white with a dark halo so
    // they read over both the robber and the paper rim still showing
    // around it.
    const robberCoord = board.robber
    const robberHex = board.hexes.find((hex) => axialKey(hex.coord) === axialKey(robberCoord))
    if (!robberHex || robberHex.numberToken === null) return null
    const point = center(robberCoord)
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
        <TokenPips number={robberHex.numberToken} x={point.x} y={point.y} override={{ fill: '#fff', stroke: '#1c1c1c' }} />
      </g>
    )
  }, [board.robber, board.hexes])
  // A resource port is a token in its terrain colour with the icon in paper, and a port for any
  // resource is an open paper ring with its rate. Each pier fades out toward its corner.
  const portLayer = useMemo(() => ports.map(({ port, a, b, point }, index) => {
    const rate = `${port.rate}:1`
    return (
      <g
        key={portRef(port.edgeId)}
        className={highlightSet.has(port.edgeId) ? 'board-port highlighted' : 'board-port'}
        data-resource={port.resource ?? 'any'}
        data-rate={port.rate}
      >
        {[a, b].map((corner, end) => {
          const start = toward(corner, point, PIER_CORNER_GAP)
          const stop = toward(point, corner, PORT_EXTENT + 0.25)
          const gradient = `port-pier-${index}-${end}`
          return (
            <g key={end}>
              <linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1={start.x} y1={start.y} x2={stop.x} y2={stop.y}>
                <stop offset="0" stopColor={TOKEN_COLOR} stopOpacity="0.1" />
                <stop offset="1" stopColor={TOKEN_COLOR} />
              </linearGradient>
              <line x1={start.x} y1={start.y} x2={stop.x} y2={stop.y} stroke={`url(#${gradient})`} strokeWidth="3.2" strokeLinecap="round" />
            </g>
          )
        })}
        {/* `transparent`, not `none`, so the open ring's centre still takes the pointer. */}
        <circle className="port-token" cx={point.x} cy={point.y} r={PORT_RADIUS} fill={port.resource ? TILE_COLORS[port.resource] : 'transparent'} stroke={TOKEN_COLOR} strokeWidth={PORT_RIM} />
        {/* The token's contents leave the pointer to the token itself. */}
        {port.resource === null ? (
          <text x={point.x} y={point.y + 4} textAnchor="middle" className="port-text" fill={TOKEN_COLOR} pointerEvents="none">{rate}</text>
        ) : port.rate === 2 ? (
          <svg x={point.x - 9} y={point.y - 9} width="18" height="18" viewBox="0 0 20 20" pointerEvents="none">
            <ResourceMarks resource={port.resource} tone={TOKEN_COLOR} />
          </svg>
        ) : (
          // Only an unusual rate is spelled out on a resource port.
          <g pointerEvents="none">
            <svg x={point.x - 6.5} y={point.y - 10.5} width="13" height="13" viewBox="0 0 20 20">
              <ResourceMarks resource={port.resource} tone={TOKEN_COLOR} />
            </svg>
            <text x={point.x} y={point.y + 10} textAnchor="middle" className="port-text" fill={TOKEN_COLOR} style={{ fontSize: 8.5 }}>{rate}</text>
          </g>
        )}
      </g>
    )
  }), [ports, highlightSet])
  const roadLayer = useMemo(() => board.roads.map((road) => (
    <Road key={`road:${road.edgeId}`} edgeId={road.edgeId} color={playerColor(road.playerId)} />
  )), [board.roads, playerColor])

  const ordinals = useMemo(() =>
    draftComplete ? new Map<VertexId, 1 | 2>() : settlementOrdinals(board), [board, draftComplete])
  const buildingLayer = useMemo(() => board.buildings.map((building) => {
    const point = vertexPoint(building.vertexId)
    const color = playerColor(building.playerId)
    const scale = TIER_SCALE[building.tier]
    const ordinal = ordinals.get(building.vertexId)
    return (
      <g key={`building:${building.vertexId}`}>
        {/* Keep the shadow independent of tier scale and the ordinal badge. */}
        <g filter={markedBuildings.has(building.vertexId) ? 'url(#piece-highlight)' : 'url(#piece-shadow)'}>
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
            {building.tier === 'settlement' && <path d={SETTLEMENT_PATH} />}
            {building.tier === 'city' && <path d="M-11.75,12.2 V-2.8 L0,-14.1 L11.75,-2.8 H17.6 V12.2 Z" />}
            {building.tier === 'superCity' && <path d="M-15,11.3 V-2.6 L-9,-11.3 L-4,-3.5 V-11.3 H4 V-3.5 L9,-11.3 L15,-2.6 V11.3 Z" />}
          </g>
        </g>
        {/* The pick number sits where a Best picks mark stamps its own, which wins when both land here. */}
        {ordinal && !highlight.some((mark) => mark.ref === building.vertexId && mark.label) && (
          <text
            className="settlement-ordinal"
            x={point.x}
            y={point.y + TIER_BASE_Y.settlement * scale - LABEL_LIFT}
            textAnchor="middle"
            fill={readableInk(color)}
            pointerEvents="none"
            aria-hidden="true"
          >
            {ordinal}
          </text>
        )}
      </g>
    )
  }), [board.buildings, highlight, markedBuildings, ordinals, playerColor])
  // A road mark is a recommended road, drawn as a faded road piece under the buildings and the
  // pick circles it joins, like a placed road. Every other edge ref names a port, which
  // `portLayer` lights up instead.
  const roadMarkLayer = useMemo(() => highlight.map((mark, index) =>
    mark.kind === 'road' && gridEdgeSet.has(mark.ref) ? (
      <g key={`hl:${mark.ref}:${index}`} className="road-highlight" pointerEvents="none" opacity={0.55}>
        <Road edgeId={mark.ref as EdgeId} color={mark.color ?? '#e72525'} />
      </g>
    ) : null), [highlight, gridEdgeSet])
  const markLayer = useMemo(() => highlight
    .filter((mark) => mark.kind !== 'road' && (mark.kind === 'hex' ? grid.landKeys : gridVertexSet).has(mark.ref))
    .map((mark) => {
      if (mark.kind === 'hex') return <polygon key={`hl:${mark.ref}`} className="hex-highlight" points={hexPoints(parseAxialKey(mark.ref), SIZE - 6)} fill="none" stroke={mark.color ?? INK_COLOR} strokeWidth="3.5" strokeDasharray="7 4" pointerEvents="none" />
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
        ? point.y + TIER_BASE_Y[marked.tier] * TIER_SCALE[marked.tier] - LABEL_LIFT
        : point.y + 3.8
      const fill = mark.color
      const ink = mark.color ? readableInk(mark.color) : undefined
      const faded = mark.faded ? ' faded' : ''
      return (
        <g key={`hl:${mark.ref}`} pointerEvents="none">
          {!marked && (
            <circle
              className={`vertex-highlight${faded}`}
              cx={point.x}
              cy={point.y}
              r="9.5"
              style={fill ? { fill, stroke: '#30271f' } : undefined}
            />
          )}
          {mark.label && (
            <text
              x={point.x}
              y={labelY}
              textAnchor="middle"
              className={`vertex-highlight-label${faded}`}
              fill={ink}
            >
              {mark.label}
            </text>
          )}
        </g>
      )
    }), [highlight, grid, gridVertexSet, markedBuildings])
  return (
    // The fitted box's proportions, for the phone arm's sea frame (spec S3):
    // square when the content is wider than tall, the content's own ratio otherwise.
    <section className="board-stage" style={{ '--board-aspect': String(viewBox.width / viewBox.height) } as CSSProperties}>
      {/* The board covers most of the phone viewport, so it must never be the
          reason a vertical swipe does nothing: the browser keeps that axis at
          every zoom level. Panning a zoomed board is the two-finger gesture,
          which also pans by the midpoint delta. pan-y still suppresses browser
          pinch-zoom, so the pinch handler gets its events. */}
      <svg
        ref={svgRef}
        className="board-canvas"
        style={{ touchAction: 'pan-y' }}
        viewBox={`${renderedViewBox.x} ${renderedViewBox.y} ${renderedViewBox.width} ${renderedViewBox.height}`}
        aria-label={readOnly ? 'Catan board history' : 'Editable Catan board'}
        onPointerDownCapture={() => {
          if (overlayOpen()) suppressClick.current = true
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endPointer(event, false)}
        onPointerCancel={cancelPointer}
        onLostPointerCapture={onLostCapture}
        onPointerLeave={(event) => {
          finePointer.current = null
          if (hoveredTarget !== null) setHoveredTarget(null)
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) cancelPointer(event)
        }}
        onClickCapture={(event) => {
          const start = finePointerDown.current
          finePointerDown.current = null
          // Only piece placement treats a moved click as a drag; a terrain click that drifts still paints its hex.
          const dragged = !coarse && pieceActive && start !== null &&
            Math.hypot(event.clientX - start.x, event.clientY - start.y) > PAN_THRESHOLD
          if (!readOnly && !suppressClick.current && !dragged) return
          event.preventDefault()
          event.stopPropagation()
          suppressClick.current = false
        }}
        onClick={(event) => {
          if (!placementActive) return
          const target = targetAt(pointOf(event))
          if (target) actOnTarget(target)
        }}
      >
        <defs>
          {/* Buildings (not roads) sit slightly proud of the board. The filter
              region is widened past the default 120% so the blur isn't clipped. */}
          <filter id="piece-shadow" x="-50%" y="-50%" width="200%" height="200%">
            {/* Near-centred: the piece is opaque, so a large dy would hide the
                shadow above it and smear it below. A wide, light blur carries the
                lift, and a small dy keeps the piece grounded rather than glowing. */}
            <feDropShadow dx="0" dy="0.5" stdDeviation="4" floodColor={INK_COLOR} floodOpacity="0.5" />
          </filter>
          {/* Highlighted pieces: the same shadow, deeper and wider, so a hovered
              draft pick reads as lifted off the board. */}
          <filter id="piece-highlight" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="2" stdDeviation="4.4" floodColor={INK_COLOR} floodOpacity="0.95" />
          </filter>
          {/* The sea rect below rounds the board's own corners, but a zoomed
              window sits inside that rect and would meet the element's square
              edges instead. This frames whatever is currently visible, so the
              rounding survives the zoom rather than scrolling off with the
              sea. rx follows the scale to hold a constant on-screen radius. */}
          <clipPath id="board-frame">
            <rect
              x={renderedViewBox.x}
              y={renderedViewBox.y}
              width={renderedViewBox.width}
              height={renderedViewBox.height}
              rx={SEA_RADIUS / transform.scale}
            />
          </clipPath>
        </defs>
        <g clipPath="url(#board-frame)">
          <rect className="board-sea" x={viewBox.x} y={viewBox.y} width={viewBox.width} height={viewBox.height} rx={SEA_RADIUS} fill={SEA_COLOR} />
          {hexLayer}
          {tokenLayer}
          {robberLayer}
          {robberTokenLayer}
          {portLayer}
          {roadLayer}
          {roadMarkLayer}
          {buildingLayer}
          {markLayer}
          <g className="hit-layers">
            {hexActive && board.hexes.map((hex) => (
              <polygon key={`hit:${axialKey(hex.coord)}`} data-hex={axialKey(hex.coord)} points={hexPoints(hex.coord)} onClick={(event) => {
                // With a terrain picked the svg click edits ports; a hex tap must not also hit the nearest one.
                event.stopPropagation()
                onHex(hex.coord)
              }} />
            ))}
          </g>
          {/* Placement affordances: legal dots, a piece preview at an empty target, or a ring. */}
          <g className="placement-layer">
            {buildActive && placeableVertices.map((vertexId) => {
              if (vertexId === preview?.ref || draftPlayer !== null) return null
              const point = vertexPoint(vertexId)
              return <circle key={`slot:${vertexId}`} className="placement-slot" cx={point.x} cy={point.y} r={coarse ? 4.7 : 3.6} fill={playerColor(placementPlayer)} fillOpacity={0.85} stroke={readableInk(playerColor(placementPlayer))} strokeWidth={1.2} strokeOpacity={0.9} onClick={(event) => onSlotClick(event, { ref: vertexId, ...point })} />
            })}
            {roadActive && placeableEdges.map((edgeId) => {
              if (edgeId === preview?.ref) return null
              const [a, b] = edgeEndpointVertexIds(edgeId).map(vertexPoint)
              const point = midpoint([a, b])
              return <circle key={`slot:${edgeId}`} className="placement-slot" cx={point.x} cy={point.y} r={coarse ? 3.6 : 2.8} fill={playerColor(placementPlayer)} fillOpacity={0.85} stroke={readableInk(playerColor(placementPlayer))} strokeWidth={1.2} strokeOpacity={0.9} onClick={(event) => onSlotClick(event, { ref: edgeId, ...point })} />
            })}
            {portsTappable && portSlots.map((slot) => (
              <circle key={slot.ref} className="placement-slot" cx={slot.x} cy={slot.y} r={coarse ? PORT_DOT_COARSE : PORT_DOT_FINE} fill={TOKEN_COLOR} fillOpacity={0.85} onClick={(event) => onSlotClick(event, slot)} />
            ))}
            {preview && !previewRoad && <path
              className="placement-hover"
              d={SETTLEMENT_PATH}
              transform={`translate(${preview.x} ${preview.y}) scale(${TIER_SCALE.settlement})`}
              fill={playerColor(hoverPlayer)}
              fillOpacity={0.7}
              stroke="#30271f"
              strokeOpacity={0.75}
              strokeWidth={PIECE_STROKE / TIER_SCALE.settlement}
              strokeLinejoin="round"
            />}
            {previewRoad && <rect
              className="placement-hover"
              x={-previewRoad.roadLength / 2}
              y={-ROAD_CORE / 2}
              width={previewRoad.roadLength}
              height={ROAD_CORE}
              rx={ROAD_RADIUS}
              transform={`translate(${previewRoad.mid.x} ${previewRoad.mid.y}) rotate(${previewRoad.angle})`}
              fill={playerColor(hoverPlayer)}
              fillOpacity={0.7}
              stroke="#30271f"
              strokeOpacity={0.75}
              strokeWidth={PIECE_STROKE}
            />}
            {hover && !preview && <circle className="placement-hover" cx={hover.x} cy={hover.y} r={hoverPort ? PORT_HOVER_RADIUS : 16} fill="none" stroke={playerColor(hoverPlayer)} strokeWidth={2.5} />}
          </g>
        </g>
      </svg>
      {transform.scale > 1 && (
        <div className="board-status">
          <span className="board-zoom">
            {transform.scale.toFixed(1)}×
            <button type="button" onClick={() => setTransform(IDENTITY)}>Reset</button>
          </span>
        </div>
      )}
    </section>
  )
}
