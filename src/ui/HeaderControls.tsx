import type { MouseEvent } from 'react'
import { draftIsComplete, inferDraftState } from '../engine/draft'
import { boardColor } from './boardColor'
import { readableInk } from './colors'
import { BoardHexGlyph, ChevronGlyph, DotsGlyph, PencilGlyph } from './glyphs'
import { activeTab, useStore } from './store'

export type HeaderPanel = 'maps' | 'players'

/**
 * The title opens Maps; roster dots view advice or pick the piece brush in build mode.
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
  const { board, turn } = tab.game
  const inGame = turn !== undefined && draftIsComplete(board, inferDraftState(board))
  const viewedId = board.players.find((player) => player.id === state.viewedPlayer)?.id ?? turn?.playerId
  const opener = (panel: HeaderPanel) => ({
    'aria-haspopup': 'dialog' as const,
    'aria-expanded': openPanel === undefined ? undefined : openPanel === panel,
    onClick: (event: MouseEvent<HTMLButtonElement>) => onOpen(panel, event.currentTarget),
  })
  const pillClass = `head-dots${board.mePlayerId ? '' : ' unclaimed'}${inGame ? ' in-game' : ''}`
  const dots = board.players.map((player) => {
    const selected = player.id === (building ? tab.activePlayerId : inGame ? viewedId : board.mePlayerId)
    const ring = inGame ? player.id === turn.playerId : selected
    const chip = inGame && selected
    const dot = <span className={`head-dot${ring ? ' me' : ''}${chip ? ' head-dot-chip' : ''}`}
      style={{ background: player.color, color: chip ? readableInk(player.color) : undefined }}>{chip ? player.name : null}</span>
    return building || inGame ? (
      <button
        type="button"
        key={player.id}
        className={`head-dot-cell${chip ? ' chip' : ''}${ring ? ' ringed' : ''}`}
        aria-label={building ? `Place pieces for ${player.name}` : `View ${player.name}'s best moves`}
        aria-pressed={selected}
        onClick={() => dispatch({ type: building ? 'active-player' : 'view-player', playerId: player.id })}
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
      {building || inGame ? (
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
