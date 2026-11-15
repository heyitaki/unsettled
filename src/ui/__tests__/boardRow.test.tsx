// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setAwardHolder } from '../../engine/stats'
import { clearBoard, clearPieces, isBlank, placeBuilding, randomizeBoard, setLayout } from '../../model/board'
import { adjustCounter, adjustHand, emptyStats, type Game } from '../../model/game'
import { boardGrid } from '../../model/layouts'
import { adjustDevHand, setActivePlayer } from '../../model/turn'
import { BoardTools } from '../BoardTools'
import { useBoardActions } from '../boardActions'
import { activeTab, StoreProvider, useStore } from '../store'

const HELP = 'Tap the board to edit pieces, the robber and ports. Pick a terrain or number, then tap a tile. A picked terrain turns a tapped port 2:1. Tap a player circle at the top to place pieces for that player.'
const RESET = 'The game goes back to before the draft: recorded turns, hands, development cards and awards are reset.'
const PIECES = `This removes every settlement, city and road. ${RESET} The tiles, numbers, ports and robber stay, and so do your players. Undo brings everything back.`
const BOARD = `This removes every tile and number, every settlement, city and road, and the robber, and puts the ports back where a new board has them. ${RESET} Your players stay. Undo brings everything back.`
const RANDOMIZE = "Replace swaps this board's tiles, tokens, ports and pieces for a random map and resets recorded turns, hands, development cards and awards. New board keeps this one and deals the random map on a new board. Your players are kept either way."
const LAYOUT = 'Switching layouts clears the tiles, tokens, and pieces on this board and resets recorded turns, hands, development cards and awards. Your players are kept.'

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

// The Board row, the counts and the help paragraph that replaced `Other tools`.
describe('Board row', () => {
  let root: Root
  let container: HTMLDivElement
  let seen: Store
  const tab = () => activeTab(seen.state)
  const board = () => tab().game.board
  const find = (scope: ParentNode, label: string) => {
    const match = [...scope.querySelectorAll('button')].find((item) =>
      item.getAttribute('aria-label') === label || item.textContent?.trim() === label)
    if (!match) throw new Error(`Missing button ${label}`)
    return match
  }
  const row = (label: string) => find(container.querySelector('.structure-grid')!, label)
  const click = async (button: HTMLButtonElement) => {
    await act(async () => button.click())
  }
  const inDialog = (label: string) => find(container.querySelector('dialog')!, label)
  const count = (label: string) => [...container.querySelectorAll('.tool-label')]
    .find((item) => item.firstChild?.textContent === label)!.querySelector('.tool-count')!
  const fill = async () => {
    await act(async () => seen.dispatch({ type: 'commit', board: randomizeBoard(board()) }))
  }
  // Populate the record so a reset cannot pass by keeping empty fields.
  const play = async () => {
    await fill()
    const player = board().players[0].id
    await act(async () => seen.dispatch({ type: 'commit', board: placeBuilding(board(), boardGrid(board().layout).vertexIds[0], player, 'settlement') }))
    let game = setActivePlayer(tab().game, player)
    game = adjustHand(game, player, 'wood', 3)
    game = adjustCounter(game, player, 'knights', 3)
    game = setAwardHolder(game, 'largestArmy', player)
    game = adjustDevHand(game, 'playable', 'monopoly', 2)
    await act(async () => seen.dispatch({ type: 'commit-game', game }))
    expect(tab().game.awards?.largestArmy).toBe(player)
    expect(tab().game.devHand?.playable.monopoly).toBe(2)
  }
  const expectFreshRecord = (game: Game) => {
    expect(game.turn).toBeUndefined()
    expect(game.devHand).toBeUndefined()
    expect(game.awards?.longestRoad ?? null).toBeNull()
    expect(game.awards?.largestArmy ?? null).toBeNull()
    for (const player of game.board.players) expect(game.stats[player.id]).toEqual(emptyStats())
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

  it('orders the rows, with the help paragraph above them and no robber, port or erase tool', () => {
    expect([...container.querySelectorAll('.tool-label')].map((label) => label.firstChild?.textContent))
      .toEqual(['Layout', 'Terrain', 'Number token', 'Board'])
    expect([...container.querySelectorAll('.structure-grid button')].map((item) => item.textContent))
      .toEqual(['Randomize', 'Clear pieces', 'Clear board'])
    const help = container.querySelector('.tool-hint')!
    expect(help.textContent).toBe(HELP)
    expect(help.compareDocumentPosition(container.querySelector('.tool-group')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(row('Clear pieces').className).toBe('danger')
    expect(row('Clear board').className).toBe('danger')
    expect(row('Randomize').className).toBe('')
  })

  it('counts tiles and number tokens, and marks a count that is short', async () => {
    expect(count('Terrain').textContent).toBe('0/19')
    expect(count('Terrain').classList.contains('short')).toBe(true)
    expect(count('Number token').textContent).toBe('0/19')
    expect(count('Number token').classList.contains('short')).toBe(true)
    await fill()
    expect(count('Terrain').textContent).toBe('19/19')
    expect(count('Terrain').classList.contains('short')).toBe(false)
    expect(count('Number token').textContent).toBe('18/18')
    expect(count('Number token').classList.contains('short')).toBe(false)
  })

  it('turns each clear off while it has nothing to clear', async () => {
    expect(row('Clear pieces').disabled).toBe(true)
    expect(row('Clear board').disabled).toBe(true)
    await fill()
    expect(row('Clear pieces').disabled).toBe(true)
    expect(row('Clear board').disabled).toBe(false)
    await play()
    expect(row('Clear pieces').disabled).toBe(false)
  })

  it('clears the pieces after asking, in one undo step, and resets the game record', async () => {
    await play()
    const before = tab()
    await click(row('Clear pieces'))
    expect(container.querySelector('dialog')?.getAttribute('aria-label')).toBe('Clear the pieces?')
    expect(container.querySelector('.confirm-dialog p')?.textContent).toBe(PIECES)
    expect(inDialog('Clear pieces').className).toBe('danger')
    await click(inDialog('Cancel'))
    expect(container.querySelector('dialog')).toBeNull()
    expect(tab().game).toBe(before.game)
    await click(row('Clear pieces'))
    await click(inDialog('Clear pieces'))
    expect(container.querySelector('dialog')).toBeNull()
    expect(board()).toEqual(clearPieces(before.game.board))
    expect(board().hexes).toEqual(before.game.board.hexes)
    expectFreshRecord(tab().game)
    expect(tab().past).toHaveLength(before.past.length + 1)
    await click(find(container, 'Undo'))
    expect(tab().game).toBe(before.game)
  })

  it('clears the board after asking, in one undo step, and resets the game record', async () => {
    await play()
    const before = tab()
    await click(row('Clear board'))
    expect(container.querySelector('dialog')?.getAttribute('aria-label')).toBe('Clear this board?')
    expect(container.querySelector('.confirm-dialog p')?.textContent).toBe(BOARD)
    expect(inDialog('Clear board').className).toBe('danger')
    await click(inDialog('Clear board'))
    expect(board()).toEqual(clearBoard(before.game.board))
    expect(isBlank(board())).toBe(true)
    expectFreshRecord(tab().game)
    expect(tab().past).toHaveLength(before.past.length + 1)
    await click(find(container, 'Undo'))
    expect(tab().game).toBe(before.game)
  })

  it('Replace resets the record in one undo step and Undo restores the game by identity', async () => {
    await play()
    const before = tab()
    await click(row('Randomize'))
    await click(inDialog('Replace'))
    expect(board().buildings).toEqual([])
    expect(board().players).toEqual(before.game.board.players)
    expectFreshRecord(tab().game)
    expect(tab().past).toHaveLength(before.past.length + 1)
    await click(find(container, 'Undo'))
    expect(tab().game).toBe(before.game)
  })

  it('Change layout resets the record in one undo step and Undo restores the game by identity', async () => {
    await play()
    const before = tab()
    await click(container.querySelectorAll<HTMLButtonElement>('.layout-grid button')[1])
    await click(inDialog('Change layout'))
    expect(board()).toEqual(setLayout(before.game.board, 'extension6'))
    expectFreshRecord(tab().game)
    expect(tab().past).toHaveLength(before.past.length + 1)
    await click(find(container, 'Undo'))
    expect(tab().game).toBe(before.game)
  })

  it('explains exactly what Replace and New board do before randomizing', async () => {
    await play()
    await click(row('Randomize'))
    expect(container.querySelector('.confirm-dialog p')?.textContent).toBe(RANDOMIZE)
  })

  it('explains exactly what Change layout resets', async () => {
    await play()
    await click(container.querySelectorAll<HTMLButtonElement>('.layout-grid button')[1])
    expect(container.querySelector('.confirm-dialog p')?.textContent).toBe(LAYOUT)
  })
})
