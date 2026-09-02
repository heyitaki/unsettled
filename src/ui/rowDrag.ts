/**
 * Geometry for the touch reorder of player rows. Native HTML5 drag-and-drop
 * never fires on touch, so the coarse-pointer path drives the same reorder from
 * pointer events and has to work out both of these itself.
 */

export interface RowBox {
  top: number
  bottom: number
}

/**
 * Index of the row under `y`, clamped to the ends of the list. This is a
 * destination-row index, not an insertion caret: `movePlayer` lifts the dragged
 * player out before inserting at the index, and the desktop drag path likewise
 * aims at the hovered card's own index.
 */
export function dropIndexFor(rows: readonly RowBox[], y: number): number {
  for (let index = 0; index < rows.length; index += 1) {
    if (y < rows[index].bottom) return index
  }
  return Math.max(0, rows.length - 1)
}

const MARGIN = 76
const MAX_SPEED = 15

/**
 * Pixels to scroll this frame while a drag sits near a viewport edge, so a row
 * can reach a drop target below the fold (the trash row, most of all). Speed
 * ramps with depth into the margin and stops ramping at the edge itself.
 */
export function edgeScrollStep(y: number, viewportHeight: number): number {
  if (viewportHeight <= MARGIN * 2) return 0
  const ramp = (depth: number) => Math.ceil(Math.min(1, depth / MARGIN) * MAX_SPEED)
  if (y < MARGIN) return -ramp(MARGIN - y)
  const fromBottom = viewportHeight - y
  if (fromBottom < MARGIN) return ramp(MARGIN - fromBottom)
  return 0
}

/**
 * Which way a resting row steps aside while the row lifted from `from` is
 * aimed at `to`: -1 up, 1 down, 0 stays. The lifted row itself, and every row
 * outside the span between the two indices, holds still.
 */
export function rowShift(index: number, from: number, to: number): -1 | 0 | 1 {
  if (to > from && index > from && index <= to) return -1
  if (to < from && index >= to && index < from) return 1
  return 0
}

/** The class each `rowShift` result draws as, shared by every list that reorders. */
export const SHIFT_CLASS = { [-1]: 'shift-up', 0: '', 1: 'shift-down' } as const
