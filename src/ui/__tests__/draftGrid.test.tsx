// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { analyzeBoardCached } from '../../engine/analyze'
import { addPlayer, createBoard, placeBuilding, setMe } from '../../model/board'
import { boardGrid } from '../../model/layouts'
import { PLAYER_PALETTE, type Board } from '../../model/types'
import { DraftGrid } from '../DraftGrid'

// Every sixth vertex, so no two picks land on adjacent corners.
const SPACED = boardGrid('standard4').vertexIds.filter((_, index) => index % 6 === 0)

function fourPlayers(): Board {
  let board = createBoard('standard4')
  board = addPlayer(board, { id: 'b', name: 'Bee', color: PLAYER_PALETTE.blue })
  board = addPlayer(board, { id: 'c', name: 'Cee', color: PLAYER_PALETTE.white })
  board = addPlayer(board, { id: 'd', name: 'Dee', color: PLAYER_PALETTE.orange })
  return setMe(board, 'c')
}

/** Plays the snake's first `picks` slots, each in the seat whose turn it is. */
function playDraft(board: Board, picks: number): Board {
  const { sequence } = analyzeBoardCached(board).draft
  let next = board
  for (let slot = 0; slot < picks; slot += 1) {
    next = placeBuilding(next, SPACED[slot], sequence[slot], 'settlement')
  }
  return next
}

let container: HTMLDivElement
let root: Root

// React's act() refuses to run without this flag, and jsdom does not set it.
const actEnvironment = (on: boolean): void => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', on)
}

const draw = (board: Board): void => {
  act(() => {
    root.render(<DraftGrid board={board} analysis={analyzeBoardCached(board)} />)
  })
}

const slots = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('.draft-grid-slot')]
const counter = (): string | undefined =>
  container.querySelectorAll('.group-label span')[1]?.textContent ?? undefined

describe('DraftGrid', () => {
  beforeEach(() => {
    actEnvironment(true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    actEnvironment(false)
  })

  it('draws one slot per pick, the taken ones placed and the next one up', () => {
    draw(playDraft(fourPlayers(), 2))

    expect(slots()).toHaveLength(8)
    expect(slots().filter((slot) => slot.classList.contains('placed'))).toHaveLength(2)
    expect(slots()[0].classList.contains('placed')).toBe(true)
    expect(slots()[1].classList.contains('placed')).toBe(true)
    expect(slots().flatMap((slot, index) => slot.classList.contains('now') ? [index] : [])).toEqual([2])
    expect(counter()).toBe('pick 3 of 8')
  })

  it('names the seat each pick belongs to, one column per player', () => {
    draw(fourPlayers())

    const names = [...container.querySelectorAll('.draft-grid-name')].map((name) => name.textContent)
    expect(names).toEqual(['aki', 'Bee', 'Cee', 'Dee', 'Dee', 'Cee', 'Bee', 'aki'])
    const grid = container.querySelector<HTMLElement>('.draft-grid')
    expect(grid?.style.getPropertyValue('--draft-cols')).toBe('4')
  })

  it('reads as complete once every pick is taken', () => {
    draw(playDraft(fourPlayers(), 8))

    expect(slots().every((slot) => slot.classList.contains('placed'))).toBe(true)
    expect(slots().some((slot) => slot.classList.contains('now'))).toBe(false)
    expect(counter()).toBe('draft complete')
  })
})
