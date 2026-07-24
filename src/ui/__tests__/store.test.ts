import { describe, expect, it, vi } from 'vitest'
import { addPlayer, createBoard } from '../../model/board'
import { activeTab, reducer, type StoreState, type TabState } from '../store'

function tab(id: string, board = createBoard('standard4'), extra: Partial<TabState> = {}): TabState {
  return {
    id,
    title: id,
    board,
    past: [],
    future: [],
    activePlayerId: board.players[0].id,
    ...extra,
  }
}

function state(tabs: TabState[], activeTabId = tabs[0].id): StoreState {
  return {
    tabs,
    activeTabId,
    tool: { kind: 'tile', tile: 'wood' },
    notice: null,
    noticeSeq: 0,
    highlight: null,
  }
}

describe('editor history', () => {
  it('reconciles the active player after undo and redo', () => {
    const original = createBoard('standard4')
    const withPlayer = addPlayer(original, {
      id: 'b',
      name: 'Bee',
      color: '#3063ba',
    })
    const start = state([tab('t1', withPlayer, { past: [original], activePlayerId: 'b' })])

    const undone = reducer(start, { type: 'undo' })
    expect(activeTab(undone).board).toBe(original)
    expect(activeTab(undone).activePlayerId).toBe('aki')

    const redone = reducer(undone, { type: 'redo' })
    expect(activeTab(redone).board).toBe(withPlayer)
    expect(withPlayer.players.some((player) => player.id === activeTab(redone).activePlayerId)).toBe(true)
  })

  it('commit and undo touch only the active tab', () => {
    const other = tab('t1')
    const start = state([other, tab('t2')], 't2')
    const edited = addPlayer(activeTab(start).board, { id: 'b', name: 'Bee', color: '#3063ba' })

    const committed = reducer(start, { type: 'commit', board: edited })
    expect(committed.tabs[0]).toBe(other)
    expect(activeTab(committed).board).toBe(edited)
    expect(activeTab(committed).past).toHaveLength(1)

    const undone = reducer(committed, { type: 'undo' })
    expect(undone.tabs[0]).toBe(other)
    expect(activeTab(undone).past).toHaveLength(0)
    expect(activeTab(undone).future).toHaveLength(1)
  })
})

describe('workspace tabs', () => {
  it('adds and activates a fresh default board with the smallest unused title', () => {
    const start = state([
      tab('t1', createBoard('standard4'), { title: 'Board 1' }),
      tab('t3', createBoard('standard4'), { title: 'Board 3' }),
    ])

    const added = reducer(start, { type: 'tab-add' })
    expect(added.tabs).toHaveLength(3)
    const fresh = activeTab(added)
    expect(fresh.title).toBe('Board 2')
    expect(fresh.board.layout).toBe('standard4')
    expect(fresh.past).toHaveLength(0)
    expect(fresh.future).toHaveLength(0)
    expect(fresh.activePlayerId).toBe(fresh.board.players[0].id)

    const again = reducer(added, { type: 'tab-add' })
    expect(activeTab(again).title).toBe('Board 4')
  })

  it('adds imported boards with an explicit title and id', () => {
    const board = createBoard('extension6')
    const added = reducer(state([tab('t1')]), { type: 'tab-add', board, title: 'Game with ben', id: 'g1' })
    expect(added.activeTabId).toBe('g1')
    expect(activeTab(added).board).toBe(board)
    expect(activeTab(added).title).toBe('Game with ben')
  })

  it('selects known tabs and ignores unknown ids', () => {
    const start = state([tab('t1'), tab('t2')], 't1')
    expect(reducer(start, { type: 'tab-select', id: 't2' }).activeTabId).toBe('t2')
    expect(reducer(start, { type: 'tab-select', id: 'nope' })).toBe(start)
  })

  it('renames tabs but ignores blank titles', () => {
    const start = state([tab('t1')])
    expect(reducer(start, { type: 'tab-rename', id: 't1', title: 'Thursday game' }).tabs[0].title).toBe('Thursday game')
    expect(reducer(start, { type: 'tab-rename', id: 't1', title: '   ' }).tabs[0].title).toBe('t1')
  })

  it('closing the active tab activates the right neighbor, then the last tab', () => {
    const start = state([tab('t1'), tab('t2'), tab('t3')], 't2')

    const closedMiddle = reducer(start, { type: 'tab-close', id: 't2' })
    expect(closedMiddle.tabs.map((entry) => entry.id)).toEqual(['t1', 't3'])
    expect(closedMiddle.activeTabId).toBe('t3')

    const closedLast = reducer(closedMiddle, { type: 'tab-close', id: 't3' })
    expect(closedLast.activeTabId).toBe('t1')
  })

  it('closing a background tab keeps the active tab', () => {
    const start = state([tab('t1'), tab('t2')], 't1')
    const closed = reducer(start, { type: 'tab-close', id: 't2' })
    expect(closed.activeTabId).toBe('t1')
    expect(closed.tabs).toHaveLength(1)
  })

  it('creates tab ids without crypto.randomUUID (insecure origins)', () => {
    const realCrypto = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) })
    try {
      const added = reducer(state([tab('t1')]), { type: 'tab-add' })
      const fresh = activeTab(added)
      expect(fresh.id).toBeTruthy()
      expect(fresh.id).not.toBe('t1')
      const again = reducer(added, { type: 'tab-add' })
      expect(activeTab(again).id).not.toBe(fresh.id)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('adopts an external workspace without losing local tabs or state', () => {
    const localBoard = createBoard('standard4')
    const original = createBoard('standard4')
    const local1 = tab('t1', localBoard, { past: [original] })
    const local2 = tab('t2')
    const start = state([local1, local2], 't1')

    const incomingBoard = createBoard('extension6')
    const adopted = reducer(start, {
      type: 'workspace-adopt',
      tabs: [
        { id: 't1', title: 'Renamed elsewhere', board: createBoard('extension6') },
        { id: 't3', title: 'From other window', board: incomingBoard },
      ],
    })

    expect(adopted.tabs.map((entry) => entry.id)).toEqual(['t1', 't2', 't3'])
    expect(adopted.tabs[0]).toBe(local1)
    expect(adopted.tabs[1]).toBe(local2)
    expect(adopted.tabs[2].title).toBe('From other window')
    expect(adopted.tabs[2].board).toBe(incomingBoard)
    expect(adopted.tabs[2].past).toHaveLength(0)
    expect(adopted.activeTabId).toBe('t1')
  })

  it('adopting a workspace with nothing new is a no-op', () => {
    const start = state([tab('t1'), tab('t2')], 't2')
    const adopted = reducer(start, {
      type: 'workspace-adopt',
      tabs: [{ id: 't1', title: 'ignored', board: createBoard('standard4') }],
    })
    expect(adopted).toBe(start)
  })

  it('closing the only tab leaves a fresh default board', () => {
    const closed = reducer(state([tab('t1')]), { type: 'tab-close', id: 't1' })
    expect(closed.tabs).toHaveLength(1)
    const fresh = activeTab(closed)
    expect(fresh.id).not.toBe('t1')
    expect(fresh.title).toBe('Board 1')
    expect(fresh.board.layout).toBe('standard4')
  })

  it('bumps noticeSeq on every notice so an identical repeat restarts the timer', () => {
    const start = state([tab('t1')])
    const first = reducer(start, { type: 'notice', message: 'Map name cannot be empty' })
    const second = reducer(first, { type: 'notice', message: 'Map name cannot be empty' })
    expect(first.noticeSeq).toBe(start.noticeSeq + 1)
    expect(second.noticeSeq).toBe(first.noticeSeq + 1)
    expect(second.notice).toBe('Map name cannot be empty')
  })
})

describe('highlight', () => {
  it('stores the marks it is given', () => {
    const marks = [{ ref: 'x', color: '#c23f38', label: '1' }] as const
    const highlighted = reducer(state([tab('t1')]), { type: 'highlight', marks })
    expect(highlighted.highlight).toBe(marks)
  })

  it('clears highlights with null', () => {
    const start = reducer(state([tab('t1')]), {
      type: 'highlight',
      marks: [{ ref: 'x' }],
    })
    expect(reducer(start, { type: 'highlight', marks: null }).highlight).toBeNull()
  })
})
