import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import type { AdviceRequest } from '../protocol'
import { createEngine } from '../wasm'

it('advises a six-player extension turn with a median below 50 ms', async () => {
  const { cases }: { cases: { name: string; request: AdviceRequest }[] } = JSON.parse(
    readFileSync(new URL('../../../../simulator/fixtures/advice-parity.json', import.meta.url), 'utf8'),
  )
  const entry = cases.find(({ request }) => request.decision.kind === 'turn' && request.game.board.layout === 'extension6' && request.game.board.players.length === 6)
  if (!entry) throw new Error('Missing six-player extension turn fixture')
  const { advise } = await createEngine(readFileSync(new URL('../engine.wasm', import.meta.url)), () => {})
  const request = JSON.stringify(entry.request)
  advise(request)
  const times = Array.from({ length: 20 }, () => {
    const start = performance.now()
    advise(request)
    return performance.now() - start
  }).sort((a, b) => a - b)
  const median = (times[9] + times[10]) / 2
  const message = `${entry.name}: median ${median.toFixed(3)} ms over 20 calls`
  console.info(message)
  expect(median, message).toBeLessThan(50)
})
