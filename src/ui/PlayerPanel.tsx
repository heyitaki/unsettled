import { addPlayer } from '../model/board'
import { PLAYER_PALETTE, type Board } from '../model/types'
import { PlusGlyph } from './glyphs'
import { ConfirmDialog } from './ConfirmDialog'
import { RosterRow, RosterTrash } from './RosterRow'
import { GameSpecialBuild } from './SpecialBuildSetting'
import { activeTab, useStore } from './store'
import { useRoster } from './useRoster'

export function PlayerPanel() {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  const { game } = tab
  const { board } = game
  const commit = (nextBoard: Board) => dispatch({ type: 'commit', board: nextBoard })
  const roster = useRoster(game, commit)
  const { listRef, dragId, listProps } = roster.reorder
  const addSeat = () => {
    const index = board.players.length
    const colors = Object.values(PLAYER_PALETTE)
    const nextBoard = addPlayer(board, { name: `Player ${index + 1}`, color: colors[index % colors.length] })
    commit(nextBoard)
    dispatch({ type: 'active-player', playerId: nextBoard.players.at(-1)?.id ?? tab.activePlayerId })
  }

  return (
    <section className="panel player-panel">
      {roster.confirm && <ConfirmDialog {...roster.confirm} />}
      <div className="panel-heading">
        <h2>Players</h2>
        <button
          type="button"
          className="panel-dots"
          aria-label="Add player"
          data-label="Add"
          disabled={board.players.length >= 6}
          onClick={addSeat}
        >
          <PlusGlyph />
        </button>
      </div>
      <p className="tool-hint">Assign yourself a player by selecting the corresponding row. Drag rows to reassign turn order. Click on a player name to rename them across all games with the same imported profile picture.</p>
      <div
        className={dragId !== null ? 'player-list roster reordering' : 'player-list roster'}
        ref={listRef}
        {...listProps}
      >
        {board.players.map((player, index) => {
          const active = tab.activePlayerId === player.id
          return (
            <RosterRow
              key={player.id}
              player={player}
              index={index}
              roster={roster}
              swatch={
                <button
                  className="swatch"
                  type="button"
                  title={active ? 'Deselect this player' : 'Use this player for new pieces'}
                  aria-label={`Use ${player.name} for new pieces`}
                  aria-pressed={active}
                  style={{ background: player.color }}
                  onClick={() => {
                    dispatch({ type: 'active-player', playerId: active ? null : player.id })
                  }}
                />
              }
            />
          )
        })}
        <RosterTrash roster={roster} playerCount={board.players.length} />
      </div>
      <GameSpecialBuild />
    </section>
  )
}
