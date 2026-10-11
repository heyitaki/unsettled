// @vitest-environment jsdom
import { act, createElement, useEffect, type Dispatch } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdviceResponse, Decision } from '../../engine/advice/protocol'
import { adjustHand } from '../../model/game'
import { AdviceProvider } from '../AdviceProvider'
import { activeTab, StoreProvider, useStore, type StoreAction, type StoreState } from '../store'
import { useAdvice, type AdviceState } from '../useAdvice'

interface Seen { state: StoreState; dispatch: Dispatch<StoreAction>; advice: AdviceState }
function Probe({ report, decision = { kind: 'preRoll' }, observer = 'aki' }: { report(value: Seen): void; decision?: Decision; observer?: string }) {
  const store = useStore()
  const advice = useAdvice(decision, observer)
  useEffect(() => report({ ...store, advice }), [store, advice, report])
  return null
}

describe('advice provider', () => {
  let root: Root
  let seen: Seen
  const workers: {
    postMessage: ReturnType<typeof vi.fn>
    terminate: ReturnType<typeof vi.fn>
    onmessage: Worker['onmessage']
    onerror: Worker['onerror']
  }[] = []
  const reply = async (index: number, response: AdviceResponse) => {
    const worker = workers[index]
    const sent = worker.postMessage.mock.calls.at(-1)
    if (!sent) throw new Error('No advice request was posted')
    const { id } = sent[0]
    await act(async () => worker.onmessage?.call(worker as unknown as Worker, { data: { id, response } } as MessageEvent))
  }
  const response: AdviceResponse = {
    kind: 'preRoll', play: null, reason: '',
    derived: { bank: { wood: 19, sheep: 19, wheat: 19, brick: 19, ore: 19 }, tradeRates: { wood: 4, sheep: 4, wheat: 4, brick: 4, ore: 4 }, devDeckRemaining: 25, unknownOwnCards: 0 },
  }
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
    sessionStorage.clear()
    workers.length = 0
    vi.stubGlobal('Worker', function () {
      const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null }
      workers.push(worker)
      return worker
    })
    root = createRoot(document.createElement('div'))
    act(() => root.render(createElement(StoreProvider, null,
      createElement(AdviceProvider, null, createElement(Probe, { report: (value) => { seen = value } })),
    )))
  })
  afterEach(() => {
    act(() => root.unmount())
    vi.unstubAllGlobals()
  })

  it('drops a completed response on an idle game change without replacing the worker', async () => {
    expect(seen.advice.status).toBe('pending')
    await reply(0, response)
    expect(seen.advice.response).toEqual(response)
    const before = activeTab(seen.state).game
    act(() => seen.dispatch({ type: 'commit-game', game: adjustHand(before, 'aki', 'wood', 1) }))
    expect(seen.advice).toMatchObject({ status: 'pending', response: undefined })
    expect(workers[0].terminate).not.toHaveBeenCalled()
    expect(workers).toHaveLength(1)
    expect(workers[0].postMessage).toHaveBeenCalledTimes(2)
    await reply(0, response)
    expect(seen.advice.status).toBe('ready')
  })

  it('ignores a previous game reply and requests again when retried after an error', async () => {
    act(() => seen.dispatch({ type: 'commit-game', game: adjustHand(activeTab(seen.state).game, 'aki', 'wood', 1) }))
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    expect(workers).toHaveLength(2)
    await reply(0, response)
    expect(seen.advice.response).toBeUndefined()
    expect(seen.advice.status).toBe('pending')
    await reply(1, { error: 'The advice engine is not built yet' })
    expect(seen.advice.status).toBe('error')
    act(() => seen.advice.retry())
    expect(seen.advice).toMatchObject({ status: 'pending', response: undefined })
    expect(workers[1].postMessage).toHaveBeenCalledTimes(2)
    await reply(1, response)
    expect(seen.advice.status).toBe('ready')
  })

  it('drops completed and pending replies when decision or observer changes on the same game', async () => {
    const game = activeTab(seen.state).game
    const render = (decision: Decision, observer: string) => act(() => root.render(createElement(StoreProvider, null,
      createElement(AdviceProvider, null, createElement(Probe, { decision, observer, report: (value) => { seen = value } })),
    )))
    await reply(0, response)
    render({ kind: 'turn' }, 'aki')
    expect(activeTab(seen.state).game).toBe(game)
    expect(seen.advice.response).toBeUndefined()
    const staleId = workers[0].postMessage.mock.calls.at(-1)![0].id
    render({ kind: 'turn' }, 'b')
    expect(seen.advice.response).toBeUndefined()
    await act(async () => workers[0].onmessage?.call(workers[0] as unknown as Worker, { data: { id: staleId, response } } as MessageEvent))
    expect(seen.advice.response).toBeUndefined()
    const current = { ...response, reason: 'For Bee' }
    await reply(0, current)
    expect(seen.advice.response).toEqual(current)
    render({ kind: 'discard' }, 'b')
    expect(seen.advice.response).toBeUndefined()
    await reply(0, response)
    render({ kind: 'discard' }, 'aki')
    expect(seen.advice.response).toBeUndefined()
  })

  it('drops advice on a tab switch even when both tabs share a game', async () => {
    await reply(0, response)
    const game = activeTab(seen.state).game
    act(() => seen.dispatch({ type: 'tab-add', game, id: 'second' }))
    expect(seen.advice.response).toBeUndefined()
    await act(async () => {})
    expect(seen.advice.status).toBe('ready')
  })
})
