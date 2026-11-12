import { useMemo } from 'react'
import { setActivePlayer } from '../model/turn'
import { adviceBlockers } from './bestMoves'
import { CardAmounts } from './BestMovesTable'
import { INK_COLOR, readableInk } from './colors'
import { SpotTiles } from './SpotTiles'
import { activeTab, useStore } from './store'
import { UndoRedoButtons } from './UndoRedoButtons'
import { RECAP_GAMES, useDraftRecap } from './useDraftRecap'

export function DraftRecapPanel({ className = 'panel analysis-panel' }: { className?: string }) {
  const { state, dispatch } = useStore()
  const { game } = activeTab(state)
  const { board } = game
  const blockers = useMemo(() => adviceBlockers(board), [board])
  const { games, wins, draws, done, error, retry } = useDraftRecap(blockers.length === 0)
  const players = [...board.players].sort((a, b) => wins[b.id] - wins[a.id])
  const headerPlayer = players.find((player) => player.id === board.mePlayerId) ?? players[0]
  const leads = headerPlayer === players[0]
  const rival = players[leads ? 1 : 0]
  const headerShare = games === 0 ? 0 : Math.round(wins[headerPlayer.id] / games * 100)
  const delta = games === 0 || !rival ? 0 : headerShare - Math.round(wins[rival.id] / games * 100)

  return (
    <section className={`${className} draft-recap-panel`}>
      <div className="panel-heading">
        <h2>Draft recap</h2>
        <UndoRedoButtons />
      </div>
      {blockers.length > 0 ? (
        <div className="hint">
          <p>Finish the board to get advice:</p>
          <ul>{blockers.map((message) => <li key={message}>{message}</li>)}</ul>
        </div>
      ) : (
        <>
          {error !== null ? (
            <div role="alert">
              <p>{error}</p>
              <button type="button" onClick={retry}>Retry</button>
            </div>
          ) : !done && (
            <div className="analysis-loading" role="status">
              <span>Simulating games…</span>
              <div style={{ width: `${Math.max(3, games / RECAP_GAMES * 100)}%` }} />
            </div>
          )}
          <div className="recap-header">
            <div className="recap-label">{headerPlayer.name}'s win chance</div>
            <div className="recap-percentage">{games === 0 ? '…' : `${headerShare}%`}</div>
            {games > 0 && rival && <div className="recap-delta">
              {delta === 0 ? `Level with ${rival.name}` : `${leads ? 'Leads' : 'Trails'} ${rival.name} by ${Math.abs(delta)} ${Math.abs(delta) === 1 ? 'point' : 'points'}`}
            </div>}
          </div>
          {games > 0 && <div className="recap-bar" aria-hidden="true">
            {players.filter((player) => wins[player.id] > 0).map((player) => (
              <span key={player.id} style={{ width: `${wins[player.id] / games * 100}%`, background: player.color,
                boxShadow: readableInk(player.color) === INK_COLOR ? 'inset 0 0 0 1px var(--ink)' : undefined }} />
            ))}
          </div>}
          <div className="recap-cards" role="list">
            {players.map((player, index) => {
              const share = games === 0 ? 0 : wins[player.id] / games * 100
              const percentage = games === 0 ? '…' : `${Math.round(share)}%`
              const { hand } = game.stats[player.id]
              const claimed = player.id === board.mePlayerId
              return (
                <div key={player.id} className={`recap-card${claimed ? ' claimed' : ''}`} role="listitem"
                  aria-label={`${player.name}: ${percentage} win chance`}>
                  <div className="recap-card-heading">
                    <span className="analysis-rank" style={{ background: player.color, color: readableInk(player.color) }}>
                      {index + 1}
                    </span>
                    <strong>{player.name}</strong>
                    {claimed && <span className="recap-you">YOU</span>}
                  </div>
                  <span className="analysis-score">{percentage}</span>
                  <div className="recap-spots">
                    {board.buildings.filter((building) => building.playerId === player.id).map(({ vertexId }) =>
                      <SpotTiles key={vertexId} board={board} vertexId={vertexId} small />)}
                  </div>
                  {Object.values(hand).some((count) => count > 0) && <div className="recap-hand"><CardAmounts cards={hand} /></div>}
                </div>
              )
            })}
          </div>
        </>
      )}
      <button type="button" className="primary recap-start"
        onClick={() => dispatch({ type: 'commit-game', game: setActivePlayer(game, board.players[0].id) })}>
        Start game
      </button>
      {done && (
        <ul className="move-notes">
          <li>Win chance over {RECAP_GAMES.toLocaleString('en-US')} simulated games, every seat played by the adviser. Expect about 3 points of noise.</li>
          {draws > 0 && <li>{draws} {draws === 1 ? 'game' : 'games'} hit the turn cap with no winner</li>}
        </ul>
      )}
    </section>
  )
}
