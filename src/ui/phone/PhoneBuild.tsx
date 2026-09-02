import { activeTab, useStore } from '../store'
import { ToolGroups } from '../ToolPalette'

/**
 * The board tools in the analysis block's slot (spec S6). Randomize, clear,
 * undo and redo are not repeated here; the header's dots menu holds them.
 *
 * The Player row is the phone's stand-in for the desktop roster's dots: the
 * canvas places every road and building for the tab's active player, and the
 * only other way to move that brush is `PlayerPanel`, which this tree never
 * mounts. Without it a phone could hand-build pieces for the first seat only.
 */
export function PhoneBuild({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  return (
    <section className="phone-block phone-block-flush phone-build">
      <div className="phone-block-inner">
        <div className="phone-block-head">
          <div>
            <span className="eyebrow">Build mode</span>
            <h2>Board tools</h2>
          </div>
        </div>
        <ToolGroups />
        <div className="tool-group">
          <span className="tool-label">Player</span>
          <div className="tool-grid player-grid">
            {tab.game.board.players.map((player) => (
              <button
                type="button"
                key={player.id}
                aria-pressed={tab.activePlayerId === player.id}
                onClick={() => dispatch({ type: 'active-player', playerId: player.id })}
              >
                <span className="phone-swatch" style={{ background: player.color }} />
                {player.name}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="phone-block-actions">
        <button type="button" className="primary" onClick={onDone}>Done</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  )
}
