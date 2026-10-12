import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import type { Board } from '../../model/types'
import { inferDraftState, type DraftState } from '../draft'

interface CorpusCase {
  name: string
  request: { board: Board }
  response: { draft: DraftState }
}

// The fixture's responses are the Rust engine's, so this pins `draft.ts` to the engine's twin of it.
const { cases }: { cases: CorpusCase[] } = JSON.parse(
  readFileSync(new URL('../../../simulator/fixtures/analysis-parity.json', import.meta.url), 'utf8'),
)

it('infers the draft state each corpus response carries', () => {
  expect(cases.length).toBeGreaterThan(0)
  for (const { name, request, response } of cases) {
    expect(inferDraftState(request.board), name).toEqual(response.draft)
  }
})
