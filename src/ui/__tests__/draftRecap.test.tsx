// @vitest-environment jsdom
import { act, useEffect, type Dispatch } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AdviceRequest, AdviceResponse } from '../../engine/advice/protocol'
import { inferDraftState } from '../../engine/draft'
import { adjustCounter, adjustHand, type Game } from '../../model/game'
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
  recapWorkers: 1,
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
  client.recapWorkers = 1
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

it('shows each known hand after the spots and omits empty hands', async () => {
  await mount()
  let seed = finishedDraft(1)
  const [first, second, third, fourth] = seed.board.players
  seed = adjustHand(adjustHand(seed, first.id, 'wood', 2), first.id, 'ore', 1)
  seed = adjustHand(seed, second.id, 'sheep', 1)
  seed = adjustCounter(seed, third.id, 'handUnknown', 3)
  seed = adjustHand(adjustHand(seed, fourth.id, 'wheat', 4), fourth.id, 'brick', 1)
  await commit(seed)
  expect(rows().map((row) => [...row.querySelectorAll('.hex-label')].map((card) => card.getAttribute('aria-label'))))
    .toEqual([['2 wood', '1 ore'], ['1 sheep'], [], ['4 wheat', '1 brick']])
  for (const row of rows()) {
    const spots = row.querySelector('.recap-spots')!
    const cards = row.querySelector('.hex-label')?.parentElement
    expect(spots.nextElementSibling).toBe(cards ?? null)
  }
})

it('splits one share bar across the players in card order and leaves out players with no wins', async () => {
  await mount()
  await commit(finishedDraft(1))
  expect(container.querySelector('.recap-bar')).toBeNull()
  await answer(batch([30, 20, 0, 0]))
  const players = game().board.players
  const segments = [...container.querySelectorAll<HTMLElement>('.recap-bar > span')]
  expect(segments.map((segment) => segment.style.width)).toEqual(['60%', '40%'])
  expect(segments.map((segment) => segment.style.background)).toEqual([players[0].color, players[1].color]
    .map((color) => { const probe = document.createElement('span'); probe.style.background = color; return probe.style.background }))
  expect(percentages()).toEqual(['60%', '40%', '0%', '0%'])
})

it('heads the recap with the claimed player and their lead or deficit, and marks their card', async () => {
  await mount()
  await commit(finishedDraft(1))
  const players = game().board.players
  const header = () => container.querySelector('.recap-header')!.textContent
  expect(header()).toBe(`${players[1].name}'s win chance…`)
  await answer(batch())
  expect(header()).toBe(`${players[1].name}'s win chance40%Leads ${players[0].name} by 20 points`)
  const claimed = rows().filter((row) => row.classList.contains('claimed'))
  expect(claimed).toHaveLength(1)
  expect(claimed[0].getAttribute('aria-label')).toBe(`${players[1].name}: 40% win chance`)
  expect(claimed[0].textContent).toContain('YOU')
  expect(rows().filter((row) => row.textContent!.includes('YOU'))).toHaveLength(1)
  expect(container.querySelectorAll('.analysis-score')).toHaveLength(4)
})

it('says when the claimed player trails the leader', async () => {
  await mount()
  await commit(finishedDraft(0))
  const players = game().board.players
  const header = () => container.querySelector('.recap-header')!.textContent
  await answer(batch())
  expect(header()).toBe(`${players[0].name}'s win chance20%Trails ${players[1].name} by 20 points`)
})

it('says when the claimed player is level with the closest rival', async () => {
  await mount()
  await commit(finishedDraft(1))
  const players = game().board.players
  await answer(batch([20, 20, 5, 5]))
  expect(container.querySelector('.recap-header')!.textContent)
    .toBe(`${players[1].name}'s win chance40%Level with ${players[0].name}`)
})

it('says point, not points, for a one-point gap', async () => {
  await mount()
  await commit(finishedDraft(1))
  const players = game().board.players
  await answer(batch([12, 13, 13, 12]))
  await answer(batch([12, 13, 12, 13]))
  expect(container.querySelector('.recap-header')!.textContent)
    .toBe(`${players[1].name}'s win chance26%Leads ${players[2].name} by 1 point`)
})

it('heads the recap with the leader when nobody is claimed', async () => {
  await mount()
  const seed = finishedDraft(1)
  await commit({ ...seed, board: { ...seed.board, mePlayerId: null } })
  const players = game().board.players
  await answer(batch())
  expect(container.querySelector('.recap-header')!.textContent)
    .toBe(`${players[1].name}'s win chance40%Leads ${players[0].name} by 20 points`)
  expect(rows().some((row) => row.classList.contains('claimed') || row.textContent!.includes('YOU'))).toBe(false)
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

it('keeps four batches in flight and refills each answer until all 20 are requested', async () => {
  client.recapWorkers = 4
  await mount({ enabled: false })
  await commit(finishedDraft(1))
  await mount({ enabled: true })
  expect(requests).toHaveLength(4)
  expect(pending).toHaveLength(4)
  for (let completed = 0; completed < RECAP_GAMES / RECAP_BATCH; completed += 1) {
    await answer(batch())
    expect(requests).toHaveLength(Math.min(20, completed + 5))
    expect(pending).toHaveLength(Math.min(4, 19 - completed))
    expect(hook.games).toBe((completed + 1) * RECAP_BATCH)
  }
  expect(requests.map(({ decision }) => decision)).toEqual(Array.from({ length: 20 }, (_, batch) =>
    ({ kind: 'recap', games: RECAP_BATCH, batch })))
  expect(hook.done).toBe(true)
})

it('adds out-of-order answers to the same totals as an ordered run', async () => {
  client.recapWorkers = 4
  await mount({ enabled: false })
  await commit(finishedDraft(1))
  await mount({ enabled: true })
  const responses = Array.from({ length: 20 }, (_, index) => batch([index, 30 - index, 10, 8], 2))
  const ordered = responses.map((_, index) => index)
  const shuffled = [3, 4, 1, 6, 0, 8, 9, 2, 5, 12, 7, 14, 11, 16, 13, 18, 19, 15, 10, 17]
  const finish = async (order: number[]) => {
    const resolvers = new Map<number, (response: AdviceResponse) => void>()
    for (const [completed, index] of order.entries()) {
      const added = pending.splice(0)
      for (const [offset, resolve] of added.entries()) resolvers.set(requests.length - added.length + offset, resolve)
      const resolve = resolvers.get(index)
      expect(resolve).toBeDefined()
      await act(async () => resolve!(responses[index]))
      expect(hook.games).toBe((completed + 1) * RECAP_BATCH)
    }
    return { games: hook.games, wins: hook.wins, draws: hook.draws, done: hook.done, error: hook.error }
  }
  const inOrder = await finish(ordered)
  expect(inOrder).toEqual({ games: RECAP_GAMES, draws: 40, done: true, error: null,
    wins: Object.fromEntries(game().board.players.map(({ id }, index) => [id, [190, 410, 200, 160][index]])) })
  requests = []
  await act(async () => hook.retry())
  expect(await finish(shuffled)).toEqual(inOrder)
})

it.each(['game', 'tab', 'retry', 'disable', 'unmount'] as const)(
  'stops a parallel run on %s and ignores all its late answers', async (change) => {
    client.recapWorkers = 4
    await mount({ enabled: false })
    await commit(finishedDraft(1))
    await mount({ enabled: true })
    await answer(batch())
    const stale = pending.splice(0)
    expect(stale).toHaveLength(4)
    if (change === 'game') await commit(finishedDraft(1))
    if (change === 'tab') await act(async () => seen.dispatch({ type: 'tab-add', game: game() }))
    if (change === 'retry') await act(async () => hook.retry())
    if (change === 'disable') await mount({ enabled: false })
    if (change === 'unmount') await act(async () => root.render(null))
    const count = requests.length
    const before = hook
    for (const resolve of stale) await act(async () => resolve(batch([50, 0, 0, 0])))
    expect(requests).toHaveLength(count)
    expect(hook).toBe(before)
    if (change !== 'unmount') expect(hook.games).toBe(0)
    if (change === 'game' || change === 'tab' || change === 'retry') {
      expect(requests.slice(-4).map(({ decision }) => decision)).toEqual(Array.from({ length: 4 }, (_, batch) =>
        ({ kind: 'recap', games: RECAP_BATCH, batch })))
      await answer(batch())
      expect(hook.games).toBe(RECAP_BATCH)
    }
  },
)

it('stops every parallel lane on the first batch error and retries from batch zero', async () => {
  client.recapWorkers = 4
  await mount({ enabled: false })
  await commit(finishedDraft(1))
  await mount({ enabled: true })
  await answer(batch())
  await answer({ error: 'Simulation stopped' })
  expect(hook.error).toBe('Simulation stopped')
  expect(hook.games).toBe(RECAP_BATCH)
  const stale = pending.splice(0)
  expect(stale).toHaveLength(3)
  await act(async () => stale[0](batch([50, 0, 0, 0])))
  await act(async () => stale[1]({ error: 'Later failure' }))
  expect(requests).toHaveLength(5)
  expect(hook.error).toBe('Simulation stopped')
  expect(hook.games).toBe(RECAP_BATCH)
  await act(async () => hook.retry())
  expect(requests.slice(5).map(({ decision }) => decision)).toEqual(Array.from({ length: 4 }, (_, batch) =>
    ({ kind: 'recap', games: RECAP_BATCH, batch })))
  expect(hook.games).toBe(0)
  expect(hook.error).toBeNull()
  await act(async () => stale[2](batch()))
  expect(requests).toHaveLength(9)
  expect(hook.games).toBe(0)
  await answer(batch())
  expect(hook.games).toBe(RECAP_BATCH)
})
