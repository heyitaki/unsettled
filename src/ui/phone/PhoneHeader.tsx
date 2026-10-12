import { useEffect, useRef, useState } from 'react'
import { boardColor } from '../boardColor'
import { Brand } from '../Brand'
import {
  BoardHexGlyph,
  ChevronGlyph,
  DotsGlyph,
  PencilGlyph,
} from '../glyphs'
import { activeTab, useStore } from '../store'
import type { PhoneOverlay } from './PhoneShell'

/**
 * The phone's header (spec S1): the brand row, which scrolls away with the
 * page, over the sticky controls row that holds the board's identity, the
 * roster and the pencil that toggles build mode. In build mode the roster
 * dots pick the piece brush; the trailing dots open Players in either mode.
 */
export function PhoneHeader({ building, onToggleMode, onOpen }: {
  building: boolean
  onToggleMode: () => void
  onOpen: (overlay: PhoneOverlay) => void
}) {
  const { state, dispatch } = useStore()
  const tab = activeTab(state)
  const { board } = tab.game
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
  const pillClass = board.mePlayerId ? 'phone-dots' : 'phone-dots unclaimed'
  const dots = board.players.map((player) => {
    const selected = player.id === (building ? tab.activePlayerId : board.mePlayerId)
    const dot = <span className={selected ? 'phone-dot me' : 'phone-dot'} style={{ background: player.color }} />
    return building ? (
      <button
        type="button"
        key={player.id}
        className="phone-dot-cell"
        aria-label={`Place pieces for ${player.name}`}
        aria-pressed={selected}
        onClick={() => dispatch({ type: 'active-player', playerId: player.id })}
      >
        {dot}
      </button>
    ) : <span key={player.id} className="phone-dot-cell">{dot}</span>
  })
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
        {building ? (
          <div className={pillClass}>
            {dots}
            <button type="button" className="phone-dots-more" aria-label="Players" aria-haspopup="dialog" onClick={() => onOpen('players')}>
              <DotsGlyph />
            </button>
          </div>
        ) : (
          <button type="button" className={pillClass} aria-label="Players" aria-haspopup="dialog" onClick={() => onOpen('players')}>
            {dots}
            <span className="phone-dots-more"><DotsGlyph /></span>
          </button>
        )}
        <button
          type="button"
          className="phone-icon-btn"
          aria-label="Edit the board"
          aria-pressed={building}
          onClick={onToggleMode}
        >
          <PencilGlyph />
        </button>
      </header>
    </>
  )
}
