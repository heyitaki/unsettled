// @vitest-environment jsdom
import { act, useEffect, type Dispatch } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdviceRequest, AdviceResponse, ScoredAdvice } from '../../engine/advice/protocol'
import { inferDraftState } from '../../engine/draft'
import { addPlayer, createBoard, placeBuilding, setMe } from '../../model/board'
import { adjustCounter, adjustHand, emptyStats, newGame, type Game } from '../../model/game'
import { edgeEndpointVertexIds } from '../../model/coords'
import { boardGrid } from '../../model/layouts'
import { adjustDevHand, recordRoll, setActivePlayer } from '../../model/turn'
import { RESOURCES } from '../../model/types'
import { AdviceProvider } from '../AdviceProvider'
import { AnalysisPanel } from '../AnalysisPanel'
import { BestMovesPanel } from '../BestMovesPanel'
import { BoardCanvas } from '../BoardCanvas'
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
    container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root.render(<StoreProvider><AdviceProvider>
      <Capture report={(value) => { seen = value }} /><BoardCanvas /><BestMovesPanel />
    </AdviceProvider></StoreProvider>))
    await act(async () => seen.dispatch({ type: 'commit-game', game: seed() }))
  })
  afterEach(() => {
    act(() => root.unmount())
    vi.unstubAllGlobals()
  })

  it('blocks all advice on unfinished boards while keeping every recording tray usable', async () => {
    requests.length = 0
    const incomplete = { ...game(), board: { ...game().board, hexes: game().board.hexes.map((hex, index) => index === 0 ? { ...hex, tile: null } : hex) } }
    await act(async () => seen.dispatch({ type: 'commit-game', game: incomplete }))
    expect(container.textContent).toContain('Finish the board to get advice:')
    expect(container.textContent).toContain('1 hex has no tile')
    expect(container.querySelector('.move-table')).not.toBeNull()
    await click('Trade')
    await click('Bee', tray())
    await click('Play dev card')
    await click('Knight', tray())
    expect(seen.state.pick?.want).toBe('hex')
    await click('Roll')
    await click('8', tray())
    expect(game().turn?.rolled).toBe(8)
    expect(game().stats).toBe(incomplete.stats)
    await click('Undo')
    await click('Roll')
    await click('7', tray())
    expect(tray().querySelectorAll('.move-discard')).toHaveLength(2)
    expect(button('More wood', tray()).disabled).toBe(false)
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

  it('uses a 2:1 port when the advice engine errors', async () => {
    const port = { ...createBoard('standard4').ports[0], resource: 'wood' as const, rate: 2 }
    const board = placeBuilding({ ...game().board, buildings: [], ports: [port] }, edgeEndpointVertexIds(port.edgeId)[1], 'aki', 'settlement')
    await act(async () => seen.dispatch({ type: 'commit-game', game: { ...game(), board } }))
    await click('Trade')
    expect(tray().textContent).toContain('Bank 2:1')
    await click('Record trade')
    expect(game().stats.aki.hand).toMatchObject({ wood: 3, brick: 6 })
  })

  it('disables every dice total after recording a roll', async () => {
    respond = () => ({ kind: 'produce', gains: { aki: { ...emptyStats().hand, wood: 2 } } })
    await click('Roll')
    await click('8', tray())
    expect(game().stats.aki.hand.wood).toBe(7)
    const rolled = game()
    await click('Rolled 8')
    const dice = [...tray().querySelectorAll<HTMLButtonElement>('.move-dice button')]
    expect(dice).toHaveLength(11)
    expect(dice.every((button) => button.disabled)).toBe(true)
    expect(tray().textContent).toContain('Rolled 8. Undo to change the roll.')
    await click('6', tray())
    expect(game()).toBe(rolled)
  })

  it('reopening a seven does not rebuild completed discard lines', async () => {
    await click('Roll')
    await click('7', tray())
    const rival = tray().querySelector('[aria-label="Bee\'s discard"]')!
    await click('Record', rival)
    expect(Object.values(game().stats.b.hand).reduce((sum, n) => sum + n, game().stats.b.handUnknown)).toBe(13)
    expect(tray().querySelectorAll('.move-discard')).toHaveLength(1)
    await click('Rolled 7')
    await click('Rolled 7')
    expect(tray().querySelectorAll('.move-discard')).toHaveLength(1)
    expect(tray().querySelector('[aria-label="Bee\'s discard"]')).toBeNull()
    expect(button('Record robber')).toBeDefined()
    expect(tray().textContent).toContain('Rolled 7. Undo to change the roll.')
    expect([...tray().querySelectorAll<HTMLButtonElement>('.move-dice button')].every((button) => button.disabled)).toBe(true)
  })

  it('prompts an unclaimed player to claim themselves in Players', async () => {
    await act(async () => seen.dispatch({ type: 'commit-game', game: { ...game(), board: setMe(game().board, null) } }))
    expect(container.querySelector('.move-notes')?.textContent).toContain('Claim yourself in Players to track your exact cards')
    await click('Turn 2: Bee')
    expect(container.querySelector('.move-notes')?.textContent).toContain('Claim yourself in Players to track your exact cards')
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
    await click('Roll')
    await click('8', tray())
    expect(game().turn?.rolled).toBe(8)
    expect(game().stats).toBe(before.stats)
    expect(container.textContent).toContain('Production not added: enter the cards by hand')
    await click('Undo')
    expect(game()).toBe(before)
    await click('Redo')
    expect(game().turn?.rolled).toBe(8)
  })

  it('records bank and player trades and buys for either active player', async () => {
    await click('Trade')
    await click('Record trade')
    expect(game().stats.aki.hand).toMatchObject({ wood: 1, brick: 6 })
    await click('Undo')
    await click('Trade')
    await click('Bee', tray())
    await click('Record trade')
    expect(game().stats.aki.hand).toMatchObject({ wood: 4, brick: 6 })
    expect(game().stats.b.hand).toMatchObject({ wood: 6, brick: 4 })
    await click('Buy dev card')
    expect(button('Record').disabled).toBe(true)
    await click('Knight', tray())
    await click('Record')
    expect(game().devHand?.bought.knight).toBe(1)
    expect(container.querySelector('.move-mine .new')?.textContent).toBe('Knight 1')
    await click('End turn')
    expect(game().turn?.playerId).toBe('b')
    expect(game().devHand?.playable.knight).toBe(2)
    await click('Buy dev card')
    await click('Record')
    expect(game().stats.b.devCards).toBe(1)
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

  it('records all four dev plays without advice', async () => {
    const before = game()
    await click('Play dev card')
    await click('Road building', tray())
    const spots = container.querySelectorAll('.placement-slot')
    await clickElement(spots[0])
    expect(seen.state.pick?.want).toBe('edge')
    await clickElement(container.querySelectorAll('.placement-slot')[0])
    await click('Record')
    expect(game().board.roads).toHaveLength(2)
    expect(game().stats.aki.hand.wood).toBe(5)
    await click('Undo')
    expect(game()).toBe(before)
    await click('Play dev card')
    await click('Year of plenty', tray())
    await click('Takes: wood')
    await click('and: wood')
    await click('Record')
    expect(game().stats.aki.hand.wood).toBe(7)
    await click('Play dev card')
    await click('Monopoly', tray())
    await click('Names: ore')
    const select = tray().querySelector('select')!
    await act(async () => { select.value = '3'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    await click('Record')
    expect(game().stats.aki.hand.ore).toBe(8)
    expect(game().stats.b.hand.ore).toBe(2)
    await click('Play dev card')
    await click('Knight', tray())
    expect(tray().textContent).toContain('Then the robber move, as on a seven. Knights played goes up by one.')
    await clickElement(container.querySelector('.hit-layers polygon'))
    await click('Bee', tray())
    expect(button('Record').disabled).toBe(true)
    await click('Stole: sheep')
    await click('Record')
    expect(game().stats.aki.knights).toBe(1)
    expect(game().stats.aki.hand.sheep).toBe(6)
    expect(game().stats.b.hand.sheep).toBe(4)
    expect(game().turn?.devPlayed).toBe(true)
  })

  it('finishes a seven without double-discarding a hand still above seven', async () => {
    await click('Roll')
    await click('7', tray())
    expect(button('Record robber').disabled).toBe(true)
    expect(tray().querySelector('[aria-label="Robbed"]')).not.toBeNull()
    const own = [...tray().querySelectorAll('.move-discard')].find((line) => line.textContent?.includes('aki'))!
    for (const [resource, count] of [['wood', 5], ['sheep', 5], ['wheat', 2]] as const) {
      for (let index = 0; index < count; index += 1) await click(`More ${resource}`, own)
    }
    await click('Record', own)
    expect(tray().querySelectorAll('.move-discard')).toHaveLength(1)
    await click('Record', tray().querySelector('.move-discard')!)
    expect(tray().querySelectorAll('.move-discard')).toHaveLength(0)
    await click('Undo')
    expect(tray().querySelectorAll('.move-discard')).toHaveLength(1)
    await click('Record', tray().querySelector('.move-discard')!)
    await clickElement(container.querySelector('.hit-layers polygon'))
    await click('Nobody', tray())
    await click('Record robber')
    expect(container.querySelector('.move-tray')).toBeNull()
    expect(game().board.robber).not.toBeNull()
    expect(container.textContent).not.toContain('The ranked moves follow.')
  })

  it('skips discard lines without recording and keeps the robber available alongside them', async () => {
    await click('Roll')
    await click('7', tray())
    const before = game()
    expect(tray().querySelectorAll('.move-discard')).toHaveLength(2)
    await clickElement(container.querySelector('.hit-layers polygon'))
    await click('Nobody', tray())
    expect(button('Record robber').disabled).toBe(false)
    await click('Skip', tray().querySelector('.move-discard')!)
    expect(tray().querySelectorAll('.move-discard')).toHaveLength(1)
    await click('Skip', tray().querySelector('.move-discard')!)
    expect(tray().querySelectorAll('.move-discard')).toHaveLength(0)
    expect(game()).toBe(before)
    expect(button('Record robber').disabled).toBe(false)
    await click('Record robber')
    expect(game().stats).toEqual(before.stats)
  })

  it('shows the nobody-over-seven copy and the robber when no discards are needed', async () => {
    let current = game()
    for (const id of ['aki', 'b']) for (const resource of RESOURCES) current = adjustHand(current, id, resource, -5)
    await act(async () => seen.dispatch({ type: 'commit-game', game: current }))
    await click('Roll')
    await click('7', tray())
    expect(tray().textContent).toContain('Nobody is over 7 cards.')
    expect(tray().querySelectorAll('.move-discard')).toHaveLength(0)
    expect(button('Record robber').disabled).toBe(true)
  })

  it('preserves the table view and row editor across turn and tab changes while closing the tray', async () => {
    await click('Points')
    await click('Correct aki by hand')
    await click('Build')
    await clickElement([...tray().querySelectorAll('button')].find((button) => button.textContent?.startsWith('Road')) ?? null)
    await click('Turn 2: Bee')
    expect(button('Points').getAttribute('aria-pressed')).toBe('true')
    expect(button('Correct aki by hand').getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('.move-tray')).toBeNull()
    expect(seen.state.pick).toBeNull()
    await click('Trade')
    await act(async () => seen.dispatch({ type: 'tab-add' }))
    expect(button('Points').getAttribute('aria-pressed')).toBe('true')
    expect(button('Correct aki by hand').getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('.move-tray')).toBeNull()
  })

  it('re-arms a cleared pick and ignores a build that leaves the board unchanged', async () => {
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
    await click('Roll')
    await click('7', tray())
    expect(requests.filter(({ decision, observer }) => decision.kind === 'discard' && observer === 'b')).toEqual([])
    const rival = tray().querySelector('[aria-label="Bee\'s discard"]')!
    await click('Enter types', rival)
    expect(rival.textContent).toContain('0 / 12')
    expect(button('Record', rival).disabled).toBe(true)
    for (const resource of RESOURCES) expect(button(`Fewer ${resource}`, rival).disabled).toBe(true)
  })

  it('shows only the active player dev defaults and counts bought cards as typed', async () => {
    expect(container.querySelector('thead th')?.textContent).toBe('')
    const note = 'Set your dev cards by type in the table'
    expect(container.textContent).not.toContain(note)
    const bought = adjustDevHand(game(), 'bought', 'monopoly', 1)
    await act(async () => seen.dispatch({ type: 'commit-game', game: bought }))
    expect(container.querySelector('.move-mine .new')?.textContent).toBe('Monopoly 1')
    expect(container.textContent).not.toContain(note)
    await act(async () => seen.dispatch({ type: 'commit-game', game: adjustCounter(adjustCounter(game(), 'aki', 'devCards', 1), 'b', 'devCards', 2) }))
    expect(container.textContent).toContain(note)
    expect(container.textContent).not.toContain('treated as unplayed knights')
    await click('Turn 2: Bee')
    expect(container.textContent).not.toContain(note)
    expect(container.textContent).toContain("Bee's 2 dev cards are treated as unplayed knights")
    await click('Turn 1: aki')
    const withoutTypes = { ...game() }
    delete withoutTypes.devHand
    await act(async () => seen.dispatch({ type: 'commit-game', game: withoutTypes }))
    expect(container.textContent).toContain(note)
  })

  it('uses inline trade count selects and a minus sign for a negative verdict', async () => {
    const cards = emptyStats().hand
    respond = () => ({ kind: 'tradeResponse', accept: false, margin: -0.123, reason: '', derived: { bank: cards, tradeRates: cards, devDeckRemaining: 21, unknownOwnCards: 0 } })
    await click('Trade')
    await click('Bee', tray())
    expect(tray().querySelector('[aria-label="aki gives"] select')).not.toBeNull()
    const count = tray().querySelector<HTMLSelectElement>('[aria-label="and gets"] select')!
    expect([...count.options].map((option) => option.value)).toEqual(['1', '2', '3', '4'])
    expect(tray().textContent).toContain('Advice for you: Decline (−0.12)')
    expect(tray().querySelector('.move-chip')).toBeNull()
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
    await tap(-1000)
    await tap(-900)
    expect(svg.getAttribute('viewBox')).toBe(before)

    // The app shows Best moves only after the draft, and a tap during the draft is a pick.
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
    await click('Roll')
    await click('8', tray())
    expect(game().stats.aki.hand.wood).toBe(7)
    expect(container.textContent).toContain('10,013.4')
    expect(container.querySelector('.move-costs')?.textContent).toBe('−1−1')
    expect(container.querySelectorAll('.move-reason')).toHaveLength(0)
    await clickElement(container.querySelector('.analysis-row-select'))
    expect(seen.state.highlight).toEqual([{ ref: edge, color: game().board.players[0].color, kind: 'road' }])
    await click('Apply')
    expect(game().board.roads).toHaveLength(1)
    expect(game().stats.aki.hand).toMatchObject({ wood: 6, brick: 4 })
  })

  it('corrects a hand and dev type one undo step at a time', async () => {
    const before = game()
    await click('Correct aki by hand')
    await click('More wood')
    expect(game().stats.aki.hand.wood).toBe(6)
    await click('More Knight')
    expect(game().devHand?.playable.knight).toBe(2)
    expect(game().stats.aki.devCards).toBe(5)
    await click('Undo')
    expect(game().stats.aki.hand.wood).toBe(6)
    expect(game().devHand?.playable.knight).toBe(1)
    await click('Undo')
    expect(game()).toBe(before)
  })

  it('clears a pick on turn changes and records for the turn player rather than the brush player', async () => {
    await click('Build')
    await clickElement([...tray().querySelectorAll('button')].find((button) => button.textContent?.startsWith('Road')) ?? null)
    await click('Turn 2: Bee')
    expect(seen.state.pick).toBeNull()
    expect(container.querySelector('.move-tray')).toBeNull()
    await click('Build')
    await clickElement([...tray().querySelectorAll('button')].find((button) => button.textContent?.startsWith('Road')) ?? null)
    await clickElement(container.querySelector('.placement-slot'))
    expect(game().board.roads[0].playerId).toBe('b')
    expect(game().stats.b.hand.wood).toBe(4)
    expect(game().stats.aki.hand.wood).toBe(5)
  })

  it('pins a fake-worker robber hex without highlighting terrain, ports or vertices', async () => {
    const cards = { wood: 0, sheep: 0, wheat: 0, brick: 0, ore: 0 }
    respond = () => ({ kind: 'preRoll', play: { type: 'playKnight', hex: { q: 0, r: 0 }, victim: 'b' }, reason: '', derived: { bank: cards, tradeRates: cards, devDeckRemaining: 21, unknownOwnCards: 0 } })
    await click('Retry advice')
    await clickElement(container.querySelector('.analysis-row-select'))
    expect(container.querySelectorAll('.hex-highlight')).toHaveLength(1)
    expect(container.querySelectorAll('.highlighted, .vertex-highlight, .edge-highlight')).toHaveLength(0)
    await click('Apply')
    expect(tray().textContent).toContain('steal from Bee')
    expect(button('Record').disabled).toBe(true)
    await click('Stole: wood')
    await click('Record')
    expect(game().board.robber).toEqual({ q: 0, r: 0 })
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
    const select = tray().querySelector<HTMLSelectElement>('[aria-label="Get count"]')!
    await act(async () => { select.value = '2'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(select.value).toBe('2')
    await render(true)
    expect(container.querySelector('.best-moves-panel')).not.toBeNull()
    expect(tray().querySelector<HTMLSelectElement>('[aria-label="Get count"]')!.value).toBe('2')
    expect(container.querySelector('[aria-label="Step back one pick"]')).toBeNull()
  })
})
