// @vitest-environment jsdom
import { act, useEffect, type Dispatch } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdviceRequest, AdviceResponse, ScoredAdvice } from '../../engine/advice/protocol'
import { inferDraftState } from '../../engine/draft'
import { addPlayer, createBoard, placeBuilding, placeRoad, setMe } from '../../model/board'
import { adjustCounter, adjustHand, emptyStats, newGame, type Game } from '../../model/game'
import { axialKey, edgeEndpointVertexIds, hexVertexIds } from '../../model/coords'
import { boardGrid } from '../../model/layouts'
import { adjustDevHand, recordPlayDev, recordRoll, setActivePlayer } from '../../model/turn'
import * as turnModel from '../../model/turn'
import { RESOURCES } from '../../model/types'
import { AdviceProvider } from '../AdviceProvider'
import { AnalysisPanel } from '../AnalysisPanel'
import { BestMovesPanel } from '../BestMovesPanel'
import { BoardCanvas } from '../BoardCanvas'
import { HeaderControls } from '../HeaderControls'
import { buildingSlots } from '../placementSlots'
import { activeTab, StoreProvider, useStore, type StoreAction, type StoreState } from '../store'
import { AnalysisContext } from '../useAnalysis'

interface Seen { state: StoreState; dispatch: Dispatch<StoreAction> }
function Capture({ report }: { report(value: Seen): void }) {
  const store = useStore()
  useEffect(() => report(store), [store, report])
  return null
}

function seed(): Game {
  let board = addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' })
  board = placeBuilding(board, boardGrid(board.layout).vertexIds[0], 'aki', 'settlement')
  board = placeBuilding(board, boardGrid(board.layout).vertexIds[30], 'b', 'settlement')
  board = { ...board, ports: [], robber: { q: 0, r: 0 }, hexes: board.hexes.map((hex) => ({ ...hex, tile: 'wood', numberToken: 6 })) }
  let game = newGame(board)
  for (const id of ['aki', 'b']) for (const resource of RESOURCES) game = adjustHand(game, id, resource, 5)
  for (const kind of ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly'] as const) game = adjustDevHand(game, 'playable', kind, 1)
  return game
}

function inGameSeed(): Game {
  const game = seed()
  return { ...game, board: placeBuilding(game.board, game.board.buildings[0].vertexId, 'aki', 'city') }
}

describe('Best moves recording', () => {
  let root: Root
  let container: HTMLDivElement
  let seen: Seen
  let requests: AdviceRequest[]
  let respond: (request: AdviceRequest) => AdviceResponse
  const game = () => activeTab(seen.state).game
  const clickElement = async (element: Element | null) => {
    if (!element) throw new Error('Missing control')
    await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  }
  const button = (label: string, scope: ParentNode = container) => {
    const match = [...scope.querySelectorAll('button')].find((button) => button.textContent?.trim() === label || button.getAttribute('aria-label') === label)
    if (!match) throw new Error(`Missing button ${label}`)
    return match
  }
  const click = async (label: string, scope: ParentNode = container) => clickElement(button(label, scope))
  const tray = () => container.querySelector('.move-tray')!
  const rollStep = () => container.querySelector('.move-step')!
  const popover = () => container.querySelector('[popover]')!
  const pickHex = async (victim?: string) => {
    const hex = game().board.hexes.find(({ coord }) => axialKey(coord) !== axialKey(game().board.robber!) &&
      (victim ? game().board.buildings.some((building) => building.playerId === victim && hexVertexIds(coord).includes(building.vertexId))
        : !game().board.buildings.some((building) => hexVertexIds(coord).includes(building.vertexId))))!
    await act(async () => seen.dispatch({ type: 'picked', ref: axialKey(hex.coord) }))
    return hex.coord
  }
  const remount = async () => {
    await act(async () => root.render(<StoreProvider><AdviceProvider>
      <Capture report={(value) => { seen = value }} /><HeaderControls building={false} onToggleMode={() => {}} onOpen={() => {}} /><BoardCanvas /><BestMovesPanel key="remounted" />
    </AdviceProvider></StoreProvider>))
  }
  const skipDiscards = async () => {
    while (rollStep().querySelector('.move-discard')) await click('Skip', rollStep().querySelector('.move-discard')!)
  }
  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
    sessionStorage.clear()
    requests = []
    respond = () => ({ error: 'The advice engine is not built yet' })
    vi.stubGlobal('Worker', class {
      onmessage: ((event: MessageEvent) => void) | null = null
      postMessage({ id, request }: { id: number; request: AdviceRequest }) {
        requests.push(request)
        queueMicrotask(() => this.onmessage?.({ data: { id, response: respond(request) } } as MessageEvent))
      }
      terminate() {}
    })
    Object.defineProperties(HTMLElement.prototype, {
      showPopover: { configurable: true, value() {} },
      hidePopover: { configurable: true, value() {} },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<StoreProvider><AdviceProvider>
      <Capture report={(value) => { seen = value }} /><HeaderControls building={false} onToggleMode={() => {}} onOpen={() => {}} /><BoardCanvas /><BestMovesPanel />
    </AdviceProvider></StoreProvider>))
    await act(async () => seen.dispatch({ type: 'commit-game', game: seed() }))
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })


  it.each([null, 8])('views rival moves without changing the turn or enabling Play after roll %s', async (roll) => {
    const cards = emptyStats().hand
    const edge = boardGrid('standard4').edgeIds[0]
    const derived = { bank: cards, tradeRates: cards, devDeckRemaining: 21, unknownOwnCards: 2 }
    respond = ({ decision }) => decision.kind === 'turn'
      ? { kind: 'turn', actions: [
        { action: { type: 'buildRoad', edgeId: edge }, score: 1, reason: '', handDelta: cards },
        { action: { type: 'pass' }, score: 0, reason: '', handDelta: cards },
      ], derived }
      : { kind: 'preRoll', play: { type: 'monopoly', resource: 'ore' }, reason: '', derived }
    const initial = adjustCounter(setActivePlayer(inGameSeed(), 'aki'), 'b', 'devCards', 2)
    await act(async () => seen.dispatch({ type: 'commit-game', game: roll === null ? initial : recordRoll(initial, roll, {}) }))
    const before = activeTab(seen.state)
    requests.length = 0
    await click("View Bee's best moves")
    const sections = container.querySelectorAll('section.best-moves-panel')
    expect(sections[1].querySelector('h2')?.textContent).toBe('Record your turn')
    expect(sections[1].querySelector('[role="group"][aria-label^="Turn"]')).toBeNull()
    expect(sections[2].querySelector('h2')?.textContent).toBe('Best moves for Bee')
    expect(sections[2].textContent).toContain("Not Bee's turn. These are the moves Bee would make with this hand if their turn started now.")
    expect(sections[2].textContent).toContain("2 of Bee's cards are of unknown type and ignored")
    expect(sections[2].textContent).toContain("Bee's 2 dev cards are treated as unplayed knights")
    expect(sections[2].textContent).not.toContain('Before you roll')
    expect(requests.filter(({ decision }) => decision.kind === 'turn' || decision.kind === 'preRoll'))
      .toEqual([expect.objectContaining({ observer: 'b', decision: { kind: 'turn' } })])
    expect(activeTab(seen.state)).toBe(before)
    expect(container.querySelector('.ledger-row.active')?.textContent).toContain('aki')
    expect(button("View aki's best moves").querySelector('.head-dot.me')).not.toBeNull()
    expect(button("View aki's best moves").querySelector('.head-dot-chip')).toBeNull()
    expect(button("View Bee's best moves").getAttribute('aria-pressed')).toBe('true')
    expect(button("View Bee's best moves").querySelector('.head-dot-chip')?.textContent).toBe('Bee')
    expect(button("View Bee's best moves").querySelector('.head-dot.me')).toBeNull()
    await clickElement(sections[2].querySelector('.analysis-row-select'))
    expect(seen.state.highlight).toEqual([{ ref: edge, color: '#3063ba', kind: 'road' }])
    expect(sections[2].querySelector('.analysis-row.current')).not.toBeNull()
    expect([...sections[2].querySelectorAll('button')].some((item) => /^(Play|End turn)/.test(item.textContent ?? ''))).toBe(false)
    await clickElement(sections[2].querySelectorAll('.analysis-row-select')[1])
    expect(sections[2].textContent).not.toContain('End turn')
    expect(activeTab(seen.state)).toBe(before)
    await click("View aki's best moves")
    expect(sections[2].querySelector('.analysis-row.current')).toBeNull()
    expect(seen.state.highlight).toBeNull()
  })

  it('ends the recorded turn in seat order and resets the header view to the new turn', async () => {
    const initial = inGameSeed()
    initial.board = addPlayer(initial.board, { id: 'c', name: 'Cee', color: '#ffffff' })
    initial.stats.c = emptyStats()
    await act(async () => seen.dispatch({ type: 'commit-game', game: setActivePlayer(initial, 'b') }))
    await click("View aki's best moves")
    const sections = container.querySelectorAll('section.best-moves-panel')
    expect(sections[1].querySelector('h2')?.textContent).toBe("Record Bee's turn")
    expect(sections[2].querySelector('h2')?.textContent).toBe('Best moves')
    expect(sections[2].textContent).toContain('Not your turn. These are the moves you would make with this hand if your turn started now.')
    await click('Buy card', sections[1])
    expect(game().stats.b.devCards).toBe(1)
    expect(game().stats.aki.devCards).toBe(4)
    await click('End turn', sections[1])
    expect(game().turn?.playerId).toBe('c')
    expect(seen.state.viewedPlayer).toBeNull()
    expect(button("View Cee's best moves").getAttribute('aria-pressed')).toBe('true')
    expect(button("View Cee's best moves").querySelector('.head-dot.me.head-dot-chip')).not.toBeNull()
    expect(sections[1].querySelector('h2')?.textContent).toBe("Record Cee's turn")
    expect(sections[2].textContent).not.toContain('Not your turn')
    await click('Undo')
    expect(game().turn?.playerId).toBe('b')
    expect(button("View Bee's best moves").getAttribute('aria-pressed')).toBe('true')
  })

  it('preserves the seven suggestion across views and defers rival moves until the robber is recorded', async () => {
    const initial = setActivePlayer(inGameSeed(), 'aki')
    const hex = initial.board.hexes.find(({ coord }) => axialKey(coord) !== '0,0')!.coord
    const cards = emptyStats().hand
    const derived = { bank: cards, tradeRates: cards, devDeckRemaining: 21, unknownOwnCards: 0 }
    respond = ({ decision }) => decision.kind === 'robber'
      ? { kind: 'robber', hex, victim: 'b', reason: 'Block wood', derived }
      : decision.kind === 'turn'
        ? { kind: 'turn', actions: [{ action: { type: 'buyDev' }, score: 1, reason: '', handDelta: cards }], derived }
        : { error: 'Unavailable' }
    await act(async () => seen.dispatch({ type: 'commit-game', game: recordRoll(initial, 7, {}) }))
    await skipDiscards()
    const marks = [{ ref: axialKey(hex), kind: 'hex', color: initial.board.players[0].color }]
    expect(seen.state.highlight).toEqual(marks)
    requests.length = 0
    await click("View Bee's best moves")
    const advice = container.querySelectorAll('section.best-moves-panel')[2]
    expect(seen.state.highlight).toEqual(marks)
    expect(advice.textContent).toContain('Record the discards and the robber above. The ranked moves follow.')
    expect(advice.querySelector('.analysis-row')).toBeNull()
    expect(requests.filter(({ observer, decision }) => observer === 'b' && decision.kind === 'turn')).toEqual([])
    await click("View aki's best moves")
    expect(seen.state.highlight).toEqual(marks)
    expect(container.querySelectorAll('.hex-highlight')).toHaveLength(1)
  })

  it('keeps the Knight suggestion pinned while hovering rival moves and switching views', async () => {
    const initial = setActivePlayer(inGameSeed(), 'aki')
    const hex = initial.board.hexes.find(({ coord }) => axialKey(coord) !== '0,0')!.coord
    const cards = emptyStats().hand
    const derived = { bank: cards, tradeRates: cards, devDeckRemaining: 21, unknownOwnCards: 0 }
    respond = ({ decision }) => decision.kind === 'robber'
      ? { kind: 'robber', hex, victim: 'b', reason: 'Block wood', derived }
      : decision.kind === 'turn'
        ? { kind: 'turn', actions: [{ action: { type: 'buildRoad', edgeId: boardGrid('standard4').edgeIds[0] }, score: 1, reason: '', handDelta: cards }], derived }
        : { error: 'Unavailable' }
    await act(async () => seen.dispatch({ type: 'commit-game', game: initial }))
    await click('Play card')
    await click('Knight', tray())
    const marks = [{ ref: axialKey(hex), kind: 'hex', color: initial.board.players[0].color }]
    expect(seen.state.highlight).toEqual(marks)
    await click("View Bee's best moves")
    expect(seen.state.highlight).toEqual(marks)
    const row = container.querySelector('.analysis-row-select')!
    expect(row).not.toBeNull()
    await act(async () => row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(seen.state.highlight).toEqual(marks)
    await act(async () => row.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
    expect(seen.state.highlight).toEqual(marks)
    await click("View aki's best moves")
    expect(seen.state.highlight).toEqual(marks)
  })

  it('closes an open tray when batched undo crosses End turn', async () => {
    const initial = game()
    await click('8')
    await click('End turn')
    expect(game().turn?.playerId).toBe('b')
    await click('Trade')
    expect(tray()).not.toBeNull()
    await act(async () => {
      seen.dispatch({ type: 'undo' })
      seen.dispatch({ type: 'undo' })
    })
    expect(game()).toBe(initial)
    expect(tray()).toBeNull()
  })

  it('starts seat one when there is no turn and nobody is claimed', async () => {
    const initial = seed()
    await act(async () => seen.dispatch({ type: 'commit-game', game: { ...initial, board: setMe(initial.board, null) } }))
    expect(game().turn).toBeUndefined()
    expect(button('Start game').classList.contains('primary')).toBe(true)
    expect(container.querySelector('[role="group"][aria-label^="Turn"]')).toBeNull()
    await click('Start game')
    expect(game().turn?.playerId).toBe('aki')
    expect(game().board.mePlayerId).toBeNull()
    expect(container.textContent).toContain("Record aki's turn")
  })

  it('arms a saved pending seven with empty undo history and does not re-arm after a later Knight', async () => {
    const saved = recordRoll(seed(), 7, {})
    for (const id of ['aki', 'b']) saved.stats[id] = { ...saved.stats[id], hand: emptyStats().hand }
    await act(async () => seen.dispatch({ type: 'tab-add', game: JSON.parse(JSON.stringify(saved)) }))
    expect(activeTab(seen.state).past).toEqual([])
    expect(seen.state.pick?.want).toBe('hex')
    expect(container.querySelectorAll('.move-tile')).toHaveLength(0)
    await pickHex()
    expect(game().turn?.robberMoved).toBe(true)
    await act(async () => seen.dispatch({ type: 'commit-game', game: recordPlayDev(game(), {
      kind: 'knight', hex: saved.board.robber!, victimId: null, stolen: null,
    }) }))
    expect(seen.state.pick).toBeNull()
    await remount()
    expect(seen.state.pick).toBeNull()
  })

  it('waits for every discard to be recorded or skipped before arming a seven', async () => {
    await click('7')
    const before = game()
    expect(container.querySelectorAll('.move-tile')).toHaveLength(0)
    expect(container.querySelectorAll('.blink')).toHaveLength(0)
    expect(container.querySelector('.move-robber')).toBeNull()
    expect(seen.state.pick).toBeNull()
    await pickHex()
    expect(game()).toBe(before)
    await click('Record', rollStep().querySelector('[aria-label="Bee\'s discard"]')!)
    expect(seen.state.pick).toBeNull()
    await skipDiscards()
    expect(seen.state.pick?.want).toBe('hex')
    expect(container.querySelectorAll('.blink')).toHaveLength(game().board.hexes.length - 1)
    await pickHex()
    expect(game().turn?.robberMoved).toBe(true)
  })

  it('disables every player trade party when the two resource rows overlap', async () => {
    const current = game()
    await act(async () => seen.dispatch({ type: 'commit-game', game: { ...current,
      board: addPlayer(current.board, { id: 'c', name: 'Cee', color: '#fff' }), stats: { ...current.stats, c: emptyStats() },
    } }))
    await click('Trade')
    await click('Gives wood')
    await click('Gives sheep')
    await click('Gets ore')
    expect(button('Bee', tray()).disabled).toBe(false)
    await click('Gets sheep')
    expect(button('Bee', tray()).disabled).toBe(true)
    expect(button('Cee', tray()).disabled).toBe(true)
    const before = game()
    await click('Bee', tray())
    expect(game()).toBe(before)
  })

  it('records mixed port lots exactly and undoes the newest log entry', async () => {
    await act(async () => seen.dispatch({ type: 'commit-game', game: setActivePlayer(game(), 'aki') }))
    const ports = createBoard('standard4').ports.slice(0, 2).map((port, index) => ({ ...port, resource: index === 0 ? 'ore' as const : null, rate: index === 0 ? 2 : 3 }))
    let board: Game['board'] = { ...game().board, buildings: [], ports }
    for (const port of ports) board = placeBuilding(board, edgeEndpointVertexIds(port.edgeId)[0], 'aki', 'settlement')
    await act(async () => seen.dispatch({ type: 'commit-game', game: { ...game(), board } }))
    const before = game()
    await click('Trade')
    expect(tray().querySelector('[aria-label="Clear"]')).toBeNull()
    const portButton = () => button('Port 3:1 · 2:1', tray())
    expect(portButton().querySelector('.stat-icon')).not.toBeNull()
    for (let count = 0; count < 4; count += 1) await click('Gives ore')
    for (let count = 0; count < 3; count += 1) await click('Gives wood')
    await click('Gets brick')
    expect(portButton().disabled).toBe(true)
    await click('Gets brick')
    expect(portButton().disabled).toBe(true)
    await click('Gets brick')
    expect(portButton().disabled).toBe(false)
    await click('One fewer ore', tray().querySelector('[aria-label="Gives"]')!)
    expect(portButton().disabled).toBe(true)
    await click('Gives ore')
    await clickElement(portButton())
    expect(game().stats.aki.hand).toMatchObject({ ore: 1, wood: 2, brick: 8 })
    expect(game().stats.b).toBe(before.stats.b)
    const log = container.querySelector('.move-log')!
    expect(log.querySelector('li > span')?.textContent).toBe('Traded 4 ore and 3 wood to the port for 3 brick')
    expect(log.querySelectorAll('button')).toHaveLength(1)
    expect(button('Undo', log).querySelector('svg')).not.toBeNull()
    await click('Undo', log)
    expect(game()).toBe(before)
    expect(container.querySelector('.move-log')).toBeNull()
  })

  it('bounds both trade hands by the total missing cards, not each resource separately', async () => {
    const stats = { ...emptyStats(), hand: { ...emptyStats().hand, ore: 1 }, handUnknown: 1 }
    await act(async () => seen.dispatch({ type: 'commit-game', game: { ...game(), stats: { ...game().stats, b: stats } } }))
    await click('Trade')
    await click('Gives wood')
    await click('Gets ore')
    await click('Gets ore')
    expect(button('Bee', tray()).disabled).toBe(false)
    await click('Gets brick')
    expect(button('Bee', tray()).disabled).toBe(true)
    expect(button('Bee', tray()).title).toContain('cannot hold')
    const before = game()
    await click('Bee', tray())
    expect(game()).toBe(before)
    await click('One fewer ore', tray().querySelector('[aria-label="Gets"]')!)
    expect(button('Bee', tray()).disabled).toBe(false)
    await click('Bee', tray())
    expect(game().stats.b).toMatchObject({ hand: { ore: 0, wood: 1 }, handUnknown: 0 })
    await click('Undo')
    await click('End turn')
    await click('Trade')
    expect(button('Gives ore').textContent).toBe('0')
    await click('Gives wood')
    expect(button('Gives brick').disabled).toBe(true)
    expect(button('Gives ore').disabled).toBe(false)
    await click('Gives ore')
    expect(button('Gives ore').disabled).toBe(true)
    await click('One fewer wood', tray())
    expect(button('Gives brick').disabled).toBe(false)
  })

  it('shows log Undo only on the newest entry when the current game is a recorded action', async () => {
    await click('Buy card')
    await click('Victory point', tray())
    const bought = game()
    await click('Buy card')
    await click('Knight', tray())
    const entries = container.querySelectorAll('.move-log li')
    expect(entries).toHaveLength(2)
    expect(entries[0].querySelector('button')).toBeNull()
    await click('Undo', entries[1])
    expect(game()).toBe(bought)
    await click('Correct aki')
    await clickElement(container.querySelector('.ledger-add'))
    expect(container.querySelector('.move-log button')).toBeNull()
  })

  it('takes back the last Road building slot without recording or spending the card', async () => {
    const before = game()
    await click('Play card')
    await click('Road building', tray())
    const slots = () => [...tray().querySelectorAll('.move-road-slot')].map((slot) => slot.textContent)
    expect(slots()).toEqual(['Road 1: tap a spot', 'Road 2'])
    expect(button('Record 0 roads').disabled).toBe(false)
    expect(button('Record 0 roads').classList.contains('primary')).toBe(false)
    await clickElement(container.querySelector('.placement-slot'))
    expect(slots()).toEqual(['Road 1 placed', 'Road 2: tap a spot'])
    await click('Take back road 1')
    expect(slots()).toEqual(['Road 1: tap a spot', 'Road 2'])
    expect(game()).toBe(before)
    await clickElement(container.querySelector('.placement-slot'))
    await clickElement(container.querySelector('.placement-slot'))
    expect(game().board.roads).toHaveLength(2)
  })

  it('keeps recorded and skipped discards through a remount, including hands still above seven', async () => {
    await click('7')
    await click('Record', rollStep().querySelector('[aria-label="Bee\'s discard"]')!)
    await remount()
    expect(rollStep().querySelectorAll('.move-discard')).toHaveLength(1)
    expect(rollStep().querySelector('.move-discard')?.getAttribute('aria-label')).toBe("aki's discard")
    expect(seen.state.pick).toBeNull()
    await skipDiscards()
    const tabId = activeTab(seen.state).id
    await act(async () => seen.dispatch({ type: 'tab-add' }))
    await act(async () => seen.dispatch({ type: 'tab-select', id: tabId }))
    expect(rollStep().querySelectorAll('.move-discard')).toHaveLength(0)
    expect(seen.state.pick?.want).toBe('hex')
  })

  it('keeps the log and production through remount, tab switches and undoing End turn', async () => {
    respond = () => ({ kind: 'produce', gains: { aki: { ...emptyStats().hand, wood: 2 } } })
    await click('8')
    await click('Buy card')
    await click('Victory point', tray())
    await remount()
    expect(rollStep().querySelector('.move-prod-cards')?.getAttribute('aria-label')).toBe('2 wood')
    expect(container.querySelector('.move-log li > span')?.textContent).toBe('Bought a dev card')
    const tabId = activeTab(seen.state).id
    await act(async () => seen.dispatch({ type: 'tab-add' }))
    await act(async () => seen.dispatch({ type: 'tab-select', id: tabId }))
    expect(container.querySelector('.move-log li > span')?.textContent).toBe('Bought a dev card')
    await click('End turn')
    expect(container.querySelector('.move-log')).toBeNull()
    expect(rollStep().querySelector('.move-prod')).toBeNull()
    await click('Undo')
    expect(container.querySelector('.move-log li > span')?.textContent).toBe('Bought a dev card')
    expect(rollStep().querySelector('.move-prod-cards')?.getAttribute('aria-label')).toBe('2 wood')
    await act(async () => seen.dispatch({ type: 'tab-add', game: JSON.parse(JSON.stringify(game())) }))
    expect(container.querySelector('.move-log li > span')?.textContent).toBe('Bought a dev card')
    expect(container.querySelector('.move-log button')).toBeNull()
    expect(rollStep().querySelector('.move-prod')).toBeNull()
    expect(rollStep().textContent).toBe('Rolled 8')
  })

  it('shows production when award tracking replaces the committed game', async () => {
    await act(async () => seen.dispatch({ type: 'commit-game', game: adjustCounter(game(), 'aki', 'knights', 3) }))
    const original = recordRoll
    let submitted: Game | undefined
    const recorder = vi.spyOn(turnModel, 'recordRoll').mockImplementationOnce((...args) => {
      submitted = original(...args)
      delete submitted.awards
      return submitted
    })
    respond = () => ({ kind: 'produce', gains: { aki: { ...emptyStats().hand, ore: 1 } } })
    try {
      await click('8')
    } finally {
      recorder.mockRestore()
    }
    expect(submitted?.awards).toBeUndefined()
    expect(game()).not.toBe(submitted)
    expect(game().awards).toBeDefined()
    expect(rollStep().querySelector('.move-prod-cards')?.getAttribute('aria-label')).toBe('1 ore')
  })

  it('caps Monopoly at each rival known resource plus unknown cards', async () => {
    await act(async () => seen.dispatch({ type: 'commit-game', game: adjustCounter(game(), 'b', 'handUnknown', 2) }))
    await click('Play card')
    await click('Monopoly', tray())
    await click('Named resource ore')
    expect(tray().textContent).toContain('How many did each player give?')
    expect(tray().querySelector('.move-monopoly-player small')?.textContent).toBe('of 5\u20137')
    expect(tray().querySelector('.move-monopoly-player')?.classList.contains('has-cards')).toBe(true)
    expect(button('One more from Bee').disabled).toBe(false)
    await click('One more from Bee')
    await click('One more from Bee')
    expect(button('One more from Bee').disabled).toBe(true)
    await click('One more from Bee')
    expect(button('One more from Bee').textContent).toBe('7')
    expect(tray().textContent).toContain('Takes 7 ore')
    expect(button('Record', tray()).classList.contains('primary')).toBe(false)
    await click('Record', tray())
    expect(game().stats.b.hand.ore).toBe(0)
    expect(game().stats.b.handUnknown).toBe(0)
    expect(game().stats.aki.hand.ore).toBe(12)
  })

  it('closes a tray and Knight flow on undo and keeps them closed after redo', async () => {
    await click('8')
    await click('Trade')
    await click('Undo')
    expect(tray()).toBeNull()
    await click('Redo')
    await click('Play card')
    await click('Knight', tray())
    expect(seen.state.pick?.want).toBe('hex')
    await click('Undo')
    expect(seen.state.pick).toBeNull()
    await click('Redo')
    expect(seen.state.pick).toBeNull()
    expect(container.querySelector('.move-robber')).toBeNull()
  })

  it('keeps Actions open when an open tray or Knight has no remaining tile', async () => {
    await click('8')
    const emptyHand = () => ({ ...game(), stats: { ...game().stats, aki: emptyStats() }, devHand: undefined })
    await click('Trade')
    await act(async () => seen.dispatch({ type: 'commit-game', game: emptyHand() }))
    expect(container.querySelectorAll('.move-tile')).toHaveLength(0)
    expect(container.textContent).not.toContain('No actions possible')
    await click('Undo')
    await click('Play card')
    await click('Knight', tray())
    await act(async () => seen.dispatch({ type: 'commit-game', game: emptyHand() }))
    expect(container.querySelectorAll('.move-tile')).toHaveLength(0)
    expect(container.textContent).not.toContain('No actions possible')
  })

  it('clears the first Year of plenty resource and still takes two of one resource', async () => {
    await click('Play card')
    await click('Year of plenty', tray())
    const before = game()
    await click('Takes wood')
    expect(button('Takes wood').getAttribute('aria-pressed')).toBe('true')
    await click('One fewer wood', tray())
    expect(button('Takes wood').getAttribute('aria-pressed')).toBe('false')
    expect(tray().textContent).not.toContain('First:')
    expect(game()).toBe(before)
    await click('Takes ore')
    await click('Takes ore')
    expect(game().stats.aki.hand).toMatchObject({ ore: 7, wood: 5 })
    expect(container.querySelector('.move-log li > span')?.textContent).toBe('Played Year of plenty · Ore and ore')
  })

  it('names the active player in questions and shows full card labels with glyphs', async () => {
    await click('Buy card')
    expect(tray().querySelector('.move-question')?.textContent).toBe('Which card did you draw?')
    expect([...tray().querySelectorAll('.move-card-choices button')].map((item) => item.textContent)).toEqual(['Knight', 'Road building', 'Year of plenty', 'Monopoly', 'Victory point'])
    expect(tray().querySelectorAll('.move-card-choices button > svg')).toHaveLength(5)
    await act(async () => seen.dispatch({ type: 'commit-game', game: adjustCounter(game(), 'b', 'devCards', 1) }))
    await click('End turn')
    await click('Play card')
    expect(tray().querySelector('.move-question')?.textContent).toBe('Which card did Bee play?')
    await click('Year of plenty', tray())
    expect(tray().textContent).toContain('Which two cards did Bee take?')
    await click('Monopoly', tray())
    expect(tray().textContent).toContain('Which resource did Bee name?')
    await click('Knight', tray())
    expect(container.querySelector('.move-robber .move-question')?.textContent).toBe('Where did the robber go?Tap its new number on the board')
    await click('Build')
    expect(tray().querySelector('.move-question')?.textContent).toBe('What did Bee build?')
    await clickElement(tray().querySelector('.move-build-road'))
    expect(tray().textContent).toContain('Where is the new road?Tap its spot on the board')
    expect(tray().querySelector('.move-build-road rect')?.getAttribute('fill')).toBe('#3063ba')
    expect(tray().querySelector('.move-piece-cost [aria-label="1 wood"]')).not.toBeNull()
  })

  it('retains the empty deck count while new advice is pending and resets it on a tab switch', async () => {
    const cards = emptyStats().hand
    respond = () => ({ kind: 'preRoll', play: null, reason: '', derived: { bank: cards, tradeRates: cards, devDeckRemaining: 0, unknownOwnCards: 0 } })
    await click('Retry advice')
    expect([...container.querySelectorAll('.move-tile')].some((tile) => tile.textContent === 'Buy card')).toBe(false)
    respond = () => ({ error: 'Unavailable' })
    act(() => seen.dispatch({ type: 'commit-game', game: adjustHand(game(), 'aki', 'wood', 1) }))
    expect(container.textContent).toContain('Getting advice')
    expect([...container.querySelectorAll('.move-tile')].some((tile) => tile.textContent === 'Buy card')).toBe(false)
    await act(async () => {})
    await act(async () => seen.dispatch({ type: 'tab-add', game: seed() }))
    expect([...container.querySelectorAll('.move-tile')].some((tile) => tile.textContent === 'Buy card')).toBe(true)
  })

  it('renders separate Ledger, record and advice sections with the approved headings and notes', async () => {
    const cards = emptyStats().hand
    respond = () => ({ kind: 'preRoll', play: null, reason: '', derived: { bank: cards, tradeRates: cards, devDeckRemaining: 21, unknownOwnCards: 0 } })
    await click('Retry advice')
    const sections = container.querySelectorAll('section.best-moves-panel')
    expect([...sections].map((section) => section.querySelector('h2')?.textContent)).toEqual(['Ledger', 'Record your turn', 'Best moves'])
    expect(sections[0].querySelector('[aria-label="Undo"]')).toBeNull()
    expect(sections[1].querySelector('[aria-label="Undo"]')).not.toBeNull()
    expect(sections[2].querySelector('[aria-label="Undo"]')).toBeNull()
    expect(container.textContent).not.toContain('Dev deck:')
    expect(container.textContent).not.toContain('Super cities count')
    expect(container.querySelectorAll('ol.move-steps > li')).toHaveLength(3)
    await click('End turn')
    expect(sections[1].querySelector('h2')?.textContent).toBe("Record Bee's turn")
  })

  it('says in one sentence when no dev card is worth playing before the roll', async () => {
    const cards = emptyStats().hand
    respond = () => ({ kind: 'preRoll', play: null, reason: '', derived: { bank: cards, tradeRates: cards, devDeckRemaining: 21, unknownOwnCards: 0 } })
    await click('Retry advice')
    const advice = container.querySelectorAll('section.best-moves-panel')[2]
    expect(advice.querySelector('.analysis-row')).toBeNull()
    expect(advice.textContent).toContain('No dev card worth playing first.')
    expect(advice.textContent).toContain('Ranked trades, builds and cards follow the roll.')
    expect(advice.textContent).not.toContain('Your best moves')
    expect(advice.textContent).not.toContain('Hold your dev cards')
    await click('End turn')
    expect(container.querySelectorAll('section.best-moves-panel')[2].querySelector('h2')?.textContent).toBe('Best moves for Bee')
  })

  it('offers a worthwhile pre-roll Knight as one row whose Play opens the prefilled robber flow', async () => {
    const cards = emptyStats().hand
    const hex = game().board.hexes.find(({ coord }) => axialKey(coord) !== '0,0')!.coord
    respond = () => ({ kind: 'preRoll', play: { type: 'playKnight', hex, victim: 'b' }, reason: 'Blocks 6 pips of Bee',
      derived: { bank: cards, tradeRates: cards, devDeckRemaining: 21, unknownOwnCards: 0 } })
    await click('Retry advice')
    const advice = container.querySelectorAll('section.best-moves-panel')[2]
    const row = advice.querySelector('.analysis-row')!
    expect(advice.querySelectorAll('.analysis-row')).toHaveLength(1)
    expect(row.className).not.toContain('move-dashed')
    expect(row.textContent).toContain('Before you roll')
    expect(row.textContent).toContain('Blocks 6 pips of Bee')
    expect(advice.textContent).not.toContain('No dev card worth playing first.')
    expect(advice.textContent).toContain('Ranked trades, builds and cards follow the roll.')
    await click('Play', row)
    expect(container.querySelector('.move-robber')?.textContent).toContain('Suggested:')
    expect(container.querySelectorAll('.hex-highlight')).toHaveLength(1)
  })

  it('names Play after its row and records pre-roll Road building in one tap', async () => {
    const cards = emptyStats().hand
    const corner = boardGrid(game().board.layout).vertexIds[0]
    const [first, second] = boardGrid(game().board.layout).edgeIds.filter((edge) => edgeEndpointVertexIds(edge).includes(corner))
    respond = () => ({ kind: 'preRoll', play: { type: 'roadBuilding', first, second }, reason: '',
      derived: { bank: cards, tradeRates: cards, devDeckRemaining: 21, unknownOwnCards: 0 } })
    await click('Retry advice')
    const row = () => container.querySelector('.analysis-row')!
    expect(button('Play', row()).getAttribute('aria-label')).toContain('Play Road building')
    await click('Play', row())
    expect(game().board.roads).toHaveLength(2)
  })

  it('does not say no card is worth playing once one was played before the roll', async () => {
    const cards = emptyStats().hand
    respond = () => ({ kind: 'preRoll', play: null, reason: '', derived: { bank: cards, tradeRates: cards, devDeckRemaining: 21, unknownOwnCards: 0 } })
    await act(async () => seen.dispatch({ type: 'commit-game', game: recordPlayDev(game(), { kind: 'yearOfPlenty', resources: ['wood', 'ore'] }) }))
    const advice = container.querySelectorAll('section.best-moves-panel')[2]
    expect(advice.textContent).not.toContain('No dev card worth playing first.')
    expect(advice.textContent).toContain('Ranked trades, builds and cards follow the roll.')
  })

  it('lists ranked moves as ledger rows without the old label', async () => {
    const cards = { wood: 0, sheep: 0, wheat: 0, brick: 0, ore: 0 }
    const derived = { bank: cards, tradeRates: { wood: 4, sheep: 4, wheat: 4, brick: 4, ore: 4 }, devDeckRemaining: 21, unknownOwnCards: 0 }
    respond = ({ decision }) => decision.kind === 'preRoll' ? { kind: 'preRoll', play: null, reason: '', derived }
      : { kind: 'turn', actions: [{ action: { type: 'pass' }, score: 0, reason: 'Ends the turn', handDelta: cards }], derived }
    await act(async () => seen.dispatch({ type: 'commit-game', game: recordRoll(game(), 8, {}) }))
    const advice = container.querySelectorAll('section.best-moves-panel')[2]
    expect(advice.querySelector('h2')?.textContent).toBe('Best moves')
    expect(advice.querySelector('.move-label')).toBeNull()
    expect(advice.querySelector('.analysis-list')?.classList.contains('pick-ledger')).toBe(true)
    expect(advice.querySelector('.analysis-row .analysis-rank')?.textContent).toBe('1')
    expect(advice.textContent).not.toContain('follow the roll')
  })

  it('draws a build\'s spot as tiles beside a title without the place', async () => {
    const cards = { wood: 0, sheep: 0, wheat: 0, brick: 0, ore: 0 }
    const derived = { bank: cards, tradeRates: { wood: 4, sheep: 4, wheat: 4, brick: 4, ore: 4 }, devDeckRemaining: 21, unknownOwnCards: 0 }
    const edgeId = boardGrid(game().board.layout).edgeIds[0]
    respond = ({ decision }) => decision.kind === 'preRoll' ? { kind: 'preRoll', play: null, reason: '', derived }
      : { kind: 'turn', actions: [
        { action: { type: 'buildRoad', edgeId }, score: 2, reason: 'Reaches a spot', handDelta: { ...cards, wood: -1, brick: -1 } },
        { action: { type: 'pass' }, score: 0, reason: 'Ends the turn', handDelta: cards },
      ], derived }
    await act(async () => seen.dispatch({ type: 'commit-game', game: recordRoll(game(), 8, {}) }))
    const [road, pass] = container.querySelectorAll('.moves-panel .analysis-row')
    expect(road.querySelector('strong')?.textContent).toBe('Build road')
    expect(road.querySelector('.move-spot svg.spot-tiles-small')?.getAttribute('aria-label')).toBeTruthy()
    expect(pass.querySelector('strong')?.textContent).toBe('Pass')
    expect(pass.querySelector('.move-spot')).toBeNull()
  })

  it('scrolls only the list to a selected row, and drops the selection when History opens', async () => {
    const cards = { wood: 0, sheep: 0, wheat: 0, brick: 0, ore: 0 }
    const derived = { bank: cards, tradeRates: { wood: 4, sheep: 4, wheat: 4, brick: 4, ore: 4 }, devDeckRemaining: 21, unknownOwnCards: 0 }
    respond = ({ decision }) => decision.kind === 'preRoll' ? { kind: 'preRoll', play: null, reason: '', derived }
      : { kind: 'turn', actions: [{ action: { type: 'pass' }, score: 0, reason: 'Ends the turn', handDelta: cards }], derived }
    await act(async () => seen.dispatch({ type: 'commit-game', game: recordRoll(game(), 8, {}) }))
    const body = container.querySelector<HTMLElement>('.moves-body')!
    const row = body.querySelector('.analysis-row')!
    Object.defineProperties(body, { clientHeight: { value: 80 }, scrollHeight: { value: 400 } })
    Object.defineProperties(row, { offsetTop: { value: 300 }, offsetHeight: { value: 60 } })
    document.documentElement.scrollTop = 37
    await clickElement(row.querySelector('.analysis-row-select'))
    expect(body.scrollTop).toBe(280)
    expect(document.documentElement.scrollTop).toBe(37)
    expect(row.querySelector('.analysis-touch-actions')?.textContent).toBe('End turnClear')
    await click('History')
    await click('Close history')
    expect(container.querySelector('.analysis-row.current')).toBeNull()
  })

  it('shows playable dev cards only, and hides the tile after playing', async () => {
    await click('End turn')
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'Play card')).toBe(false)
    await click('Buy card')
    expect([...container.querySelectorAll('.move-tile')].some((tile) => tile.textContent === 'Play card')).toBe(false)
    await click('Undo')
    await act(async () => seen.dispatch({ type: 'commit-game', game: adjustCounter(game(), 'b', 'devCards', 1) }))
    await click('Buy card')
    await click('Play card')
    expect(tray().querySelectorAll('[aria-label="Played card"] button')).toHaveLength(4)
    await click('Year of plenty', tray())
    await click('Takes wood')
    await click('Takes ore')
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'Play card')).toBe(false)
    await click('End turn')
    let current = game()
    for (const kind of ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly'] as const) current = adjustDevHand(current, 'playable', kind, -1)
    current = adjustDevHand(current, 'bought', 'knight', 1)
    await act(async () => seen.dispatch({ type: 'commit-game', game: current }))
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'Play card')).toBe(false)
  })

  it('drops an undone action from the log and restores it on redo', async () => {
    await click('Buy card')
    await click('Victory point', tray())
    expect(container.querySelector('.move-log li > span')?.textContent).toBe('Bought a dev card')
    await click('Undo')
    expect(container.querySelector('.move-log li > span')?.textContent ?? '').toBe('')
    await click('Redo')
    expect(container.querySelector('.move-log li > span')?.textContent).toBe('Bought a dev card')
    await click('End turn')
    expect(container.querySelector('.move-log li > span')?.textContent ?? '').toBe('')
  })

  it('records rival-on-rival theft on the name tap and asks for a card when you are the victim', async () => {
    const board = addPlayer(game().board, { id: 'c', name: 'Cee', color: '#fff' })
    await act(async () => seen.dispatch({ type: 'commit-game', game: { ...game(), board, stats: { ...game().stats, c: emptyStats() } } }))
    await act(async () => seen.dispatch({ type: 'commit-game', game: setActivePlayer(game(), 'c') }))
    await click('7')
    await skipDiscards()
    const before = game()
    const hex = await pickHex('b')
    expect(popover().textContent).toContain('Cee stole from')
    expect(popover().textContent).toContain('25 cards')
    await clickElement([...popover().querySelectorAll('button')].find((button) => button.textContent?.includes('Bee'))!)
    expect(game().board.robber).toEqual(hex)
    expect(game().stats.c.handUnknown).toBe(1)
    expect(popover()).toBeNull()
    await click('Undo')
    expect(game()).toBe(before)
    await pickHex('aki')
    await clickElement([...popover().querySelectorAll('button')].find((button) => button.textContent?.includes('aki'))!)
    expect(popover().textContent).toContain('What did Cee take from you?')
    await click('Back', popover())
    expect(popover().textContent).toContain('Cee stole from')
    await clickElement([...popover().querySelectorAll('button')].find((button) => button.textContent?.includes('aki'))!)
    await click('ore', popover())
    expect(game().stats.aki.hand.ore).toBe(4)
    expect(game().stats.c.hand.ore).toBe(1)
  })

  it('re-arms a hex pick after native light-dismiss and allows Nobody', async () => {
    await click('7')
    await skipDiscards()
    const before = game()
    await pickHex('b')
    await act(async () => {
      const event = new Event('toggle')
      Object.defineProperty(event, 'newState', { value: 'closed' })
      popover().dispatchEvent(event)
    })
    expect(popover()).toBeNull()
    expect(game()).toBe(before)
    expect(seen.state.pick?.want).toBe('hex')
    await pickHex('b')
    await click('Nobody', popover())
    expect(game().stats).toBe(before.stats)
    expect(seen.state.pick).toBeNull()
  })

  it('keeps a logged Knight when the store awards Largest Army', async () => {
    await act(async () => seen.dispatch({ type: 'commit-game', game: adjustCounter(game(), 'aki', 'knights', 2) }))
    await click('Play card')
    await click('Knight', tray())
    await pickHex()
    expect(game().awards?.largestArmy).toBe('aki')
    expect(container.querySelector('.move-log li > span')?.textContent).toContain('Played Knight')
    await click('Undo')
    expect(game().stats.aki.knights).toBe(2)
    expect(container.querySelector('.move-log li > span')?.textContent ?? '').toBe('')
  })

  it('rings seven advice automatically and records the claimed mover on the resource tap', async () => {
    const hex = game().board.hexes.find(({ coord }) => axialKey(coord) !== '0,0' &&
      game().board.buildings.some((building) => building.playerId === 'b' && hexVertexIds(coord).includes(building.vertexId)))!.coord
    const cards = emptyStats().hand
    respond = ({ decision }) => decision.kind === 'robber'
      ? { kind: 'robber', hex, victim: 'b', reason: 'Block wood', derived: { bank: cards, tradeRates: cards, devDeckRemaining: 21, unknownOwnCards: 0 } }
      : { error: 'Unavailable' }
    await click('7')
    await skipDiscards()
    expect(container.querySelectorAll('.hex-highlight')).toHaveLength(1)
    expect(container.textContent).toContain('steal from Bee. Block wood')
    const before = game()
    await pickHex('b')
    await clickElement([...popover().querySelectorAll('button')].find((button) => button.textContent?.includes('Bee'))!)
    expect(game()).toBe(before)
    await click('wood', popover())
    expect(game().stats.aki.hand.wood).toBe(6)
    expect(game().stats.b.hand.wood).toBe(4)
    expect(popover()).toBeNull()
    expect(seen.state.pick).toBeNull()
    expect(container.querySelector('.move-log li > span')?.textContent).toContain('Stole from Bee')
    await click('Undo')
    expect(game()).toBe(before)
  })

  it('never brings back an undone change on the Ledger Undo line', async () => {
    await click('Correct aki')
    await click('Add one Wood, now 5')
    const status = () => container.querySelector('.ledger-status')!
    await click('Undo', status())
    // The same game is back on top of the stack under a change made elsewhere.
    await act(async () => seen.dispatch({ type: 'commit-game', game: adjustCounter(game(), 'b', 'knights', 1) }))
    expect(status().textContent).not.toContain('Added one Wood')
    expect(status().querySelector('button')).toBeNull()
  })

  it('prefills trade advice for a single party tap', async () => {
    const cards = emptyStats().hand
    respond = () => ({ kind: 'turn', actions: [{ action: { type: 'offerTrade', give: 'wood', get: 'ore', count: 2 }, score: 1, reason: '', handDelta: cards }],
      derived: { bank: cards, tradeRates: cards, devDeckRemaining: 21, unknownOwnCards: 0 } })
    await act(async () => seen.dispatch({ type: 'commit-game', game: recordRoll(game(), 8, {}) }))
    await clickElement(container.querySelector('.analysis-row-select'))
    await click('Play')
    expect(button('Gives wood').textContent).toBe('2/5')
    expect(button('Gets ore').textContent).toBe('1')
    await click('Bee', tray())
    expect(game().stats.aki.hand).toMatchObject({ wood: 3, ore: 6 })
    expect(game().stats.b.hand).toMatchObject({ wood: 7, ore: 4 })
  })

  it('prefills Monopoly advice from known hands and shows only playable kinds', async () => {
    const cards = emptyStats().hand
    respond = () => ({ kind: 'preRoll', play: { type: 'monopoly', resource: 'ore' }, reason: '',
      derived: { bank: cards, tradeRates: cards, devDeckRemaining: 21, unknownOwnCards: 0 } })
    await act(async () => seen.dispatch({ type: 'commit-game', game: adjustDevHand(game(), 'playable', 'knight', -1) }))
    await click('Play', container.querySelector('.analysis-row')!)
    expect([...tray().querySelectorAll('[aria-label="Played card"] button')].map((button) => button.textContent)).toEqual(['Road building', 'Year of plenty', 'Monopoly'])
    expect(button('Named resource ore').getAttribute('aria-pressed')).toBe('true')
    expect(button('One more from Bee').textContent).toBe('5')
    await click('Record', tray())
    expect(game().stats.aki.hand.ore).toBe(10)
    expect(game().stats.b.hand.ore).toBe(0)
  })

  it('records Road building with zero or one road and resets a reopened tray', async () => {
    await click('Play card')
    await click('Road building', tray())
    await click('Record 0 roads')
    expect(game().board.roads).toHaveLength(0)
    expect(game().turn?.devPlayed).toBe(true)
    await click('Undo')
    await click('Play card')
    await click('Road building', tray())
    await clickElement(container.querySelector('.placement-slot'))
    await click('Record 1 road')
    expect(game().board.roads).toHaveLength(1)
    await click('Trade')
    await click('Gives wood')
    await click('Trade')
    expect(tray()).toBeNull()
    await click('Trade')
    expect(button('Gives wood').textContent).toBe('0/5')
  })

  it('keeps a completed seven done through remount and tab changes, then follows undo and redo', async () => {
    await click('7')
    await skipDiscards()
    await pickHex()
    const tabId = activeTab(seen.state).id
    await act(async () => root.render(<StoreProvider><AdviceProvider>
      <Capture report={(value) => { seen = value }} /><HeaderControls building={false} onToggleMode={() => {}} onOpen={() => {}} /><BoardCanvas /><BestMovesPanel key="remount" />
    </AdviceProvider></StoreProvider>))
    expect(seen.state.pick).toBeNull()
    expect(container.querySelector('.move-robber')).toBeNull()
    await act(async () => seen.dispatch({ type: 'tab-add' }))
    await act(async () => seen.dispatch({ type: 'tab-select', id: tabId }))
    expect(seen.state.pick).toBeNull()
    await click('Undo')
    expect(seen.state.pick?.want).toBe('hex')
    expect(container.querySelectorAll('.blink')).toHaveLength(game().board.hexes.length - 1)
    await click('Redo')
    expect(seen.state.pick).toBeNull()
    expect(container.querySelectorAll('.blink')).toHaveLength(0)
    await click('End turn')
    await click('Undo')
    expect(seen.state.pick).toBeNull()
  })

  it('reopens the victim list when the same hex is picked again', async () => {
    await click('7')
    await skipDiscards()
    await pickHex('b')
    const first = popover()
    await clickElement([...first.querySelectorAll('button')].find((button) => button.textContent?.includes('Bee'))!)
    expect(popover().textContent).toContain('What did you take')
    await pickHex('b')
    expect(popover()).not.toBe(first)
    expect(popover().textContent).toContain('Steal from')
    expect(popover().textContent).not.toContain('What did you take')
  })

  it('rings a rival Knight advice fill and keeps Actions current after the roll', async () => {
    const cards = emptyStats().hand
    const hex = game().board.hexes.find(({ coord }) => axialKey(coord) !== '0,0')!.coord
    respond = ({ decision }) => decision.kind === 'turn'
      ? { kind: 'turn', actions: [{ action: { type: 'playKnight', hex, victim: 'aki' }, reason: '', score: 1, handDelta: cards }],
        derived: { bank: cards, tradeRates: cards, devDeckRemaining: 21, unknownOwnCards: 0 } }
      : { kind: 'preRoll', play: null, reason: '', derived: { bank: cards, tradeRates: cards, devDeckRemaining: 21, unknownOwnCards: 0 } }
    await act(async () => seen.dispatch({ type: 'commit-game', game: recordRoll(setActivePlayer(adjustCounter(game(), 'b', 'devCards', 1), 'b'), 8, {}) }))
    await clickElement(container.querySelector('.analysis-row-select'))
    await click('Play')
    expect(container.querySelectorAll('.hex-highlight')).toHaveLength(1)
    expect(container.querySelector('.move-robber')?.textContent).toContain('Suggested:')
    expect(container.querySelector('.move-robber')?.textContent).toContain('steal from aki')
    expect(container.querySelectorAll('.move-step')[1].className).toContain('now')
  })

  it('shows production as player groups with one glyph per resource and a count above one, including Nobody produces', async () => {
    const cards = emptyStats().hand
    respond = () => ({ kind: 'produce', gains: { aki: { ...cards, wood: 2, ore: 1 }, b: { ...cards, wheat: 1 } } })
    await click('8')
    const groups = rollStep().querySelectorAll('.move-prod-player')
    expect([...groups].map((group) => group.textContent)).toEqual(['aki2', 'Bee'])
    expect(groups[0].querySelector('.swatch')).not.toBeNull()
    expect(groups[0].querySelectorAll('.stat-icon')).toHaveLength(2)
    expect(groups[1].querySelectorAll('.stat-icon')).toHaveLength(1)
    expect(rollStep().querySelector('.move-step-title')?.textContent).toContain('Rolled 8')
    await click('Change roll')
    respond = () => ({ kind: 'produce', gains: {} })
    await click('2', rollStep())
    expect(rollStep().textContent).toContain('Nobody produces')
  })

  it('shows only affordable legal build pieces and marks an empty Actions step done after the roll', async () => {
    await click('Build')
    expect([...tray().querySelectorAll('[aria-label="Piece"] button')].map((button) => button.querySelector('.move-piece-name')?.textContent)).toEqual(['Road', 'City'])
    await click('Build')
    const current = { ...game(), stats: { ...game().stats, aki: emptyStats() }, devHand: undefined }
    await act(async () => seen.dispatch({ type: 'commit-game', game: current }))
    expect(container.querySelectorAll('.move-tile')).toHaveLength(0)
    expect(container.querySelectorAll('.move-step')[1].className).toContain('later')
    expect(container.querySelectorAll('.move-step-title')[1].textContent).toBe('Actions')
    await click('8')
    const actions = container.querySelectorAll('.move-step')[1]
    expect(actions.className).toContain('done')
    expect(actions.querySelector('.move-step-title')?.textContent).toBe('No actions possible')
    expect(actions.querySelector('.move-step-dot svg')).not.toBeNull()
    expect(container.querySelectorAll('.move-step')[2].className).toContain('now')
  })

  it('hides buying when advice reports an empty dev deck', async () => {
    const cards = emptyStats().hand
    respond = () => ({ kind: 'preRoll', play: null, reason: '', derived: { bank: cards, tradeRates: cards, devDeckRemaining: 0, unknownOwnCards: 0 } })
    await click('Retry advice')
    expect([...container.querySelectorAll('.move-tile')].map((tile) => tile.textContent)).toEqual(['Trade', 'Play card', 'Build'])
  })

  it('blocks all advice on unfinished boards while keeping every recording tray usable', async () => {
    requests.length = 0
    const incomplete = { ...game(), board: { ...game().board, hexes: game().board.hexes.map((hex, index) => index === 0 ? { ...hex, tile: null } : hex) } }
    await act(async () => seen.dispatch({ type: 'commit-game', game: incomplete }))
    expect(container.textContent).toContain('Finish the board to get advice:')
    expect(container.textContent).toContain('1 hex has no tile')
    expect(container.querySelector('.ledger-row')).not.toBeNull()
    await click('Trade')
    await click('Bee', tray())
    await click('Play card')
    await click('Knight', tray())
    expect(seen.state.pick?.want).toBe('hex')
    await click('Play card')
    await click('8')
    expect(game().turn?.rolled).toBe(8)
    expect(game().stats).toBe(incomplete.stats)
    await click('Undo')
    await click('7')
    expect(rollStep().querySelectorAll('.move-discard')).toHaveLength(2)
    expect(button('More wood', rollStep()).disabled).toBe(false)
    expect(seen.state.pick).toBeNull()
    await skipDiscards()
    expect(seen.state.pick?.want).toBe('hex')
    expect(requests).toEqual([])
  })

  it('the empty board wins over the completed draft swap', async () => {
    const board = { ...game().board, hexes: createBoard('standard4').hexes }
    await act(async () => seen.dispatch({ type: 'commit-game', game: { ...game(), board } }))
    await act(async () => root.render(<StoreProvider><AdviceProvider>
      <Capture report={(value) => { seen = value }} />
      <AnalysisContext.Provider value={{ analysis: { status: 'complete', draft: inferDraftState(board), recommendations: [], takenBeforeFirstPick: [], warnings: [] }, pending: false, error: null, retry() {} }}>
        <AnalysisPanel />
      </AnalysisContext.Provider>
    </AdviceProvider></StoreProvider>))
    expect(container.textContent).toContain('This board is empty')
    expect(container.querySelector('.best-moves-panel')).toBeNull()
  })

  it('records the entered whole lots at a 2:1 port', async () => {
    const port = { ...createBoard('standard4').ports[0], resource: 'wood' as const, rate: 2 }
    const board = placeBuilding({ ...game().board, buildings: [], ports: [port] }, edgeEndpointVertexIds(port.edgeId)[1], 'aki', 'settlement')
    await act(async () => seen.dispatch({ type: 'commit-game', game: { ...game(), board } }))
    await click('Trade')
    await click('Gives wood')
    await click('Gets ore')
    await click('Gets ore')
    expect(button('Port 4:1 · 2:1').disabled).toBe(true)
    for (let count = 0; count < 3; count += 1) await click('Gives wood')
    await click('Port 4:1 · 2:1')
    expect(game().stats.aki.hand).toMatchObject({ wood: 1, ore: 7 })
    expect(container.querySelector('.move-log li > span')?.textContent).toContain('Traded 4 wood to the port for 2 ore')
  })

  it('folds a recorded roll, shows production under it, and changes it after later actions', async () => {
    respond = () => ({ kind: 'produce', gains: { aki: { ...emptyStats().hand, wood: 2 } } })
    expect(container.querySelectorAll('.move-dice button')).toHaveLength(11)
    expect(button('7').querySelector('.seven-robber')).not.toBeNull()
    expect(button('8').querySelector('.dice-pips')?.children).toHaveLength(5)
    const before = game()
    await click('8')
    expect(game().stats.aki.hand.wood).toBe(7)
    expect(rollStep().className).toContain('done')
    expect(rollStep().textContent).toContain('Rolled 8')
    expect(rollStep().querySelectorAll('.move-prod-player')).toHaveLength(1)
    expect(rollStep().querySelector('.move-prod-player')?.textContent).toBe('aki2')
    expect(rollStep().querySelectorAll('.move-prod-cards[aria-label="2 wood"] .stat-icon')).toHaveLength(1)
    expect(rollStep().querySelector('.move-step-title')?.textContent).toContain('Rolled 8')
    expect(button('Change roll').title).toBe('Change roll')
    expect(button('Change roll').textContent).toBe('')
    expect(container.querySelector('.move-dice')).toBeNull()
    expect(rollStep().querySelector('.move-step-title .move-prod')).toBeNull()
    await click('Change roll')
    expect(game()).toBe(before)
    expect(rollStep().className).toContain('now')
    await click('8')
    await click('Buy card')
    await click('Knight', tray())
    const acted = game()
    expect(container.querySelector('.move-log li > span')?.textContent).toBe('Bought a dev card')
    await click('Change roll')
    expect(game()).toBe(before)
    expect(container.querySelector('.move-dice')).not.toBeNull()
    expect(container.querySelector('.move-log')).toBeNull()
    await click('Undo')
    expect(game()).toBe(acted)
    expect(container.querySelector('.move-log li > span')?.textContent).toBe('Bought a dev card')
    expect(rollStep().textContent).toContain('Rolled 8')
  })

  it('keeps a dev card played before the roll in the log once after Change roll', async () => {
    await click('Play card')
    await click('Year of plenty', tray())
    await click('Takes ore')
    await click('Takes ore')
    await click('8')
    await click('Change roll')
    expect([...container.querySelectorAll('.move-log li')].map((item) => item.querySelector('span')?.textContent)).toEqual(['Played Year of plenty · Ore and ore'])
    await click('6')
    await click('Change roll')
    expect([...container.querySelectorAll('.move-log li')].map((item) => item.querySelector('span')?.textContent)).toEqual(['Played Year of plenty · Ore and ore'])
  })

  it('keeps completed discards folded while the other player discards', async () => {
    await click('7')
    await click('Record', rollStep().querySelector('[aria-label="Bee\'s discard"]')!)
    expect(Object.values(game().stats.b.hand).reduce((sum, n) => sum + n, game().stats.b.handUnknown)).toBe(13)
    expect(rollStep().querySelectorAll('.move-discard')).toHaveLength(1)
    expect(container.querySelectorAll('.move-tile')).toHaveLength(0)
    expect(seen.state.pick).toBeNull()
    await skipDiscards()
    expect(seen.state.pick?.want).toBe('hex')
  })

  it('prompts an unclaimed player to claim themselves in Players', async () => {
    await act(async () => seen.dispatch({ type: 'commit-game', game: { ...game(), board: setMe(game().board, null) } }))
    expect(container.textContent).toContain('Claim yourself in Players to track your exact cards.')
    await click('Start game')
    await click('End turn')
    expect(container.textContent).toContain('Claim yourself in Players to track your exact cards.')
  })

  it('renders the three highest offers from unsorted advice and preserves the other rows', async () => {
    const cards = emptyStats().hand
    const actions: ScoredAdvice[] = [
      { type: 'buyDev' },
      { type: 'offerTrade', give: 'wood', get: 'ore', count: 1 },
      { type: 'offerTrade', give: 'brick', get: 'ore', count: 1 },
      { type: 'tradeBank', give: 'wood', get: 'ore', count: 1, rate: 4 },
      { type: 'offerTrade', give: 'sheep', get: 'ore', count: 1 },
      { type: 'offerTrade', give: 'wheat', get: 'ore', count: 1 },
      { type: 'buyDev' },
      { type: 'offerTrade', give: 'wood', get: 'ore', count: 2 },
      { type: 'pass' },
    ].map((action, index) => ({ action: action as ScoredAdvice['action'], score: [5, 1, 40, 3, 20, 50, 2, 10, 0][index], reason: `Row ${index}`, handDelta: cards }))
    respond = () => ({ kind: 'turn', actions, derived: { bank: cards, tradeRates: cards, devDeckRemaining: 21, unknownOwnCards: 0 } })
    await act(async () => seen.dispatch({ type: 'commit-game', game: recordRoll(game(), 8, {}) }))
    expect([...container.querySelectorAll('.move-reason')].map((row) => row.textContent)).toEqual(['Row 0', 'Row 2', 'Row 3', 'Row 4', 'Row 5', 'Row 6', 'Row 8'])
  })

  it('records a roll without production when the engine is unavailable', async () => {
    const before = game()
    await click('8')
    expect(game().turn?.rolled).toBe(8)
    expect(game().stats).toBe(before.stats)
    expect(container.textContent).toContain('Production not added: enter the cards by hand')
    await click('Undo')
    expect(game()).toBe(before)
    await click('Redo')
    expect(game().turn?.rolled).toBe(8)
  })

  it('records counted player trades and buys for either active player', async () => {
    await click('Trade')
    expect(button('Bee', tray()).disabled).toBe(true)
    await click('Gives wood')
    await click('Gets brick')
    for (let count = 0; count < 3; count += 1) await click('Gives wood')
    await click('Bank 4:1')
    expect(game().stats.aki.hand).toMatchObject({ wood: 1, brick: 6 })
    await click('Undo')
    await click('Trade')
    await click('Gives wood')
    await click('Gives wood')
    await click('Gives sheep')
    await click('Gets ore')
    expect(button('Bank 4:1').disabled).toBe(true)
    await click('Clear', tray())
    expect(button('Bee', tray()).disabled).toBe(true)
    await click('Gives wood')
    await click('Gives wood')
    await click('Gives sheep')
    await click('Gets brick')
    await click('Bee', tray())
    expect(game().stats.aki.hand).toMatchObject({ wood: 3, sheep: 4, brick: 6 })
    expect(game().stats.b.hand).toMatchObject({ wood: 7, sheep: 6, brick: 4 })
    await click('Buy card')
    expect(tray().textContent).toContain('Which card did you draw?')
    await click('Knight', tray())
    expect(game().devHand?.bought.knight).toBe(1)
    expect(container.querySelector('.ledger-dev-pill.new')?.textContent).toBe('Knight new')
    await click('End turn')
    expect(game().turn?.playerId).toBe('b')
    expect(game().devHand?.playable.knight).toBe(2)
    await click('Buy card')
    expect(game().stats.b.devCards).toBe(1)
    expect(tray()).toBeNull()
  })

  it('records a build through the canvas and undoes its piece and cost together', async () => {
    const before = game()
    await click('Build')
    await clickElement([...tray().querySelectorAll('button')].find((button) => button.textContent?.startsWith('Road')) ?? null)
    expect(seen.state.pick?.want).toBe('edge')
    await clickElement(container.querySelector('.placement-slot'))
    expect(game().board.roads).toHaveLength(1)
    expect(game().stats.aki.hand).toMatchObject({ wood: 4, brick: 4 })
    expect(seen.state.pick).toBeNull()
    await click('Undo')
    expect(game()).toBe(before)
  })

  it('records all four dev plays without advice, with one undo per play', async () => {
    const before = game()
    await click('Play card')
    await click('Road building', tray())
    await clickElement(container.querySelector('.placement-slot'))
    expect(seen.state.pick?.want).toBe('edge')
    expect(button('Record 1 road')).toBeDefined()
    await clickElement(container.querySelector('.placement-slot'))
    expect(game().board.roads).toHaveLength(2)
    expect(game().stats.aki.hand.wood).toBe(5)
    await click('Undo')
    expect(game()).toBe(before)
    await click('Play card')
    await click('Year of plenty', tray())
    await click('Takes wood')
    expect(game()).toBe(before)
    expect(button('Takes wood').textContent).toBe('1')
    await click('Takes ore')
    expect(game().stats.aki.hand).toMatchObject({ wood: 6, ore: 6 })
    await click('Undo')
    await click('Play card')
    await click('Monopoly', tray())
    await click('Named resource ore')
    expect(button('One more from Bee').textContent).toBe('5')
    await click('One fewer from Bee')
    await click('One fewer from Bee')
    await click('Record', tray())
    expect(game().stats.aki.hand.ore).toBe(8)
    expect(game().stats.b.hand.ore).toBe(2)
    await click('Undo')
    await click('Play card')
    await click('Knight', tray())
    expect(tray()).toBeNull()
    expect(seen.state.pick?.want).toBe('hex')
    await pickHex('b')
    await clickElement([...popover().querySelectorAll('button')].find((button) => button.textContent?.includes('Bee'))!)
    expect(popover().textContent).toContain('What did you take from Bee?')
    await click('sheep', popover())
    expect(game().stats.aki.knights).toBe(1)
    expect(game().stats.aki.hand.sheep).toBe(6)
    expect(game().stats.b.hand.sheep).toBe(4)
    expect(game().turn?.devPlayed).toBe(true)
  })

  it('finishes a seven without double-discarding a hand still above seven', async () => {
    await click('7')
    const own = rollStep().querySelector('[aria-label="aki\'s discard"]')!
    for (const [resource, count] of [['wood', 5], ['sheep', 5], ['wheat', 2]] as const) {
      for (let index = 0; index < count; index += 1) await click(`More ${resource}`, own)
    }
    await click('Record', own)
    expect(rollStep().querySelectorAll('.move-discard')).toHaveLength(1)
    await click('Record', rollStep().querySelector('.move-discard')!)
    expect(rollStep().querySelectorAll('.move-discard')).toHaveLength(0)
    await click('Undo')
    expect(rollStep().querySelectorAll('.move-discard')).toHaveLength(1)
    await click('Record', rollStep().querySelector('.move-discard')!)
    const hex = await pickHex()
    expect(game().board.robber).toEqual(hex)
    expect(popover()).toBeNull()
    expect(container.textContent).not.toContain('The ranked moves follow.')
    await click('Undo')
    expect(seen.state.pick?.want).toBe('hex')
  })

  it('skips discards without a commit and ignores the robber own hex', async () => {
    await click('7')
    const before = game()
    expect(rollStep().querySelectorAll('.move-discard')).toHaveLength(2)
    await click('Skip', rollStep().querySelector('.move-discard')!)
    await click('Skip', rollStep().querySelector('.move-discard')!)
    await clickElement(container.querySelector(`.hit-layers [data-hex="${axialKey(before.board.robber!)}"]`))
    expect(game()).toBe(before)
    expect(popover()).toBeNull()
    expect(container.querySelectorAll('.blink')).toHaveLength(game().board.hexes.length - 1)
    expect(rollStep().querySelectorAll('.move-discard')).toHaveLength(0)
    expect(game()).toBe(before)
    await pickHex()
    expect(game().stats).toEqual(before.stats)
    expect(container.querySelectorAll('.blink')).toHaveLength(0)
  })

  it('shows no discard lines and arms the robber when nobody is over seven', async () => {
    let current = game()
    for (const id of ['aki', 'b']) for (const resource of RESOURCES) current = adjustHand(current, id, resource, -5)
    await act(async () => seen.dispatch({ type: 'commit-game', game: current }))
    await click('7')
    expect(rollStep().querySelectorAll('.move-discard')).toHaveLength(0)
    expect(seen.state.pick?.want).toBe('hex')
  })

  it('preserves the Ledger row editor across turn and tab changes while closing the tray', async () => {
    await click('Correct aki')
    await click('Build')
    await clickElement([...tray().querySelectorAll('button')].find((button) => button.textContent?.startsWith('Road')) ?? null)
    await click('End turn')
    expect(button('Correct aki').getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('.move-tray')).toBeNull()
    expect(seen.state.pick).toBeNull()
    await click('Trade')
    await act(async () => seen.dispatch({ type: 'tab-add' }))
    expect(button('Correct aki').getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('.move-tray')).toBeNull()
  })

  it('re-arms a cleared pick and ignores a build that leaves the board unchanged', async () => {
    const corner = buildingSlots(game().board, 'aki', 'settlement', 'edit')[0]
    const edge = boardGrid('standard4').edgeIds.find((id) => edgeEndpointVertexIds(id).includes(corner))!
    await act(async () => seen.dispatch({ type: 'commit', board: placeRoad(game().board, edge, 'aki') }))
    const before = game()
    const past = activeTab(seen.state).past
    await click('Build')
    await clickElement([...tray().querySelectorAll('button')].find((button) => button.textContent?.startsWith('Settlement')) ?? null)
    expect(seen.state.pick).toEqual({ want: 'vertex', piece: 'settlement' })
    await act(async () => seen.dispatch({ type: 'pick-clear' }))
    expect(seen.state.pick).toEqual({ want: 'vertex', piece: 'settlement' })
    await act(async () => seen.dispatch({ type: 'workspace-adopt', tabs: [...seen.state.tabs, { ...activeTab(seen.state), id: 'adopted' }].map(({ id, title, game }) => ({ id, title, game })) }))
    expect(seen.state.pick).toEqual({ want: 'vertex', piece: 'settlement' })
    await act(async () => seen.dispatch({ type: 'picked', ref: before.board.buildings[0].vertexId }))
    expect(game()).toBe(before)
    expect(activeTab(seen.state).past).toBe(past)
    expect(seen.state.pick).toBeNull()
  })

  it('starts rival typed discards at zero even with a worker recommendation', async () => {
    const cards = emptyStats().hand
    respond = ({ decision }) => decision.kind === 'discard'
      ? { kind: 'discard', count: 12, cards: { ...cards, wood: 5, sheep: 5, wheat: 2 }, reason: '', derived: { bank: cards, tradeRates: cards, devDeckRemaining: 21, unknownOwnCards: 0 } }
      : { error: 'The advice engine is not built yet' }
    await click('7')
    expect(requests.filter(({ decision, observer }) => decision.kind === 'discard' && observer === 'b')).toEqual([])
    const rival = rollStep().querySelector('[aria-label="Bee\'s discard"]')!
    await click('Enter types', rival)
    expect(rival.textContent).toContain('0 / 12')
    expect(button('Record', rival).disabled).toBe(true)
    for (const resource of RESOURCES) expect(button(`Fewer ${resource}`, rival).disabled).toBe(true)
  })

  it('shows only the active player dev defaults and counts bought cards as typed', async () => {
    expect(container.querySelector('.ledger-header > span')?.textContent).toBe('')
    const note = 'Set your dev cards by type in the Ledger'
    expect(container.textContent).not.toContain(note)
    const bought = adjustDevHand(game(), 'bought', 'monopoly', 1)
    await act(async () => seen.dispatch({ type: 'commit-game', game: bought }))
    expect(container.querySelector('.ledger-dev-pill.new')?.textContent).toBe('Monopoly new')
    expect(container.textContent).not.toContain(note)
    await act(async () => seen.dispatch({ type: 'commit-game', game: adjustCounter(adjustCounter(game(), 'aki', 'devCards', 1), 'b', 'devCards', 2) }))
    expect(container.textContent).not.toContain(note)
    expect(container.textContent).not.toContain('treated as unplayed knights')
    await click('End turn')
    expect(container.textContent).not.toContain(note)
    expect(container.textContent).toContain("Bee's 2 dev cards are treated as unplayed knights")
    await click('End turn')
    const withoutTypes = { ...game() }
    delete withoutTypes.devHand
    await act(async () => seen.dispatch({ type: 'commit-game', game: withoutTypes }))
    expect(container.textContent).not.toContain(note)
  })

  it('shows a negative verdict for the claimed counterparty before recording the trade', async () => {
    const cards = emptyStats().hand
    respond = () => ({ kind: 'tradeResponse', accept: false, margin: -0.123, reason: 'Keep ore', derived: { bank: cards, tradeRates: cards, devDeckRemaining: 21, unknownOwnCards: 0 } })
    await click('End turn')
    await click('Trade')
    await click('Gives wood')
    await click('Gets ore')
    expect(tray().textContent).toContain('Advice for you: Decline (−0.12): Keep ore')
    expect(requests.at(-1)).toMatchObject({ observer: 'aki', decision: { kind: 'tradeResponse', proposer: 'b', give: 'wood', get: 'ore', count: 1 } })
    await click('aki', tray())
    expect(game().stats.aki.hand).toMatchObject({ wood: 6, ore: 4 })
  })

  it('disables double-tap zoom while a tray is picking a spot', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    await act(async () => seen.dispatch({ type: 'tool', tool: { kind: 'none' } }))
    const svg = container.querySelector<SVGSVGElement>('.board-canvas')!
    svg.getBoundingClientRect = () => new DOMRect(0, 0, 400, 400)
    const before = svg.getAttribute('viewBox')
    const tap = async (time: number) => {
      for (const type of ['pointerdown', 'pointerup']) {
        const event = new MouseEvent(type, { bubbles: true, clientX: 200, clientY: 200 })
        Object.defineProperties(event, { pointerId: { value: 1 }, timeStamp: { value: time } })
        await act(async () => svg.dispatchEvent(event))
      }
    }
    // The app shows Best moves only after the draft.
    await act(async () => seen.dispatch({ type: 'commit', board: placeBuilding(game().board, boardGrid('standard4').vertexIds[0], 'aki', 'city') }))
    await click('Build')
    await clickElement([...tray().querySelectorAll('button')].find((button) => button.textContent?.startsWith('Road')) ?? null)
    await tap(100)
    await tap(200)
    expect(svg.getAttribute('viewBox')).toBe(before)
    await click('Build')
    await tap(500)
    await tap(600)
    expect(svg.getAttribute('viewBox')).not.toBe(before)
  })

  it('tapping a hex with the selected number under the token tool clears its number', async () => {
    expect(game().board.hexes[0].numberToken).toBe(6)
    await act(async () => seen.dispatch({ type: 'tool', tool: { kind: 'token', number: 6 } }))
    await clickElement(container.querySelector('.hit-layers polygon'))
    expect(game().board.hexes[0].numberToken).toBeNull()
    expect(game().board.hexes[0].tile).toBe('wood')
    expect(game().board.hexes[1].numberToken).toBe(6)
  })

  it('renders sorted fake-worker advice and applies a selected move', async () => {
    const edge = boardGrid('standard4').edgeIds[0]
    const cards = { wood: 0, sheep: 0, wheat: 0, brick: 0, ore: 0 }
    const derived = { bank: cards, tradeRates: { wood: 4, sheep: 4, wheat: 4, brick: 4, ore: 4 }, devDeckRemaining: 21, unknownOwnCards: 0 }
    respond = ({ decision }) => decision.kind === 'produce' ? { kind: 'produce', gains: { aki: { ...cards, wood: 2 } } }
      : decision.kind === 'preRoll' ? { kind: 'preRoll', play: null, reason: '', derived }
        : { kind: 'turn', actions: [{ action: { type: 'buildRoad', edgeId: edge }, score: 10013.4, reason: '', handDelta: { ...cards, wood: -1, brick: -1 } }, { action: { type: 'pass' }, score: 0, reason: '', handDelta: cards }], derived }
    await click('8')
    expect(game().stats.aki.hand.wood).toBe(7)
    expect(container.textContent).toContain('10,013.4')
    expect(container.querySelector('.move-costs')?.textContent).toBe('−1−1')
    expect(container.querySelectorAll('.move-reason')).toHaveLength(0)
    await clickElement(container.querySelector('.analysis-row-select'))
    expect(seen.state.highlight).toEqual([{ ref: edge, color: game().board.players[0].color, kind: 'road' }])
    await click('Play')
    expect(game().board.roads).toHaveLength(1)
    expect(game().stats.aki.hand).toMatchObject({ wood: 6, brick: 4 })
    expect(container.querySelector('.move-log li > span')?.textContent).toBe('Built a road')
    expect(container.querySelector('.move-log svg')).not.toBeNull()
    await click('Undo')
    expect(container.querySelector('.move-log')).toBeNull()
  })

  it('corrects a hand and dev type one undo step at a time', async () => {
    const before = game()
    await click('Correct aki')
    await click('Add one Wood, now 5')
    expect(game().stats.aki.hand.wood).toBe(6)
    await click('Dev cards 4')
    await click('Add one Knight, now 1')
    expect(game().devHand?.playable.knight).toBe(2)
    expect(game().stats.aki.devCards).toBe(5)
    const status = () => container.querySelector('.ledger-status')!
    expect(status().textContent).toContain('Added one Knight · Undo')
    await click('Undo', status())
    expect(game().stats.aki.hand.wood).toBe(6)
    expect(game().devHand?.playable.knight).toBe(1)
    // The line names only the change on top of the undo stack, which is now the wood.
    expect(button('Undo', container.querySelector('.best-moves-panel:not(.ledger-panel)')!)).not.toBeNull()
    expect(status().querySelector('button')).toBeNull()
    await click('Undo')
    expect(game()).toBe(before)
  })

  it('clears a pick on turn changes and records for the turn player rather than the brush player', async () => {
    await click('Build')
    await clickElement([...tray().querySelectorAll('button')].find((button) => button.textContent?.startsWith('Road')) ?? null)
    await click('End turn')
    expect(seen.state.pick).toBeNull()
    expect(container.querySelector('.move-tray')).toBeNull()
    await click('Build')
    await clickElement([...tray().querySelectorAll('button')].find((button) => button.textContent?.startsWith('Road')) ?? null)
    await clickElement(container.querySelector('.placement-slot'))
    expect(game().board.roads[0].playerId).toBe('b')
    expect(game().stats.b.hand.wood).toBe(4)
    expect(game().stats.aki.hand.wood).toBe(5)
  })

  it('automatically rings robber advice and keeps a knight fill armed for a board tap', async () => {
    const hex = game().board.hexes.find(({ coord }) => axialKey(coord) !== '0,0')!.coord
    const cards = emptyStats().hand
    respond = () => ({ kind: 'preRoll', play: { type: 'playKnight', hex, victim: 'b' }, reason: 'Block wood', derived: { bank: cards, tradeRates: cards, devDeckRemaining: 21, unknownOwnCards: 0 } })
    await click('Retry advice')
    await click('Play', container.querySelector('.analysis-row')!)
    expect(container.querySelectorAll('.hex-highlight')).toHaveLength(1)
    expect(container.querySelectorAll('.highlighted, .vertex-highlight, .edge-highlight')).toHaveLength(0)
    expect(container.textContent).toContain('Suggested:')
    expect(container.textContent).toContain('steal from Bee')
    expect(seen.state.pick?.want).toBe('hex')
    await pickHex()
    expect(game().stats.aki.knights).toBe(1)
  })

  it('keeps the completed-game tray mounted while placement analysis is pending', async () => {
    let board = game().board
    const vertices = boardGrid(board.layout).vertexIds
    for (const [index, id] of [[10, 'aki'], [20, 'b'], [30, 'b']] as const) board = placeBuilding(board, vertices[index], id, 'settlement')
    await act(async () => seen.dispatch({ type: 'commit-game', game: setActivePlayer({ ...game(), board }, 'aki') }))
    const render = async (pending: boolean) => act(async () => root.render(<StoreProvider><AdviceProvider>
      <Capture report={(value) => { seen = value }} /><BoardCanvas />
      <AnalysisContext.Provider value={{ analysis: { status: pending ? 'no-production' : 'complete', draft: inferDraftState(board), recommendations: [], takenBeforeFirstPick: [], warnings: [] }, pending, error: null, retry() {} }}>
        <AnalysisPanel />
      </AnalysisContext.Provider>
    </AdviceProvider></StoreProvider>))
    await render(false)
    await click('Trade')
    await click('Gets ore')
    await click('Gets ore')
    expect(button('Gets ore').textContent).toBe('2')
    await render(true)
    expect(container.querySelector('.best-moves-panel')).not.toBeNull()
    expect(button('Gets ore').textContent).toBe('2')
    expect(container.querySelector('[aria-label="Step back one pick"]')).toBeNull()
  })
})
