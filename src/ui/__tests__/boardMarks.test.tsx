// @vitest-environment jsdom
import { act, useEffect, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { boardGrid, defaultPortEdges } from '../../model/layouts'
import { BoardCanvas } from '../BoardCanvas'
import { StoreProvider, useStore, type HighlightMark } from '../store'

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
