export interface ViewTransform {
  scale: number
  tx: number
  ty: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export const IDENTITY: ViewTransform = { scale: 1, tx: 0, ty: 0 }

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(value, maximum))

export function transformedViewBox(base: Box, transform: ViewTransform): Box {
  return {
    x: base.x + transform.tx,
    y: base.y + transform.ty,
    width: base.width / transform.scale,
    height: base.height / transform.scale,
  }
}

export function clampTransform(
  transform: ViewTransform,
  base: Box,
): ViewTransform {
  const scale = clamp(transform.scale, 1, 6)
  const maxTx = Math.max(0, base.width - base.width / scale)
  const maxTy = Math.max(0, base.height - base.height / scale)
  return {
    scale,
    tx: clamp(transform.tx, 0, maxTx),
    ty: clamp(transform.ty, 0, maxTy),
  }
}

/**
 * Moves the visible window by a board-unit delta. A finger moving right should
 * move the window left, so pointer callers pass the negated pointer delta.
 */
export function panBy(
  transform: ViewTransform,
  dxUnits: number,
  dyUnits: number,
  base: Box,
): ViewTransform {
  return clampTransform({
    ...transform,
    tx: transform.tx + dxUnits,
    ty: transform.ty + dyUnits,
  }, base)
}

export function zoomAbout(
  transform: ViewTransform,
  factor: number,
  anchor: { x: number; y: number },
  base: Box,
): ViewTransform {
  const before = transformedViewBox(base, transform)
  const position = {
    x: (anchor.x - before.x) / before.width,
    y: (anchor.y - before.y) / before.height,
  }
  const scale = clamp(transform.scale * factor, 1, 6)
  const width = base.width / scale
  const height = base.height / scale
  return clampTransform({
    scale,
    tx: anchor.x - position.x * width - base.x,
    ty: anchor.y - position.y * height - base.y,
  }, base)
}

export function clientToUnits(
  point: { x: number; y: number },
  rect: DOMRectReadOnly | Box,
  base: Box,
  transform: ViewTransform,
): { x: number; y: number } {
  const view = transformedViewBox(base, transform)
  if (rect.width === 0 || rect.height === 0) {
    return { x: view.x + view.width / 2, y: view.y + view.height / 2 }
  }
  const scale = Math.min(rect.width / view.width, rect.height / view.height)
  const left = (rect.width - view.width * scale) / 2
  const top = (rect.height - view.height * scale) / 2
  return {
    x: view.x + (point.x - rect.x - left) / scale,
    y: view.y + (point.y - rect.y - top) / scale,
  }
}
