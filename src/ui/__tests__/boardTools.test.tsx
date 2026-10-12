// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearBoard, isBlank, randomizeBoard, setHexTile } from '../../model/board'
import { ToolPalette } from '../ToolPalette'
import { activeTab, StoreProvider, useStore } from '../store'

type Store = ReturnType<typeof useStore>
function Capture({ report }: { report(store: Store): void }) {
  const store = useStore()
  useEffect(() => report(store), [store, report])
  return null
}

describe('Board tools', () => {
  let root: Root
  let container: HTMLDivElement
  let seen: Store
  const tab = () => activeTab(seen.state)
  const board = () => tab().game.board
  const button = (label: string) => {
    const match = [...container.querySelectorAll('button')].find((item) =>
      item.getAttribute('aria-label') === label || item.textContent?.trim() === label)
    if (!match) throw new Error(`Missing button ${label}`)
    return match
  }
  const click = async (label: string) => {
    await act(async () => button(label).click())
  }
  const fill = async () => {
    await act(async () => seen.dispatch({ type: 'commit', board: randomizeBoard(board()) }))
  }
  beforeEach(async () => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    localStorage.clear()
    sessionStorage.clear()
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: { configurable: true, value() {} },
      close: { configurable: true, value() {} },
    })
    container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root.render(<StoreProvider>
      <Capture report={(store) => { seen = store }} /><ToolPalette />
    </StoreProvider>))
    await act(async () => { container.querySelector('details')!.open = true })
  })
  afterEach(() => {
    act(() => root.unmount())
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
  })

  it('selects the current layout and switches a blank board without a dialog', async () => {
    expect(button('4 players').getAttribute('aria-pressed')).toBe('true')
    expect(button('4 players').classList.contains('selected')).toBe(true)
    expect(button('5–6 players').getAttribute('aria-pressed')).toBe('false')
    await click('4 players')
    expect(tab().past).toHaveLength(0)
    await click('5–6 players')
    expect(board().layout).toBe('extension6')
    expect(button('5–6 players').getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('dialog')).toBeNull()
    expect(tab().past).toHaveLength(1)
  })

  it('confirms a layout change on a non-blank board and can cancel it', async () => {
    await fill()
    const before = tab()
    await click('5–6 players')
    expect(container.querySelector('dialog')?.getAttribute('aria-label')).toBe('Change layout?')
    expect(board()).toBe(before.game.board)
    await click('Cancel')
    expect(container.querySelector('dialog')).toBeNull()
    expect(tab().past).toBe(before.past)
    await click('5–6 players')
    await click('Change layout')
    expect(board().layout).toBe('extension6')
    expect(isBlank(board())).toBe(true)
    expect(board().players).toEqual(before.game.board.players)
    expect(container.querySelector('dialog')).toBeNull()
  })

  it('clears only after confirmation, in one undo step, without changing the tool', async () => {
    await fill()
    await click('wood')
    const before = tab()
    const tool = seen.state.tool
    await click('clear all')
    expect(container.querySelector('dialog')?.getAttribute('aria-label')).toBe('Clear this board?')
    expect(container.querySelector('.confirm-dialog p')?.textContent).toBe('Clearing removes the tiles, tokens, and pieces on this board and puts its ports back. Your players are kept.')
    expect(button('Clear board').className).toBe('danger')
    expect(seen.state.tool).toBe(tool)
    await click('Cancel')
    expect(container.querySelector('dialog')).toBeNull()
    expect(board()).toBe(before.game.board)
    expect(tab().past).toBe(before.past)
    await click('clear all')
    await click('Clear board')
    expect(board()).toEqual(clearBoard(before.game.board))
    expect(isBlank(board())).toBe(true)
    expect(tab().past).toHaveLength(before.past.length + 1)
    expect(seen.state.tool).toBe(tool)
    expect(button('clear all').className).toBe('danger')
    await click('Undo')
    expect(board()).toBe(before.game.board)
  })

  it('does nothing when clearing a blank board', async () => {
    await click('wood')
    const before = tab()
    const tool = seen.state.tool
    await click('clear all')
    expect(container.querySelector('dialog')).toBeNull()
    expect(board()).toBe(before.game.board)
    expect(tab().past).toBe(before.past)
    expect(seen.state.tool).toBe(tool)
  })

  it('undoes and redoes an edit from the desktop heading', async () => {
    const original = board()
    expect(button('Undo').disabled).toBe(true)
    expect(button('Redo').disabled).toBe(true)
    const headings = [...container.querySelectorAll('.panel-heading button')]
    expect(headings.map((item) => item.getAttribute('aria-label'))).toEqual(['Undo', 'Redo'])
    expect([...container.querySelectorAll('[aria-label]')].some((item) => item.getAttribute('aria-label') === 'Board options')).toBe(false)
    await fill()
    const edited = board()
    expect(button('Undo').disabled).toBe(false)
    await click('Undo')
    expect(board()).toBe(original)
    expect(button('Redo').disabled).toBe(false)
    await click('Redo')
    expect(board()).toBe(edited)
  })

  it('orders the shared rows and shows the exact placement hint', () => {
    expect([...container.querySelectorAll('.tool-label')].map((label) => label.firstChild?.textContent))
      .toEqual(['Layout', 'Terrain', 'Number token', 'Other tools'])
    expect(container.querySelector('.tool-hint')?.textContent).toBe('With no tool selected, tap a corner on the board to cycle settlement, city, empty. Tap an edge to add or remove a road, or a port to edit it.')
    expect([...container.querySelectorAll('.structure-grid button')].map((item) => item.textContent))
      .toEqual(['robber', 'port', 'erase', 'clear all'])
  })

  it('repeats an untouched random deal without asking and confirms after an edit', async () => {
    await click('Randomize board')
    expect(isBlank(board())).toBe(false)
    await click('Randomize board')
    expect(container.querySelector('dialog')).toBeNull()
    await act(async () => seen.dispatch({ type: 'commit', board: setHexTile(board(), { q: 0, r: 0 }, null) }))
    const before = tab()
    await click('Randomize board')
    expect(container.querySelector('dialog')?.getAttribute('aria-label')).toBe('Randomize this board?')
    await click('Cancel')
    expect(container.querySelector('dialog')).toBeNull()
    expect(board()).toBe(before.game.board)
    expect(tab().past).toBe(before.past)
    await click('Randomize board')
    await click('Replace')
    expect(tab().past).toHaveLength(before.past.length + 1)
    expect(board().hexes.every((hex) => hex.tile !== null)).toBe(true)
  })

  it('can randomize onto a new named tab without replacing the original', async () => {
    await fill()
    const original = tab()
    await click('Randomize board')
    await click('New board')
    expect(tab().title).toBe('Board 2')
    expect(board().players).toEqual(original.game.board.players)
    expect(seen.state.tabs.find((item) => item.id === original.id)?.game).toBe(original.game)
    expect(container.querySelector('dialog')).toBeNull()
  })
})
