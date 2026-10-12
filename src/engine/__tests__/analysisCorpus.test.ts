import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { analysisFile } from '../../../simulator/tools/generate-analysis-parity'
import type { Board } from '../../model/types'
import { inferDraftState, type DraftState } from '../draft'

vi.mock('node:fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs')>(), writeFileSync: vi.fn(),
}))

interface CorpusCase {
  name: string
  request: { board: Board }
  response: { draft: DraftState }
}

/** Every class the corpus has to cover, beside the case that covers it. */
const CLASSES: Record<string, string> = {
  'layout standard4': 'empty-first-seat-standard4',
  'layout extension6': 'empty-first-seat-extension6',
  'one player': 'roster-1',
  'two players': 'roster-2',
  'three players': 'roster-3',
  'four players': 'empty-first-seat-standard4',
  'five players': 'roster-5',
  'six players': 'empty-first-seat-extension6',
  'an empty board for the first seat': 'empty-first-seat-standard4',
  'mid first round': 'mid-first-round',
  'the last pick of round one': 'last-pick-of-round-one',
  'the first pick of round two': 'first-pick-of-round-two',
  'mid second round': 'mid-second-round',
  'the last pick': 'last-pick',
  'a complete draft': 'complete-draft',
  'a city on the board': 'city-on-board',
  'mePlayerId null': 'me-null',
  'me done': 'me-done',
  'targetPick naming a later pick of mine': 'target-later-pick',
  'targetPick naming an invalid pick': 'target-invalid-pick',
  'targetPick naming my own next pick': 'target-next-pick',
  'one pick ahead': 'one-pick-ahead',
  'two picks ahead': 'two-picks-ahead',
  'three picks ahead': 'three-picks-ahead',
  'opponentTopK 1': 'opponent-top-k-1',
  'softmaxTemperature 0': 'softmax-temperature-0',
  'expansionWeight 0': 'expansion-weight-0',
  'seed 12345': 'seed-12345',
  'default rollouts on the worst-case board': 'worst-case-default-rollouts',
}

const committed = readFileSync(analysisFile.path, 'utf8')
const corpus = JSON.parse(committed) as { cases: CorpusCase[] }

describe('analysis parity corpus', () => {
  it('matches the committed fixture to the current TypeScript analysis without regenerating it', () => {
    expect(vi.mocked(writeFileSync).mock.calls.length).toBe(0)
    expect(committed === analysisFile.contents, analysisFile.path).toBe(true)
  })

  it.each(Object.entries(CLASSES))('covers %s', (_class, name) => {
    expect(corpus.cases.map((entry) => entry.name)).toContain(name)
  })

  it('names every case once', () => {
    const names = corpus.cases.map((entry) => entry.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('infers the draft state each response carries', () => {
    for (const { name, request, response } of corpus.cases) {
      expect(inferDraftState(request.board), name).toEqual(response.draft)
    }
  })
})
