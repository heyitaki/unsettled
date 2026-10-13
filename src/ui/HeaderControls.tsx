import type { MouseEvent } from 'react'
import { boardColor } from './boardColor'
import { BoardHexGlyph, ChevronGlyph, DotsGlyph, PencilGlyph } from './glyphs'
import { activeTab, useStore } from './store'

export type HeaderPanel = 'maps' | 'players'

/**
 * The title opens Maps and the roster dots open Players or pick the piece brush in build mode.
 * The pencil toggles build mode in both trees.
 */
export function HeaderControls({ building, onToggleMode, onOpen, openPanel }: {
  building: boolean
  onToggleMode: () => void
  onOpen: (panel: HeaderPanel, trigger: HTMLButtonElement) => void
  openPanel?: HeaderPanel | null
}) {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  const { board } = tab.game
  const opener = (panel: HeaderPanel) => ({
    'aria-haspopup': 'dialog' as const,
    'aria-expanded': openPanel === undefined ? undefined : openPanel === panel,
    onClick: (event: MouseEvent<HTMLButtonElement>) => onOpen(panel, event.currentTarget),
  })
  const pillClass = board.mePlayerId ? 'head-dots' : 'head-dots unclaimed'
  const dots = board.players.map((player) => {
    const selected = player.id === (building ? tab.activePlayerId : board.mePlayerId)
    const dot = <span className={selected ? 'head-dot me' : 'head-dot'} style={{ background: player.color }} />
    return building ? (
      <button
        type="button"
        key={player.id}
        className="head-dot-cell"
        aria-label={`Place pieces for ${player.name}`}
        aria-pressed={selected}
        onClick={() => dispatch({ type: 'active-player', playerId: player.id })}
      >
        {dot}
      </button>
    ) : <span key={player.id} className="head-dot-cell">{dot}</span>
  })
  return (
    <>
      <button type="button" className="head-title" {...opener('maps')}>
        <BoardHexGlyph color={boardColor(tab.title)} className="head-title-hex" />
        <span className="head-title-name">{tab.title}</span>
        <ChevronGlyph className="menu-chevron" />
      </button>
      <span className="head-spacer" />
      {building ? (
        <div className={pillClass}>
          {dots}
          <button type="button" className="head-dots-more" aria-label="Players" {...opener('players')}>
            <DotsGlyph />
          </button>
        </div>
      ) : (
        <button type="button" className={pillClass} aria-label="Players" {...opener('players')}>
          {dots}
          <span className="head-dots-more"><DotsGlyph /></span>
        </button>
      )}
      <button
        type="button"
        className="icon-btn"
        aria-label="Edit the board"
        aria-pressed={building}
        onClick={onToggleMode}
      >
        <PencilGlyph />
      </button>
    </>
  )
}
