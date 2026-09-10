import { computeStandings } from '../../engine/stats'
import { addPlayer } from '../../model/board'
import { PLAYER_PALETTE, type Board } from '../../model/types'
import { DraftGrid } from '../DraftGrid'
import { PlusGlyph } from '../glyphs'
import { RosterRow, RosterTrash } from '../RosterRow'
import { activeTab, useStore } from '../store'
import { useRoster } from '../useRoster'
import { PhoneOverlay } from './PhoneOverlay'
import { AwardControls } from '../AwardControls'

/**
 * The roster and the snake draft (spec S8). A row claims on tap, renames on
 * its name, and moves seats by a hold or by its grip; seat order is draft
 * order (B3), so a drop repaints the ribbon and re-runs the analysis through
 * the board it commits. The points ledger stays on the desktop (O1).
 */
export function PlayersScreen({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore()
  const { game } = activeTab(state)
  const { board } = game
  const commit = (next: Board) => dispatch({ type: 'commit', board: next })
  const standings = computeStandings(game)
  const roster = useRoster(board, commit)
  const { reorder } = roster
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
          {...reorder.listProps}
        >
          {board.players.map((player, index) => (
            <RosterRow key={player.id} player={player} index={index} roster={roster}>
              <span className="roster-vp" aria-label={`Victory points: ${standings[index].victoryPoints}`}>
                {standings[index].victoryPoints}
              </span>
            </RosterRow>
          ))}
          <RosterTrash roster={roster} playerCount={board.players.length} />
          <button type="button" className="list-add" disabled={board.players.length >= 6} onClick={add}>
            <PlusGlyph />
            Add player
          </button>
        </div>
      </div>
      <DraftGrid board={board} />
      <AwardControls />
    </PhoneOverlay>
  )
}
