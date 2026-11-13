// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isBlank, randomizeBoard, setHexTile } from '../../model/board'
import { BoardTools } from '../BoardTools'
import { useBoardActions } from '../boardActions'
import { activeTab, StoreProvider, useStore } from '../store'

function Tools() {
  const { state, dispatch } = useStore()
  const actions = useBoardActions(activeTab(state), dispatch)
  return <>{actions.confirm}<BoardTools actions={actions} onDone={() => {}} onCancel={() => {}} /></>
}

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
      <Capture report={(store) => { seen = store }} /><Tools />
    </StoreProvider>))
  })
  afterEach(() => {
    act(() => root.unmount())
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
  })

  it('explains the header player brush in the help paragraph', () => {
    expect(container.querySelector('.tool-hint')?.textContent).toContain('Tap a player circle at the top to place pieces for that player.')
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

  it('repeats an untouched random deal without asking and confirms after an edit', async () => {
    await click('Randomize')
    expect(isBlank(board())).toBe(false)
    await click('Randomize')
    expect(container.querySelector('dialog')).toBeNull()
    await act(async () => seen.dispatch({ type: 'commit', board: setHexTile(board(), { q: 0, r: 0 }, null) }))
    const before = tab()
    await click('Randomize')
    expect(container.querySelector('dialog')?.getAttribute('aria-label')).toBe('Randomize this board?')
    await click('Cancel')
    expect(container.querySelector('dialog')).toBeNull()
    expect(board()).toBe(before.game.board)
    expect(tab().past).toBe(before.past)
    await click('Randomize')
    await click('Replace')
    expect(tab().past).toHaveLength(before.past.length + 1)
    expect(board().hexes.every((hex) => hex.tile !== null)).toBe(true)
  })

  it('can randomize onto a new named tab without replacing the original', async () => {
    await fill()
    const original = tab()
    await click('Randomize')
    await click('New board')
    expect(tab().title).toBe('Board 2')
    expect(board().players).toEqual(original.game.board.players)
    expect(seen.state.tabs.find((item) => item.id === original.id)?.game).toBe(original.game)
    expect(container.querySelector('dialog')).toBeNull()
  })
})
