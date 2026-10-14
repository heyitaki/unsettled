import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { edgeIdOf, vertexIdOf } from '../../model/coords'
import { createBoard } from '../../model/board'
import { boardGrid } from '../../model/layouts'
import { PLAYER_PALETTE, type Board, type EdgeId, type Hex, type Port, type Resource, type TileKind } from '../../model/types'
import { parseScreenshot, type RgbaImage } from '../index'
import { sorted, toSrgb } from './pillPixels'

// Colonist screenshots stay out of the repo (see fixtures/colonist.local), so
// this file runs only on a machine that has them.
const dir = fileURLToPath(new URL('../../../fixtures/colonist.local/', import.meta.url))

function load(name: string): RgbaImage {
  const png = PNG.sync.read(readFileSync(`${dir}${name}.png`))
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }
}

// Colonist's nine harbours never move; only their types are shuffled. Listed
// clockwise from the ship above the top-left tile.
const PORT_EDGES: EdgeId[] = [
  'e:0,-3;0,-2',
  'e:1,-2;2,-3',
  'e:2,-1;3,-2',
  'e:2,0;3,0',
  'e:1,1;1,2',
  'e:-1,2;-1,3',
  'e:-3,3;-2,2',
  'e:-3,1;-2,1',
  'e:-2,-1;-1,-1',
]

// Each board read by eye from the screenshots: tiles row by row, top to
// bottom and left to right, then the harbours in PORT_EDGES order.
const BOARDS = {
  a: {
    tiles: 'wood8 wood3 brick6 / wood10 sheep4 brick9 sheep2 / wood9 brick5 wheat11 ore10 ore5 / wheat12 sheep6 wheat3 wheat8 / desert sheep11 ore4',
    ports: 'any brick wheat wood sheep any ore any any',
  },
  b: {
    tiles: 'ore3 brick8 sheep10 / desert wood4 ore5 wood9 / wood6 wheat9 brick11 wheat6 sheep12 / wheat2 sheep10 ore3 wood11 / wheat5 sheep8 brick4',
    ports: 'any any ore any wheat brick wood any sheep',
  },
  c: {
    tiles: 'brick5 brick10 sheep8 / wheat2 ore9 wood3 wheat4 / wheat6 wheat4 ore11 sheep6 wood11 / sheep3 wood5 desert ore12 / wood8 brick10 sheep9',
    ports: 'wheat any any wood any ore brick sheep any',
  },
  d: {
    tiles: 'wood12 sheep11 sheep4 / desert brick6 sheep3 sheep8 / ore9 ore5 ore11 wheat10 wheat5 / wood10 wood4 wood9 brick2 / brick8 wheat3 wheat6',
    ports: 'ore sheep any brick wheat wood any any any',
  },
}

function terrain(board: keyof typeof BOARDS): { hexes: Hex[]; ports: Port[] } {
  const tiles = BOARDS[board].tiles.split(' ').filter((word) => word !== '/')
  const hexes = boardGrid('standard4').landCoords.map((coord, index): Hex => {
    const [, tile, number] = /^([a-z]+)(\d*)$/.exec(tiles[index])!
    return { coord, tile: tile as TileKind, numberToken: number ? Number(number) : null }
  })
  const ports = BOARDS[board].ports.split(' ').map((word, index): Port => ({
    edgeId: PORT_EDGES[index],
    resource: word === 'any' ? null : word as Resource,
    rate: word === 'any' ? 3 : 2,
  }))
  return { hexes, ports }
}

// A 1x display draws the same screen at half these captures' pixel size. No
// such capture exists, so a 2x2 box average of a 2x one stands in for it.
function halved(image: RgbaImage): RgbaImage {
  const width = image.width >> 1
  const height = image.height >> 1
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < 4; channel += 1) {
        const at = (dx: number, dy: number) => image.data[((2 * y + dy) * image.width + 2 * x + dx) * 4 + channel]
        data[(y * width + x) * 4 + channel] = Math.round((at(0, 0) + at(1, 0) + at(0, 1) + at(1, 1)) / 4)
      }
    }
  }
  return { width, height, data }
}

// On screen q runs right and r runs down, so these are a hex's six neighbours
// by compass side, and each corner sits between two of them.
const SIDES = { NE: [1, -1], E: [1, 0], SE: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [0, -1] } as const
const CORNERS = { N: ['NW', 'NE'], NE: ['NE', 'E'], SE: ['E', 'SE'], S: ['SE', 'SW'], SW: ['SW', 'W'], NW: ['W', 'NW'] } as const

// Pieces read by eye, per colour: `s` a settlement and `c` a city at a hex's
// corner, `r` a road along a hex's side. Each count was checked against the
// victory points and road length the screenshot's player panel shows.
const D_MIDGAME = {
  orange: 's 1,-2:S s 2,-1:NE s 2,-1:S s 2,0:NE r 0,-1:E r 2,-1:E r 2,-1:SW r 2,-1:SE r 2,0:NE',
  green: 'c 2,-2:S s -2,0:N c -2,0:SE r 2,-2:SE r 2,-1:NE r 1,-1:E r -2,0:NE r -2,0:E',
  red: 'c 0,-1:S c 0,0:SE r 0,-1:SW r -1,0:E r 0,0:E',
  blue: 's -2,2:N s -2,2:SW s -2,2:SE s 0,1:S s 1,1:S r -2,2:NW r -2,2:NE r -2,2:W r -2,2:E r 0,1:SE r 1,1:SW',
}
const PIECES: Record<string, Record<string, string>> = {
  // The road is still to be placed: circles mark its three candidate edges.
  'a-02-first-settlement-road-pending': { red: 's 1,0:NW' },
  'a-07-draft-complete': {
    green: 's 0,-2:SW s -1,0:N r 0,-2:W r -1,0:NE',
    orange: 's 0,-2:SE s 1,1:S r 0,-2:E r 1,1:SE',
    blue: 's -1,0:SW s -1,1:SE r -1,0:W r -1,1:E',
    red: 's 1,0:NW s 1,0:NE r 1,0:W r 1,0:E',
  },
  'a-11-robber-moved-again': {
    green: 's 0,-2:SW s -1,0:N r 0,-2:W r -1,0:NE r -1,0:E',
    orange: 's 0,-2:SE s 1,1:S r 0,-2:E r 1,1:SE r 1,1:E',
    blue: 's -1,0:SW s -1,1:SE r -1,0:W r -1,1:E r 0,0:SW',
    red: 's 1,0:NW s 1,0:NE r 1,0:W r 1,0:E',
  },
  'b-05-draft-last-pick-1280': {
    orange: 's 0,-2:SE s 0,1:SE r 0,-2:E r 1,1:SW',
    blue: 's -1,0:NW s -1,2:SE r -1,0:W r -1,2:E',
    red: 's 0,0:NE r 0,0:E',
    green: 's -1,0:S s -1,2:SW r -1,0:SE r -1,2:W',
  },
  'c-01-draft-second-to-pick-1600': { green: 's 0,-2:S r 0,-2:SE' },
  'd-03-draft-complete': {
    orange: 's 1,-2:S s 2,-1:S r 0,-1:E r 2,-1:SE',
    green: 's 2,-2:S s -2,0:SE r 2,-2:SE r -2,0:E',
    red: 's 0,-1:S s 0,0:SE r -1,0:E r 0,0:E',
    blue: 's -2,2:N s 0,1:S r -2,2:NE r 0,1:SE',
  },
  'd-06-knight-played-robber-by-city': {
    orange: 's 1,-2:S s 2,-1:S r 0,-1:E r 2,-1:E r 2,-1:SE',
    green: 's 2,-2:S s -2,0:SE r 2,-2:SE r 2,-1:NE r -2,0:E',
    red: 'c 0,-1:S s 0,0:SE r 0,-1:SW r -1,0:E r 0,0:E',
    blue: 's -2,2:N s -2,2:SE s 0,1:S r -2,2:NE r -2,2:E r 0,1:SE r 1,1:SW',
  },
  'd-10-two-green-cities-two-red': D_MIDGAME,
  'd-11-midgame-cities-1440': D_MIDGAME,
}

function expectedPieces(name: string) {
  const buildings: object[] = []
  const roads: object[] = []
  for (const [color, list] of Object.entries(PIECES[name])) {
    const words = list.split(' ')
    for (let index = 0; index < words.length; index += 2) {
      const [hex, at] = words[index + 1].split(':')
      const [q, r] = hex.split(',').map(Number)
      const beside = (side: keyof typeof SIDES) => ({ q: q + SIDES[side][0], r: r + SIDES[side][1] })
      if (words[index] === 'r') roads.push({ edgeId: edgeIdOf([{ q, r }, beside(at as keyof typeof SIDES)]), color })
      else buildings.push({
        vertexId: vertexIdOf([{ q, r }, ...CORNERS[at as keyof typeof CORNERS].map(beside)]),
        color,
        tier: words[index] === 'c' ? 'city' : 'settlement',
      })
    }
  }
  return { buildings: sorted(buildings), roads: sorted(roads) }
}

function pieces(board: Board) {
  const names = Object.keys(PLAYER_PALETTE) as (keyof typeof PLAYER_PALETTE)[]
  const color = (playerId: string) => {
    const hex = board.players.find((player) => player.id === playerId)?.color
    return names.find((name) => PLAYER_PALETTE[name] === hex)
  }
  return {
    buildings: sorted(board.buildings.map(({ vertexId, playerId, tier }) => ({ vertexId, color: color(playerId), tier }))),
    roads: sorted(board.roads.map(({ edgeId, playerId }) => ({ edgeId, color: color(playerId) }))),
  }
}

// The player panel read by eye: its rows top to bottom, the viewer's box
// last, each as `colour hand devCards knights`. The panel lists the players in
// turn order but rotated to put the viewer last, so who goes first shows only
// while the draft is unfinished: from the settlement counts, or from whose row
// is lit when the counts are level. `first` is null where it cannot be told.
const D_PANEL = { first: null, rows: 'blue 4 0 0 / orange 5 0 1 / green 1 0 1 / red 11 1 0' }
const PANELS: Record<string, { first: string | null; rows: string }> = {
  'a-01-draft-start': { first: 'red', rows: 'orange 0 0 0 / green 0 0 0 / blue 0 0 0 / red 0 0 0' },
  'a-11-robber-moved-again': { first: null, rows: 'orange 3 0 0 / green 5 0 0 / blue 6 0 0 / red 4 1 0' },
  'b-05-draft-last-pick-1280': { first: 'red', rows: 'orange 3 0 0 / blue 2 0 0 / green 3 0 0 / red 0 0 0' },
  'c-01-draft-second-to-pick-1600': { first: 'green', rows: 'blue 0 0 0 / orange 0 0 0 / green 0 0 0 / red 0 0 0' },
  'd-02-mid-draft-four-colours': { first: 'orange', rows: 'blue 3 0 0 / orange 0 0 0 / green 0 0 0 / red 0 0 0' },
  // A rival's row is lit here, and the viewer's box is not.
  'd-03-draft-complete': { first: null, rows: 'blue 4 0 0 / orange 5 0 0 / green 5 0 0 / red 4 0 0' },
  'd-06-knight-played-robber-by-city': { first: null, rows: 'blue 7 0 0 / orange 6 1 0 / green 5 0 1 / red 4 0 0' },
  'd-10-two-green-cities-two-red': D_PANEL,
  'd-11-midgame-cities-1440': D_PANEL,
}

function expectPanel(name: string, result: Extract<ReturnType<typeof parseScreenshot>, { ok: true }>) {
  const { board, stats } = result.game
  const rows = PANELS[name].rows.split(' / ').map((row) => row.split(' '))
  const panel = rows.map(([color]) => color)
  const start = PANELS[name].first === null ? 0 : panel.indexOf(PANELS[name].first)
  const names = Object.keys(PLAYER_PALETTE) as (keyof typeof PLAYER_PALETTE)[]
  const colors = board.players.map((player) => names.find((color) => PLAYER_PALETTE[color] === player.color))
  expect(colors).toEqual([...panel.slice(start), ...panel.slice(0, start)])
  expect(colors[board.players.findIndex((player) => player.id === board.mePlayerId)]).toBe('red')
  expect(Object.fromEntries(board.players.map((player, index) => {
    const { handUnknown, devCards, knights } = stats[player.id]
    return [colors[index], [handUnknown, devCards, knights].join(' ')]
  }))).toEqual(Object.fromEntries(rows.map(([color, ...counts]) => [color, counts.join(' ')])))
  expect(result.issues.filter((issue) => issue.stage === 'stats')).toEqual([])
  expect(result.issues.some((issue) => issue.stage === 'roster')).toBe(PANELS[name].first === null)
  // Colonist never shows which of a player's settlements came first.
  expect(result.read).toEqual({
    roster: true,
    order: PANELS[name].first !== null,
    picks: false,
    hands: board.players.map((player) => player.id),
  })
}

// Issue refs are what the board can highlight, never a player id.
function expectBoardRefs(result: Extract<ReturnType<typeof parseScreenshot>, { ok: true }>) {
  const players = new Set(result.game.board.players.map((player) => player.id))
  expect(result.issues.filter((issue) => issue.ref !== undefined && players.has(issue.ref))).toEqual([])
}

// An update that changes nothing compares serialized games, so a parsed board
// must spell its keys the way the app's own boards do.
function expectAppKeyOrder(board: Board) {
  expect(Object.keys(board)).toEqual(Object.keys(createBoard('standard4')))
  for (const building of board.buildings) expect(Object.keys(building)).toEqual(['vertexId', 'playerId', 'tier'])
  for (const road of board.roads) expect(Object.keys(road)).toEqual(['edgeId', 'playerId'])
}

const unreadable = (result: ReturnType<typeof parseScreenshot>) =>
  result.ok ? result.issues.filter((issue) => issue.severity === 'unreadable') : []

// [screenshot, board, robber hex as "q,r"]
const CLEAR: [string, keyof typeof BOARDS, string][] = [
  ['a-01-draft-start', 'a', '-2,2'],
  ['a-02-first-settlement-road-pending', 'a', '-2,2'],
  ['a-06-draft-last-pick', 'a', '-2,2'],
  ['a-07-draft-complete', 'a', '-2,2'],
  // A trade offer panel hides the wheat harbour's sail; the type follows from the other eight.
  ['a-09-robber-on-numbered-tile', 'a', '0,-2'],
  ['a-11-robber-moved-again', 'a', '0,-1'],
  ['b-01-draft-start', 'b', '-1,-1'],
  ['b-02-draft-start-1280', 'b', '-1,-1'],
  ['b-03-mid-draft-1280', 'b', '-1,-1'],
  ['b-04-mid-draft-1280', 'b', '-1,-1'],
  ['b-05-draft-last-pick-1280', 'b', '-1,-1'],
  ['c-01-draft-second-to-pick-1600', 'c', '0,1'],
  ['d-01-draft-third-to-pick', 'd', '-1,-1'],
  ['d-02-mid-draft-four-colours', 'd', '-1,-1'],
  ['d-03-draft-complete', 'd', '-1,-1'],
  ['d-04-place-robber-prompt', 'd', '2,-1'],
  ['d-05-first-city-red', 'd', '0,1'],
  ['d-06-knight-played-robber-by-city', 'd', '0,-1'],
  ['d-07-midgame-bot-settlements', 'd', '0,1'],
  ['d-08-green-city-and-red-city', 'd', '0,1'],
  ['d-09-two-red-cities-one-green', 'd', '0,1'],
  ['d-10-two-green-cities-two-red', 'd', '-2,2'],
  ['d-11-midgame-cities-1440', 'd', '-2,2'],
]

describe.skipIf(!existsSync(dir))('Colonist screenshots', () => {
  it.each(CLEAR)('reads %s', (name, board, robber) => {
    const result = parseScreenshot(load(name))
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    const expected = terrain(board)
    const [q, r] = robber.split(',').map(Number)
    expect(result.game.board.layout).toBe('standard4')
    expect(result.game.board.hexes).toEqual(expected.hexes)
    expect(sorted(result.game.board.ports)).toEqual(sorted(expected.ports))
    expect(result.game.board.robber).toEqual({ q, r })
    expect(unreadable(result)).toEqual([])
    if (name in PIECES) expect(pieces(result.game.board)).toEqual(expectedPieces(name))
    if (name in PANELS) expectPanel(name, result)
    expectBoardRefs(result)
    expectAppKeyOrder(result.game.board)
  }, 20_000)

  // Dealt cards fly over one token and the producing tiles are dimmed in a-08;
  // a discard dialog covers the desert in a-10. Refusing or flagging either is
  // fine. Reporting a clean board that is wrong is not.
  it.each([
    ['a-08-trade-offer-overlay', 'a'],
    ['a-10-discard-dialog-overlay', 'a'],
  ] as const)('never reports a clean wrong board for %s', (name, board) => {
    const result = parseScreenshot(load(name))
    if (!result.ok || unreadable(result).length > 0) return
    const expected = terrain(board)
    expect(result.game.board.hexes).toEqual(expected.hexes)
    expect(sorted(result.game.board.ports)).toEqual(sorted(expected.ports))
  }, 20_000)

  it.each([
    ['a-11-robber-moved-again', 'a', '0,-1'],
    ['c-01-draft-second-to-pick-1600', 'c', '0,1'],
    ['d-10-two-green-cities-two-red', 'd', '-2,2'],
  ] as const)('reads %s at half resolution', (name, board, robber) => {
    const result = parseScreenshot(halved(load(name)))
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    const expected = terrain(board)
    const [q, r] = robber.split(',').map(Number)
    expect(result.game.board.hexes).toEqual(expected.hexes)
    expect(sorted(result.game.board.ports)).toEqual(sorted(expected.ports))
    expect(result.game.board.robber).toEqual({ q, r })
    expect(unreadable(result)).toEqual([])
    expect(pieces(result.game.board)).toEqual(expectedPieces(name))
    expectPanel(name, result)
  }, 20_000)

  // Windows 1280 and 1440 points wide leave a 1x digit about ten pixels tall.
  it.each([
    ['b-05-draft-last-pick-1280', 'b'],
    ['d-11-midgame-cities-1440', 'd'],
  ] as const)('never reports a clean wrong board for %s at half resolution', (name, board) => {
    const result = parseScreenshot(halved(load(name)))
    if (!result.ok || unreadable(result).length > 0) return
    const expected = terrain(board)
    expect(result.game.board.hexes).toEqual(expected.hexes)
    expect(sorted(result.game.board.ports)).toEqual(sorted(expected.ports))
    expect(pieces(result.game.board)).toEqual(expectedPieces(name))
    // Panel digits only cross-check points, so a count may be flagged but never wrong.
    if (result.issues.some((issue) => issue.stage === 'stats')) return
    expectPanel(name, result)
  }, 20_000)

  // The captures are Display P3; a browser canvas hands the parser sRGB.
  it.each([
    'a-11-robber-moved-again',
    'b-05-draft-last-pick-1280',
    'c-01-draft-second-to-pick-1600',
    'd-10-two-green-cities-two-red',
  ])('reads %s the same after conversion to sRGB', (name) => {
    const image = load(name)
    const raw = parseScreenshot(image)
    const converted = parseScreenshot(toSrgb(image))
    expect(raw).toMatchObject({ ok: true })
    expect(converted).toMatchObject({ ok: true })
    if (!raw.ok || !converted.ok) return
    expect(converted.game.board).toEqual(raw.game.board)
  }, 30_000)
})
