interface Size {
  width: number
  height: number
}

export function clampToViewport(
  x: number,
  y: number,
  size: Size,
  viewport: Size,
  margin = 4,
): { left: number; top: number } {
  return {
    left: Math.max(margin, Math.min(x, viewport.width - size.width - margin)),
    top: Math.max(margin, Math.min(y, viewport.height - size.height - margin)),
  }
}

export function placeBelow(
  trigger: { left: number; top: number; bottom: number },
  size: Size,
  viewport: Size,
  margin = 4,
): { left: number; top: number } {
  const spaceBelow = viewport.height - trigger.bottom - margin
  const spaceAbove = trigger.top - margin
  const top = size.height > spaceBelow && spaceAbove > spaceBelow ? trigger.top - size.height : trigger.bottom
  return clampToViewport(trigger.left, top, size, viewport, margin)
}

/** Whether a modal or dropdown is up, including native top-layer overlays. */
export const overlayOpen = (): boolean =>
  document.querySelector('dialog[open], [popover]:popover-open, .popover-backdrop, .menu-backdrop') !== null

/**
 * Is the keystroke going into a field? Global key handling stays out of the
 * way of one: the overlay's Escape would otherwise close it while a title is
 * being typed.
 */
export const isTextEntry = (element: Element | null): boolean =>
  element instanceof HTMLInputElement ||
  element instanceof HTMLTextAreaElement ||
  (element instanceof HTMLElement && element.isContentEditable)
