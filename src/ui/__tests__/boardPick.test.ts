import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, placeBuilding, placeRoad } from '../../model/board'
import { edgeEndpointVertexIds, vertexAdjacentVertexIds } from '../../model/coords'
import { newGame } from '../../model/game'
import { boardGrid } from '../../model/layouts'
import { buildingSlots, roadSlots } from '../placementSlots'
import { reducer, type StoreState, type TabState } from '../store'

const tab = (id: string): TabState => ({ id, title: id, game: newGame(createBoard('standard4')), past: [], future: [], activePlayerId: 'aki', mapId: null })
const state = (): StoreState => ({ tabs: [tab('a'), tab('b')], activeTabId: 'a', tool: { kind: 'tile', tile: 'wood' }, notice: null, noticeSeq: 0, highlight: null, pick: null, mapsRevision: 0 })

describe('board picking', () => {
  it('delivers one picked ref without editing the game or changing the tool', () => {
    const before = state()
    const waiting = reducer(before, { type: 'pick', target: { want: 'hex' } })
    const picked = reducer(waiting, { type: 'picked', ref: '0,0' })
    expect(picked.pick).toEqual({ want: 'hex', ref: '0,0' })
    expect(picked.tabs).toBe(before.tabs)
    expect(picked.tool).toBe(before.tool)
    expect(reducer(picked, { type: 'picked', ref: '1,0' })).toBe(picked)
    expect(reducer(picked, { type: 'pick-clear' }).pick).toBeNull()
    expect(reducer(before, { type: 'picked', ref: '0,0' })).toBe(before)
  })

  it('clears a pending pick when the active tab changes or closes', () => {
    const waiting = reducer(state(), { type: 'pick', target: { want: 'vertex', piece: 'city' } })
    expect(reducer(waiting, { type: 'picked', ref: 'spot' }).pick).toEqual({ want: 'vertex', piece: 'city', ref: 'spot' })
    expect(reducer(waiting, { type: 'tab-select', id: 'b' }).pick).toBeNull()
    expect(reducer(waiting, { type: 'tab-add' }).pick).toBeNull()
    expect(reducer(waiting, { type: 'tab-close', id: 'a' }).pick).toBeNull()
  })

  it('offers only connected empty road slots, including a road chosen in the tray', () => {
    const grid = boardGrid('standard4')
    const first = grid.edgeIds.find((edge) => edgeEndpointVertexIds(edge).every((vertex) => grid.edgeIds.filter((other) => edgeEndpointVertexIds(other).includes(vertex)).length === 3))!
    const [start, end] = edgeEndpointVertexIds(first)
    const board = placeBuilding(addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: 'blue' }), start, 'aki', 'settlement')
    const initial = roadSlots(board, 'aki')
    expect(initial).toEqual(grid.edgeIds.filter((edge) => edgeEndpointVertexIds(edge).includes(start)))
    expect(roadSlots(board, 'b')).toEqual([])
    const extended = roadSlots(board, 'aki', [first])
    const continuation = grid.edgeIds.find((edge) => edge !== first && edgeEndpointVertexIds(edge).includes(end))!
    expect(initial).not.toContain(continuation)
    expect(extended).toContain(continuation)
    expect(extended).not.toContain(first)
    expect(roadSlots(placeRoad(board, first, 'aki'), 'aki')).toEqual(extended)
    expect(roadSlots(placeRoad(board, first, 'b'), 'aki')).not.toContain(first)
    expect(roadSlots(placeBuilding(board, end, 'b', 'settlement'), 'aki', [first])).not.toContain(continuation)
    const waiting = reducer(state(), { type: 'pick', target: { want: 'edge', edges: [first] } })
    expect(reducer(waiting, { type: 'picked', ref: continuation }).pick).toEqual({ want: 'edge', edges: [first], ref: continuation })
  })

  it('offers road-connected distance-legal settlements and only own settlements for cities', () => {
    const grid = boardGrid('standard4')
    const [settlement, city, rival] = [grid.vertexIds[0], grid.vertexIds[20], grid.vertexIds[40]]
    let board = addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: 'blue' })
    board = placeBuilding(board, settlement, 'aki', 'settlement')
    board = placeBuilding(board, city, 'aki', 'city')
    board = placeBuilding(board, rival, 'b', 'settlement')
    expect(buildingSlots(board, 'aki', 'city', 'build')).toEqual([settlement])
    expect(buildingSlots(board, 'b', 'city', 'build')).toEqual([rival])
    const blocked = new Set([settlement, city, rival].flatMap((vertex) => [vertex, ...vertexAdjacentVertexIds(vertex)]))
    expect(buildingSlots(board, 'aki', 'settlement', 'build')).toEqual([])
    const edge = grid.edgeIds.find((edge) => edgeEndpointVertexIds(edge).every((vertex) => !blocked.has(vertex)))!
    board = placeRoad(board, edge, 'aki')
    expect(buildingSlots(board, 'aki', 'settlement', 'build')).toEqual(grid.vertexIds.filter((vertex) => edgeEndpointVertexIds(edge).includes(vertex)))
    expect(buildingSlots(board, 'b', 'settlement', 'build')).toEqual([])
    expect(buildingSlots(board, 'aki', 'settlement', 'edit')).toEqual(grid.vertexIds.filter((vertex) => vertex === city || !blocked.has(vertex)))
    expect(buildingSlots(board, null, 'settlement', 'build')).toEqual([])
    expect(buildingSlots(board, 'aki', 'city', 'edit')).toContain(grid.vertexIds.find((vertex) => !blocked.has(vertex)))
  })
})
