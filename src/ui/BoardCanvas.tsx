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
import { draftIsComplete, inferDraftState } from '../engine/draft'
import { activePlayerId } from '../model/turn'
import { boardGrid } from '../model/layouts'
import {
  isBlank,
  placeBuilding,
  placeRoad,
  removeBuilding,
  removePort,
  removeRoad,
  setHexTile,
  setLayout,
  setNumberToken,
  setRobber,
  settlementOrdinals,
  upsertPort,
} from '../model/board'
import type { AxialCoord, Board, BuildingTier, EdgeId, LayoutId, Port, VertexId } from '../model/types'
import { BLANK_TILE_COLOR, INK_COLOR, readableInk, SEA_COLOR, TILE_COLORS, TOKEN_COLOR } from './colors'
import { ConfirmDialog } from './ConfirmDialog'
import { NumberTokenFace, ROBBER_BODY, ROBBER_HEAD_CY, ROBBER_HEAD_R, TokenPips } from './glyphs'
import { MenuSelect } from './MenuSelect'
import { overlayOpen } from './overlayPosition'
import { PortPopover } from './PortPopover'
import { buildingSlots, clickTarget, nextBuildingTier, roadSlots } from './placementSlots'
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
// How far the port bubble sits beyond its coastal edge, along the outward
// normal. A full apothem (SIZE·√3/2) would center it on the phantom neighbour
// hex, making the leaders equilateral; squashing flattens that triangle.
const PORT_TRIANGLE_SQUASH = 0.7
const PORT_OFFSET = (SIZE * Math.sqrt(3)) / 2 * PORT_TRIANGLE_SQUASH
const PORT_HALF_W = 25
const PORT_HALF_H = 13
// Sea margin kept around the outermost drawn content on every side.
const BOARD_MARGIN = 18
// Rounding on the sea's corners, in unscaled board units. The clip frame that
// carries it while zoomed divides it by the scale, so the on-screen radius is
// the same at 6x as it is at fit.
const SEA_RADIUS = 32
// Shared outline width for every piece (buildings + roads), in unscaled board
// units. Matches the settlement's original border (2.5 stroke × 0.8 scale).
const PIECE_STROKE = 2
// Colored core width of a road; its casing adds PIECE_STROKE on each side.
const ROAD_CORE = 7
// Corner rounding on the road's rectangular ends (SVG rx on the casing/core
// rects). Small enough to read as a squared-off plank, not a capsule.
const ROAD_RADIUS = 2.5
// Fraction of an edge trimmed from each end of a highlighted road direction, so the stub sits
// between the vertex circles the same recommendation draws rather than running under them.
const MARK_EDGE_INSET = 0.26
const SETTLEMENT_PATH = 'M-15,13 V-3 L0,-15 L15,-3 V13 Z'
// Render scale per tier, and the y of each silhouette's base in its own
// unscaled path units — a highlight number sits just above that footing.
const TIER_SCALE: Record<BuildingTier, number> = { settlement: 0.8, city: 1, superCity: 1.18 }
const TIER_BASE_Y: Record<BuildingTier, number> = { settlement: 13, city: 12.2, superCity: 11.3 }
// Conservative half-extent a placed building reaches from its vertex, across all
// tiers/scales (city annex ≈ 20 + outline). Used to keep edge pieces in-frame.
const PIECE_REACH = 22

const LAYOUT_LABEL: Record<LayoutId, string> = {
  standard4: '4 player',
  extension6: '5–6 player',
}
const LAYOUT_OPTIONS = (Object.keys(LAYOUT_LABEL) as LayoutId[])
  .map((value) => ({ value, label: LAYOUT_LABEL[value] }))

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
  const inset = length * 0.07
  const a2 = { x: a.x + dir.x * inset, y: a.y + dir.y * inset }
  const b2 = { x: b.x - dir.x * inset, y: b.y - dir.y * inset }
  const roadLength = Math.max(0, Math.hypot(b2.x - a2.x, b2.y - a2.y))
  const mid = { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 }
  const angle = (Math.atan2(b2.y - a2.y, b2.x - a2.x) * 180) / Math.PI
  return { roadLength, mid, angle }
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
  const { board } = tab.game
  const [editingPort, setEditingPort] = useState<EdgeId | null>(null)
  const [pendingLayout, setPendingLayout] = useState<LayoutId | null>(null)
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
  const setTransform = (next: ViewTransform) => {
    transformRef.current = next
    setTransformState(next)
  }
  // The popover edge belongs to the tab it was opened on; keeping it across a
  // tab switch would edit (or crash on) a different board's coastline.
  useEffect(() => {
    setEditingPort(null)
    // A pending layout change belongs to the tab it was raised on; drop it on a
    // switch so confirming can't reset a different board.
    setPendingLayout(null)
  }, [state.activeTabId])
  const grid = useMemo(() => boardGrid(board.layout), [board.layout])
  // Positions depend on the layout alone; the candidates below filter them per board.
  const targetPositions = useMemo(() => [
    ...grid.vertexIds.map((ref) => ({ ref, ...vertexPoint(ref) })),
    ...grid.edgeIds.map((ref) => ({ ref, ...midpoint(edgeEndpointVertexIds(ref).map(vertexPoint)) })),
  ], [grid])
  const gridVertexSet = useMemo<ReadonlySet<string>>(() => new Set(grid.vertexIds), [grid])
  const highlight = state.highlight ?? restMarks ?? NO_MARKS
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
        // The pill is wider than tall, so it reaches further back toward a
        // vertical edge (normal along x) than toward a slanted one (|nx| = 0.5).
        // Add that extra reach, so the sea gap is the same on every edge.
        const offset = PORT_OFFSET + (PORT_HALF_W - PORT_HALF_H) * (Math.abs(outward.x) / length - 0.5)
        const point = {
          x: midpoint.x + (outward.x / length) * offset,
          y: midpoint.y + (outward.y / length) * offset,
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
  const pick = state.pick

  // A pick places for the turn player; a tool places for the editor's selected player.
  const placementPlayer = pick ? activePlayerId(tab.game) : tab.activePlayerId
  const placeableVertices = useMemo<VertexId[]>(() => {
    if (pick) return pick.want === 'vertex' ? buildingSlots(board, placementPlayer, pick.piece, 'build') : []
    if (state.tool.kind !== 'piece') return []
    const occupied = new Set(board.buildings.map((building) => building.vertexId))
    return buildingSlots(board, placementPlayer, 'settlement', 'edit').filter((vertexId) => !occupied.has(vertexId))
  }, [state.tool, board, placementPlayer, pick])
  const placeableEdges = useMemo<EdgeId[]>(() => {
    if (pick ? pick.want !== 'edge' : state.tool.kind !== 'piece') return []
    return roadSlots(board, placementPlayer, pick?.want === 'edge' ? pick.edges : undefined)
  }, [state.tool, board, placementPlayer, pick])
  const candidates = useMemo(() => {
    const refs = new Set<string>([...placeableVertices, ...placeableEdges])
    if (!pick && state.tool.kind === 'piece') {
      for (const building of board.buildings) refs.add(building.vertexId)
      for (const road of board.roads) refs.add(road.edgeId)
    }
    return [
      ...targetPositions.filter((target) => refs.has(target.ref)),
      ...(!pick && state.tool.kind === 'piece' ? ports.map(({ port, point }) => ({ ref: `port:${port.edgeId}`, ...point })) : []),
    ]
  }, [targetPositions, placeableVertices, placeableEdges, board.buildings, board.roads, ports, pick, state.tool])
  const targetAt = useCallback((point: Point) => {
    const rect = svgRef.current && contentBox(svgRef.current)
    // An unmeasured board has no point to resolve; clientToUnits would answer with the view centre.
    if (!rect || rect.width === 0 || rect.height === 0) return null
    const units = clientToUnits(point, rect, viewBox, transformRef.current)
    const ref = clickTarget(units, candidates, lastClick.current, { max: SIZE / 2, repeat: REPEAT_DISTANCE, direct: DIRECT_DISTANCE })
    return ref === null ? null : { ref, ...units }
  }, [candidates, viewBox])
  const draftComplete = useMemo(() => draftIsComplete(board, inferDraftState(board)), [board])
  // Stable across renders that don't change the roster, so the piece layers
  // below can list it as a dependency without re-rendering on every render.
  const playerColor = useCallback(
    (id: string | null) => board.players.find((player) => player.id === id)?.color ?? '#333',
    [board.players],
  )
  const commit = (nextBoard: Board) => dispatch({ type: 'commit', board: nextBoard })
  const choose = (layout: LayoutId) => {
    if (layout === board.layout) return
    // Only confirm when the switch would destroy something.
    if (isBlank(board)) commit(setLayout(board, layout))
    else setPendingLayout(layout)
  }
  const onHex = (coord: AxialCoord) => {
    if (pick) {
      if (pick.want === 'hex') dispatch({ type: 'picked', ref: axialKey(coord) })
      return
    }
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
    if (pick) {
      if (pick.want === 'edge') dispatch({ type: 'picked', ref: edgeId })
      return
    }
    if (state.tool.kind === 'piece') {
      const existing = board.roads.find((road) => road.edgeId === edgeId)
      if (existing) commit(removeRoad(board, edgeId))
      else if (tab.activePlayerId !== null) commit(placeRoad(board, edgeId, tab.activePlayerId))
    } else if (state.tool.kind === 'erase') {
      commit(removePort(removeRoad(board, edgeId), edgeId))
    } else if (state.tool.kind === 'port' && grid.coastalEdgeIds.includes(edgeId)) setEditingPort(edgeId)
  }
  const onVertex = (vertexId: VertexId) => {
    if (pick) {
      if (pick.want === 'vertex') dispatch({ type: 'picked', ref: vertexId })
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
    } else if (state.tool.kind === 'erase') commit(removeBuilding(board, vertexId))
  }
  const buildActive = pick ? pick.want === 'vertex' : state.tool.kind === 'piece'
  const roadActive = pick ? pick.want === 'edge' : state.tool.kind === 'piece'
  const placementActive = buildActive || roadActive
  const hover = coarse ? undefined : candidates.find((target) => target.ref === hoveredTarget)
  const hoverBuilding = hover && board.buildings.find((building) => building.vertexId === hover.ref)
  const hoverRoad = hover && board.roads.find((road) => road.edgeId === hover.ref)
  const hoverPlayer = hover && !hover.ref.startsWith('port:')
    ? hoverBuilding?.playerId ?? hoverRoad?.playerId ?? placementPlayer
    : null
  const preview = hover && !hover.ref.startsWith('port:') && !hoverBuilding && !hoverRoad ? hover : undefined
  const previewRoad = preview?.ref.startsWith('e:') ? roadGeometry(preview.ref as EdgeId) : undefined
  useEffect(() => {
    lastClick.current = null
    finePointer.current = null
    finePointerDown.current = null
  }, [placementActive, state.activeTabId, board.layout])
  useEffect(() => {
    setHoveredTarget(!coarse && placementActive && finePointer.current
      ? targetAt(finePointer.current)?.ref ?? null
      : null)
  }, [targetAt, coarse, placementActive, state.activeTabId, board.layout, transform])
  const actOnTarget = (target: { ref: string; x: number; y: number }) => {
    lastClick.current = target
    if (target.ref.startsWith('port:')) setEditingPort(target.ref.slice(5) as EdgeId)
    else if (target.ref.startsWith('v:')) onVertex(target.ref as VertexId)
    else onEdge(target.ref as EdgeId)
  }
  // The dots take no pointer events (editor.css), so a pointer always goes through the svg's
  // handler; only a click dispatched on a dot itself arrives here, and it names its target.
  const onSlotClick = (event: ReactMouseEvent<SVGCircleElement>, slot: { ref: string; x: number; y: number }) => {
    event.stopPropagation()
    actOnTarget(slot)
  }
  const eraseActive = !pick && state.tool.kind === 'erase'
  const portActive = !pick && state.tool.kind === 'port'
  const hexActive = pick ? pick.want === 'hex' : state.tool.kind === 'tile' || state.tool.kind === 'token' || state.tool.kind === 'robber'
  const gesturesBlocked = editingPort !== null || pendingLayout !== null
  const overlayBlocksGestures = () =>
    gesturesBlocked || overlayOpen()
  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (overlayBlocksGestures()) return
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
    if (overlayBlocksGestures()) return
    if (!coarse) {
      finePointer.current = pointOf(event)
      setHoveredTarget(targetAt(finePointer.current)?.ref ?? null)
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
    // Double-tap-to-zoom only exists when no placement tool is selected. The
    // first tap of a pair is never suppressed — suppressing it would mean
    // holding every single placement for the full double-tap window — so with a
    // tool active a double tap would zoom *and* edit the board under the first
    // tap, and tapping neighbouring hexes quickly is ordinary editing. With a
    // tool selected, taps place and pinch is the way to zoom. Clearing the
    // stored tap keeps one made under a tool from later pairing with a tap made
    // after the tool was dropped.
    if (pick || state.tool.kind !== 'none') {
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
  // the map forever, jamming taps and clicks.
  const onLostCapture = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(event.pointerId)) return
    cancelPointer(event)
  }
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (event: WheelEvent) => {
      if (
        !event.ctrlKey ||
        gesturesBlocked ||
        overlayOpen()
      ) return
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
  }, [gesturesBlocked, viewBox])
  // Panning and pinching change nothing but the <svg>'s viewBox, yet a plain
  // render rebuilds and diffs every one of the ~300 presentation elements on
  // each pointermove. Memoizing the layers that don't read the transform makes
  // a gesture frame diff a single attribute. Only the presentation layers are
  // memoized: the hit and placement layers close over the board-editing
  // handlers, which are rebuilt every render anyway, and are far smaller.
  const hexLayer = useMemo(() => board.hexes.map((hex) => (
    <polygon
      key={axialKey(hex.coord)}
      points={hexPoints(hex.coord)}
      fill={hex.tile ? TILE_COLORS[hex.tile] : BLANK_TILE_COLOR}
      stroke="#f8f1dc"
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
      <g key={`token:${axialKey(hex.coord)}`}>
        <NumberTokenFace number={hex.numberToken} x={point.x} y={point.y} discOnly={underRobber} />
      </g>
    )
  }), [board.hexes, board.robber])
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
  const portLayer = useMemo(() => ports.map(({ port, a, b, point }) => {
    const fill = port.resource ? TILE_COLORS[port.resource] : TOKEN_COLOR
    const ink = port.resource ? readableInk(TILE_COLORS[port.resource]) : INK_COLOR
    return (
      <g
        key={`port:${port.edgeId}`}
        className={highlightSet.has(port.edgeId) ? 'highlighted' : ''}
        onClick={
          portActive ? () => setEditingPort(port.edgeId)
            // The badge floats in the sea, clear of the edge hit line that erases its port.
            : eraseActive ? () => dispatch({ type: 'commit', board: removePort(board, port.edgeId) })
              : undefined
        }
        style={portActive ? { cursor: 'pointer' } : eraseActive ? { cursor: 'crosshair' } : undefined}
      >
        <line x1={a.x} y1={a.y} x2={point.x} y2={point.y} stroke="#fff" strokeWidth="2" strokeDasharray="5 5" />
        <line x1={b.x} y1={b.y} x2={point.x} y2={point.y} stroke="#fff" strokeWidth="2" strokeDasharray="5 5" />
        <rect x={point.x - PORT_HALF_W} y={point.y - PORT_HALF_H} width={PORT_HALF_W * 2} height={PORT_HALF_H * 2} rx={PORT_HALF_H} fill={fill} stroke="#fff" strokeWidth="2.5" />
        <text x={point.x} y={point.y + 4} textAnchor="middle" className="port-text" fill={ink}>{port.rate}:1</text>
      </g>
    )
  }), [ports, highlightSet, portActive, eraseActive, board, dispatch])
  const roadLayer = useMemo(() => board.roads.map((road) => {
    // Draw the road as a slim rounded rectangle rather than a round-capped
    // stroke: squarer ends read as a plank, not a capsule. Rotate a
    // midpoint-centred rect to the edge's angle; the casing is the same
    // rect grown by PIECE_STROKE on every side.
    const { roadLength, mid, angle } = roadGeometry(road.edgeId)
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
  }), [board.roads, playerColor])

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
            {building.tier === 'city' && <path d="M-13,12.2 V-2.8 L0,-14.1 L13,-2.8 H20 V12.2 Z" />}
            {building.tier === 'superCity' && <path d="M-15,11.3 V-2.6 L-9,-11.3 L-4,-3.5 V-11.3 H4 V-3.5 L9,-11.3 L15,-2.6 V11.3 Z" />}
          </g>
        </g>
        {/* The pick number sits where a Best picks mark stamps its own, which wins when both land here. */}
        {ordinal && !highlight.some((mark) => mark.ref === building.vertexId && mark.label) && (
          <text
            className="settlement-ordinal"
            x={point.x}
            y={point.y + TIER_BASE_Y.settlement * scale - 4.2}
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
  const markLayer = useMemo(() => highlight
    .filter((mark) => (mark.kind === 'hex' ? grid.landKeys : mark.kind === 'road' ? gridEdgeSet : gridVertexSet).has(mark.ref))
    .map((mark) => {
      if (mark.kind === 'hex') return <polygon key={`hl:${mark.ref}`} className="hex-highlight" points={hexPoints(parseAxialKey(mark.ref), SIZE - 6)} fill="none" stroke={mark.color ?? INK_COLOR} strokeWidth="3.5" strokeDasharray="7 4" pointerEvents="none" />
      // A road mark is a direction, not a place: the analysis panel's road recommendation.
      // Draw it as a stub of road along the edge, short enough to leave both endpoints clear of
      // the vertex circles the same recommendation puts there. Every other mark is a place, and
      // an edge ref among them names a port, which `portLayer` lights up instead.
      if (mark.kind === 'road') {
        const [a, b] = edgeEndpointVertexIds(mark.ref as EdgeId).map(vertexPoint)
        const from = { x: a.x + (b.x - a.x) * MARK_EDGE_INSET, y: a.y + (b.y - a.y) * MARK_EDGE_INSET }
        const to = { x: b.x - (b.x - a.x) * MARK_EDGE_INSET, y: b.y - (b.y - a.y) * MARK_EDGE_INSET }
        return (
          <g key={`hl:${mark.ref}`} pointerEvents="none">
            <line
              className="edge-highlight"
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              style={mark.color ? { stroke: mark.color } : undefined}
            />
          </g>
        )
      }
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
        : point.y + 4.73
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
              r="11"
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
    }), [highlight, grid, gridEdgeSet, gridVertexSet, markedBuildings])
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
        aria-label="Editable Catan board"
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
          const dragged = !coarse && placementActive && start !== null &&
            Math.hypot(event.clientX - start.x, event.clientY - start.y) > PAN_THRESHOLD
          if (!suppressClick.current && !dragged) return
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
          {/* Pieces step back during the draft so the Best picks circles lead. */}
          <g opacity={draftComplete ? undefined : 0.7}>
            {roadLayer}
            {buildingLayer}
          </g>
          {markLayer}
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
              return <circle key={`hit:${vertexId}`} cx={point.x} cy={point.y} r={coarse ? 17 : 9} onClick={() => onVertex(vertexId)} />
            })}
          </g>
          {/* Placement affordances: legal dots, a piece preview at an empty target, or a ring. */}
          <g className="placement-layer">
            {buildActive && placeableVertices.map((vertexId) => {
              if (vertexId === preview?.ref) return null
              const point = vertexPoint(vertexId)
              return <circle key={`slot:${vertexId}`} className="placement-slot" cx={point.x} cy={point.y} r={coarse ? 4.7 : 3.6} fill={playerColor(placementPlayer)} fillOpacity={0.85} stroke={readableInk(playerColor(placementPlayer))} strokeWidth={1.2} strokeOpacity={0.9} onClick={(event) => onSlotClick(event, { ref: vertexId, ...point })} />
            })}
            {roadActive && placeableEdges.map((edgeId) => {
              if (edgeId === preview?.ref) return null
              const [a, b] = edgeEndpointVertexIds(edgeId).map(vertexPoint)
              const point = midpoint([a, b])
              return <circle key={`slot:${edgeId}`} className="placement-slot" cx={point.x} cy={point.y} r={coarse ? 3.6 : 2.8} fill={playerColor(placementPlayer)} fillOpacity={0.85} stroke={readableInk(playerColor(placementPlayer))} strokeWidth={1.2} strokeOpacity={0.9} onClick={(event) => onSlotClick(event, { ref: edgeId, ...point })} />
            })}
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
            {hover && !preview && <circle className="placement-hover" cx={hover.x} cy={hover.y} r={16} fill="none" stroke={playerColor(hoverPlayer)} strokeWidth={2.5} />}
          </g>
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
      <div className="board-status">
        <MenuSelect
          ariaLabel="Board layout"
          value={board.layout}
          options={LAYOUT_OPTIONS}
          onSelect={choose}
          align="center"
        >
          <strong>{LAYOUT_LABEL[board.layout]}</strong>
        </MenuSelect>
        {transform.scale > 1 && (
          <span className="board-zoom">
            {transform.scale.toFixed(1)}×
            <button type="button" onClick={() => setTransform(IDENTITY)}>Reset</button>
          </span>
        )}
      </div>
    </section>
  )
}
