// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createBoard, randomizeBoard } from '../../model/board'
import { emptyStats, newGame } from '../../model/game'
import { useBoardActions } from '../boardActions'
import { activeTab, StoreProvider, useStore } from '../store'

const print = '123456'.repeat(64)
let root: Root
let container: HTMLDivElement
let store: ReturnType<typeof useStore>
let actions: ReturnType<typeof useBoardActions>
const tab = () => activeTab(store.state)
function Tools() {
  store = useStore()
  actions = useBoardActions(tab(), store.dispatch)
  return actions.confirm
}

beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  sessionStorage.clear()
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value() {} },
    close: { configurable: true, value() {} },
  })
  container = document.createElement('div')
  root = createRoot(container)
  act(() => root.render(<StoreProvider><Tools /></StoreProvider>))
  const game = newGame(randomizeBoard(createBoard('standard4')))
  game.avatars = { aki: print, departed: print }
  game.stats.aki = { ...emptyStats(), handUnknown: 5 }
  game.turn = { playerId: 'aki', rolled: 6, devPlayed: false, progressPlayed: { roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 } }
  act(() => store.dispatch({ type: 'commit-game', game }))
})

afterEach(() => {
  act(() => root.unmount())
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
})

function confirm(label: string) {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent === label)!
  act(() => button.click())
}

it.each(['Clear board', 'Clear pieces', 'Replace', 'Change layout'])('preserves only roster avatars through %s while resetting the game', (label) => {
  act(() => {
    if (label === 'Clear board') actions.clear()
    else if (label === 'Clear pieces') actions.clearPieces()
    else if (label === 'Replace') actions.randomize()
    else actions.chooseLayout('extension6')
  })
  confirm(label)
  expect(tab().game.avatars).toEqual({ aki: print })
  expect(tab().game.stats.aki).toEqual(emptyStats())
  expect(tab().game.turn).toBeUndefined()
})

it('carries only roster avatars to a randomized new board and leaves the old game alone', () => {
  const original = tab()
  act(() => actions.randomize())
  confirm('New board')
  expect(tab().game.avatars).toEqual({ aki: print })
  expect(tab().game.stats.aki).toEqual(emptyStats())
  expect(tab().game.turn).toBeUndefined()
  expect(tab().id).not.toBe(original.id)
  expect(store.state.tabs.find(({ id }) => id === original.id)?.game).toBe(original.game)
})
