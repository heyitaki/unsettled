import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import type { Board } from '../../model/types'
import { createEngine } from '../advice/wasm'

const wasm = readFileSync(new URL('../advice/engine.wasm', import.meta.url))
const { cases }: { cases: { name: string; request: { board: Board } }[] } = JSON.parse(
  readFileSync(new URL('../../../simulator/fixtures/analysis-parity.json', import.meta.url), 'utf8'),
)
// The `worstCaseBoard()` of `perf.test.ts`: a full six-player extension board with nothing placed.
const worstCase = cases.find(({ name }) => name === 'worst-case-default-rollouts')!.request.board

/**
 * Fastest of three, so a busy neighbour has to spoil all three before this reads as a regression.
 * Each run gets its own instance: the engine keeps the rival rankings of its last calls, and a
 * second call on one instance would time the lookup instead of the ranking.
 */
async function fastest(board: Board): Promise<number> {
  const request = JSON.stringify({ board })
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

// Bounds for the straight port; the speed tasks tighten them.
it('ranks the worst-case six-player opening in under 1500 ms', async () => {
  const time = await fastest(worstCase)
  console.info(`analyze worst-case opening: fastest ${time.toFixed(0)} ms of 3`)
  expect(time).toBeLessThan(1500)
}, 45_000)

it('ranks it with three rival rankings ahead in under 5500 ms', async () => {
  const time = await fastest({ ...worstCase, mePlayerId: 'p4' })
  console.info(`analyze worst-case as p4: fastest ${time.toFixed(0)} ms of 3`)
  expect(time).toBeLessThan(5500)
}, 90_000)
