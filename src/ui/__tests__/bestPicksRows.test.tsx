// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftAnalysis, TakenVertex } from '../../engine/analysisProtocol'
import type { AnalysisRequest } from '../../engine/analysisProtocol'
import { inferDraftState } from '../../engine/draft'
import { vertexAdjacency } from '../../engine/legality'
import { emptyBreakdown } from './emptyBreakdown'
import { addPlayer, createBoard, placeRoad, setHexTile, upsertPort } from '../../model/board'
import { axialKey, axialToPixel, edgeEndpointVertexIds, parseVertexId, vertexIncidentEdgeIds } from '../../model/coords'
import { boardGrid } from '../../model/layouts'
import { setTile } from '../../model/__tests__/helpers'
import type { AxialCoord, Board, EdgeId, VertexId } from '../../model/types'
import { AnalysisPanel } from '../AnalysisPanel'
import { AnalysisProvider } from '../AnalysisProvider'
import { INK_COLOR, TILE_COLORS, TOKEN_COLOR } from '../colors'
import { StoreProvider, useStore } from '../store'

const GRID = boardGrid('standard4')
/** A corner of three land hexes, which the board below makes wood 6, a desert and ore 8. */
const INLAND = GRID.vertexIds.find((id) => parseVertexId(id).every((coord) => GRID.landKeys.has(axialKey(coord))))!
const INLAND_KEYS = new Set(parseVertexId(INLAND).map(axialKey))
const landAt = (vertexId: string) => parseVertexId(vertexId).filter((coord) => GRID.landKeys.has(axialKey(coord)))
/** Two coastal edges with no hex in common with each other or with `INLAND`, for a 3:1 and an ore 2:1 port. */
const landKeys = (edgeId: string) => new Set(edgeEndpointVertexIds(edgeId)
  .flatMap((vertexId) => parseVertexId(vertexId).map(axialKey)).filter((key) => GRID.landKeys.has(key)))
const apart = (edgeId: string, taken: Set<string>) => [...landKeys(edgeId)].every((key) => !taken.has(key))
const ANY_EDGE = GRID.coastalEdgeIds.find((edgeId) => apart(edgeId, INLAND_KEYS)
  && edgeEndpointVertexIds(edgeId).some((id) => landAt(id).length === 1))!
const ORE_EDGE = GRID.coastalEdgeIds.find((edgeId) =>
  apart(edgeId, INLAND_KEYS) && apart(edgeId, landKeys(ANY_EDGE)))!
const ANY_PORT = edgeEndpointVertexIds(ANY_EDGE).find((id) => landAt(id).length === 1)!
const ORE_PORT = edgeEndpointVertexIds(ORE_EDGE)[0]
const PORT_VERTICES = new Set([ANY_EDGE, ORE_EDGE].flatMap(edgeEndpointVertexIds))
const FIXED_KEYS = new Set([...INLAND_KEYS, ...landKeys(ANY_EDGE), ...landKeys(ORE_EDGE)])
const TWO_HEX = GRID.vertexIds.find((id) => landAt(id).length === 2 && !PORT_VERTICES.has(id)
  && landAt(id).every((coord) => !FIXED_KEYS.has(axialKey(coord))))!
const TWO_HEX_KEYS = new Set(landAt(TWO_HEX).map(axialKey))
const ONE_HEX = GRID.vertexIds.find((id) => landAt(id).length === 1 && !PORT_VERTICES.has(id)
  && landAt(id).every((coord) => !INLAND_KEYS.has(axialKey(coord)) && !TWO_HEX_KEYS.has(axialKey(coord))))!

const MIRRORED = GRID.vertexIds.find((id) => id === 'v:0,0;1,-1;1,0')!

function opening(): Board {
  let board = addPlayer(createBoard('standard4'), { id: 'b', name: 'Blue', color: '#3063ba' })
  for (const hex of board.hexes) board = setTile(board, hex.coord, 'wheat', 9)
  const [wood, desert, ore] = parseVertexId(INLAND)
  board = setTile(setTile(setTile(board, wood, 'wood', 6), desert, 'desert'), ore, 'ore', 8)
  const [unassigned, unnumbered] = board.hexes.filter((hex) => TWO_HEX_KEYS.has(axialKey(hex.coord)))
  board = setTile(setHexTile(board, unassigned.coord, null), unnumbered.coord, 'wheat')
  board = setTile(setTile(setTile(board, { q: 1, r: -1 }, 'sheep', 10), { q: 0, r: 0 }, 'brick', 11), { q: 1, r: 0 }, 'wheat', 5)
  return upsertPort(upsertPort({ ...board, ports: [] }, ANY_EDGE, null, 3), ORE_EDGE, 'ore', 2)
}

function Commit({ report }: { report(dispatch: ReturnType<typeof useStore>['dispatch']): void }) {
  report(useStore().dispatch)
  return null
}

function Highlights() {
  return <output data-highlights>{JSON.stringify(useStore().state.highlight)}</output>
}

describe('Best picks rows', () => {
  let root: Root
  let container: HTMLDivElement
  let jobs: { request: AnalysisRequest; reply(analysis: DraftAnalysis): void }[]
  const click = async (element: Element | null) => {
    if (!element) throw new Error('Missing control')
    await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  }
  const reply = async (takenBeforeFirstPick: TakenVertex[] = [], firstPicks: VertexId[] = [INLAND], {
    plannedSecond = [ANY_PORT, ORE_PORT, TWO_HEX], survival = 1, status = 'ready', firstRoad = null,
  }: { plannedSecond?: VertexId[]; survival?: number; status?: DraftAnalysis['status']; firstRoad?: EdgeId | null } = {}) => {
    const job = jobs.at(-1)!
    await act(async () => job.reply({
      status, draft: inferDraftState(job.request.board), warnings: [], takenBeforeFirstPick,
      recommendations: firstPicks.map((firstPick) => ({
        firstPick, firstRoad, secondRoad: null, plannedSecond,
        survival, score: 0.5, rankScore: 0.5,
        breakdown: { ...emptyBreakdown(), production: 0.7, robber: -0.2 },
      })),
    }))
  }
  const tiles = (spot: Element | null | undefined) => [...spot?.querySelectorAll<SVGGElement>(':scope > g.spot-tile') ?? []]
  const translate = (tile: Element) => {
    const match = /^translate\(([-\d.]+) ([-\d.]+)\)$/.exec(tile.getAttribute('transform') ?? '')
    expect(match).not.toBeNull()
    return { x: Number(match![1]), y: Number(match![2]) }
  }
  const expectOffset = (from: Element, to: Element, fromCoord: AxialCoord, toCoord: AxialCoord, side: number) => {
    const a = translate(from)
    const b = translate(to)
    const expectedA = axialToPixel(fromCoord, side)
    const expectedB = axialToPixel(toCoord, side)
    expect(Math.abs(b.x - a.x - (expectedB.x - expectedA.x))).toBeLessThan(0.01)
    expect(Math.abs(b.y - a.y - (expectedB.y - expectedA.y))).toBeLessThan(0.01)
  }
  let dispatch: ReturnType<typeof useStore>['dispatch']
  const render = async (onBuild?: () => void) => {
    await act(async () => root.render(<StoreProvider><AnalysisProvider>
      <Commit report={(value) => { dispatch = value }} /><AnalysisPanel onBuild={onBuild} />
    </AnalysisProvider></StoreProvider>))
  }

  beforeEach(async () => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    localStorage.clear()
    sessionStorage.clear()
    jobs = []
    vi.stubGlobal('Worker', class {
      onmessage: ((event: MessageEvent) => void) | null = null
      postMessage(request: AnalysisRequest) {
        jobs.push({
          request,
          reply: (analysis) => this.onmessage?.({ data: { id: request.id, analysis } } as MessageEvent),
        })
      }
      terminate() {}
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await render()
    await act(async () => dispatch({ type: 'commit', board: opening() }))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', false)
  })

  const gone: TakenVertex[] = [
    { playerId: 'b', vertexId: ANY_PORT, road: null, frequency: 0.54 },
    { playerId: 'aki', vertexId: ORE_PORT, road: null, frequency: 0.31 },
  ]

  it('a: draws each pick, follow-up and Likely gone spot as one SVG at its own size', async () => {
    await reply(gone)
    expect(container.querySelector('.analysis-list.pick-ledger')).not.toBeNull()
    expect(container.querySelector('.spot-pill')).toBeNull()
    expect(container.querySelectorAll('svg.spot-tiles')).toHaveLength(6)
    const pick = container.querySelector('.analysis-row-select > svg.spot-tiles')
    expect(pick).not.toBeNull()
    expect(pick?.classList.contains('spot-tiles-small')).toBe(false)
    const small = container.querySelectorAll('.analysis-follow-spot, .analysis-gone-entry')
    expect(small).toHaveLength(5)
    for (const spot of small) {
      expect(spot.querySelectorAll('svg.spot-tiles.spot-tiles-small')).toHaveLength(1)
    }
    for (const spot of container.querySelectorAll('svg.spot-tiles')) expect(spot.querySelector('svg')).toBeNull()
  })

  it('a: uses small clusters in the no-availability placeholder', async () => {
    await reply(gone, [], { status: 'no-availability' })
    expect(container.querySelectorAll('.analysis-placeholder .analysis-gone-spots > svg.spot-tiles.spot-tiles-small')).toHaveLength(2)
    expect(container.querySelector('.spot-pill')).toBeNull()
  })

  it('b: draws board colours, a cactus and tokens on numbered hexes, including blanks', async () => {
    await reply([], [INLAND], { plannedSecond: [ANY_PORT, ORE_PORT, TWO_HEX, INLAND] })
    const pick = tiles(container.querySelector('.analysis-row-select > .spot-tiles'))
    expect(pick).toHaveLength(3)
    expect(pick.map((tile) => tile.querySelector('polygon')?.getAttribute('fill'))).toEqual([
      TILE_COLORS.wood, TILE_COLORS.ore, TILE_COLORS.desert,
    ])
    const small = tiles(container.querySelectorAll('.analysis-follow-spot > .spot-tiles')[3])
    expect(small).toHaveLength(3)
    for (const [cluster, radius] of [[pick, 13.2], [small, 10.7]] as const) {
      for (const tile of cluster) {
        const points = tile.querySelector('polygon')!.getAttribute('points')!.split(' ').map((point) => point.split(',').map(Number))
        expect(points).toHaveLength(6)
        expect(points[0][0]).toBeCloseTo(0, 5)
        expect(points[0][1]).toBeCloseTo(-radius, 5)
        for (const [x, y] of points) expect(Math.hypot(x, y)).toBeCloseTo(radius, 5)
      }
    }
    const desert = pick[2]
    expect(desert.querySelector('circle, text')).toBeNull()
    expect(desert.querySelectorAll('path')).toHaveLength(2)
    expect(desert.querySelector('rect')?.getAttribute('fill')).toBe('#c29b4a')
    expect(desert.querySelector(':scope > g')?.getAttribute('transform')).toBe('translate(-7 -7) scale(0.7)')
    const smallCactus = /^translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)$/.exec(
      small[2].querySelector(':scope > g')?.getAttribute('transform') ?? '',
    )
    expect(smallCactus).not.toBeNull()
    for (const [index, expected] of [-5.75, -5.75, 0.575].entries()) {
      expect(Math.abs(Number(smallCactus![index + 1]) - expected)).toBeLessThan(0.01)
    }
    const incomplete = tiles(container.querySelectorAll('.analysis-follow-spot > .spot-tiles')[2])
    expect(incomplete).toHaveLength(2)
    expect(incomplete.map((tile) => tile.querySelector('polygon')?.getAttribute('fill'))).toEqual(['#d8d7cc', TILE_COLORS.wheat])
    expect(incomplete[0].querySelector('circle')).not.toBeNull()
    expect(incomplete[0].querySelector('text')?.textContent).toBe('9')
    expect(incomplete[1].querySelector('circle, text')).toBeNull()
  })

  it('c: sizes one- and two-digit tokens at both scales and makes only 6 and 8 hot', async () => {
    await reply([], [INLAND, MIRRORED], { plannedSecond: [INLAND, MIRRORED] })
    const spots = [...container.querySelectorAll<SVGSVGElement>('.spot-tiles')]
    expect(spots).toHaveLength(6)
    for (const spot of spots) {
      const k = spot.classList.contains('spot-tiles-small') ? 11.5 / 14 : 1
      const tokens = [...spot.querySelectorAll<SVGTextElement>('text')]
      expect(tokens.map((token) => token.textContent)).toEqual(spot.getAttribute('aria-label')?.startsWith('Wood') ? ['6', '8'] : ['10', '11', '5'])
      for (const token of tokens) {
        const number = Number(token.textContent)
        expect(token.getAttribute('class')).toBe([6, 8].includes(number) ? 'token-text hot' : 'token-text')
        const fontSize = (number < 10 ? 10 : 8.5) * k
        expect(parseFloat(token.style.fontSize)).toBeCloseTo(fontSize, 8)
        expect(Number(token.getAttribute('y'))).toBeCloseTo(0.35 * fontSize, 8)
        expect(token.getAttribute('text-anchor')).toBe('middle')
        const disc = token.parentElement!.querySelector('circle')!
        expect(Number(disc.getAttribute('r'))).toBeCloseTo(7.6 * k, 8)
        expect(disc.getAttribute('fill')).toBe(TOKEN_COLOR)
        expect(disc.getAttribute('stroke')).toBe(INK_COLOR)
        expect(Number(disc.getAttribute('stroke-width'))).toBeCloseTo(0.8 * k, 8)
      }
    }
  })

  it.each([false, true])('d: keeps both inland orientations in board coordinates (small: %s)', async (small) => {
    await reply([], [INLAND, MIRRORED], { plannedSecond: [INLAND, MIRRORED] })
    const spots = container.querySelectorAll(small ? '.analysis-follow-spot > .spot-tiles' : '.analysis-row-select > .spot-tiles')
    const side = small ? 11.5 : 14
    const fixtures = [
      [
        { fill: TILE_COLORS.wood, text: '6', coord: { q: -1, r: -1 } },
        { fill: TILE_COLORS.ore, text: '8', coord: { q: 0, r: -1 } },
        { fill: TILE_COLORS.desert, text: '', coord: { q: -1, r: 0 } },
      ],
      [
        { fill: TILE_COLORS.sheep, text: '10', coord: { q: 1, r: -1 } },
        { fill: TILE_COLORS.brick, text: '11', coord: { q: 0, r: 0 } },
        { fill: TILE_COLORS.wheat, text: '5', coord: { q: 1, r: 0 } },
      ],
    ]
    fixtures.forEach((parts, index) => {
      const drawn = parts.map(({ fill, text }) => tiles(spots[index]).find((tile) =>
        tile.querySelector('polygon')?.getAttribute('fill') === fill && tile.textContent === text)!)
      expect(drawn.every(Boolean)).toBe(true)
      for (let a = 0; a < parts.length; a += 1) {
        for (let b = a + 1; b < parts.length; b += 1) {
          expectOffset(drawn[a], drawn[b], parts[a].coord, parts[b].coord, side)
        }
      }
      const ys = drawn.map((tile) => translate(tile).y)
      if (index === 0) {
        expect(ys[0]).toBe(ys[1])
        expect(ys[2]).toBeGreaterThan(ys[0])
      } else {
        expect(ys[1]).toBe(ys[2])
        expect(ys[1]).toBeGreaterThan(ys[0])
      }
    })
  })

  it.each([false, true])('e: draws generic and ore badges in their sea hexes (small: %s)', async (small) => {
    await reply([], [ANY_PORT, ORE_PORT], { plannedSecond: [ANY_PORT, ORE_PORT] })
    const spots = container.querySelectorAll(small ? '.analysis-follow-spot > .spot-tiles' : '.analysis-row-select > .spot-tiles')
    const side = small ? 11.5 : 14
    const k = side / 14
    const fixtures = [
      { fill: TOKEN_COLOR, text: '3:1', ink: INK_COLOR, land: { q: -1, r: 2 }, sea: { q: -1, r: 3 } },
      { fill: TILE_COLORS.ore, text: '2:1', ink: TOKEN_COLOR, land: { q: -2, r: 0 }, sea: { q: -3, r: 0 } },
    ]
    fixtures.forEach(({ fill, text, ink, land, sea }, index) => {
      const parts = tiles(spots[index])
      expect(parts).toHaveLength(2)
      const port = spots[index].querySelector('g.spot-tile.spot-port')!
      expect(port).not.toBeNull()
      expect(parts[1]).toBe(port)
      expect(port.querySelector('polygon, circle')).toBeNull()
      const rect = port.querySelector('rect')!
      expect(rect.getAttribute('fill')).toBe(fill)
      expect(rect.getAttribute('stroke')).toBe(INK_COLOR)
      for (const [attribute, expected] of Object.entries({ x: -10, y: -6, width: 20, height: 12, rx: 6, 'stroke-width': 1 })) {
        expect(Number(rect.getAttribute(attribute))).toBeCloseTo(expected * k, 8)
      }
      const label = port.querySelector('text')!
      expect(label.textContent).toBe(text)
      expect(label.getAttribute('text-anchor')).toBe('middle')
      expect(label.getAttribute('fill')).toBe(ink)
      expect(Number(label.getAttribute('y'))).toBeCloseTo(2.7 * k, 8)
      expect(parseFloat(label.style.fontSize)).toBeCloseTo(7.5 * k, 8)
      expectOffset(parts[0], port, land, sea, side)
    })
  })

  it.each([false, true])('f: crops one- and two-part coastal spots and inland clusters to their union (small: %s)', async (small) => {
    await reply([], [ONE_HEX, TWO_HEX, ANY_PORT, ORE_PORT, INLAND], { plannedSecond: [ONE_HEX, TWO_HEX, ANY_PORT, ORE_PORT, INLAND] })
    const spots = container.querySelectorAll(small ? '.analysis-row:first-child .analysis-follow-spot > .spot-tiles' : '.analysis-row-select > .spot-tiles')
    expect(spots).toHaveLength(5)
    const side = small ? 11.5 : 14
    const widths = [Math.sqrt(3), 1.5 * Math.sqrt(3), 1.5 * Math.sqrt(3), 2 * Math.sqrt(3), 2 * Math.sqrt(3)]
    const heights = [2, 3.5, 3.5, 2, 3.5]
    expect([...spots].map((spot) => tiles(spot).length)).toEqual([1, 2, 2, 2, 3])
    spots.forEach((spot, index) => {
      const width = Number((widths[index] * side).toFixed(2))
      const height = Number((heights[index] * side).toFixed(2))
      expect(Number(spot.getAttribute('width'))).toBe(width)
      expect(Number(spot.getAttribute('height'))).toBe(height)
      expect(spot.getAttribute('viewBox')?.split(' ').map(Number)).toEqual([0, 0, width, height])
      const centres = tiles(spot).map(translate)
      expect(Math.min(...centres.map(({ x }) => x))).toBeCloseTo(Math.sqrt(3) / 2 * side, 2)
      expect(Math.min(...centres.map(({ y }) => y))).toBeCloseTo(side, 2)
      for (const { x, y } of centres) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(width)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(height)
      }
    })
  })

  it('g: preserves each vertex description as the image name and pick tooltip', async () => {
    await reply(gone, [INLAND, MIRRORED, ONE_HEX, TWO_HEX, ORE_PORT])
    const picks = [...container.querySelectorAll('.analysis-row-select > .spot-tiles')]
    expect(picks.map((spot) => spot.getAttribute('aria-label'))).toEqual([
      'Wood 6 · Ore 8 · Desert', 'Sheep 10 · Brick 11 · Wheat 5', 'Wheat 9',
      'Unassigned · Wheat ?', 'Wheat 9 · Ore 2:1 port',
    ])
    for (const spot of container.querySelectorAll('.spot-tiles')) expect(spot.getAttribute('role')).toBe('img')
    for (const pick of picks) expect(pick.parentElement?.getAttribute('title')).toBe(pick.getAttribute('aria-label'))
    const labels = ['Wheat 9 · 3:1 port', 'Wheat 9 · Ore 2:1 port', 'Unassigned · Wheat ?']
    const follows = container.querySelectorAll('.analysis-follow')
    expect(follows).toHaveLength(5)
    for (const follow of follows) {
      expect([...follow.querySelectorAll('.spot-tiles')].map((spot) => spot.getAttribute('aria-label'))).toEqual(labels)
    }
    expect([...container.querySelectorAll('.analysis-gone-entry .spot-tiles')].map((spot) => spot.getAttribute('aria-label'))).toEqual(labels.slice(0, 2))
  })

  it('renders no cluster for a follow-up corner outside the board', async () => {
    await expect(reply([], [INLAND], { plannedSecond: ['v:10,10;10,11;11,10'] })).resolves.toBeUndefined()
    expect(container.querySelectorAll('.analysis-row-select > svg.spot-tiles')).toHaveLength(1)
    const follows = container.querySelectorAll('.analysis-follow-spot')
    expect(follows).toHaveLength(1)
    expect(follows[0].querySelector('svg.spot-tiles')).toBeNull()
  })

  it('h: puts the thumbnail, body, score and selected factors in separate ledger columns', async () => {
    await reply(gone, [INLAND], { survival: 0.54 })
    const row = container.querySelector('.analysis-row-select')!
    expect([...row.children].map((child) => child.getAttribute('class'))).toEqual([
      'analysis-rank', 'spot-tiles', 'analysis-row-body', 'analysis-score',
    ])
    expect(container.querySelector('.pick-ledger .analysis-pick-line')).toBeNull()
    expect(row.querySelector(':scope > .analysis-score')?.textContent).toBe('0.5')
    const body = row.querySelector('.analysis-row-body')!
    expect([...body.children].map((child) => child.getAttribute('class'))).toEqual(['analysis-availability', 'analysis-follow'])
    expect(body.firstElementChild?.textContent).toBe('54% likely available')
    expect([...body.querySelectorAll('.analysis-follow-spot')].map((spot) => spot.firstElementChild?.textContent)).toEqual(['then', 'or', 'or'])
    const entries = [...container.querySelectorAll('.analysis-gone-entry')]
    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => entry.firstElementChild?.textContent)).toEqual(['1. Blue', '2. aki'])
    expect(entries.map((entry) => entry.lastElementChild?.textContent)).toEqual(['54%', '31%'])
    for (const entry of entries) expect(entry.children).toHaveLength(3)
    await click(row)
    expect([...row.children].map((child) => child.getAttribute('class'))).toEqual([
      'analysis-rank', 'spot-tiles', 'analysis-row-body', 'analysis-score', 'analysis-factors',
    ])
    const factors = [...row.querySelectorAll(':scope > .analysis-factors > span')]
    expect(factors.map((factor) => factor.textContent)).toEqual(['Production +0.7', 'Robber −0.2'])
    expect(factors.map((factor) => [...factor.childNodes].slice(0, -1).map((node) => node.textContent).join(''))).toEqual(['Production ', 'Robber '])
    expect(factors.map((factor) => factor.querySelector('b')?.textContent)).toEqual(['+0.7', '−0.2'])
  })

  it.each([false, true])('i: opens factors only for the selected row (phone: %s)', async (phone) => {
    if (phone) {
      vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
      await render(() => {})
    }
    await reply([], [INLAND, MIRRORED])
    expect(container.querySelector('.analysis-factors')).toBeNull()
    const rows = container.querySelectorAll('.analysis-row-select')
    await click(rows[0])
    expect(container.querySelectorAll('.analysis-factors')).toHaveLength(1)
    expect(rows[0].querySelector('.analysis-factors')).not.toBeNull()
    expect(rows[1].querySelector('.analysis-factors')).toBeNull()
    await click(rows[1])
    expect(rows[0].querySelector('.analysis-factors')).toBeNull()
    expect(rows[1].querySelector('.analysis-factors')).not.toBeNull()
    await click(rows[1])
    expect(container.querySelector('.analysis-factors')).toBeNull()
  })

  describe('contest notes', () => {
    const adjacency = vertexAdjacency('standard4')
    const near = (vertexId: VertexId) => adjacency.get(vertexId)!
    const edge = (a: VertexId, b: VertexId): EdgeId =>
      vertexIncidentEdgeIds(a).find((edgeId) => edgeEndpointVertexIds(edgeId).includes(b))!
    const pick = [...adjacency.keys()].find((vertexId) => near(vertexId).length === 3
      && near(vertexId).every((n) => near(n).length === 3 && near(n).every((s) => near(s).length === 3
        && near(s).every((t) => near(t).length === 3))))!
    const far = near(pick)[0]
    const firstRoad = edge(pick, far)
    const [s1, s2] = near(far).filter((vertexId) => vertexId !== pick)
    const [t1, t2] = near(s1).filter((vertexId) => vertexId !== far)
    const u1 = near(t1).find((vertexId) => vertexId !== s1)!
    const u2 = near(t2).find((vertexId) => vertexId !== s1 && vertexId !== u1 && !near(u1).includes(vertexId))!
    const thirdRoad = edge(t1, near(t1).find((vertexId) => vertexId !== s1 && vertexId !== u1)!)
    const v = near(s2).find((vertexId) => vertexId !== far)!
    const w = near(v).find((vertexId) => vertexId !== s2)!
    const roster = () => addPlayer(addPlayer(opening(), { id: 'c', name: 'White', color: '#ffffff' }),
      { id: 'd', name: 'Orange', color: '#e58331' })
    const commit = async (board: Board) => act(async () => dispatch({ type: 'commit', board }))
    const show = () => reply([], [pick], { firstRoad })
    const notes = () => [...container.querySelectorAll('.analysis-contest')].map((note) => note.textContent)

    it('names one rival and places the note below the score and above selected factors', async () => {
      await commit(placeRoad(roster(), edge(u1, t1), 'b'))
      await show()
      expect(notes()).toEqual(['Blue can reach 1 of 2 spots'])
      const row = container.querySelector('.analysis-row-select')!
      const note = row.querySelector('.analysis-contest')!
      expect(note.parentElement).toBe(row)
      expect(note.previousElementSibling?.className).toBe('analysis-score')
      expect(row.querySelector('.analysis-row-body .analysis-contest')).toBeNull()
      await click(row)
      expect(note.nextElementSibling?.className).toBe('analysis-factors')
    })

    it('combines two rivals with the same count in roster order', async () => {
      await commit(placeRoad(placeRoad(roster(), edge(u1, t1), 'c'), edge(u2, t2), 'b'))
      await show()
      expect(notes()).toEqual(['Blue and White can reach 1 of 2 spots'])
    })

    it('combines three rivals with commas and a final and', async () => {
      const board = placeRoad(placeRoad(roster(), edge(u1, t1), 'c'), edge(u2, t2), 'b')
      await commit(placeRoad(board, thirdRoad, 'd'))
      await show()
      expect(notes()).toEqual(['Blue, White and Orange can reach 1 of 2 spots'])
    })

    it('separates different counts with a semicolon in roster group order', async () => {
      const board = placeRoad(placeRoad(roster(), edge(u1, t1), 'c'), edge(u2, t2), 'b')
      await commit(placeRoad(board, edge(v, w), 'c'))
      await show()
      expect(notes()).toEqual(['Blue can reach 1 of 2 spots; White can reach 2 of 2 spots'])
    })

    it('keeps the earlier rival first when that rival contests more spots', async () => {
      const board = placeRoad(placeRoad(roster(), edge(u1, t1), 'b'), edge(u2, t2), 'c')
      await commit(placeRoad(board, edge(v, w), 'b'))
      await show()
      expect(notes()).toEqual(['Blue can reach 2 of 2 spots; White can reach 1 of 2 spots'])
    })

    it('keeps a group together when another count occurs between its rivals', async () => {
      let board = placeRoad(placeRoad(roster(), edge(u1, t1), 'c'), edge(u2, t2), 'b')
      board = placeRoad(placeRoad(board, edge(v, w), 'c'), thirdRoad, 'd')
      await commit(board)
      await show()
      expect(notes()).toEqual(['Blue and Orange can reach 1 of 2 spots; White can reach 2 of 2 spots'])
    })

    it('names the only spot when a rival road removes the other spot', async () => {
      await commit(placeRoad(roster(), edge(far, s2), 'b'))
      await show()
      expect(notes()).toEqual(['Blue can reach the only spot'])
    })

    it('omits the note when no rival contests or the row has no road', async () => {
      await commit(roster())
      await show()
      expect(notes()).toEqual([])
      await commit(placeRoad(roster(), edge(u1, t1), 'b'))
      await reply([], [pick])
      expect(notes()).toEqual([])
    })

    it('appends one ring per contested spot when the row is selected or hovered', async () => {
      await act(async () => root.render(<StoreProvider><AnalysisProvider>
        <Commit report={(value) => { dispatch = value }} /><AnalysisPanel /><Highlights />
      </AnalysisProvider></StoreProvider>))
      await commit(placeRoad(placeRoad(roster(), edge(u1, t1), 'b'), edge(v, w), 'b'))
      await show()
      expect(notes()).toEqual(['Blue can reach 2 of 2 spots'])
      const row = container.querySelector('.analysis-row-select')!
      const spots = [s1, s2].sort((a, b) => edge(far, a) < edge(far, b) ? -1 : 1)
      const expected = spots.map((ref) => ({ ref, color: '#3063ba', kind: 'ring' }))
      const marks = () => JSON.parse(container.querySelector('[data-highlights]')!.textContent!)
      await act(async () => row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
      expect(marks().slice(-2)).toEqual(expected)
      await click(row)
      expect(marks().filter((mark: { kind?: string }) => mark.kind === 'ring')).toEqual(expected)
      expect(marks().slice(-2)).toEqual(expected)
    })

    it('keeps each row note and selected rings tied to that row', async () => {
      await act(async () => root.render(<StoreProvider><AnalysisProvider>
        <Commit report={(value) => { dispatch = value }} /><AnalysisPanel /><Highlights />
      </AnalysisProvider></StoreProvider>))
      await commit(placeRoad(roster(), edge(u1, t1), 'b'))
      expect(edgeEndpointVertexIds(firstRoad)).not.toContain(INLAND)
      await reply([], [INLAND, pick], { firstRoad })
      const rows = container.querySelectorAll('.analysis-row-select')
      expect(rows).toHaveLength(2)
      expect(rows[0].querySelector('.analysis-contest')).toBeNull()
      expect(rows[1].querySelector('.analysis-contest')?.textContent).toBe('Blue can reach 1 of 2 spots')
      const rings = () => JSON.parse(container.querySelector('[data-highlights]')!.textContent!)
        .filter((mark: { kind?: string }) => mark.kind === 'ring')
      await click(rows[1])
      expect(rings()).toEqual([{ ref: s1, color: '#3063ba', kind: 'ring' }])
      await click(rows[0])
      expect(rings()).toEqual([])
    })

    it('holds the old board and names until the next ranking arrives', async () => {
      const board = placeRoad(roster(), edge(u1, t1), 'b')
      await commit(board)
      await show()
      expect(notes()).toEqual(['Blue can reach 1 of 2 spots'])
      await commit({ ...board, roads: [], players: board.players.map((player) => ({ ...player, name: 'Renamed' })) })
      expect(container.querySelector('.analysis-stale .analysis-contest')?.textContent).toBe('Blue can reach 1 of 2 spots')
      await show()
      expect(container.querySelector('.analysis-stale')).toBeNull()
      expect(notes()).toEqual([])
    })

    it.each(['b', 'aki'])('uses the viewed seat with a road owned by %s', async (owner) => {
      await commit(placeRoad(roster(), edge(u1, t1), owner))
      await act(async () => dispatch({ type: 'view-pick', slot: 1 }))
      expect(jobs.at(-1)!.request.board.mePlayerId).toBe('b')
      await show()
      expect(notes()).toEqual(owner === 'b' ? [] : ['aki can reach 1 of 2 spots'])
    })

    it('holds the ranked seat when the viewed seat changes during a pending ranking', async () => {
      await commit(placeRoad(roster(), edge(u1, t1), 'aki'))
      await act(async () => dispatch({ type: 'view-pick', slot: 1 }))
      await show()
      expect(notes()).toEqual(['aki can reach 1 of 2 spots'])
      await act(async () => dispatch({ type: 'view-pick', slot: 0 }))
      expect(container.querySelector('.analysis-stale .analysis-contest')?.textContent).toBe('aki can reach 1 of 2 spots')
      await show()
      expect(notes()).toEqual([])
    })

    it('ignores a likely-gone road until it is placed on the board', async () => {
      await commit(roster())
      await reply([{ playerId: 'b', vertexId: u1, road: edge(u1, t1), frequency: 1 }], [pick], { firstRoad })
      expect(notes()).toEqual([])
      await commit(placeRoad(roster(), edge(u1, t1), 'b'))
      await show()
      expect(notes()).toEqual(['Blue can reach 1 of 2 spots'])
    })
  })
})
