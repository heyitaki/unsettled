import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { createEngine, reviveNonFinite, type Engine } from '../wasm'

const { cases }: { cases: { name: string; request: object; response: { status: string } }[] } = JSON.parse(
  readFileSync(new URL('../../../../simulator/fixtures/analysis-parity.json', import.meta.url), 'utf8'),
  reviveNonFinite,
)
const fractions: number[] = []
let engine: Engine
beforeAll(async () => {
  engine = await createEngine(readFileSync(new URL('../engine.wasm', import.meta.url)), (fraction) => fractions.push(fraction))
})

/** The comparison of `analysis_parity.rs`: order, names, strings and nulls exactly, numbers within `1e-9`. */
function expectClose(actual: unknown, expected: unknown, path: string): void {
  if (typeof actual === 'number' && typeof expected === 'number' && Number.isFinite(expected)) {
    expect(Math.abs(actual - expected), path).toBeLessThanOrEqual(1e-9)
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual) && actual.length, `${path}: length`).toBe(expected.length)
    expected.forEach((value, index) => expectClose((actual as unknown[])[index], value, `${path}[${index}]`))
  } else if (expected !== null && typeof expected === 'object') {
    // Key order is the writer's own and is not part of the response.
    expect(Object.keys(actual as object).sort(), `${path}: keys`).toEqual(Object.keys(expected).sort())
    for (const [key, value] of Object.entries(expected)) expectClose((actual as Record<string, unknown>)[key], value, `${path}.${key}`)
  } else {
    expect(actual, path).toBe(expected)
  }
}

describe('analysis WebAssembly parity', () => {
  it.each(cases)('$name matches the fixture', ({ name, request, response }) => {
    expectClose(engine.analyze(JSON.stringify(request)), response, name)
  })

  it('reports progress through the import, ending near 1 when a ranking ran', () => {
    const entry = cases.find(({ response }) => response.status === 'ready')!
    fractions.length = 0
    engine.analyze(JSON.stringify(entry.request))
    expect(fractions.length).toBeGreaterThan(0)
    expect(fractions.every((fraction, index) => fraction >= (fractions[index - 1] ?? 0) && fraction <= 1)).toBe(true)
    expect(fractions.at(-1)).toBeGreaterThanOrEqual(0.95)
  })

  it('returns an error for a request that is not JSON', () => {
    expect(engine.analyze('not JSON')).toEqual({ error: expect.any(String) })
  })

  it('revives the three non-finite strings in number fields alone', () => {
    const text = '{"score":"NaN","survival":"Infinity","expansion":"-Infinity","playerId":"NaN","rankScore":"v:1"}'
    expect(JSON.parse(text, reviveNonFinite)).toEqual({ score: NaN, survival: Infinity, expansion: -Infinity, playerId: 'NaN', rankScore: 'v:1' })
  })
})
