import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import type { Board } from '../../model/types'
import { createEngine } from '../advice/wasm'

const wasm = readFileSync(new URL('../advice/engine.wasm', import.meta.url))
const { cases }: { cases: { name: string; request: { board: Board } }[] } = JSON.parse(
  readFileSync(new URL('../../../simulator/fixtures/analysis-parity.json', import.meta.url), 'utf8'),
)
// The worst case for a ranking: a full six-player extension board with nothing placed.
const worstCase = cases.find(({ name }) => name === 'worst-case-default-rollouts')!.request.board

/**
 * Fastest of three, so a busy neighbour has to spoil all three before this reads as a regression.
 * Each run gets its own instance: the engine keeps the rival rankings of its last calls, and a
 * second call on one instance would time the lookup instead of the ranking.
 */
async function fastest(board: Board, weights?: Record<string, unknown>): Promise<number> {
  const request = JSON.stringify({ board, options: weights ? { weights } : undefined })
  let best = Infinity
  for (let run = 0; run < 3; run += 1) {
    const { analyze } = await createEngine(wasm, () => {})
    const start = performance.now()
    const response = analyze(request)
    best = Math.min(best, performance.now() - start)
    expect(response).toMatchObject({ status: 'ready' })
  }
  return best
}

// The fastest of three measured 31 ms and 105 ms on the development machine when these were set. CI's runner took
// three times as long as that machine on the ranking this replaced, so the bounds leave it room: a wall-clock bound
// tight enough to catch a small regression there would fail without one. The speed suite's `analyze/` rows are the
// fine measure.
it('ranks the worst-case six-player opening in under 300 ms', async () => {
  const time = await fastest(worstCase)
  console.info(`analyze worst-case opening: fastest ${time.toFixed(0)} ms of 3`)
  expect(time).toBeLessThan(300)
}, 45_000)

it('ranks it with three rival rankings ahead in under 1200 ms', async () => {
  const time = await fastest({ ...worstCase, mePlayerId: 'p4' })
  console.info(`analyze worst-case as p4: fastest ${time.toFixed(0)} ms of 3`)
  expect(time).toBeLessThan(1200)
}, 90_000)

const contestWeights: Record<string, unknown> = {
  ...JSON.parse(readFileSync(new URL('../../../simulator/placement/seat-weights/seats-6.json', import.meta.url), 'utf8')),
  contestWeight: 0.5,
  repriceFirstExpansion: 1,
}

it('ranks the worst-case opening with contests and re-pricing in under 300 ms', async () => {
  const time = await fastest(worstCase, contestWeights)
  console.info(`analyze contested opening: fastest ${time.toFixed(0)} ms of 3`)
  expect(time).toBeLessThan(300)
}, 45_000)

it('ranks it as p4 with contests and re-pricing in under 1200 ms', async () => {
  const time = await fastest({ ...worstCase, mePlayerId: 'p4' }, contestWeights)
  console.info(`analyze contested as p4: fastest ${time.toFixed(0)} ms of 3`)
  expect(time).toBeLessThan(1200)
}, 90_000)
