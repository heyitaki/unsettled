import { analyzeBoardCached } from '../engine/analyze'
import { NavigationGlyph } from './glyphs'
import { PANES, type PaneId } from './mobilePanes'
import { activeTab, useStore } from './store'

export function MobileNav({ pane, onSelect }: {
  pane: PaneId
  onSelect: (pane: PaneId) => void
}) {
  const { state } = useStore()
  const board = activeTab(state).game.board
  const analysis = analyzeBoardCached(board)
  const myTurn = analysis.status === 'ready' &&
    analysis.draft.currentPlayerId === board.mePlayerId
  return (
    <nav className="mobile-nav" role="tablist" aria-label="Workspace panels">
      {PANES.map((destination) => {
        const turnBadge = destination.id === 'picks' && myTurn
        return (
          <button
            type="button"
            key={destination.id}
            role="tab"
            aria-selected={pane === destination.id}
            aria-controls={`pane-${destination.id}`}
            aria-label={turnBadge ? `${destination.label}, it is your turn` : destination.label}
            onClick={() => onSelect(destination.id)}
          >
            <span className="mobile-nav-icon">
              <NavigationGlyph pane={destination.id} />
              {turnBadge && <span className="turn-badge" aria-hidden="true" />}
            </span>
            <span>{destination.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
