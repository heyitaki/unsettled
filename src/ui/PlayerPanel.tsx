import {
  addPlayer,
  draftOrder,
  movePlayer,
  removePlayer,
  renamePlayer,
  setMe,
  setPlayerColor,
} from '../model/board'
import { PLAYER_PALETTE } from '../model/types'
import { activeTab, useStore } from './store'

export function PlayerPanel() {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  const { board } = tab
  const commit = (nextBoard: typeof board) => dispatch({ type: 'commit', board: nextBoard })
  const order = draftOrder(board).map((id) => board.players.find((player) => player.id === id))
  return (
    <section className="panel player-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Turn order</span>
          <h2>Players</h2>
        </div>
        <button
          type="button"
          disabled={board.players.length >= 6}
          onClick={() => {
            const index = board.players.length
            const colors = Object.values(PLAYER_PALETTE)
            const nextBoard = addPlayer(board, { name: `Player ${index + 1}`, color: colors[index % colors.length] })
            commit(nextBoard)
            dispatch({ type: 'active-player', playerId: nextBoard.players.at(-1)?.id ?? tab.activePlayerId })
          }}
        >Add</button>
      </div>
      <div className="player-list">
        {board.players.map((player, index) => (
          <div className={`player-row ${tab.activePlayerId === player.id ? 'active' : ''}`} key={player.id}>
            <button
              className="player-dot"
              type="button"
              title="Use this player for new pieces"
              style={{ background: player.color }}
              onClick={() => dispatch({ type: 'active-player', playerId: player.id })}
            />
            <input
              aria-label={`Name for player ${index + 1}`}
              value={player.name}
              onChange={(event) => commit(renamePlayer(board, player.id, event.target.value))}
            />
            <input
              className="color-input"
              type="color"
              aria-label={`Color for ${player.name}`}
              value={player.color}
              onChange={(event) => commit(setPlayerColor(board, player.id, event.target.value))}
            />
            <label className="me-radio" title="This is me">
              <input type="radio" name="me" checked={board.mePlayerId === player.id} onChange={() => commit(setMe(board, player.id))} />
              me
            </label>
            <div className="reorder-buttons">
              <button type="button" aria-label={`Move ${player.name} earlier`} disabled={index === 0} onClick={() => commit(movePlayer(board, player.id, index - 1))}>↑</button>
              <button type="button" aria-label={`Move ${player.name} later`} disabled={index === board.players.length - 1} onClick={() => commit(movePlayer(board, player.id, index + 1))}>↓</button>
            </div>
            <button
              type="button"
              className="icon-danger"
              aria-label={`Remove ${player.name}`}
              disabled={board.players.length === 1}
              onClick={() => {
                const nextBoard = removePlayer(board, player.id)
                commit(nextBoard)
                if (tab.activePlayerId === player.id) {
                  dispatch({ type: 'active-player', playerId: nextBoard.players[0].id })
                }
              }}
            >×</button>
          </div>
        ))}
      </div>
      <div className="draft-strip" aria-label="Snake draft order">
        {order.map((player, index) => player && (
          <div key={`${player.id}:${index}`} title={player.name}>
            <span style={{ background: player.color }} />
            {player.name}
          </div>
        ))}
      </div>
    </section>
  )
}
