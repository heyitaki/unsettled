import { useEffect, useRef, useState } from 'react'
import { clearBoard, randomizeBoard } from '../../model/board'
import { boardColor } from '../boardColor'
import { Brand } from '../Brand'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu'
import {
  BoardHexGlyph,
  ChevronGlyph,
  ClearBoardGlyph,
  DiceGlyph,
  DotsGlyph,
  ExportGlyph,
  PencilGlyph,
  RedoGlyph,
  UndoGlyph,
} from '../glyphs'
import { activeTab, useStore } from '../store'
import { useJsonFiles } from '../useJsonFiles'
import type { PhoneOverlay } from './PhoneShell'

/**
 * The phone's header (spec S1): the brand row, which scrolls away with the
 * page, over the sticky controls row that holds the board's identity, the
 * roster, the pencil that toggles build mode, and the dots menu with what the
 * desktop tool palette's heading holds plus Export JSON.
 */
export function PhoneHeader({ building, onToggleMode, onOpen }: {
  building: boolean
  onToggleMode: () => void
  onOpen: (overlay: PhoneOverlay) => void
}) {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  const { board } = tab.game
  const { exportJson } = useJsonFiles()
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const brandRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const brand = brandRef.current
    const head = headRef.current
    if (!brand || !head) return
    // The header sits flush under the brand row until it sticks, so the brand
    // row leaving the band above the header's sticky line is the moment the
    // page starts sliding under it. An observer costs nothing per scroll
    // frame, where measuring rects would force a layout; the one measurement
    // here seeds the state before the observer's first, asynchronous report.
    const stickyTop = parseFloat(getComputedStyle(head).top) || 0
    setScrolled(brand.getBoundingClientRect().bottom <= stickyTop)
    const observer = new IntersectionObserver(
      (entries) => setScrolled(!entries[entries.length - 1].isIntersecting),
      { rootMargin: `-${stickyTop}px 0px 0px 0px` },
    )
    observer.observe(brand)
    return () => observer.disconnect()
  }, [])
  const history: ContextMenuItem[] = [
    {
      label: 'Undo',
      icon: <UndoGlyph />,
      disabled: tab.past.length === 0,
      onClick: () => dispatch({ type: 'undo' }),
    },
    {
      label: 'Redo',
      icon: <RedoGlyph />,
      disabled: tab.future.length === 0,
      onClick: () => dispatch({ type: 'redo' }),
    },
  ]
  const items: ContextMenuItem[] = [
    {
      label: 'Randomize board',
      icon: <DiceGlyph />,
      onClick: () => dispatch({ type: 'commit', board: randomizeBoard(board) }),
    },
    { label: 'Export JSON', icon: <ExportGlyph />, onClick: exportJson },
    {
      label: 'Clear board',
      icon: <ClearBoardGlyph />,
      danger: true,
      onClick: () => dispatch({ type: 'commit', board: clearBoard(board) }),
    },
  ]
  return (
    <>
      <div className="phone-brand" ref={brandRef}>
        <Brand />
      </div>
      <header className={scrolled ? 'phone-head scrolled' : 'phone-head'} ref={headRef}>
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
          aria-pressed={building}
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
            // Hung from the button's bottom-right corner, its tail pointing back up at it.
            const rect = event.currentTarget.getBoundingClientRect()
            setMenuAt({ x: rect.right, y: rect.bottom })
          }}
        >
          <DotsGlyph />
        </button>
        {menuAt && (
          <ContextMenu
            ariaLabel="Board options"
            x={menuAt.x}
            y={menuAt.y}
            history={history}
            items={items}
            onClose={() => setMenuAt(null)}
          />
        )}
      </header>
    </>
  )
}
