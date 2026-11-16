import { expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createEngine } from '../src/engine/advice/wasm'
import { rowContest } from '../src/engine/contest'
import { createBoard, placeRoad } from '../src/model/board'
import { edgeEndpointVertexIds } from '../src/model/coords'
import { boardGrid } from '../src/model/layouts'
import type { Game } from '../src/model/game'
import type { Board, VertexId } from '../src/model/types'
import { LISTED_PICKS } from '../src/ui/restMarks'

/** The roster `seedUnclaimedRoster` writes, in the order the claim row renders it. */
export const UNCLAIMED_ROSTER = [
  { id: 'p1', name: 'Red', color: '#c23f38' },
  { id: 'p2', name: 'Blue', color: '#3063ba' },
  { id: 'p3', name: 'Orange', color: '#e58331' },
  { id: 'p4', name: 'White', color: '#ffffff' },
]

/** The matching roads put a rival road end on or beside every unbuilt corner. */
export async function contestFixture(name = 'Blue') {
  let board: Board = {
    ...createBoard('standard4'),
    players: UNCLAIMED_ROSTER.map((player, index) => index === 1 ? { ...player, name } : player),
    mePlayerId: 'p1',
  }
  const resources = ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const
  const numbers = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4]
  board = { ...board, hexes: board.hexes.map((hex, index) => ({
    ...hex, tile: resources[index % resources.length], numberToken: numbers[index % numbers.length],
  })) }
  const taken = new Set<VertexId>()
  for (const edgeId of boardGrid(board.layout).edgeIds) {
    const ends = edgeEndpointVertexIds(edgeId)
    if (ends.some((end) => taken.has(end))) continue
    ends.forEach((end) => taken.add(end))
    board = placeRoad(board, edgeId, 'p2')
  }
  const engine = await createEngine(readFileSync(new URL('../src/engine/advice/engine.wasm', import.meta.url)), () => {})
  const analysis = engine.analyze(JSON.stringify({ board }))
  if ('error' in analysis) throw new Error(analysis.error)
  const contests = analysis.recommendations.slice(0, LISTED_PICKS).map((row) => rowContest(board, 'p1', row))
  expect(contests).toHaveLength(LISTED_PICKS)
  const notes = contests.map(({ spots, contested }) => {
    expect(spots.length).toBeGreaterThan(0)
    expect(contested).toEqual(spots.map((vertexId) => ({ vertexId, playerId: 'p2' })))
    return `${name} can reach ${spots.length === 1 ? 'the only spot' : `${spots.length} of ${spots.length} spots`}`
  })
  return { board, contests, notes }
}

/**
 * A fresh board boots with one claimed player, so the no-me state needs a
 * roster nobody has claimed. The store flushes its own workspace on pagehide,
 * so the seed runs at the start of the reloaded document, after that flush,
 * and edits only the roster fields of the stored tab. The caller waits for the
 * reloaded tree in its own vocabulary.
 */
export async function seedUnclaimedRoster(page: Page) {
  await seedBoard(page, { players: UNCLAIMED_ROSTER, mePlayerId: null })
}

/**
 * Writes `fields` over the stored board, a whole `Board` replacing it, and `stats` over the
 * game's per-player stats. The tab's active player goes with them, since the seeded roster need
 * not hold that id. A `turn` marks the game as started, which takes a finished draft past the
 * recap to Best moves.
 */
export async function seedBoard(page: Page, fields: Partial<Board>, stats: Game['stats'] = {}, turn?: Game['turn']) {
  await page.addInitScript(({ seed, stats, turn }) => {
    const key = 'unsettled.workspace.v1'
    const raw = localStorage.getItem(key)
    if (raw === null) return
    const workspace = JSON.parse(raw)
    Object.assign(workspace.tabs[0].game.board, seed)
    workspace.tabs[0].game.stats = stats
    if (turn) workspace.tabs[0].game.turn = turn
    delete workspace.tabs[0].activePlayerId
    localStorage.setItem(key, JSON.stringify(workspace))
  }, { seed: fields, stats, turn })
  await page.reload()
}

/**
 * `count` saved maps, every one a copy of the stored board, so a test can put
 * more in the Library than the popover can show. Runs on the reloaded document
 * like `seedUnclaimedRoster`, after the store's own pagehide flush.
 */
export async function seedSavedMaps(page: Page, count: number) {
  await page.addInitScript((n) => {
    const raw = localStorage.getItem('unsettled.workspace.v1')
    if (raw === null) return
    const { game } = JSON.parse(raw).tabs[0]
    const now = Date.now()
    localStorage.setItem('unsettled.maps.v1', JSON.stringify(
      Array.from({ length: n }, (_, i) => (
        { id: `map-${i}`, name: `Map ${i + 1}`, game, createdAt: now - i, modifiedAt: now - i }
      )),
    ))
  }, count)
  await page.reload()
}

/** A board's automatic title when it was created today (`model/names.ts` `automaticTitle`). */
export function todayTitle(...names: string[]): string {
  const today = new Date()
  return `${today.getMonth() + 1}/${today.getDate()} ${names.join(', ')}`
}
