import { useMemo } from 'react'
import { setActivePlayer } from '../model/turn'
import { adviceBlockers } from './bestMoves'
import { readableInk } from './colors'
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
          <div className="analysis-list" role="list">
            {players.map((player, index) => {
              const share = games === 0 ? 0 : wins[player.id] / games * 100
              const percentage = games === 0 ? '…' : `${Math.round(share)}%`
              return (
                <div key={player.id} className="recap-row" role="listitem"
                  aria-label={`${player.name}: ${percentage} win chance`}>
                  <span className="analysis-rank" style={{ background: player.color, color: readableInk(player.color) }}>
                    {index + 1}
                  </span>
                  <div className="analysis-row-body">
                    <strong>{player.name}</strong>
                    <div className="recap-spots">
                      {board.buildings.filter((building) => building.playerId === player.id).map(({ vertexId }) =>
                        <SpotTiles key={vertexId} board={board} vertexId={vertexId} small />)}
                    </div>
                    <div className="recap-bar"><span style={{ width: `${share}%`, background: player.color }} /></div>
                  </div>
                  <span className="analysis-score">{percentage}</span>
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
