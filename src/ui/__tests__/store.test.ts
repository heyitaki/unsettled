import { describe, expect, it } from 'vitest'
import { addPlayer, createBoard, removePlayer, setTile } from '../../model/board'
import { adjustHand, newGame, type Game } from '../../model/game'
import { activeTab, reducer, type StoreState, type TabState } from '../store'
import { NOTHING_UNFLUSHED, type UnflushedWork } from '../workspaceSync'

const unflushed = (work: Partial<UnflushedWork> = {}): UnflushedWork => ({
  ...NOTHING_UNFLUSHED,
  ...work,
})

function tab(id: string, game = newGame(createBoard('standard4')), extra: Partial<TabState> = {}): TabState {
  return {
    id,
    title: id,
    game,
    past: [],
    future: [],
    activePlayerId: game.board.players[0].id,
    mapId: null,
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
    mapsRevision: 0,
  }
}

describe('editor history', () => {
  it('ignores an active-player id that is not on the roster', () => {
    // The reducer, not the caller, has the last word on roster membership: a
    // dangling id reaches placeRoad/placeBuilding, which throw on it.
    const start = state([tab('t1')])
    expect(activeTab(reducer(start, { type: 'active-player', playerId: 'ghost' })).activePlayerId).toBe('aki')
  })

  it('commit re-selects the active player when the roster drops them', () => {
    const twoPlayers = newGame(addPlayer(createBoard('standard4'), { id: 'b', name: 'Bee', color: '#3063ba' }))
    const start = state([tab('t1', twoPlayers, { activePlayerId: 'b' })])

    const removed = reducer(start, { type: 'commit', board: removePlayer(twoPlayers.board, 'b') })
    expect(activeTab(removed).activePlayerId).toBe('aki')
  })

  it('reconciles the active player after undo and redo', () => {
    const original = newGame(createBoard('standard4'))
    const withPlayer: Game = {
      ...original,
      board: addPlayer(original.board, { id: 'b', name: 'Bee', color: '#3063ba' }),
    }
    const start = state([tab('t1', withPlayer, { past: [original], activePlayerId: 'b' })])

    const undone = reducer(start, { type: 'undo' })
    expect(activeTab(undone).game).toBe(original)
    expect(activeTab(undone).activePlayerId).toBe('aki')

    const redone = reducer(undone, { type: 'redo' })
    expect(activeTab(redone).game).toBe(withPlayer)
    expect(withPlayer.board.players.some((player) => player.id === activeTab(redone).activePlayerId)).toBe(true)
  })

  it('commit and undo touch only the active tab', () => {
    const other = tab('t1')
    const start = state([other, tab('t2')], 't2')
    const edited = addPlayer(activeTab(start).game.board, { id: 'b', name: 'Bee', color: '#3063ba' })

    const committed = reducer(start, { type: 'commit', board: edited })
    expect(committed.tabs[0]).toBe(other)
    expect(activeTab(committed).game.board).toBe(edited)
    expect(activeTab(committed).past).toHaveLength(1)

    const undone = reducer(committed, { type: 'undo' })
    expect(undone.tabs[0]).toBe(other)
    expect(activeTab(undone).past).toHaveLength(0)
    expect(activeTab(undone).future).toHaveLength(1)
  })

  it('commit reconciles stats when the roster changes', () => {
    const start = state([tab('t1')])
    const grown = addPlayer(activeTab(start).game.board, { id: 'b', name: 'Bee', color: '#3063ba' })
    const added = reducer(start, { type: 'commit', board: grown })
    expect(Object.keys(activeTab(added).game.stats).sort()).toEqual(['aki', 'b'])

    const shrunk = removePlayer(grown, 'b')
    const removed = reducer(added, { type: 'commit', board: shrunk })
    expect(Object.keys(activeTab(removed).game.stats)).toEqual(['aki'])
  })

  it('commit keeps an edit that changes nothing off the undo stack', () => {
    const painted = newGame(setTile(createBoard('standard4'), { q: 0, r: 0 }, 'wheat', 6))
    const start = state([tab('t1', painted)])

    const repaint = reducer(start, { type: 'commit', board: setTile(painted.board, { q: 0, r: 0 }, 'wheat', 6) })
    expect(repaint).toBe(start)

    const real = reducer(start, { type: 'commit', board: setTile(painted.board, { q: 0, r: 0 }, 'ore', 6) })
    expect(activeTab(real).past).toEqual([painted])
  })

  it('commit-game records stat edits on the undo stack', () => {
    const start = state([tab('t1')])
    const before = activeTab(start).game
    const edited = adjustHand(before, 'aki', 'ore', 2)

    const committed = reducer(start, { type: 'commit-game', game: edited })
    expect(activeTab(committed).game.stats.aki.hand.ore).toBe(2)
    expect(activeTab(committed).past).toEqual([before])

    const undone = reducer(committed, { type: 'undo' })
    expect(activeTab(undone).game).toBe(before)

    // A no-op commit-game (same reference) leaves the state untouched.
    expect(reducer(committed, { type: 'commit-game', game: activeTab(committed).game })).toBe(committed)
  })

  it('commit-game re-selects the active player when the restored roster drops them', () => {
    // Build mode's Cancel restores a whole earlier game; a player added and
    // selected meanwhile must not survive as a dangling id.
    const original = newGame(createBoard('standard4'))
    const withPlayer: Game = {
      ...original,
      board: addPlayer(original.board, { id: 'b', name: 'Bee', color: '#3063ba' }),
    }
    const start = state([tab('t1', withPlayer, { activePlayerId: 'b' })])
    expect(activeTab(reducer(start, { type: 'commit-game', game: original })).activePlayerId).toBe('aki')
  })
})

describe('workspace tabs', () => {
  it('adds and activates a fresh default board with the smallest unused title', () => {
    const start = state([
      tab('t1', newGame(createBoard('standard4')), { title: 'Board 1' }),
      tab('t3', newGame(createBoard('standard4')), { title: 'Board 3' }),
    ])

    const added = reducer(start, { type: 'tab-add' })
    expect(added.tabs).toHaveLength(3)
    const fresh = activeTab(added)
    expect(fresh.title).toBe('Board 2')
    expect(fresh.game.board.layout).toBe('standard4')
    expect(fresh.past).toHaveLength(0)
    expect(fresh.future).toHaveLength(0)
    expect(fresh.activePlayerId).toBe(fresh.game.board.players[0].id)

    const again = reducer(added, { type: 'tab-add' })
    expect(activeTab(again).title).toBe('Board 4')
  })

  it('adds imported games with an explicit title and id', () => {
    const game = newGame(createBoard('extension6'))
    const added = reducer(state([tab('t1')]), { type: 'tab-add', game, title: 'Game with ben', id: 'g1' })
    expect(added.activeTabId).toBe('g1')
    expect(activeTab(added).game).toBe(game)
    expect(activeTab(added).title).toBe('Game with ben')
  })

  it('appends a new tab to the end of the open boards and opens it', () => {
    const start = state([tab('t1'), tab('t2'), tab('t3')], 't1')
    const game = newGame(createBoard('extension6'))

    const added = reducer(start, { type: 'tab-add', game, title: 'Harbour', id: 'new' })
    expect(added.tabs.map((entry) => entry.id)).toEqual(['t1', 't2', 't3', 'new'])
    expect(added.activeTabId).toBe('new')
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

  it('creates distinct tab ids', () => {
    const added = reducer(state([tab('t1')]), { type: 'tab-add' })
    const fresh = activeTab(added)
    expect(fresh.id).toBeTruthy()
    expect(fresh.id).not.toBe('t1')
    const again = reducer(added, { type: 'tab-add' })
    expect(activeTab(again).id).not.toBe(fresh.id)
  })

  it('adopts an external workspace, keeping local state for tabs it still lists', () => {
    const localGame = newGame(createBoard('standard4'))
    const original = newGame(createBoard('standard4'))
    const local1 = tab('t1', localGame, { past: [original] })
    const local2 = tab('t2')
    const start = state([local1, local2], 't1')

    const incomingGame = newGame(createBoard('extension6'))
    const adopted = reducer(start, {
      type: 'workspace-adopt',
      tabs: [
        { id: 't1', title: 'Renamed elsewhere', game: newGame(createBoard('extension6')) },
        { id: 't2', title: 't2', game: newGame(createBoard('standard4')) },
        { id: 't3', title: 'From other window', game: incomingGame },
      ],
    })

    expect(adopted.tabs.map((entry) => entry.id)).toEqual(['t1', 't2', 't3'])
    expect(adopted.tabs[0]).toBe(local1)
    expect(adopted.tabs[1]).toBe(local2)
    expect(adopted.tabs[2].title).toBe('From other window')
    expect(adopted.tabs[2].game).toBe(incomingGame)
    expect(adopted.tabs[2].past).toHaveLength(0)
    expect(adopted.activeTabId).toBe('t1')
  })

  it('adopts closures from another window instead of resurrecting the tabs', () => {
    const start = state([tab('t1'), tab('t2'), tab('t3')], 't2')
    const adopted = reducer(start, {
      type: 'workspace-adopt',
      tabs: [{ id: 't3', title: 't3', game: newGame(createBoard('standard4')) }],
    })
    expect(adopted.tabs.map((entry) => entry.id)).toEqual(['t3'])
    // The active tab was closed elsewhere, so activation falls to what survived.
    expect(adopted.activeTabId).toBe('t3')
  })

  it('keeps local tabs whose save has not been flushed yet', () => {
    const local2 = tab('t2')
    const start = state([tab('t1'), local2], 't2')
    const adopted = reducer(start, {
      type: 'workspace-adopt',
      tabs: [{ id: 't1', title: 't1', game: newGame(createBoard('standard4')) }],
      unflushed: unflushed({ added: ['t1', 't2'] }),
    })
    expect(adopted.tabs.map((entry) => entry.id)).toEqual(['t1', 't2'])
    expect(adopted.tabs[1]).toBe(local2)
    expect(adopted.activeTabId).toBe('t2')
  })

  it('adopting the same tab set is a no-op so two windows cannot ping-pong', () => {
    const start = state([tab('t1'), tab('t2')], 't2')
    const adopted = reducer(start, {
      type: 'workspace-adopt',
      tabs: [
        { id: 't1', title: 'renamed elsewhere', game: newGame(createBoard('extension6')) },
        { id: 't2', title: 't2', game: newGame(createBoard('standard4')) },
      ],
    })
    expect(adopted).toBe(start)
  })

  it('ignores an adoption that would leave no tabs at all', () => {
    const start = state([tab('t1')])
    expect(reducer(start, { type: 'workspace-adopt', tabs: [] })).toBe(start)
  })

  it('carries a map link through an adoption', () => {
    const start = state([tab('t1')])
    const adopted = reducer(start, {
      type: 'workspace-adopt',
      tabs: [
        { id: 't1', title: 't1', game: newGame(createBoard('standard4')) },
        { id: 't2', title: 'Alpha', game: newGame(createBoard('standard4')), mapId: 'map-1' },
      ],
    })
    expect(adopted.tabs[1].mapId).toBe('map-1')
  })

  it('adopts a link made elsewhere for a tab it already has', () => {
    // Keeping the local tab wholesale would drop the link, and this window's
    // next autosave would then erase it from storage for good.
    const start = state([tab('t1')])
    const adopted = reducer(start, {
      type: 'workspace-adopt',
      tabs: [{ id: 't1', title: 't1', game: newGame(createBoard('standard4')), mapId: 'map-1' }],
    })
    expect(adopted.tabs[0]).toMatchObject({ mapId: 'map-1', past: [], future: [] })
  })

  it('keeps local content but takes the incoming link when the two differ', () => {
    // Content cannot be merged, so local wins. A link can only ever be one
    // value, and keeping the local one leaves the two windows disagreeing
    // forever, each autosave overwriting the other's idea of where this tab
    // was saved.
    const original = newGame(createBoard('standard4'))
    const local = tab('t1', undefined, { mapId: 'map-1', past: [original] })
    const start = state([local])
    const adopted = reducer(start, {
      type: 'workspace-adopt',
      tabs: [{ id: 't1', title: 't1', game: newGame(createBoard('extension6')), mapId: 'map-2' }],
    })
    expect(adopted.tabs[0]).toMatchObject({ mapId: 'map-2', past: [original] })
    expect(adopted.tabs[0].game).toBe(local.game)
  })

  it('keeps a link this window made but has not written yet', () => {
    // The save that made the link is still in flight, so it is newer than
    // anything the incoming blob can hold; adopting the older link would let
    // our own pending write then persist the loss.
    const local = tab('t1', undefined, { mapId: 'map-2' })
    const start = state([local])
    const adopted = reducer(start, {
      type: 'workspace-adopt',
      tabs: [{ id: 't1', title: 't1', game: newGame(createBoard('standard4')), mapId: 'map-1' }],
      unflushed: unflushed({ relinked: ['t1'] }),
    })
    expect(adopted).toBe(start)
  })

  it('drops a link a kept local tab shares with an adopted one', () => {
    // Both windows opened the same map. Two tabs holding one link each treat a
    // save as "overwrite my own map", so the unflushed duplicate is unlinked
    // and the persisted tab keeps the map.
    const start = state([tab('t2', undefined, { mapId: 'map-1' })])
    const adopted = reducer(start, {
      type: 'workspace-adopt',
      tabs: [{ id: 't1', title: 'Alpha', game: newGame(createBoard('standard4')), mapId: 'map-1' }],
      unflushed: unflushed({ added: ['t2'] }),
    })
    expect(adopted.tabs.map((entry) => [entry.id, entry.mapId])).toEqual([
      ['t1', 'map-1'],
      ['t2', null],
    ])
  })

  it('drops a link the incoming blob gives to two tabs at once', () => {
    const start = state([tab('t1')])
    const adopted = reducer(start, {
      type: 'workspace-adopt',
      tabs: [
        { id: 't1', title: 'Alpha', game: newGame(createBoard('standard4')), mapId: 'map-1' },
        { id: 't2', title: 'Alpha', game: newGame(createBoard('standard4')), mapId: 'map-1' },
      ],
    })
    expect(adopted.tabs.map((entry) => entry.mapId)).toEqual(['map-1', null])
  })

  it('unlinks a tab whose link the other window dropped', () => {
    const start = state([tab('t1', undefined, { mapId: 'map-1' })])
    const adopted = reducer(start, {
      type: 'workspace-adopt',
      tabs: [{ id: 't1', title: 't1', game: newGame(createBoard('standard4')) }],
    })
    expect(adopted.tabs[0].mapId).toBeNull()
  })

  it('reports dropped tabs once, not on every echo of the same blob', () => {
    const start = state([tab('t1')])
    const adopted = reducer(start, {
      type: 'workspace-adopt',
      tabs: [
        { id: 't1', title: 't1', game: newGame(createBoard('standard4')) },
        { id: 't2', title: 't2', game: newGame(createBoard('standard4')) },
      ],
      warning: 'Ignored invalid workspace tabs: Board 3',
    })
    expect(adopted.notice).toBe('Ignored invalid workspace tabs: Board 3')
    // The echo adopts nothing, so it must not re-announce the same loss.
    const echo = reducer(adopted, {
      type: 'workspace-adopt',
      tabs: adopted.tabs.map(({ id, title, game }) => ({ id, title, game })),
      warning: 'Ignored invalid workspace tabs: Board 3',
    })
    expect(echo).toBe(adopted)
  })

  it('does not resurrect a tab that was persisted and then closed elsewhere', () => {
    // `added` carries only tabs this window has never written. A tab it did
    // write, now missing from the incoming set, was closed on purpose.
    const start = state([tab('t1'), tab('t2')], 't1')
    const adopted = reducer(start, {
      type: 'workspace-adopt',
      tabs: [{ id: 't1', title: 't1', game: newGame(createBoard('standard4')) }],
      unflushed: NOTHING_UNFLUSHED,
    })
    expect(adopted.tabs.map((entry) => entry.id)).toEqual(['t1'])
  })

  it('does not resurrect a tab closed here whose write is still in flight', () => {
    // The other window echoes the workspace as it stood a moment ago, and that
    // echo lands inside this one's autosave debounce. Adopting it would put the
    // tab back and this window's own pending write would then persist it.
    const start = state([tab('t1')], 't1')
    const adopted = reducer(start, {
      type: 'workspace-adopt',
      tabs: [
        { id: 't1', title: 't1', game: newGame(createBoard('standard4')) },
        { id: 't2', title: 't2', game: newGame(createBoard('standard4')) },
      ],
      unflushed: unflushed({ closed: ['t2'] }),
    })
    expect(adopted).toBe(start)
  })

  it('keeps the replacement tab alone after every tab was closed here', () => {
    // Closing the last tab mints a blank one, which is unflushed by definition.
    // Adopting the pre-close blob around it is the "several tabs pop back up"
    // report: the whole closed set, with the blank tab trailing them.
    const blank = tab('fresh')
    const start = state([blank], 'fresh')
    const adopted = reducer(start, {
      type: 'workspace-adopt',
      tabs: ['t1', 't2', 't3'].map((id) => ({
        id,
        title: id,
        game: newGame(createBoard('standard4')),
      })),
      unflushed: unflushed({ added: ['fresh'], closed: ['t1', 't2', 't3'] }),
    })
    expect(adopted.tabs.map((entry) => entry.id)).toEqual(['fresh'])
    expect(adopted.activeTabId).toBe('fresh')
  })
})

describe('library links', () => {
  // The tab helper titles each tab after its id, so a library entry named for
  // the tab it belongs to is the "nothing drifted" case.
  const library = (maps: { id: string; name: string }[]) => ({ readable: true as const, maps })

  it('links a tab to the map it was saved into, renaming it to match', () => {
    const start = state([tab('t1'), tab('t2')], 't1')
    const linked = reducer(start, { type: 'tab-link', id: 't2', mapId: 'map-1', title: 'Alpha' })
    expect(linked.tabs[1]).toMatchObject({ mapId: 'map-1', title: 'Alpha' })
    // Untouched tabs stay unlinked — the link is per tab, not per title.
    expect(linked.tabs[0].mapId).toBeNull()
    expect(linked.mapsRevision).toBe(start.mapsRevision + 1)
  })

  it('gives a map to one tab only, unlinking whichever tab held it before', () => {
    // Two tabs linked to one map would each treat a save as "overwrite my own
    // map" and silently destroy the other's saved work.
    const start = state([tab('t1', undefined, { mapId: 'map-1' }), tab('t2')], 't2')
    const linked = reducer(start, { type: 'tab-link', id: 't2', mapId: 'map-1', title: 'Alpha' })
    expect(linked.tabs[0]).toMatchObject({ mapId: null, title: 't1' })
    expect(linked.tabs[1]).toMatchObject({ mapId: 'map-1', title: 'Alpha' })
  })

  it('ignores a link for a tab that is already gone', () => {
    // The save dialog captures its target tab when it opens; that tab can be
    // closed before Replace is pressed.
    const start = state([tab('t1')])
    expect(reducer(start, { type: 'tab-link', id: 'gone', mapId: 'map-1', title: 'Alpha' })).toBe(start)
  })

  it('opens a fresh tab unlinked', () => {
    const added = reducer(state([tab('t1')]), { type: 'tab-add' })
    expect(activeTab(added).mapId).toBeNull()
  })

  it('unlinks tabs whose map left the library and keeps the rest', () => {
    const start = state([
      tab('t1', undefined, { mapId: 'map-1' }),
      tab('t2', undefined, { mapId: 'map-2' }),
      tab('t3'),
    ])
    const changed = reducer(start, {
      type: 'maps-changed',
      library: library([{ id: 'map-2', name: 't2' }]),
    })
    // The deleted map's tab keeps its content — it is now unsaved work, not a
    // pointer to something that no longer exists.
    expect(changed.tabs[0]).toMatchObject({ mapId: null, game: start.tabs[0].game })
    expect(changed.tabs[1]).toBe(start.tabs[1])
    expect(changed.tabs[2]).toBe(start.tabs[2])
  })

  it('retitles a linked tab when its map was renamed in another window', () => {
    // Without this the tab keeps saving under a stale name, which finds no
    // entry and forks the map into a second copy.
    const start = state([tab('t1', undefined, { mapId: 'map-1' })])
    const renamed = reducer(start, {
      type: 'maps-changed',
      library: library([{ id: 'map-1', name: 'Gamma' }]),
    })
    expect(renamed.tabs[0]).toMatchObject({ mapId: 'map-1', title: 'Gamma' })
  })

  it('changes no link when the library did not parse', () => {
    // An unreadable blob is not an empty library: unlinking every tab here
    // would be persisted by the next autosave and could not be undone.
    const start = state([tab('t1', undefined, { mapId: 'map-1' })])
    const changed = reducer(start, { type: 'maps-changed', library: { readable: false } })
    expect(changed.tabs).toBe(start.tabs)
    expect(changed.mapsRevision).toBe(start.mapsRevision + 1)
  })

  it('bumps mapsRevision even when no link changed, so the library re-renders', () => {
    const start = state([tab('t1', undefined, { mapId: 'map-1' })])
    const changed = reducer(start, {
      type: 'maps-changed',
      library: library([{ id: 'map-1', name: 't1' }]),
    })
    expect(changed.tabs).toBe(start.tabs)
    expect(changed.mapsRevision).toBe(start.mapsRevision + 1)
  })

  it('does not relink a tab when a different map reuses its old name', () => {
    // Deleting "Alpha" and saving a new board under the same name mints a new
    // id, so the orphaned tab must stay unlinked rather than adopt the new map.
    const start = state([tab('t1', undefined, { title: 'Alpha', mapId: 'map-1' })])
    const orphaned = reducer(start, { type: 'maps-changed', library: library([]) })
    expect(orphaned.tabs[0].mapId).toBeNull()
    const recreated = reducer(orphaned, {
      type: 'maps-changed',
      library: library([{ id: 'map-2', name: 'Alpha' }]),
    })
    expect(recreated.tabs[0].mapId).toBeNull()
  })

  it('closing the only tab leaves a fresh default board', () => {
    const closed = reducer(state([tab('t1')]), { type: 'tab-close', id: 't1' })
    expect(closed.tabs).toHaveLength(1)
    const fresh = activeTab(closed)
    expect(fresh.id).not.toBe('t1')
    expect(fresh.title).toBe('Board 1')
    expect(fresh.game.board.layout).toBe('standard4')
    // The regenerated board owns nothing in the library, however its title
    // reads. A blank board inheriting a map's identity is what made saved maps
    // look like they had been wiped.
    expect(fresh.mapId).toBeNull()
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

  it('returns the same state when clearing an already empty highlight', () => {
    // Identity is the whole point: sweeping the draft ribbon clears nothing once
    // per slot, and a fresh state object would re-render every store consumer.
    const start = state([tab('t1')])
    expect(reducer(start, { type: 'highlight', marks: null })).toBe(start)
  })

})
