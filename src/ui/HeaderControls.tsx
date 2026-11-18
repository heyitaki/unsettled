import type { MouseEvent } from 'react'
import { draftIsComplete, inferDraftState } from '../engine/draft'
import { gameStarted } from '../engine/gameStage'
import { boardColor } from './boardColor'
import { readableInk } from './colors'
import { viewPick, viewedPlayerId } from './draftSlots'
import { BoardHexGlyph, ChevronGlyph, DotsGlyph, PencilGlyph } from './glyphs'
import { activeTab, useStore } from './store'

export type HeaderPanel = 'maps' | 'players'

/**
 * The title opens Maps; roster dots view a player's next pick during the draft, their advice
 * in game, or pick the piece brush in build mode.
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
  const inGame = gameStarted(tab.game)
  const viewedId = board.players.find((player) => player.id === state.viewedPlayer)?.id ?? turn?.playerId
  const draft = inferDraftState(board)
  const drafting = !inGame && !draftIsComplete(board, draft)
  const nextPick = (playerId: string) => draft.remainingPickIndices.find((pick) => draft.sequence[pick] === playerId)
  const opener = (panel: HeaderPanel) => ({
    'aria-haspopup': 'dialog' as const,
    'aria-expanded': openPanel === undefined ? undefined : openPanel === panel,
    onClick: (event: MouseEvent<HTMLButtonElement>) => onOpen(panel, event.currentTarget),
  })
  const pillClass = `head-dots${inGame ? ' in-game' : ''}`
  const dots = board.players.map((player) => {
    const selected = player.id === (building ? tab.activePlayerId
      : inGame ? viewedId
      : drafting ? viewedPlayerId(board, state.viewedPick)
      : board.mePlayerId)
    const ring = inGame ? player.id === turn?.playerId : selected
    const chip = inGame && selected
    const dot = <span className={`head-dot${ring ? ' me' : ''}${chip ? ' head-dot-chip' : ''}`}
      style={{ background: player.color, color: chip ? readableInk(player.color) : undefined }}>{chip ? player.name : null}</span>
    const pick = nextPick(player.id)
    return building || inGame || drafting ? (
      <button
        type="button"
        key={player.id}
        className={`head-dot-cell${chip ? ' chip' : ''}${ring ? ' ringed' : ''}`}
        aria-label={building ? `Place pieces for ${player.name}` : inGame ? `View ${player.name}'s best moves` : `View ${player.name}'s next pick`}
        aria-pressed={selected}
        disabled={!building && !inGame && pick === undefined}
        onClick={() => {
          if (building || inGame) dispatch({ type: building ? 'active-player' : 'view-player', playerId: player.id })
          else if (pick !== undefined) viewPick(board, dispatch, pick)
        }}
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
      <div className={`head-player-controls${board.mePlayerId ? '' : ' unclaimed'}`}>
        <button
          type="button"
          className="icon-btn"
          aria-label="Edit the board"
          aria-pressed={building}
          onClick={onToggleMode}
        >
          <PencilGlyph />
        </button>
        {building || inGame || drafting ? (
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
      </div>
    </>
  )
}
