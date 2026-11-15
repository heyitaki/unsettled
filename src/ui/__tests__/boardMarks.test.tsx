// @vitest-environment jsdom
import { act, useEffect, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addPlayer, createBoard, placeBuilding, setHexTile } from '../../model/board'
import { axialToPixel, parseVertexId } from '../../model/coords'
import { legalSettlementVertices } from '../../engine/legality'
import { boardGrid, defaultPortEdges } from '../../model/layouts'
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
// jsdom rewrites an inline colour into its rgb() form on the way into the style attribute.
const COLOR_RGB = 'rgb(48, 99, 186)'

/** Pushes the marks under test into the store the canvas reads, then draws the canvas. */
function Harness({ marks }: { marks: readonly HighlightMark[] }): ReactNode {
  const { dispatch } = useStore()
  useEffect(() => dispatch({ type: 'highlight', marks }), [dispatch, marks])
  return <BoardCanvas />
}

let container: HTMLDivElement
let root: Root

// React's act() refuses to run without this flag, and jsdom does not set it.
const actEnvironment = (on: boolean): void => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', on)
}

const draw = (marks: readonly HighlightMark[]): void => {
  act(() => {
    root.render(<StoreProvider><Harness marks={marks} /></StoreProvider>)
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

const [RING_ONLY, SHARED, UNRANKED, RANKED] = legalSettlementVertices(draftBoard())
const RING_MARKS: readonly HighlightMark[] = [
  { ref: SHARED, color: COLOR, faded: true },
  { ref: RING_ONLY, color: COLOR, kind: 'ring' },
  { ref: SHARED, color: COLOR, kind: 'ring' },
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

  it('draws a road mark as one stroke and no vertex circle', () => {
    draw([{ ref: EDGE, color: COLOR, label: 'R', kind: 'road' }])

    const strokes = container.querySelectorAll('.edge-highlight')
    expect(strokes).toHaveLength(1)
    expect(strokes[0].getAttribute('style')).toContain(COLOR_RGB)
    expect(container.querySelectorAll('.vertex-highlight')).toHaveLength(0)
  })

  it('draws a ring with a dark outer edge and no filled vertex mark', () => {
    draw([{ ref: VERTEX, color: COLOR, kind: 'ring' }])
    const ring = container.querySelector('.vertex-ring')!
    const edge = container.querySelector('.vertex-ring-edge')!
    expect(container.querySelectorAll('.vertex-ring')).toHaveLength(1)
    expect(container.querySelectorAll('.vertex-ring-edge')).toHaveLength(1)
    expect(container.querySelector('.vertex-highlight')).toBeNull()
    expect(ring.getAttribute('stroke')).toBe(COLOR)
    expect(ring.getAttribute('stroke-width')).toBe('3')
    expect(edge.getAttribute('stroke')).toBe('#30271f')
    expect(edge.getAttribute('stroke-width')).toBe('5')
    expect([...ring.parentElement!.children]).toEqual([edge, ring])
    expect(ring.parentElement!.getAttribute('pointer-events')).toBe('none')
    expect(ring.parentElement!.querySelector('text')).toBeNull()
    const points = parseVertexId(VERTEX).map((coord) => axialToPixel(coord, 58))
    for (const circle of [edge, ring]) {
      expect(circle.getAttribute('fill')).toBe('none')
      expect(circle.getAttribute('r')).toBe('16')
      expect(Number(circle.getAttribute('cx'))).toBeCloseTo(points.reduce((sum, p) => sum + p.x, 0) / 3)
      expect(Number(circle.getAttribute('cy'))).toBeCloseTo(points.reduce((sum, p) => sum + p.y, 0) / 3)
    }
  })

  it('draws a larger ring beside a vertex mark on the same corner without duplicate keys', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      draw([
        { ref: VERTEX, color: COLOR, faded: true },
        { ref: VERTEX, color: COLOR, kind: 'ring' },
      ])
      expect(container.querySelectorAll('.vertex-highlight.faded')).toHaveLength(1)
      expect(container.querySelectorAll('.vertex-ring')).toHaveLength(1)
      expect(container.querySelectorAll('.vertex-ring-edge')).toHaveLength(1)
      for (const circle of container.querySelectorAll('.vertex-ring, .vertex-ring-edge')) {
        expect(circle.getAttribute('r')).toBe('19')
      }
      expect(errors).not.toHaveBeenCalled()
    } finally {
      errors.mockRestore()
    }
  })

  it('draws no draft dots outside edit mode, under a ring or anywhere else', () => {
    act(() => root.render(<StoreProvider><DraftBoard marks={RING_MARKS} /></StoreProvider>))
    const rings = [...container.querySelectorAll('.vertex-ring')]
    expect(rings).toHaveLength(2)
    expect(container.querySelectorAll('.placement-slot')).toHaveLength(0)
    rings.forEach((ring, index) => {
      const at = `[cx="${ring.getAttribute('cx')}"][cy="${ring.getAttribute('cy')}"]`
      expect(container.querySelectorAll(`.vertex-highlight${at}`)).toHaveLength(index === 0 ? 0 : 1)
      expect(ring.getAttribute('r')).toBe(index === 0 ? '16' : '19')
    })
  })

  it('takes a draft tap on a placeable circle and on no other mark', async () => {
    // A likely-gone circle is solid like a first pick, and only the flag tells them apart.
    const marks: HighlightMark[] = [...RING_MARKS, { ref: UNRANKED, color: COLOR, label: '1' }, { ref: RANKED, color: COLOR, label: '1', placeable: true }]
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
    for (const vertex of [SHARED, RING_ONLY, UNRANKED]) {
      await tap(vertex)
      expect(buildings()).toBe(1)
    }
    await tap(RANKED)
    expect(buildings()).toBe(2)
  })

  it('draws a vertex mark as a circle and no edge stroke', () => {
    draw([{ ref: VERTEX, color: COLOR, label: '1' }])

    expect(container.querySelectorAll('.vertex-highlight')).toHaveLength(1)
    expect(container.querySelectorAll('.edge-highlight')).toHaveLength(0)
  })

  it('ignores a road mark the layout has no edge for', () => {
    draw([{ ref: 'e:9,9;9,10', color: COLOR, label: 'R', kind: 'road' }])

    expect(container.querySelectorAll('.edge-highlight')).toHaveLength(0)
  })

  it('lights the port up for a plain edge mark and lays a road for a road mark', () => {
    draw([{ ref: PORT_EDGE }])
    expect(container.querySelectorAll('g.highlighted')).toHaveLength(1)
    expect(container.querySelectorAll('.edge-highlight')).toHaveLength(0)

    draw([{ ref: PORT_EDGE, color: COLOR, label: 'R', kind: 'road' }])
    expect(container.querySelectorAll('g.highlighted')).toHaveLength(0)
    expect(container.querySelectorAll('.edge-highlight')).toHaveLength(1)
  })
})
