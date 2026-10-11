import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import type { AdviceRequest, AdviceResponse } from '../protocol'
import { createAdviser } from '../wasm'

const { cases }: { cases: { name: string; request: AdviceRequest; response: AdviceResponse }[] } = JSON.parse(
  readFileSync(new URL('../../../../simulator/fixtures/advice-parity.json', import.meta.url), 'utf8'),
)
let advise: Awaited<ReturnType<typeof createAdviser>>
beforeAll(async () => { advise = await createAdviser(readFileSync(new URL('../engine.wasm', import.meta.url))) })

describe('adviser WebAssembly parity', () => {
  it('covers at least 120 cases across both layouts', () => {
    expect(cases.length).toBeGreaterThanOrEqual(120)
    expect(new Set(cases.map(({ request }) => request.game.board.layout))).toEqual(new Set(['standard4', 'extension6']))
  })

  it.each(cases)('$name matches the native Rust response exactly', ({ request, response }) => {
    expect(JSON.parse(advise(JSON.stringify(request)))).toEqual(response)
  })

  it('returns an error string for a request that is not JSON', () => {
    expect(JSON.parse(advise('not JSON'))).toMatchObject({ error: expect.any(String) })
  })
})
