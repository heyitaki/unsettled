/**
 * Reveal-on-select (spec B2): a mark moved on a board the page has scrolled
 * past is a change the reader cannot see, so selecting a recommendation brings
 * the window back to the board, and only then. The scroll rides the phone
 * arm's `html { scroll-behavior: smooth }`, which a plain `scrollTop` assignment
 * honours where `scrollTo({ behavior })` would not on every scroller.
 */

/** The board counts as in view while at least this much of it shows under the header. */
const VISIBLE_SLACK = 120

/** True when the board's bottom edge sits above the band just under the header. */
export const shouldRevealBoard = (boardBottom: number, headerBottom: number): boolean =>
  boardBottom < headerBottom + VISIBLE_SLACK

/** Measures the phone shell's header and board, and reveals the board if it has scrolled past. */
export function revealBoardIfScrolledPast(): void {
  const board = document.querySelector('.phone-shell .board-canvas')?.getBoundingClientRect()
  const header = document.querySelector('.phone-head')?.getBoundingClientRect()
  if (board && header && shouldRevealBoard(board.bottom, header.bottom)) {
    document.documentElement.scrollTop = 0
  }
}
