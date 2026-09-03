export interface Rect {
  width: number
  height: number
}

export interface Viewport {
  width: number
  height: number
}

export function clampToViewport(
  x: number,
  y: number,
  size: Rect,
  viewport: Viewport,
  margin = 4,
): { left: number; top: number } {
  return {
    left: Math.max(margin, Math.min(x, viewport.width - size.width - margin)),
    top: Math.max(margin, Math.min(y, viewport.height - size.height - margin)),
  }
}

export function placeBelow(
  trigger: { left: number; top: number; bottom: number },
  size: Rect,
  viewport: Viewport,
  margin = 4,
): { left: number; top: number; flipped: boolean } {
  const spaceBelow = viewport.height - trigger.bottom - margin
  const spaceAbove = trigger.top - margin
  const flipped = size.height > spaceBelow && spaceAbove > spaceBelow
  const top = flipped ? trigger.top - size.height : trigger.bottom
  return { ...clampToViewport(trigger.left, top, size, viewport, margin), flipped }
}

/**
 * Whether a modal or dropdown is up. A DOM query because the popover, the
 * import dialog and every dropdown belong to components the callers know
 * nothing about. Both backdrop classes, because both block: `.popover-backdrop`
 * dims (ConfirmDialog, ImportDialog, PortPopover) and `.menu-backdrop` is
 * invisible but still swallows every click (MenuSelect, ContextMenu).
 */
export const overlayOpen = (): boolean =>
  document.querySelector('.popover-backdrop, .menu-backdrop') !== null

/**
 * Is the keystroke going into a field? Global key handling stays out of the
 * way of one: the overlay's Escape would otherwise close it while a title is
 * being typed.
 */
export const isTextEntry = (element: Element | null): boolean =>
  element instanceof HTMLInputElement ||
  element instanceof HTMLTextAreaElement ||
  (element instanceof HTMLElement && element.isContentEditable)
