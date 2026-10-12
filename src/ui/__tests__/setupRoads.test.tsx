// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Recommendation, TakenVertex } from '../../engine/analyze'
import { inferDraftState } from '../../engine/draft'
import { emptyBreakdown } from '../../engine/valuation'
import { addPlayer, createBoard, setMe } from '../../model/board'
import { edgeEndpointVertexIds } from '../../model/coords'
import { boardGrid } from '../../model/layouts'
import { setTile } from '../../model/__tests__/helpers'
import { AnalysisPanel } from '../AnalysisPanel'
import { BoardCanvas } from '../BoardCanvas'
import { activeTab, StoreProvider, useStore } from '../store'
import { AnalysisContext } from '../useAnalysis'

type Seen = ReturnType<typeof useStore>
function Capture({ report }: { report(value: Seen): void }) {
  const store = useStore()
  useEffect(() => report(store), [store, report])
  return null
}

const [ROAD, FIRST_ROAD, SECOND_ROAD] = [0, 24, 48].map((index) => boardGrid('standard4').edgeIds[index])
const gone: TakenVertex[] = [
  { vertexId: edgeEndpointVertexIds(ROAD)[0], playerId: 'aki', road: ROAD, frequency: 1 },
  { vertexId: boardGrid('standard4').vertexIds[30], playerId: 'b', road: null, frequency: 1 },
]
const pick: Recommendation = {
  firstPick: edgeEndpointVertexIds(FIRST_ROAD)[0], firstRoad: FIRST_ROAD,
  plannedSecond: [edgeEndpointVertexIds(SECOND_ROAD)[0]], secondRoad: SECOND_ROAD,
  survival: 1, score: 1, rankScore: 1, breakdown: emptyBreakdown(),
}

describe('Best picks setup roads', () => {
  let root: Root
  let container: HTMLDivElement
  let seen: Seen
  const board = () => activeTab(seen.state).game.board
  const click = async (element: Element | null) => {
    if (!element) throw new Error('Missing control')
    await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  }
  const button = (label: string) => [...container.querySelectorAll('button')].find((element) =>
    element.textContent?.trim() === label) ?? null
  const render = async (recommendation = pick) => {
    await act(async () => root.render(<StoreProvider>
      <Capture report={(value) => { seen = value }} />
      <AnalysisContext.Provider value={{
        analysis: {
          status: 'ready', draft: inferDraftState(setMe(board(), 'b')), warnings: [],
          recommendations: [recommendation], takenBeforeFirstPick: gone,
        },
        pending: false, error: null, retry() {},
      }}>
        <BoardCanvas /><AnalysisPanel />
      </AnalysisContext.Provider>
    </StoreProvider>))
  }

  beforeEach(async () => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    localStorage.clear()
    sessionStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<StoreProvider><Capture report={(value) => { seen = value }} /></StoreProvider>))
    const opening = setTile(addPlayer(createBoard('standard4'), { id: 'b', name: 'Blue', color: '#3063ba' }), { q: 0, r: 0 }, 'wood', 6)
    await act(async () => seen.dispatch({ type: 'commit', board: opening }))
    await act(async () => seen.dispatch({ type: 'view-pick', slot: 1 }))
    await render()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', false)
  })

  it('marks each likely-gone road in its picker colour and skips null roads', async () => {
    await click(container.querySelector('.analysis-touch-select'))
    expect(seen.state.highlight?.filter(({ kind }) => kind === 'road')).toEqual([
      { ref: ROAD, color: board().players[0].color, label: 'R', kind: 'road' },
    ])
    expect(seen.state.highlight?.filter(({ kind }) => kind !== 'road')).toHaveLength(2)
    const lines = container.querySelectorAll<SVGLineElement>('.edge-highlight')
    expect(lines).toHaveLength(1)
    expect(lines[0].style.stroke).toBe('rgb(194, 63, 56)')
  })

  it.each(['Play these out', 'Place settlement'])('%s lays the roads and settlements in one undoable commit', async (action) => {
    const original = activeTab(seen.state).game
    const historyLength = activeTab(seen.state).past.length
    await click(container.querySelector(action === 'Play these out' ? '.analysis-touch-select' : '.analysis-row-select'))
    await click(button(action))
    expect(board().buildings).toEqual([
      ...gone.map(({ vertexId, playerId }) => ({ vertexId, playerId, tier: 'settlement' })),
      ...(action === 'Place settlement' ? [{ vertexId: pick.firstPick, playerId: 'b', tier: 'settlement' }] : []),
    ])
    expect(board().roads).toEqual([
      { edgeId: ROAD, playerId: 'aki' },
      ...(action === 'Place settlement' ? [{ edgeId: FIRST_ROAD, playerId: 'b' }] : []),
    ])
    expect(board().mePlayerId).toBe('aki')
    expect(activeTab(seen.state).past).toHaveLength(historyLength + 1)
    await act(async () => seen.dispatch({ type: 'undo' }))
    expect(activeTab(seen.state).game).toEqual(original)
  })

  it('places a recommendation whose setup road is null', async () => {
    await render({ ...pick, firstRoad: null })
    await click(container.querySelector('.analysis-row-select'))
    await click(button('Place settlement'))
    expect(board().roads).toEqual([{ edgeId: ROAD, playerId: 'aki' }])
    expect(board().buildings.at(-1)).toMatchObject({ vertexId: pick.firstPick, playerId: 'b' })
  })

  it('drops the road of a line pick my settlement replaces, and never takes over a rival road', async () => {
    await render({ ...pick, firstPick: gone[0].vertexId, firstRoad: FIRST_ROAD })
    await click(container.querySelector('.analysis-row-select'))
    await click(button('Place settlement'))
    expect(board().roads).toEqual([{ edgeId: FIRST_ROAD, playerId: 'b' }])
    await act(async () => seen.dispatch({ type: 'undo' }))
    await render({ ...pick, firstRoad: ROAD })
    await click(container.querySelector('.analysis-row-select'))
    await click(button('Place settlement'))
    expect(board().roads).toEqual([{ edgeId: ROAD, playerId: 'aki' }])
  })

  it('fades the second road and gives overlapping road marks distinct keys', async () => {
    const errors = vi.spyOn(console, 'error')
    await render({ ...pick, secondRoad: FIRST_ROAD })
    await click(container.querySelector('.analysis-row-select'))
    const lines = container.querySelectorAll('.edge-highlight')
    expect(lines).toHaveLength(2)
    expect(lines[0].parentElement?.getAttribute('opacity')).toBeNull()
    expect(lines[1].parentElement?.getAttribute('opacity')).toBe('0.55')
    expect(errors).not.toHaveBeenCalled()
  })
})
