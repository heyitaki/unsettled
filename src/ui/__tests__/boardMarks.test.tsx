// @vitest-environment jsdom
import { act, useEffect, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addPlayer, createBoard, placeBuilding, placeRoad, setHexTile } from '../../model/board'
import { axialToPixel, parseVertexId } from '../../model/coords'
import { legalSettlementVertices } from '../../engine/legality'
import { boardGrid, defaultPortEdges } from '../../model/layouts'
import type { Board } from '../../model/types'
import { BoardCanvas } from '../BoardCanvas'
import { StoreProvider, useStore, type HighlightMark } from '../store'

// The draft tap asks the engine for a setup road; none is needed to see where a tap lands.
vi.mock('../../engine/setupRoad', () => ({ setupRoad: async () => null }))

const grid = boardGrid('standard4')
const EDGE = grid.edgeIds[0]
const VERTEX = grid.vertexIds[0]
// A port and a recommended road are both keyed by the edge they sit on, so the one edge that is
// both is where the two can be told apart.
const PORT_EDGE = defaultPortEdges('standard4')[0]
const COLOR = '#3063ba'

/** Pushes the marks under test into the store the canvas reads, then draws the canvas. */
function Harness({ marks, board }: { marks: readonly HighlightMark[]; board?: Board }): ReactNode {
  const { dispatch } = useStore()
  useEffect(() => {
    if (board) dispatch({ type: 'commit', board })
    dispatch({ type: 'highlight', marks })
  }, [dispatch, marks, board])
  return <BoardCanvas />
}

let container: HTMLDivElement
let root: Root

// React's act() refuses to run without this flag, and jsdom does not set it.
const actEnvironment = (on: boolean): void => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', on)
}

const draw = (marks: readonly HighlightMark[], board?: Board): void => {
  act(() => {
    root.render(<StoreProvider><Harness marks={marks} board={board} /></StoreProvider>)
  })
}

const draftBoard = () => {
  let board = addPlayer(createBoard('standard4'), { id: 'b', name: 'Blue', color: COLOR })
  board = setHexTile(board, { q: 0, r: 0 }, 'wood')
  return placeBuilding(board, VERTEX, board.players[0].id, 'settlement')
}

/** A board in mid-draft with the tools closed, wearing the marks under test. */
function DraftBoard({ marks }: { marks: readonly HighlightMark[] }) {
  const { dispatch } = useStore()
  useEffect(() => {
    dispatch({ type: 'commit', board: draftBoard() })
    dispatch({ type: 'highlight', marks })
  }, [dispatch, marks])
  return <BoardCanvas />
}

const [UNMARKED, PLANNED, UNRANKED, RANKED] = legalSettlementVertices(draftBoard())
const PLANNED_MARKS: readonly HighlightMark[] = [
  { ref: PLANNED, color: COLOR, faded: true },
]

describe('board mark layer', () => {
  beforeEach(() => {
    actEnvironment(true)
    localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    actEnvironment(false)
  })

  it.each([undefined, false, true])("draws a planned road on the placed road's core geometry (faded: %s)", (faded) => {
    const board = { ...createBoard('standard4'), players: [{ id: 'b', name: 'Blue', color: COLOR }] }
    draw([{ ref: EDGE, color: COLOR, label: 'R', kind: 'road', faded }], placeRoad(board, EDGE, 'b'))

    const core = container.querySelector(`g[transform] > rect[fill="${COLOR}"]`)!
    const planned = container.querySelectorAll('.road-highlight > rect.planned-piece')
    expect(planned).toHaveLength(1)
    const road = planned[0]
    expect(road.parentElement?.getAttribute('pointer-events')).toBe('none')
    expect(road.getAttribute('fill')).toBe(COLOR)
    for (const name of ['x', 'y', 'width', 'height', 'rx']) expect(road.getAttribute(name)).toBe(core.getAttribute(name))
    expect(road.getAttribute('transform')).toBe(core.parentElement!.getAttribute('transform'))
    expect(Number(road.getAttribute('width'))).toBeCloseTo(50.88)
    expect(road.parentElement?.querySelector('line, text')).toBeNull()
    expect(container.querySelectorAll('.vertex-highlight')).toHaveLength(0)
  })

  it('uses highlight red for a road mark without a colour', () => {
    draw([{ ref: EDGE, kind: 'road' }])
    const road = container.querySelector('.road-highlight > rect.planned-piece')!
    expect(road.getAttribute('fill')).toBe('#e72525')
  })

  it('draws no draft dots outside edit mode', () => {
    act(() => root.render(<StoreProvider><DraftBoard marks={PLANNED_MARKS} /></StoreProvider>))
    expect(container.querySelectorAll('.placement-slot')).toHaveLength(0)
  })

  it('takes a draft tap on a placeable circle and on no other mark', async () => {
    // A likely-gone circle is solid like a first pick, and only the flag tells them apart.
    const marks: HighlightMark[] = [...PLANNED_MARKS, { ref: UNRANKED, color: COLOR, label: '1' }, { ref: RANKED, color: COLOR, label: '1', placeable: true }]
    act(() => root.render(<StoreProvider><DraftBoard marks={marks} /></StoreProvider>))
    const svg = container.querySelector<SVGSVGElement>('.board-canvas')!
    // Laid over its own view box, so a client point is a board point.
    const [x, y, width, height] = svg.getAttribute('viewBox')!.split(' ').map(Number)
    svg.getBoundingClientRect = () => new DOMRect(x, y, width, height)
    const buildings = () => container.querySelectorAll('g[filter="url(#piece-shadow)"] > g, g[filter="url(#piece-highlight)"] > g').length
    const tap = async (vertex: string) => {
      const points = parseVertexId(vertex).map((coord) => axialToPixel(coord, 58))
      const clientX = points.reduce((sum, p) => sum + p.x, 0) / 3
      const clientY = points.reduce((sum, p) => sum + p.y, 0) / 3
      await act(async () => { svg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY })) })
    }
    expect(buildings()).toBe(1)
    for (const vertex of [PLANNED, UNMARKED, UNRANKED]) {
      await tap(vertex)
      expect(buildings()).toBe(1)
    }
    await tap(RANKED)
    expect(buildings()).toBe(2)
  })

  it('draws a vertex mark as a circle and no road', () => {
    draw([{ ref: VERTEX, color: COLOR, label: '1' }])

    expect(container.querySelectorAll('.vertex-highlight')).toHaveLength(1)
    expect(container.querySelectorAll('.road-highlight > rect')).toHaveLength(0)
  })

  it('ignores a road mark the layout has no edge for', () => {
    draw([{ ref: 'e:9,9;9,10', color: COLOR, label: 'R', kind: 'road' }])

    expect(container.querySelectorAll('.road-highlight > rect')).toHaveLength(0)
  })

  it('lights the port up for a plain edge mark and lays a road for a road mark', () => {
    draw([{ ref: PORT_EDGE }])
    expect(container.querySelectorAll('g.highlighted')).toHaveLength(1)
    expect(container.querySelectorAll('.road-highlight > rect')).toHaveLength(0)

    draw([{ ref: PORT_EDGE, color: COLOR, label: 'R', kind: 'road' }])
    expect(container.querySelectorAll('g.highlighted')).toHaveLength(0)
    expect(container.querySelectorAll('.road-highlight > rect.planned-piece')).toHaveLength(1)
  })
})
