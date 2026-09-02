import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
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
  upsertPort,
} from '../model/board'
import type { AxialCoord, Board, BuildingTier, EdgeId, LayoutId, Port, VertexId } from '../model/types'
import { INK_COLOR, PAPER_COLOR, readableInk, SEA_COLOR, TILE_COLORS, TOKEN_COLOR } from './colors'
import { ConfirmDialog } from './ConfirmDialog'
import { ROBBER_BODY, ROBBER_HEAD } from './glyphs'
import { MenuSelect } from './MenuSelect'
import { overlayOpen } from './overlayPosition'
import { PortPopover } from './PortPopover'
import { activeTab, useStore } from './store'
import {
  IDENTITY,
  clampTransform,
  clientToUnits,
  panBy,
  transformedViewBox,
  zoomAbout,
  type ViewTransform,
} from './boardViewport'
import { useCoarsePointer } from './useMediaQuery'

const SIZE = 58
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
const pointOf = (event: ReactPointerEvent<SVGSVGElement>): Point => ({ x: event.clientX, y: event.clientY })
const midpoint = (points: readonly Point[]): Point => ({
  x: (points[0].x + points[1].x) / 2,
  y: (points[0].y + points[1].y) / 2,
})
const distance = (points: readonly Point[]): number =>
  Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)

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
  const coarse = useCoarsePointer()
  const tab = activeTab(state)
  const { board } = tab.game
  const [editingPort, setEditingPort] = useState<EdgeId | null>(null)
  const [pendingLayout, setPendingLayout] = useState<LayoutId | null>(null)
  const [transform, setTransformState] = useState<ViewTransform>(IDENTITY)
  const transformRef = useRef<ViewTransform>(IDENTITY)
  const svgRef = useRef<SVGSVGElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const onePointer = useRef<{ x: number; y: number; panning: boolean } | null>(null)
  const gestureHadPinch = useRef(false)
  const suppressClick = useRef(false)
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null)
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
  const gesturesBlocked = editingPort !== null || pendingLayout !== null
  const overlayBlocksGestures = () =>
    gesturesBlocked || overlayOpen()
  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!coarse || overlayBlocksGestures()) return
    const point = pointOf(event)
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
    if (!coarse || overlayBlocksGestures() || !pointers.current.has(event.pointerId)) return
    const rect = event.currentTarget.getBoundingClientRect()
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
    if (!wasPanning && Math.hypot(point.x - start.x, point.y - start.y) <= 8) return
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
    if (state.tool.kind !== 'none') {
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
      const rect = event.currentTarget.getBoundingClientRect()
      const anchor = clientToUnits(pointOf(event), rect, viewBox, IDENTITY)
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
        svg.getBoundingClientRect(),
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
      fill={hex.tile ? TILE_COLORS[hex.tile] : '#d8d7cc'}
      stroke="#f8f1dc"
      strokeWidth="4"
      className={highlightSet.has(axialKey(hex.coord)) ? 'highlighted' : ''}
    />
  )), [board.hexes, highlightSet])
  const tokenLayer = useMemo(() => board.hexes.map((hex) => {
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
  }), [board.hexes, board.robber])
  const robberLayer = useMemo(() => {
    if (!board.robber) return null
    const point = center(board.robber)
    return (
      <g transform={`translate(${point.x} ${point.y})`}>
        <circle cy={ROBBER_HEAD.cy} r={ROBBER_HEAD.r} fill="#1c1c1c" />
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
        {pipDots(robberHex.numberToken, point.x, point.y, { fill: '#fff', stroke: '#1c1c1c' })}
      </g>
    )
  }, [board.robber, board.hexes])
  const portLayer = useMemo(() => ports.map(({ port, a, b, point }) => {
    const fill = port.resource ? TILE_COLORS[port.resource] : PAPER_COLOR
    const ink = port.resource ? readableInk(TILE_COLORS[port.resource]) : INK_COLOR
    return (
      <g
        key={`port:${port.edgeId}`}
        className={highlightSet.has(port.edgeId) ? 'highlighted' : ''}
        onClick={portActive ? () => setEditingPort(port.edgeId) : undefined}
        style={portActive ? { cursor: 'pointer' } : undefined}
      >
        <line x1={a.x} y1={a.y} x2={point.x} y2={point.y} stroke="#f5e9cf" strokeWidth="2" strokeDasharray="5 5" />
        <line x1={b.x} y1={b.y} x2={point.x} y2={point.y} stroke="#f5e9cf" strokeWidth="2" strokeDasharray="5 5" />
        <rect x={point.x - PORT_HALF_W} y={point.y - PORT_HALF_H} width={PORT_HALF_W * 2} height={PORT_HALF_H * 2} rx={PORT_HALF_H} fill={fill} stroke={INK_COLOR} strokeWidth="1.6" />
        <text x={point.x} y={point.y + 4} textAnchor="middle" className="port-text" fill={ink}>{port.rate}:1</text>
      </g>
    )
  }), [ports, highlightSet, portActive])
  const roadLayer = useMemo(() => board.roads.map((road) => {
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
  }), [board.roads, playerColor])
  const buildingLayer = useMemo(() => board.buildings.map((building) => {
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
  }), [board.buildings, markedBuildings, playerColor])
  const markLayer = useMemo(() => (state.highlight ?? [])
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
    }), [state.highlight, gridVertexSet, markedBuildings])
  return (
    // The fitted box's proportions, for the portrait arm's sea frame (spec S3):
    // square when the content is wider than tall, the content's own ratio otherwise.
    <section className="board-stage" style={{ '--board-aspect': String(viewBox.width / viewBox.height) } as CSSProperties}>
      <div className="board-status">
        <MenuSelect
          ariaLabel="Board layout"
          value={board.layout}
          options={LAYOUT_OPTIONS}
          onSelect={choose}
        >
          <strong>{LAYOUT_LABEL[board.layout]}</strong> layout
        </MenuSelect>
        <span className="board-count">{board.hexes.filter((hex) => hex.tile).length}/{board.hexes.length} terrain</span>
        <span className="board-count">{board.roads.length + board.buildings.length} pieces</span>
        {transform.scale > 1 && (
          <span className="board-zoom">
            {transform.scale.toFixed(1)}×
            <button type="button" onClick={() => setTransform(IDENTITY)}>Reset</button>
          </span>
        )}
      </div>
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
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endPointer(event, false)}
        onPointerCancel={cancelPointer}
        onLostPointerCapture={onLostCapture}
        onPointerLeave={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) cancelPointer(event)
        }}
        onClickCapture={(event) => {
          if (!suppressClick.current) return
          event.preventDefault()
          event.stopPropagation()
          suppressClick.current = false
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
          {roadLayer}
          {buildingLayer}
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
          {/* Placement affordances: visible, normal-cursor dots at every rule-legal
              vertex/edge for the active building or road tool. */}
          <g className="placement-layer">
            {buildActive && placeableVertices.map((vertexId) => {
              const point = vertexPoint(vertexId)
              return <circle key={`slot:${vertexId}`} className="placement-slot" cx={point.x} cy={point.y} r={coarse ? 11 : 8} fill="rgba(250,246,235,.5)" stroke={playerColor(tab.activePlayerId)} strokeWidth={coarse ? 3 : 2.5} onClick={() => onVertex(vertexId)} />
            })}
            {roadActive && placeableEdges.map((edgeId) => {
              const [a, b] = edgeEndpointVertexIds(edgeId).map(vertexPoint)
              return <circle key={`slot:${edgeId}`} className="placement-slot" cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} r={coarse ? 10 : 7} fill="rgba(250,246,235,.5)" stroke={playerColor(tab.activePlayerId)} strokeWidth={coarse ? 3 : 2.5} onClick={() => onEdge(edgeId)} />
            })}
            {/* Invisible targets over the active player's own same-tier pieces so
                clicking one with the same tool still toggles it off (onVertex /
                onEdge route to remove); no visible dot, just a normal-cursor hit. */}
            {buildTier && board.buildings
              .filter((piece) => piece.playerId === tab.activePlayerId && piece.tier === buildTier)
              .map((piece) => {
                const point = vertexPoint(piece.vertexId)
                return <circle key={`rm:${piece.vertexId}`} className="placement-remove" cx={point.x} cy={point.y} r={coarse ? 18 : 12} onClick={() => onVertex(piece.vertexId)} />
              })}
            {roadActive && board.roads
              .filter((road) => road.playerId === tab.activePlayerId)
              .map((road) => {
                const [a, b] = edgeEndpointVertexIds(road.edgeId).map(vertexPoint)
                return <line key={`rm:${road.edgeId}`} className="placement-remove" x1={a.x} y1={a.y} x2={b.x} y2={b.y} onClick={() => onEdge(road.edgeId)} />
              })}
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
