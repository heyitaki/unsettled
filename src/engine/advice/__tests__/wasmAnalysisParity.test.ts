import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { createEngine, reviveNonFinite, type Engine } from '../wasm'

const { cases }: { cases: { name: string; request: object; response: { status: string; recommendations: object[]; takenBeforeFirstPick: object[] } }[] } = JSON.parse(
  readFileSync(new URL('../../../../simulator/fixtures/analysis-parity.json', import.meta.url), 'utf8'),
  reviveNonFinite,
)
const fractions: number[] = []
let engine: Engine
beforeAll(async () => {
  engine = await createEngine(readFileSync(new URL('../engine.wasm', import.meta.url)), (fraction) => fractions.push(fraction))
})

/**
 * Cases the wasm does not return bit for bit. The fixture is written by the native build, which takes `pow` from the
 * platform's maths library, where the wasm carries Rust's own. The two round `x ** 1.5` one bit apart on some inputs,
 * and 1.5 is the coverage exponent of the default weights, which only a one-player roster is scored with.
 */
const LAST_BIT_CASES = ['roster-1']

/** Order, names, strings and nulls exactly, numbers within `1e-9`. */
function expectClose(actual: unknown, expected: unknown, path: string): void {
  if (typeof actual === 'number' && typeof expected === 'number' && Number.isFinite(expected)) {
    expect(Math.abs(actual - expected), path).toBeLessThanOrEqual(1e-9)
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual) && actual.length, `${path}: length`).toBe(expected.length)
    expected.forEach((value, index) => expectClose((actual as unknown[])[index], value, `${path}[${index}]`))
  } else if (expected !== null && typeof expected === 'object') {
    expect(Object.keys(actual as object).sort(), `${path}: keys`).toEqual(Object.keys(expected).sort())
    for (const [key, value] of Object.entries(expected)) expectClose((actual as Record<string, unknown>)[key], value, `${path}.${key}`)
  } else {
    expect(actual, path).toBe(expected)
  }
}

describe('analysis WebAssembly parity', () => {
  it.each(cases)('$name matches the fixture', ({ name, request, response }) => {
    const actual = engine.analyze(JSON.stringify(request))
    if (LAST_BIT_CASES.includes(name)) {
      expectClose(actual, response, name)
      // Fails once the case is exact again, so the list cannot outlive its reason.
      expect(actual).not.toEqual(response)
    } else {
      expect(actual).toEqual(response)
    }
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

  it('revives every number field a ranked response carries', () => {
    const numberFields = new Set<string>()
    const collect = (value: object) => {
      for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === 'number') numberFields.add(key)
        else if (entry !== null && typeof entry === 'object') collect(entry)
      }
    }
    for (const { response } of cases) collect([response.recommendations, response.takenBeforeFirstPick])
    expect(numberFields.size).toBeGreaterThan(0)
    for (const field of numberFields) expect(reviveNonFinite(field, 'NaN'), field).toBeNaN()
  })
})
