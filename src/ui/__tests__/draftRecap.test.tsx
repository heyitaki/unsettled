// @vitest-environment jsdom
import { act, useEffect, type Dispatch } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AdviceRequest, AdviceResponse } from '../../engine/advice/protocol'
import { inferDraftState } from '../../engine/draft'
import type { Game } from '../../model/game'
import { awaitingFirstTurn, setActivePlayer } from '../../model/turn'
import { AnalysisPanel } from '../AnalysisPanel'
import { DraftRecapPanel } from '../DraftRecapPanel'
import { vertexDescription } from '../vertexParts'
import { decisionKey } from '../adviceClient'
import { activeTab, StoreProvider, useStore, type StoreAction, type StoreState } from '../store'
import { AdviceContext } from '../useAdvice'
import { AnalysisContext } from '../useAnalysis'
import { RECAP_BATCH, RECAP_GAMES, useDraftRecap } from '../useDraftRecap'
import { finishedDraft } from './finishedDraft'

it('awaits only a clean finished draft with no recorded turn', () => {
  const game = finishedDraft(1)
  expect(awaitingFirstTurn(game)).toBe(true)
  expect(awaitingFirstTurn(setActivePlayer(game, game.board.players[0].id))).toBe(false)
  const [first, ...rest] = game.board.buildings
  expect(awaitingFirstTurn({ ...game, board: { ...game.board, buildings: [{ ...first, tier: 'city' }, ...rest] } })).toBe(false)
  expect(awaitingFirstTurn({ ...game, board: { ...game.board, buildings: [...game.board.buildings, first] } })).toBe(false)
  expect(awaitingFirstTurn({ ...game, board: { ...game.board, buildings: rest } })).toBe(false)
})

it('keys recap decisions by games and batch', () => {
  const first = decisionKey({ kind: 'recap', games: 50, batch: 0 })
  expect(first).not.toBe(decisionKey({ kind: 'recap', games: 50, batch: 1 }))
  expect(first).not.toBe(decisionKey({ kind: 'recap', games: 20, batch: 0 }))
})

let root: Root
let container: HTMLDivElement
let seen: { state: StoreState; dispatch: Dispatch<StoreAction> }
let requests: AdviceRequest[]
let pending: ((response: AdviceResponse) => void)[]
let hook: ReturnType<typeof useDraftRecap>
const client = {
  request: (request: AdviceRequest): Promise<AdviceResponse> => {
    requests.push(request)
    return new Promise((resolve) => pending.push(resolve))
  },
  cancelAll() {},
  dispose() {},
}

function Probe({ enabled }: { enabled: boolean }) {
  hook = useDraftRecap(enabled)
  return <span>{hook.games}</span>
}

function Harness({ full = false, enabled }: { full?: boolean; enabled?: boolean }) {
  const store = useStore()
  useEffect(() => { seen = store }, [store])
  const { board } = activeTab(store.state).game
  return <AdviceContext.Provider value={client}>
    <AnalysisContext.Provider value={{ analysis: { status: 'complete', draft: inferDraftState(board),
      recommendations: [], takenBeforeFirstPick: [], warnings: [] }, pending: false, error: null, retry() {} }}>
      {enabled !== undefined ? <Probe enabled={enabled} /> : full ? <AnalysisPanel /> : <DraftRecapPanel />}
    </AnalysisContext.Provider>
  </AdviceContext.Provider>
}

const game = () => activeTab(seen.state).game
const mount = async (props: { full?: boolean; enabled?: boolean } = {}) => {
  await act(async () => root.render(<StoreProvider><Harness {...props} /></StoreProvider>))
}
const commit = async (next: Game) => {
  await act(async () => seen.dispatch({ type: 'commit-game', game: next }))
}
const answer = async (response: AdviceResponse) => {
  const resolve = pending.shift()
  if (!resolve) throw new Error('No pending request')
  await act(async () => resolve(response))
}
const batch = (counts = [10, 20, 10, 10], draws = 0): AdviceResponse => ({
  kind: 'recap', games: RECAP_BATCH,
  wins: Object.fromEntries(game().board.players.map(({ id }, index) => [id, counts[index]])), draws,
})
const click = async (label: string) => {
  const button = [...container.querySelectorAll('button')].find((button) =>
    button.textContent === label || button.getAttribute('aria-label') === label)
  if (!button) throw new Error(`Missing ${label}`)
  await act(async () => button.click())
}
const rows = () => [...container.querySelectorAll('[role="listitem"]')]
const percentages = () => [...container.querySelectorAll('.analysis-score')].map((node) => node.textContent)

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  sessionStorage.clear()
  requests = []
  pending = []
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  vi.restoreAllMocks()
})

it('requests batches one at a time and shows the running totals until complete', async () => {
  await mount()
  await commit(finishedDraft(1))
  expect(requests).toHaveLength(1)
  expect(container.querySelector('.move-notes')).toBeNull()
  expect(percentages()).toEqual(['…', '…', '…', '…'])
  expect(container.querySelector<HTMLElement>('.analysis-loading div')!.style.width).toBe('3%')
  await answer(batch())
  expect(percentages()).toEqual(['40%', '20%', '20%', '20%'])
  await answer(batch([40, 0, 10, 0]))
  expect(percentages()).toEqual(['50%', '20%', '20%', '10%'])
  for (let index = 2; index < RECAP_GAMES / RECAP_BATCH; index += 1) {
    expect(container.querySelector('.move-notes')).toBeNull()
    expect(requests).toHaveLength(index + 1)
    expect(pending).toHaveLength(1)
    expect(requests[index]).toMatchObject({ observer: game().board.players[0].id,
      decision: { kind: 'recap', games: RECAP_BATCH, batch: index } })
    await answer(batch())
  }
  expect(requests.map(({ decision }) => decision)).toEqual(Array.from({ length: RECAP_GAMES / RECAP_BATCH }, (_, index) =>
    ({ kind: 'recap', games: RECAP_BATCH, batch: index })))
  expect(pending).toHaveLength(0)
  expect(container.querySelector('[role="status"]')).toBeNull()
  expect(container.querySelector('.move-notes')?.textContent).toContain('Win chance over 1,000 simulated games')
  expect(container.querySelectorAll('.move-notes li')).toHaveLength(1)
})

it.each([[1, 'game'], [2, 'games']] as const)('reports %i completed draws with the right plural', async (draws, noun) => {
  await mount()
  await commit(finishedDraft(1))
  for (let index = 0; index < RECAP_GAMES / RECAP_BATCH - 1; index += 1) await answer(batch())
  expect(container.querySelector('.move-notes')).toBeNull()
  await answer(batch([10, 20, 10, 10 - draws], draws))
  expect(container.querySelector('.move-notes')?.textContent)
    .toContain(`${draws} ${noun} hit the turn cap with no winner`)
  expect(container.querySelectorAll('.move-notes li')).toHaveLength(2)
})

it('orders plain rows by wins with ties in roster order and keeps settlements in board order', async () => {
  await mount()
  await commit(finishedDraft(1))
  await answer(batch())
  const players = game().board.players
  expect(rows().map((row) => row.getAttribute('aria-label'))).toEqual([1, 0, 2, 3].map((index) =>
    `${players[index].name}: ${index === 1 ? 40 : 20}% win chance`))
  expect(rows().map((row) => row.querySelectorAll('.spot-tiles-small').length)).toEqual([2, 2, 2, 2])
  for (const [rowIndex, playerIndex] of [1, 0, 2, 3].entries()) {
    expect([...rows()[rowIndex].querySelectorAll('.spot-tiles-small')].map((spot) => spot.getAttribute('aria-label')))
      .toEqual(game().board.buildings.filter((building) => building.playerId === players[playerIndex].id)
        .map(({ vertexId }) => vertexDescription(game().board, vertexId)))
  }
  const row = rows()[0]
  await act(async () => {
    row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  })
  expect(seen.state.highlight).toBeNull()
  await act(async () => row.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  expect(seen.state.highlight).toBeNull()
  expect(rows().every((row) => row.querySelector('button') === null)).toBe(true)
  expect(container.querySelector<HTMLElement>('.recap-bar > span')!.style.width).toBe('40%')
})

it('sets bar widths to each player share, including zero wins', async () => {
  await mount()
  await commit(finishedDraft(1))
  await answer(batch([30, 20, 0, 0]))
  expect(rows().map((row) => row.querySelector<HTMLElement>('.recap-bar > span')!.style.width))
    .toEqual(['60%', '40%', '0%', '0%'])
  expect(percentages()).toEqual(['60%', '40%', '0%', '0%'])
})

it('keeps counted rows on error and retries from batch zero', async () => {
  await mount()
  await commit(finishedDraft(1))
  await answer(batch([10, 20, 10, 5], 5))
  await answer({ error: 'Simulation stopped' })
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Simulation stopped')
  expect(percentages()).toEqual(['40%', '20%', '20%', '10%'])
  expect(container.querySelector('.move-notes')).toBeNull()
  expect(pending).toHaveLength(0)
  expect(container.querySelector('[role="status"]')).toBeNull()
  await click('Retry')
  expect(requests.at(-1)?.decision).toEqual({ kind: 'recap', games: RECAP_BATCH, batch: 0 })
  expect(percentages()).toEqual(['…', '…', '…', '…'])
  expect(container.querySelector('[role="alert"]')).toBeNull()
  await answer(batch())
  expect(percentages()).toEqual(['40%', '20%', '20%', '20%'])
})

it('blocks a blank tile without blocking Start game', async () => {
  await mount()
  const seed = finishedDraft(1)
  await commit({ ...seed, board: { ...seed.board,
    hexes: seed.board.hexes.map((hex, index) => index === 0 ? { ...hex, tile: null } : hex) } })
  expect(requests).toHaveLength(0)
  expect(rows()).toHaveLength(0)
  expect(container.textContent).toContain('Finish the board to get advice:')
  expect(container.querySelector('.move-notes')).toBeNull()
  expect(container.querySelector('[role="status"]')).toBeNull()
  await click('Start game')
  expect(game().turn?.playerId).toBe(seed.board.players[0].id)
})

it('starts the first player without changing hands and undo returns to the recap', async () => {
  await mount({ full: true })
  await commit(finishedDraft(1))
  expect(container.querySelector('h2')?.textContent).toBe('Draft recap')
  expect(game().board.mePlayerId).toBe(game().board.players[1].id)
  const stats = game().stats
  await click('Start game')
  expect(game().turn?.playerId).toBe(game().board.players[0].id)
  expect(game().turn).toEqual({ playerId: game().board.players[0].id, rolled: null, devPlayed: false,
    progressPlayed: { roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 } })
  expect(game().stats).toBe(stats)
  expect(container.querySelector('h2')?.textContent).toBe('Best moves')
  await click('Undo')
  expect(container.querySelector('h2')?.textContent).toBe('Draft recap')
  await click('Redo')
  expect(container.querySelector('h2')?.textContent).toBe('Best moves')
})

it('shows Best moves for a finished draft with a recorded turn', async () => {
  await mount({ full: true })
  const seed = finishedDraft(1)
  await commit(setActivePlayer(seed, seed.board.players[1].id))
  expect(container.querySelector('h2')?.textContent).toBe('Best moves')
  expect(container.querySelector('.draft-recap-panel')).toBeNull()
  expect(requests.every(({ decision }) => decision.kind !== 'recap')).toBe(true)
})

it('discards superseded replies and clears totals for a different game', async () => {
  await mount()
  await commit(finishedDraft(1))
  await answer(batch())
  const stale = pending.shift()!
  await commit(finishedDraft(1))
  expect(percentages()).toEqual(['…', '…', '…', '…'])
  const count = requests.length
  await act(async () => stale(batch([50, 0, 0, 0])))
  expect(percentages()).toEqual(['…', '…', '…', '…'])
  expect(requests).toHaveLength(count)
  await answer(batch())
  expect(percentages()).toEqual(['40%', '20%', '20%', '20%'])
})

it('ties accumulated totals to the tab even when it shares the same Game object', async () => {
  await mount()
  await commit(finishedDraft(1))
  await answer(batch())
  const stale = pending.shift()!
  const shared = game()
  await act(async () => seen.dispatch({ type: 'tab-add', game: shared }))
  expect(game()).toBe(shared)
  expect(percentages()).toEqual(['…', '…', '…', '…'])
  const count = requests.length
  await act(async () => stale(batch()))
  expect(requests).toHaveLength(count)
  expect(percentages()).toEqual(['…', '…', '…', '…'])
})

it('requests nothing while disabled and stops an unmounted run', async () => {
  await mount({ enabled: false })
  await commit(finishedDraft(1))
  expect(requests).toHaveLength(0)
  await mount({ enabled: true })
  await answer(batch())
  expect(hook.games).toBe(RECAP_BATCH)
  expect(hook.done).toBe(false)
  const stale = pending.shift()!
  await mount({ enabled: false })
  await act(async () => stale(batch()))
  expect(requests).toHaveLength(2)
  await mount({ enabled: true })
  const last = pending.shift()!
  await act(async () => root.render(null))
  await act(async () => last(batch()))
  expect(requests).toHaveLength(3)
})
