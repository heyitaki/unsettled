// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, removeBuilding } from '../../model/board'
import { boardGrid } from '../../model/layouts'
import type { Board } from '../../model/types'
import imported from '../../parser/__tests__/expected/settled-2p-first-pick.json'
import { BoardCanvas } from '../BoardCanvas'
import { StoreProvider, useStore } from '../store'

function Harness({ board, highlighted }: { board: Board; highlighted: boolean }) {
  const { dispatch } = useStore()
  useEffect(() => {
    dispatch({ type: 'commit', board })
    dispatch({ type: 'highlight', marks: highlighted ? [{ ref: board.buildings[0].vertexId }] : null })
  }, [dispatch, board, highlighted])
  return <BoardCanvas />
}

let container: HTMLDivElement
let root: Root
const draw = (board: Board, highlighted = false) => act(() => root.render(<StoreProvider><Harness board={board} highlighted={highlighted} /></StoreProvider>))
const badges = () => [...container.querySelectorAll('.settlement-ordinal')]

describe('settlement order badges', () => {
  beforeEach(() => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    localStorage.clear()
    sessionStorage.clear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', false)
  })

  it('shows the imported first settlement with a decorative badge', () => {
    draw(imported as Board)
    expect(badges().map((badge) => badge.textContent)).toEqual(['1'])
    expect(badges()[0].getAttribute('aria-hidden')).toBe('true')
    expect(badges()[0].getAttribute('pointer-events')).toBe('none')
  })

  it.each([false, true])('keeps badges outside piece filters with highlight=%s', (highlighted) => {
    draw(imported as Board, highlighted)
    expect(container.querySelector(`[filter="url(#piece-${highlighted ? 'highlight' : 'shadow'})"]`)).not.toBeNull()
    expect(badges()[0].closest('[filter]')).toBeNull()
  })

  it('numbers hand-placed settlements and renumbers after removal', () => {
    const [a, b] = boardGrid('standard4').vertexIds
    let board = addPlayer(createBoard('standard4'), { id: 'second', name: 'Brown', color: '#684d43' })
    board = placeBuilding(board, a, board.players[0].id, 'settlement')
    board = placeBuilding(board, b, board.players[0].id, 'settlement')
    draw(board)
    expect(badges().map((badge) => badge.textContent)).toEqual(['1', '2'])
    draw(removeBuilding(board, a))
    expect(badges().map((badge) => badge.textContent)).toEqual(['1'])
  })

  it('fades roads and buildings to 70% only while the draft is unfinished', () => {
    const piece = () => container.querySelector('[filter="url(#piece-shadow)"]')!
    draw(imported as Board)
    expect(piece().closest('[opacity]')?.getAttribute('opacity')).toBe('0.7')
    let board = createBoard('standard4')
    const vertices = boardGrid(board.layout).vertexIds
    for (const [index, player] of board.players.entries()) {
      board = placeBuilding(board, vertices[index * 2], player.id, 'settlement')
      board = placeBuilding(board, vertices[index * 2 + 1], player.id, 'settlement')
    }
    draw(board)
    expect(piece().closest('[opacity]')).toBeNull()
  })

  it('hides badges after the last draft pick and when a city exists', () => {
    let board = createBoard('standard4')
    const vertices = boardGrid(board.layout).vertexIds
    for (const [index, player] of board.players.entries()) {
      board = placeBuilding(board, vertices[index * 2], player.id, 'settlement')
      board = placeBuilding(board, vertices[index * 2 + 1], player.id, 'settlement')
    }
    draw(board)
    expect(badges()).toEqual([])
    board = imported as Board
    const cityVertex = vertices.find((vertexId) => vertexId !== board.buildings[0].vertexId)!
    board = placeBuilding(board, cityVertex, board.players[0].id, 'city')
    expect(board.buildings.filter((building) => building.tier === 'settlement')).toHaveLength(1)
    draw(board)
    expect(badges()).toEqual([])
  })
})
