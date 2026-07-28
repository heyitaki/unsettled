/**
 * Bounds for the draggable board deck on the single-pane mobile shell, in CSS
 * pixels. The value being clamped is the board canvas's own height; the deck's
 * other rows (tab strip, status line, grab handle) sit outside it.
 */
export const MIN_DECK_BOARD_HEIGHT = 120

/**
 * Arrow-key resize increment for the separator: small enough to land on a chosen
 * height, large enough that crossing the range is not a hundred presses.
 */
export const DECK_KEY_STEP = 24

/**
 * The tallest board this viewport allows, given the chrome the board has to
 * share the viewport with (`reserved`, measured from the live DOM in App.tsx —
 * nothing here hard-codes it). Where the viewport is too short to honour both
 * bounds the floor wins: a 120px board still reads as a board, a 20px one does
 * not.
 */
export function deckBoardCeiling(viewportHeight: number, reserved: number): number {
  return Math.max(MIN_DECK_BOARD_HEIGHT, viewportHeight - reserved)
}

/**
 * A board-only deck is useful — placing pieces wants every pixel — but the drag
 * must never push the deck's own handle under the bottom nav, or the board loses
 * the control that resizes it.
 */
export function clampDeckBoardHeight(height: number, viewportHeight: number, reserved: number): number {
  return Math.min(Math.max(height, MIN_DECK_BOARD_HEIGHT), deckBoardCeiling(viewportHeight, reserved))
}
