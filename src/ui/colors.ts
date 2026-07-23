import type { TileKind } from '../model/types'

export const TILE_COLORS: Record<TileKind, string> = {
  wood: '#1e7a3a',
  sheep: '#9bd06b',
  wheat: '#e3b23c',
  brick: '#b84a2a',
  ore: '#7a7f86',
  desert: '#e1c88a',
}

export const SEA_COLOR = '#3c7fbf'
export const TOKEN_COLOR = '#f4eacf'
export const INK_COLOR = '#3a2c1c'
export const PAPER_COLOR = '#fbf4df'

/** Pick dark ink or light paper text for legibility on an arbitrary fill color. */
export function readableInk(hex: string): string {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? INK_COLOR : PAPER_COLOR
}
