// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { addPlayer, createBoard, placeBuilding, placeRoad, setHexTile } from '../../model/board'
import { hexEdgeIds, hexVertexIds } from '../../model/coords'
import { newGame, type Game, type ScreenshotRead } from '../../model/game'
import { ImportQuestionStep } from '../ImportQuestionStep'
import { settleImport } from '../importQuestions'
import { vertexDescription } from '../vertexParts'

const A = hexVertexIds({ q: 0, r: -2 })[0]
const B = hexVertexIds({ q: 0, r: 2 })[3]
const players = () => addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })
const read = (overrides: Partial<ScreenshotRead> = {}): ScreenshotRead => ({
  roster: true, order: true, picks: true, hands: [], unorderedPicks: [], points: {}, knights: [], ...overrides,
})
const done = vi.fn()
const skip = vi.fn()
const marks = vi.fn()
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
const group = (label: string) => container.querySelector(`[role="group"][aria-label="${label}"]`)!
const buttons = (element: Element = container) => [...element.querySelectorAll<HTMLButtonElement>('button')]
const click = (label: string, element: Element = container) => act(() => buttons(element).find((button) => button.textContent === label)!.click())
const doneButton = () => container.querySelector<HTMLButtonElement>('.confirm-actions .primary')!
const finish = () => act(() => doneButton().click())
const render = (game: Game, shot: ScreenshotRead) => act(() => root.render(
  <ImportQuestionStep game={game} read={shot} onDone={done} onSkip={skip} onMarks={marks} />,
))

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  done.mockClear()
  skip.mockClear()
  marks.mockClear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

it('asks only unread details, with accessible settlement thumbnails and gated Done', () => {
  const game = newGame(placeBuilding(placeBuilding(setHexTile(players(), { q: 0, r: -2 }, 'ore'), A, 'aki', 'settlement'), B, 'aki', 'settlement'))
  render(game, read({ order: false, picks: false, unorderedPicks: ['aki'] }))
  expect(container.textContent).toContain("The screenshot doesn't show these. Best picks and Best moves open once they're answered.")
  expect([...container.querySelectorAll('[role="group"]')].map((element) => element.getAttribute('aria-label')))
    .toEqual(['Turn order', 'Second settlement'])
  expect(doneButton().disabled).toBe(true)
  expect(doneButton().textContent).toBe('2 left')
  const picks = buttons(group('Second settlement'))
  expect(picks).toHaveLength(2)
  expect(picks[0].getAttribute('aria-label')).toBe(`aki's settlement on ${vertexDescription(game.board, A)}`)
  expect(picks.every((button) => button.querySelector('svg'))).toBe(true)
  click('Bee', group('Turn order'))
  expect(group('Second settlement').querySelector('[role="img"][aria-label="1 ore"]')).toBeNull()
  expect(marks).not.toHaveBeenCalledWith(expect.arrayContaining([expect.anything()]))
  act(() => picks[0].click())
  expect(picks[0].getAttribute('aria-pressed')).toBe('true')
  // The chosen corner's starting cards sit by the name, and the board stamps both pieces.
  expect(group('Second settlement').querySelector('[role="img"][aria-label="1 ore"]')).not.toBeNull()
  expect(marks).toHaveBeenLastCalledWith([
    { ref: A, color: game.board.players[0].color, label: '2' },
    { ref: B, color: game.board.players[0].color, label: '1' },
  ])
  expect(doneButton().disabled).toBe(false)
  expect(doneButton().textContent).toBe('Done')
  finish()
  expect(done).toHaveBeenCalledExactlyOnceWith({ order: ['b', 'aki'], second: { aki: A } })
})

it('collects a complete turn order and removes a chosen player and every later pick', () => {
  const game = newGame(addPlayer(players(), { id: 'c', name: 'Cee', color: '#aaa' }))
  render(game, read({ roster: false, order: false }))
  expect(group('Turn order').textContent).toContain('Tap players in turn order')
  click('Bee', group('Turn order'))
  click('Cee', group('Turn order'))
  click('aki', group('Turn order'))
  expect(buttons(group('Turn order')).map((button) => button.textContent)).toEqual(['3 aki', '1 Bee', '2 Cee'])
  click('2 Cee', group('Turn order'))
  expect(buttons(group('Turn order')).map((button) => button.textContent)).toEqual(['aki', '1 Bee', 'Cee'])
  finish()
  expect(done).not.toHaveBeenCalled()
  click('aki', group('Turn order'))
  click('Cee', group('Turn order'))
  finish()
  expect(done).toHaveBeenLastCalledWith({ order: ['b', 'aki', 'c'] })
})

it('does not ask who went first when the placed pieces settle it', () => {
  let board = addPlayer(addPlayer(players(), { id: 'c', name: 'Cee', color: '#aaa' }), { id: 'd', name: 'Dee', color: '#777' })
  const spots = [hexVertexIds({ q: -2, r: 0 })[0], hexVertexIds({ q: 2, r: 0 })[0], hexVertexIds({ q: 0, r: -2 })[0], hexVertexIds({ q: 0, r: 2 })[0], hexVertexIds({ q: -2, r: 2 })[0]]
  for (const [index, id] of ['aki', 'b', 'c', 'd', 'd'].entries()) board = placeBuilding(board, spots[index], id, 'settlement')
  render(newGame(board), read({ order: false }))
  expect(group('Turn order')).toBeNull()
})

it('skips even after answers have been selected', () => {
  render(newGame(players()), read({ order: false }))
  click('Bee', group('Turn order'))
  click('Skip')
  expect(skip).toHaveBeenCalledOnce()
  expect(done).not.toHaveBeenCalled()
})

function tiedRoad(): Game {
  let board = players()
  for (const edge of hexEdgeIds({ q: 0, r: 0 }).slice(0, 5)) board = placeRoad(board, edge, 'aki')
  for (const edge of hexEdgeIds({ q: 2, r: -2 }).slice(0, 5)) board = placeRoad(board, edge, 'b')
  return newGame(board)
}

it('offers every award holder the points allow, with Nobody last', () => {
  render(tiedRoad(), read({ points: { aki: 2 } }))
  expect(buttons(group('Largest army')).map((button) => button.textContent)).toEqual(['aki', 'Bee', 'Nobody'])
  expect(group('Longest road').textContent).toContain('Longest road · Who holds it?')
  expect(group('Largest army').textContent).toContain('Largest army · Who holds it?')
  click('Nobody', group('Largest army'))
  expect(buttons(group('Longest road')).map((button) => button.textContent)).toEqual(['aki', 'Bee'])
  click('aki', group('Longest road'))
  finish()
  expect(done).toHaveBeenCalledExactlyOnceWith({ largestArmy: null, longestRoad: 'aki' })
})

it('switches a wrong award pair by clearing the answer a new pick rules out', () => {
  render(tiedRoad(), read({ points: { aki: 2, b: 2 } }))
  click('aki', group('Longest road'))
  click('Bee', group('Largest army'))
  expect(buttons(group('Longest road')).map((button) => button.textContent)).toEqual(['aki', 'Bee'])
  click('Bee', group('Longest road'))
  expect(buttons(group('Largest army')).find((button) => button.textContent === 'Bee')!.getAttribute('aria-pressed')).toBe('false')
  expect(doneButton().textContent).toBe('1 left')
  click('aki', group('Largest army'))
  finish()
  expect(done).toHaveBeenCalledExactlyOnceWith({ longestRoad: 'b', largestArmy: 'aki' })
})

it('drops an award answer that is no longer among the options', () => {
  const game = tiedRoad()
  render(game, read({ points: { aki: 2, b: 2 } }))
  click('aki', group('Longest road'))
  render(game, read({ points: { aki: 0, b: 2 } }))
  finish()
  expect(done).toHaveBeenCalledExactlyOnceWith({})
})

it('ignores invalid orders and settlement answers without mutating the import', () => {
  const game = newGame(placeBuilding(placeBuilding(players(), A, 'aki', 'settlement'), B, 'aki', 'settlement'))
  const original = structuredClone(game)
  const shot = read({ order: false, unorderedPicks: ['aki'] })
  expect(settleImport(game, shot, { order: ['aki', 'aki'], second: { aki: hexVertexIds({ q: 0, r: 0 })[0] } }).board)
    .toEqual(game.board)
  expect(game).toEqual(original)
})
