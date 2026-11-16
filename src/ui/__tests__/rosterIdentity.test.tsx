// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBoard, renamePlayer } from '../../model/board'
import { newGame } from '../../model/game'
import { PLAYER_PALETTE } from '../../model/types'
import { loadPeople, savePeople, WORKSPACE_KEY } from '../../persistence/localStorage'
import { PlayerPanel } from '../PlayerPanel'
import { PlayersScreen } from '../phone/PlayersScreen'
import { activeTab, StoreProvider, useStore } from '../store'

const alicePrint = '123456'.repeat(64)
const bobPrint = 'abcdef'.repeat(64)
const bobNear = 'accdf0'.repeat(64)

describe.each(['desktop', 'phone'])('%s roster identity', (layout) => {
  let root: Root
  let container: HTMLDivElement
  let store: ReturnType<typeof useStore>
  const tab = () => activeTab(store.state)
  const Probe = () => { store = useStore(); return null }
  const button = (name: string) => {
    const found = [...container.querySelectorAll('button')].find((item) =>
      item.getAttribute('aria-label') === name || item.textContent === name)
    if (!found) throw new Error(`Missing button ${name}`)
    return found
  }
  const click = (name: string) => act(() => button(name).click())
  const rename = (from: string, to: string) => {
    click(`Rename ${from}`)
    const input = container.querySelector<HTMLInputElement>('input.list-row-rename')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, to)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  }

  beforeEach(() => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: { configurable: true, value() {} },
      close: { configurable: true, value() {} },
    })
    localStorage.clear()
    sessionStorage.clear()
    const game = newGame({ ...createBoard('standard4'), players: [
      { id: 'p1', name: 'Red', color: PLAYER_PALETTE.red },
      { id: 'p2', name: 'Blue', color: PLAYER_PALETTE.blue },
    ], mePlayerId: null })
    game.avatars = { p1: bobPrint }
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ tabs: [{ id: 'test', title: 'Test', game }] }))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(<StoreProvider><Probe />{layout === 'desktop' ? <PlayerPanel /> : <PlayersScreen onClose={() => {}} />}</StoreProvider>))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('refuses a duplicate name with a notice and reverts the field', () => {
    const before = tab().game
    rename('Red', ' bLuE ')
    expect(tab().game).toBe(before)
    expect(store.state.notice).toContain('Blue')
    expect(button('Rename Red')).toBeDefined()
    expect(loadPeople()).toEqual([])
  })

  it('saves a new identity and keeps it when the board rename is undone', () => {
    rename('Red', ' alice ')
    expect(tab().game.board.players[0].name).toBe('alice')
    expect(loadPeople()).toEqual([{ name: 'alice', prints: [bobPrint] }])
    act(() => store.dispatch({ type: 'undo' }))
    expect(tab().game.board.players[0].name).toBe('Red')
    expect(loadPeople()).toEqual([{ name: 'alice', prints: [bobPrint] }])
  })

  it('asks before joining, cancels unchanged, then joins using the stored spelling and moves the print', () => {
    const people = [{ name: 'Alice', prints: [alicePrint] }, { name: 'Bob', prints: [bobPrint] }]
    savePeople(people)
    const before = tab().game
    rename('Red', ' ALICE ')
    expect(container.querySelector('.confirm-dialog h3')?.textContent).toBe('Join with Alice?')
    expect(button('Join').classList.contains('primary')).toBe(true)
    expect(tab().game).toBe(before)
    expect(loadPeople()).toEqual(people)
    click('Cancel')
    expect(container.querySelector('.confirm-dialog')).toBeNull()
    expect(tab().game).toBe(before)
    expect(loadPeople()).toEqual(people)
    expect(button('Rename Red')).toBeDefined()
    rename('Red', 'ALICE')
    click('Join')
    expect(tab().game.board.players[0].name).toBe('Alice')
    expect(loadPeople()).toEqual([{ name: 'Alice', prints: [alicePrint, bobPrint] }])
    expect(tab().past).toHaveLength(1)
  })

  it('saves no identity for an unchanged name or a colour name', () => {
    const before = tab().game
    rename('Red', 'Red')
    expect(tab().game).toBe(before)
    rename('Red', 'green')
    expect(tab().game.board.players[0].name).toBe('green')
    expect(loadPeople()).toEqual([])
  })

  // A stored person can never carry a default name (parsePeople refuses one), so only creation can be tested.
  it('a Player number never creates an identity', () => {
    const people = [{ name: 'Alice', prints: [alicePrint] }]
    savePeople(people)
    rename('Red', ' player 3 ')
    expect(container.querySelector('.confirm-dialog')).toBeNull()
    expect(tab().game.board.players[0].name).toBe('player 3')
    expect(loadPeople()).toEqual(people)
  })

  it.each(['Rename everywhere', 'Only this photo', 'Cancel'])('offers a choice for an identity with several photos: %s', (choice) => {
    const people = [{ name: 'Bob', prints: [bobPrint, bobNear] }, { name: 'Alice', prints: [alicePrint] }]
    savePeople(people)
    const before = tab()
    rename('Red', ' Charlie ')
    expect(container.querySelector('.confirm-dialog h3')?.textContent).toBe('Rename Bob?')
    expect(container.querySelector('.confirm-dialog p')?.textContent).toBe('Bob has 2 photos.')
    const actions = [...container.querySelectorAll<HTMLButtonElement>('.confirm-dialog button')]
    expect(actions.map((action) => action.textContent)).toEqual(['Rename everywhere', 'Only this photo', 'Cancel'])
    expect(actions.map((action) => action.autofocus)).toEqual([false, false, true])
    expect(actions[0].classList.contains('primary')).toBe(true)
    expect(tab().game).toBe(before.game)
    expect(loadPeople()).toEqual(people)
    click(choice)
    expect(container.querySelector('.confirm-dialog')).toBeNull()
    if (choice === 'Cancel') {
      expect(tab().game).toBe(before.game)
      expect(tab().past).toBe(before.past)
      expect(loadPeople()).toEqual(people)
      expect(button('Rename Red')).toBeDefined()
    } else {
      expect(tab().game.board.players[0].name).toBe('Charlie')
      expect(tab().past).toHaveLength(before.past.length + 1)
      expect(loadPeople()).toEqual(choice === 'Rename everywhere'
        ? [{ name: 'Charlie', prints: [bobPrint, bobNear] }, people[1]]
        : [{ name: 'Bob', prints: [bobNear] }, people[1], { name: 'Charlie', prints: [bobPrint] }])
    }
  })

  it('renames an identity with one print directly', () => {
    savePeople([{ name: 'Bob', prints: [bobPrint] }])
    rename('Red', 'Charlie')
    expect(container.querySelector('.confirm-dialog')).toBeNull()
    expect(tab().game.board.players[0].name).toBe('Charlie')
    expect(loadPeople()).toEqual([{ name: 'Charlie', prints: [bobPrint] }])
  })

  it('keeps the join choice when the current identity holds several photos', () => {
    savePeople([{ name: 'Bob', prints: [bobPrint, bobNear] }, { name: 'Alice', prints: [alicePrint] }])
    rename('Red', 'ALICE')
    expect(container.querySelector('.confirm-dialog h3')?.textContent).toBe('Join with Alice?')
    click('Join')
    expect(tab().game.board.players[0].name).toBe('Alice')
    expect(loadPeople()).toEqual([{ name: 'Bob', prints: [bobNear] }, { name: 'Alice', prints: [alicePrint, bobPrint] }])
  })

  it.each(['tab switch', 'undo'])('clears a pending photo choice after a %s returns to the same game', (change) => {
    const people = [{ name: 'Bob', prints: [bobPrint, bobNear] }]
    savePeople(people)
    const before = tab()
    rename('Red', 'Charlie')
    expect(container.querySelector('.confirm-dialog h3')?.textContent).toBe('Rename Bob?')
    if (change === 'tab switch') {
      act(() => store.dispatch({ type: 'tab-add' }))
      act(() => store.dispatch({ type: 'tab-select', id: before.id }))
    } else {
      act(() => store.dispatch({ type: 'commit', board: renamePlayer(tab().game.board, 'p2', 'Bee') }))
      act(() => store.dispatch({ type: 'undo' }))
    }
    expect(tab().game).toBe(before.game)
    expect(container.querySelector('.confirm-dialog')).toBeNull()
    expect(loadPeople()).toEqual(people)
  })

  it('does not warn when an unchanged name already belongs to another seat', () => {
    act(() => store.dispatch({ type: 'commit', board: renamePlayer(renamePlayer(tab().game.board, 'p1', 'alice'), 'p2', 'alice') }))
    const before = tab().game
    const notice = store.state.notice
    rename('alice', 'alice')
    expect(tab().game).toBe(before)
    expect(store.state.notice).toBe(notice)
    expect(loadPeople()).toEqual([])
  })

  it('commits an unchanged non-colour name without joining another identity', () => {
    const people = [{ name: 'alice', prints: [alicePrint] }, { name: 'Bob', prints: [bobPrint] }]
    savePeople(people)
    act(() => store.dispatch({ type: 'commit', board: renamePlayer(tab().game.board, 'p1', 'alice') }))
    const before = tab()
    rename('alice', 'alice')
    expect(container.querySelector('.confirm-dialog')).toBeNull()
    expect(tab().game).toBe(before.game)
    expect(tab().past).toBe(before.past)
    expect(loadPeople()).toEqual(people)
  })

  it('keeps a capitalisation change in the player name and its own identity', () => {
    savePeople([{ name: 'alice', prints: [bobPrint] }])
    act(() => store.dispatch({ type: 'commit', board: renamePlayer(tab().game.board, 'p1', 'alice') }))
    rename('alice', 'Alice')
    expect(container.querySelector('.confirm-dialog')).toBeNull()
    expect(tab().game.board.players[0].name).toBe('Alice')
    expect(loadPeople()).toEqual([{ name: 'Alice', prints: [bobPrint] }])
  })

  it('saves an exact-spelling join even when the board already has that spelling', () => {
    savePeople([{ name: 'Alice', prints: [alicePrint] }, { name: 'Bob', prints: [bobPrint] }])
    act(() => store.dispatch({ type: 'commit', board: renamePlayer(tab().game.board, 'p1', 'Alice') }))
    const before = tab().game
    rename('Alice', 'alice')
    expect(container.querySelector('.confirm-dialog h3')?.textContent).toBe('Join with Alice?')
    click('Join')
    expect(tab().game).toBe(before)
    expect(loadPeople()).toEqual([{ name: 'Alice', prints: [alicePrint, bobPrint] }])
  })

  it('orders Join before Cancel and gives Cancel the native autofocus', () => {
    savePeople([{ name: 'Alice', prints: [alicePrint] }])
    rename('Red', 'Alice')
    const actions = [...container.querySelectorAll<HTMLButtonElement>('.confirm-dialog button')]
    expect(actions.map((action) => action.textContent)).toEqual(['Join', 'Cancel'])
    expect(actions.map((action) => action.autofocus)).toEqual([false, true])
  })

  it('clears a pending join when switching away and back to its tab', () => {
    savePeople([{ name: 'Alice', prints: [alicePrint] }])
    const original = tab().id
    rename('Red', 'Alice')
    act(() => store.dispatch({ type: 'tab-add' }))
    act(() => store.dispatch({ type: 'tab-select', id: original }))
    expect(container.querySelector('.confirm-dialog')).toBeNull()
    expect(loadPeople()).toEqual([{ name: 'Alice', prints: [alicePrint] }])
  })

  it('clears a pending join when a change is undone back to the original game object', () => {
    savePeople([{ name: 'Alice', prints: [alicePrint] }])
    const original = tab().game
    rename('Red', 'Alice')
    act(() => store.dispatch({ type: 'commit', board: renamePlayer(tab().game.board, 'p2', 'Bee') }))
    expect(container.querySelector('.confirm-dialog')).toBeNull()
    act(() => store.dispatch({ type: 'undo' }))
    expect(tab().game).toBe(original)
    expect(container.querySelector('.confirm-dialog')).toBeNull()
    expect(loadPeople()).toEqual([{ name: 'Alice', prints: [alicePrint] }])
  })

  it('keeps an open rename field when another part of the game changes', () => {
    click('Rename Red')
    const input = container.querySelector<HTMLInputElement>('input.list-row-rename')!
    act(() => store.dispatch({ type: 'commit', board: renamePlayer(tab().game.board, 'p2', 'Bee') }))
    expect(container.querySelector('input.list-row-rename')).toBe(input)
  })

  it('renames a player without a photo without changing identities', () => {
    savePeople([{ name: 'Alice', prints: [alicePrint] }])
    rename('Blue', 'Alice')
    expect(tab().game.board.players[1].name).toBe('Alice')
    expect(container.querySelector('.confirm-dialog')).toBeNull()
    expect(loadPeople()).toEqual([{ name: 'Alice', prints: [alicePrint] }])
  })

  it('does not apply a pending join to another board', () => {
    savePeople([{ name: 'Alice', prints: [alicePrint] }])
    rename('Red', 'Alice')
    act(() => store.dispatch({ type: 'tab-add' }))
    expect(container.querySelector('.confirm-dialog')).toBeNull()
    expect(loadPeople()).toEqual([{ name: 'Alice', prints: [alicePrint] }])
  })

  it('reports an identity save failure and leaves the name unchanged', () => {
    const before = tab().game
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
    rename('Red', 'Alice')
    expect(tab().game).toBe(before)
    expect(store.state.notice).toContain('Full')
    expect(button('Rename Red')).toBeDefined()
  })
})
