// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { addPlayer, draftOrder, placeBuilding } from '../../model/board'
import { boardGrid } from '../../model/layouts'
import { setActivePlayer } from '../../model/turn'
import { readableInk } from '../colors'
import { buildingSlots } from '../placementSlots'
import { HeaderControls } from '../HeaderControls'
import { activeTab, StoreProvider, useStore } from '../store'

let root: Root
let container: HTMLDivElement
let store: ReturnType<typeof useStore>
const onOpen = vi.fn()
function Capture() {
  const current = useStore()
  useEffect(() => { store = current }, [current])
  return null
}
const render = async (building: boolean) => {
  await act(async () => root.render(<StoreProvider>
    <Capture /><HeaderControls building={building} onToggleMode={() => {}} onOpen={onOpen} />
  </StoreProvider>))
}
const startGame = async () => {
  const { game } = activeTab(store.state)
  const board = placeBuilding(game.board, boardGrid(game.board.layout).vertexIds[0], 'aki', 'city')
  await act(async () => store.dispatch({ type: 'commit-game', game: setActivePlayer({ ...game, board }, 'b') }))
}
const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!

beforeEach(async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  sessionStorage.clear()
  onOpen.mockClear()
  container = document.createElement('div')
  root = createRoot(container)
  await render(false)
  await act(async () => store.dispatch({ type: 'commit', board: addPlayer(activeTab(store.state).game.board, { id: 'b', name: 'Bee', color: '#3063ba' }) }))
})
afterEach(() => act(() => root.unmount()))

it('keeps the claim and brush rings before recording a turn', async () => {
  expect(container.querySelector('.head-dots')?.tagName).toBe('BUTTON')
  expect(container.querySelector('.head-dot-chip')).toBeNull()
  expect(container.querySelectorAll('.head-dot.me')).toHaveLength(1)
  expect(container.querySelectorAll('.head-dot-cell')[0].querySelector('.head-dot.me')).not.toBeNull()
  await render(true)
  await act(async () => button('Place pieces for Bee').click())
  expect(button('Place pieces for Bee').querySelector('.head-dot.me')).not.toBeNull()
  expect(container.querySelector('.head-dot-chip')).toBeNull()
})

it('rings the turn and chips the brush in build mode without changing the view or claim', async () => {
  await startGame()
  expect(container.querySelector('.head-dots')?.tagName).toBe('DIV')
  expect(button("View aki's best moves").querySelector('.head-dot.me')).toBeNull()
  expect(button("View Bee's best moves").querySelector('.head-dot.me.head-dot-chip')).not.toBeNull()
  await render(true)
  const chip = button('Place pieces for aki').querySelector<HTMLElement>('.head-dot-chip')!
  expect(chip.textContent).toBe('aki')
  const color = document.createElement('span').style
  color.color = readableInk(activeTab(store.state).game.board.players[0].color)
  expect(chip.style.color).toBe(color.color)
  expect(chip.classList.contains('me')).toBe(false)
  expect(button('Place pieces for Bee').querySelector('.head-dot.me')).not.toBeNull()
  await act(async () => button('Place pieces for Bee').click())
  expect(button('Place pieces for Bee').querySelector('.head-dot.me.head-dot-chip')).not.toBeNull()
  expect(button('Place pieces for Bee').getAttribute('aria-pressed')).toBe('true')
  expect(activeTab(store.state).game.board.mePlayerId).toBe('aki')
  expect(store.state.viewedPlayer ?? null).toBeNull()
  await act(async () => button('Players').click())
  expect(onOpen).toHaveBeenCalledWith('players', button('Players'))
  await render(false)
  await act(async () => button("View aki's best moves").click())
  expect(store.state.viewedPlayer).toBe('aki')
  expect(activeTab(store.state).activePlayerId).toBe('b')
  await render(true)
  expect(button('Place pieces for Bee').querySelector('.head-dot.me.head-dot-chip')).not.toBeNull()
  await render(false)
  expect(button("View aki's best moves").querySelector('.head-dot-chip')).not.toBeNull()
})

it('keeps the pre-game header during an unfinished draft even with a recorded turn', async () => {
  await act(async () => store.dispatch({ type: 'commit-game', game: setActivePlayer(activeTab(store.state).game, 'b') }))
  expect(container.querySelector('.head-dots')?.tagName).toBe('BUTTON')
  expect(container.querySelector('button[aria-label^="View "]')).toBeNull()
  expect(container.querySelector('.head-dot-chip')).toBeNull()
  expect(container.querySelectorAll('.head-dot.me')).toHaveLength(1)
  expect(container.querySelectorAll('.head-dot-cell')[0].querySelector('.head-dot.me')).not.toBeNull()
  await render(true)
  expect(button('Place pieces for aki').querySelector('.head-dot.me')).not.toBeNull()
  expect(button('Place pieces for Bee').querySelector('.head-dot.me')).toBeNull()
  expect(container.querySelector('.head-dot-chip')).toBeNull()
  await render(false)
  let { board } = activeTab(store.state).game
  for (const id of draftOrder(board)) board = placeBuilding(board, buildingSlots(board, id, 'settlement', 'edit')[0], id, 'settlement')
  await act(async () => store.dispatch({ type: 'commit', board }))
  expect(button("View Bee's best moves").querySelector('.head-dot.me.head-dot-chip')).not.toBeNull()
})

it('keeps the full name in the chip and its accessible view button label', async () => {
  await startGame()
  const name = 'Bee with a very long player name'
  const { board } = activeTab(store.state).game
  await act(async () => store.dispatch({ type: 'commit', board: { ...board,
    players: board.players.map((player) => player.id === 'b' ? { ...player, name } : player),
  } }))
  const viewButton = button(`View ${name}'s best moves`)
  expect(viewButton).not.toBeNull()
  expect(viewButton.querySelector('.head-dot-chip')?.textContent).toBe(name)
})
