// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftAnalysis, TakenVertex } from '../../engine/analyze'
import type { AnalysisRequest } from '../../engine/analysisProtocol'
import { inferDraftState } from '../../engine/draft'
import { emptyBreakdown } from '../../engine/valuation'
import { addPlayer, createBoard, placeBuilding, setMe } from '../../model/board'
import { boardGrid } from '../../model/layouts'
import { setTile } from '../../model/__tests__/helpers'
import { AnalysisPanel } from '../AnalysisPanel'
import { AnalysisProvider } from '../AnalysisProvider'
import { viewedPlayerId } from '../draftSlots'
import { restingMarks } from '../restMarks'
import { activeTab, StoreProvider, useStore } from '../store'
import { useAnalysis, type AnalysisState } from '../useAnalysis'

type Seen = ReturnType<typeof useStore> & { analysis: AnalysisState }
function Capture({ report }: { report(value: Seen): void }) {
  const store = useStore()
  const analysis = useAnalysis()
  useEffect(() => report({ ...store, analysis }), [store, analysis, report])
  return null
}

const SPACED = boardGrid('standard4').vertexIds.filter((_, index) => index % 6 === 0)
function opening() {
  let board = createBoard('standard4')
  for (const [id, name, color] of [['b', 'Blue', '#3063ba'], ['c', 'Orange', '#e58331'], ['d', 'White', '#ffffff']]) {
    board = addPlayer(board, { id, name, color })
  }
  return setTile(board, { q: 0, r: 0 }, 'wood', 6)
}

describe('viewing another player in Best picks', () => {
  let root: Root
  let container: HTMLDivElement
  let seen: Seen
  let jobs: { request: AnalysisRequest; reply(analysis: DraftAnalysis): void }[]
  const board = () => activeTab(seen.state).game.board
  const click = async (element: Element | null) => {
    if (!element) throw new Error('Missing control')
    await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  }
  const button = (label: string) => [...container.querySelectorAll('button')].find((element) =>
    element.textContent?.trim() === label || element.getAttribute('aria-label') === label) ?? null
  const context = () => container.querySelector('.analysis-context')?.textContent
  const reply = async (takenBeforeFirstPick: TakenVertex[] = []) => {
    const job = jobs.at(-1)!
    await act(async () => job.reply({
      status: 'ready', draft: inferDraftState(job.request.board), warnings: [], takenBeforeFirstPick,
      recommendations: [{ firstPick: SPACED[6], firstRoad: null, plannedSecond: [], survival: 1, score: 1, rankScore: 1, breakdown: emptyBreakdown() }],
    }))
  }

  beforeEach(async () => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    localStorage.clear()
    sessionStorage.clear()
    jobs = []
    vi.stubGlobal('Worker', class {
      onmessage: ((event: MessageEvent) => void) | null = null
      postMessage(request: AnalysisRequest) {
        jobs.push({ request, reply: (analysis) => this.onmessage?.({ data: { id: request.id, analysis } } as MessageEvent) })
      }
      terminate() {}
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<StoreProvider><AnalysisProvider>
      <Capture report={(value) => { seen = value }} /><AnalysisPanel />
    </AnalysisProvider></StoreProvider>))
    await act(async () => seen.dispatch({ type: 'commit', board: opening() }))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', false)
  })

  it('views both rival picks and the name menu without changing the claim or history', async () => {
    const original = board()
    const history = activeTab(seen.state).past
    await click(button('Pick 2: Blue'))
    expect(board()).toBe(original)
    expect(activeTab(seen.state).past).toBe(history)
    expect(context()).toContain('Blue · Picking 2nd and 7th')
    expect(seen.analysis.analysis.draft.myPickIndices).toEqual([1, 6])
    const analysed = jobs.at(-1)!.request.board
    expect(analysed.mePlayerId).toBe('b')
    expect(button('Pick 2: Blue')?.getAttribute('aria-pressed')).toBe('true')
    expect(button('Pick 7: Blue')?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelectorAll('.draft-ribbon-slot[aria-pressed="true"]')).toHaveLength(2)
    await reply()
    expect(restingMarks(board(), seen.analysis.analysis, viewedPlayerId(board(), seen.state.viewedPick))?.[0].color).toBe('#3063ba')
    expect(container.querySelector<HTMLElement>('.analysis-rank')?.style.background).toBe('rgb(48, 99, 186)')
    await click(container.querySelector('.analysis-row-select'))
    expect(seen.state.highlight?.[0].color).toBe('#3063ba')
    await click(button('Pick 2: Blue'))
    expect(container.querySelector('.analysis-row.current')).not.toBeNull()
    await click(button('Pick 7: Blue'))
    expect(context()).toContain('Blue · Picking 7th')
    expect(button('Pick 7: Blue')?.classList.contains('viewing')).toBe(true)
    expect(jobs.at(-1)!.request.board).toBe(analysed)
    expect(jobs.at(-1)!.request.targetPick).toBe(6)
    expect(seen.analysis.pending).toBe(true)
    expect(container.querySelector('.analysis-row')).toBeNull()
    expect(seen.state.highlight).toBeNull()
    await click(container.querySelector('.analysis-context .menu-trigger'))
    expect(container.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe('Whose picks to show')
    await click(button('Orange'))
    expect(context()).toContain('Orange · Picking 3rd and 6th')
    expect(board()).toBe(original)
    expect(activeTab(seen.state).past).toBe(history)
    await act(async () => seen.dispatch({ type: 'commit', board: setMe(board(), 'd') }))
    expect(seen.state.viewedPick).toBeNull()
    expect(context()).toContain('White · Picking 4th and 5th')
    expect(jobs.at(-1)!.request.board).toBe(board())
  })

  it.each(['Play these out', 'Place settlement'])('keeps the claim when using %s on a rival view', async (action) => {
    const original = board()
    const pickers = ['aki', 'b', 'c', 'd', 'd', 'c']
    await click(button('Pick 7: Blue'))
    await reply(pickers.map((playerId, index) => ({ playerId, vertexId: SPACED[index], frequency: 1 })))
    expect(container.querySelector('.analysis-likely-gone')?.textContent).toContain('2. Blue:')
    await click(container.querySelector(action === 'Play these out' ? '.analysis-touch-select' : '.analysis-row-select'))
    await click(button(action))
    expect(board().mePlayerId).toBe('aki')
    expect(board().buildings.map(({ playerId }) => playerId)).toEqual(action === 'Play these out' ? pickers : [...pickers, 'b'])
    expect(activeTab(seen.state).past.at(-1)?.board).toBe(original)
  })

  it('views the first unplaced pick from a placed circle and ignores a finished player', async () => {
    let next = placeBuilding(board(), SPACED[0], 'aki', 'settlement')
    next = placeBuilding(next, SPACED[1], 'b', 'settlement')
    await act(async () => seen.dispatch({ type: 'commit', board: next }))
    await click(button('Pick 2: Blue'))
    expect(seen.state.viewedPick).toBe(6)
    expect(context()).toContain('Blue · Picking 2nd and 7th')
    expect(button('Pick 7: Blue')?.classList.contains('viewing')).toBe(true)
    for (const [index, playerId] of ['c', 'd', 'd', 'c', 'b'].entries()) {
      next = placeBuilding(next, SPACED[index + 2], playerId, 'settlement')
    }
    await act(async () => seen.dispatch({ type: 'commit', board: next }))
    const before = seen.state
    await click(button('Pick 2: Blue'))
    expect(seen.state).toBe(before)
    await click(container.querySelector('.analysis-context .menu-trigger'))
    expect([...container.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual(['aki'])
  })

  it('claims on a ribbon click only when the board is unclaimed', async () => {
    await act(async () => seen.dispatch({ type: 'commit', board: setMe(board(), null) }))
    expect(container.querySelector('.claim-row')).not.toBeNull()
    await click(button('Pick 7: Blue'))
    expect(board().mePlayerId).toBe('b')
    expect(seen.state.viewedPick).toBe(6)
    expect(container.querySelector('.claim-row')).toBeNull()
    expect(context()).toContain('Blue · Picking 7th')
  })
})
