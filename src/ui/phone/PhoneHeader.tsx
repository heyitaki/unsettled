import { useEffect, useState } from 'react'
import { clearBoard, randomizeBoard } from '../../model/board'
import { boardColor } from '../boardColor'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu'
import { BoardHexGlyph, ChevronGlyph, DotsGlyph, PencilGlyph } from '../glyphs'
import { activeTab, useStore } from '../store'
import { useJsonFiles } from '../useJsonFiles'
import type { PhoneMode, PhoneOverlay } from './PhoneShell'

/** Past this much scroll the header casts a shadow on the page sliding under it. */
const SCROLLED_AT = 4

/**
 * The phone's only fixed chrome (spec S1): the board's identity, the roster,
 * the pencil that toggles build mode, and the dots menu that holds what the
 * desktop tool palette's heading holds.
 */
export function PhoneHeader({ mode, onToggleMode, onOpen }: {
  mode: PhoneMode
  onToggleMode: () => void
  onOpen: (overlay: PhoneOverlay) => void
}) {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  const { board } = tab.game
  const { exportJson } = useJsonFiles()
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > SCROLLED_AT)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  const items: ContextMenuItem[] = [
    { label: 'Undo', disabled: tab.past.length === 0, onClick: () => dispatch({ type: 'undo' }) },
    { label: 'Redo', disabled: tab.future.length === 0, onClick: () => dispatch({ type: 'redo' }) },
    {
      label: 'Randomize board',
      separated: true,
      onClick: () => dispatch({ type: 'commit', board: randomizeBoard(board) }),
    },
    { label: 'Export JSON', onClick: exportJson },
    {
      label: 'Clear board',
      danger: true,
      onClick: () => dispatch({ type: 'commit', board: clearBoard(board) }),
    },
  ]
  return (
    <header className={scrolled ? 'phone-head scrolled' : 'phone-head'}>
      <button type="button" className="phone-title" aria-haspopup="dialog" onClick={() => onOpen('maps')}>
        <BoardHexGlyph color={boardColor(tab.title)} className="phone-title-hex" />
        <span className="phone-title-name">{tab.title}</span>
        <ChevronGlyph className="phone-chevron" />
      </button>
      <span className="phone-head-spacer" />
      <button
        type="button"
        className={board.mePlayerId ? 'phone-dots' : 'phone-dots unclaimed'}
        aria-label="Players"
        aria-haspopup="dialog"
        onClick={() => onOpen('players')}
      >
        {board.players.map((player) => (
          <span
            key={player.id}
            className={player.id === board.mePlayerId ? 'phone-dot me' : 'phone-dot'}
            style={{ background: player.color }}
          />
        ))}
      </button>
      <button
        type="button"
        className="phone-icon-btn"
        aria-label="Edit the board"
        aria-pressed={mode === 'build'}
        onClick={onToggleMode}
      >
        <PencilGlyph />
      </button>
      <button
        type="button"
        className="phone-icon-btn"
        aria-label="Board options"
        aria-haspopup="menu"
        aria-expanded={menuAt !== null}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setMenuAt({ x: rect.right, y: rect.bottom + 4 })
        }}
      >
        <DotsGlyph />
      </button>
      {menuAt && (
        <ContextMenu
          ariaLabel="Board options"
          x={menuAt.x}
          y={menuAt.y}
          items={items}
          onClose={() => setMenuAt(null)}
        />
      )}
    </header>
  )
}
