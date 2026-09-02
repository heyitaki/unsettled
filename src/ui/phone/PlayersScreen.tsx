import { useState } from 'react'
import { analyzeBoardCached } from '../../engine/analyze'
import { computeStandings } from '../../engine/stats'
import { addPlayer, movePlayer, removePlayer, renamePlayer, setMe } from '../../model/board'
import { PLAYER_PALETTE, type Board } from '../../model/types'
import { DraftGrid } from '../DraftGrid'
import { GripGlyph, PlusGlyph, TrashGlyph } from '../glyphs'
import { InlineRename } from '../InlineRename'
import { rowShift, SHIFT_CLASS } from '../rowDrag'
import { activeTab, useStore } from '../store'
import { useCoarsePointer } from '../useMediaQuery'
import { useRowReorder } from '../useRowReorder'
import { PhoneOverlay } from './PhoneOverlay'

/**
 * The roster and the snake draft (spec S8). A row claims on tap, renames on
 * its name, and moves seats by a hold or by its grip; seat order is draft
 * order (B3), so a drop repaints the ribbon and re-runs the analysis through
 * the board it commits. The points ledger stays on the desktop (O1).
 */
export function PlayersScreen({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore()
  const coarse = useCoarsePointer()
  const { game } = activeTab(state)
  const { board } = game
  const commit = (next: Board) => dispatch({ type: 'commit', board: next })
  const standings = computeStandings(game)
  const analysis = analyzeBoardCached(board)
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null)
  const ids = board.players.map((player) => player.id)
  const reorder = useRowReorder({
    coarse,
    ids,
    rowSelector: '.roster-row',
    trashSelector: '.roster-trash',
    lockedId: editing?.id,
    onMove: (id, index) => commit(movePlayer(board, id, index)),
    onRemove: (id) => commit(removePlayer(board, id)),
  })
  const from = reorder.dragId === null ? -1 : ids.indexOf(reorder.dragId)
  const aimed = reorder.dropTarget?.kind === 'row' ? reorder.dropTarget.index : from
  const commitRename = () => {
    if (!editing) return
    const next = editing.draft.trim()
    setEditing(null)
    if (next) commit(renamePlayer(board, editing.id, next))
  }
  const add = () => {
    const index = board.players.length
    const colors = Object.values(PLAYER_PALETTE)
    commit(addPlayer(board, { name: `Player ${index + 1}`, color: colors[index % colors.length] }))
  }
  return (
    <PhoneOverlay title="Players" onClose={onClose}>
      <div>
        <div className="group-label">
          <span>Roster</span>
        </div>
        <div
          className={reorder.dragId !== null ? 'list roster reordering' : 'list roster'}
          ref={reorder.listRef}
        >
          {board.players.map((player, index) => {
            const me = board.mePlayerId === player.id
            const lifted = reorder.dragId === player.id
            const classes = ['roster-row']
            if (me) classes.push('me')
            if (lifted) classes.push('dragging')
            else if (reorder.dragId !== null) {
              classes.push(SHIFT_CLASS[rowShift(index, from, aimed)])
              if (reorder.dropTarget?.kind === 'row' && reorder.dropTarget.index === index) classes.push('drag-over')
            }
            return (
              <div
                key={player.id}
                className={classes.join(' ').trim()}
                // The lifted row tracks the pointer; the others ease through CSS.
                style={lifted ? { transform: `translateY(${reorder.dragOffset}px)` } : undefined}
                {...reorder.rowProps(player.id)}
              >
                <button
                  type="button"
                  className="list-row-select"
                  aria-label={`Claim ${player.name}`}
                  aria-pressed={me}
                  onClick={() => commit(setMe(board, player.id))}
                />
                <span
                  className="roster-grip"
                  aria-hidden="true"
                  onPointerDown={(event) => reorder.startImmediately(event, player.id)}
                >
                  <GripGlyph />
                </span>
                <span className="swatch" style={{ background: player.color }} />
                <span className="list-row-main">
                  <InlineRename
                    name={player.name}
                    draft={editing?.id === player.id ? editing.draft : null}
                    onDraft={(draft) => setEditing({ id: player.id, draft })}
                    onStart={() => setEditing({ id: player.id, draft: player.name })}
                    onCommit={commitRename}
                    onCancel={() => setEditing(null)}
                  />
                </span>
                <span className={me ? 'you-chip' : 'you-chip none'}>You</span>
                <span className="roster-vp" aria-label={`Victory points: ${standings[index].victoryPoints}`}>
                  {standings[index].victoryPoints}
                </span>
              </div>
            )
          })}
          {/* Only exists mid-drag: removing a player is rare enough that it does
              not deserve permanent UI, and the drag is already in the hand. */}
          {reorder.dragId !== null && board.players.length > 1 && (
            <div
              className={reorder.dropTarget?.kind === 'trash' ? 'roster-trash over' : 'roster-trash'}
              {...reorder.trashProps}
            >
              <TrashGlyph />
              Drop here to remove
            </div>
          )}
          <button type="button" className="list-add" disabled={board.players.length >= 6} onClick={add}>
            <PlusGlyph />
            Add player
          </button>
        </div>
      </div>
      <DraftGrid board={board} analysis={analysis} />
    </PhoneOverlay>
  )
}
