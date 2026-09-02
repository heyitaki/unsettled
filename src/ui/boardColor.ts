/** Ten hues so that boards open together rarely share one (spec B4); the order matches the prototype. */
export const BOARD_PALETTE: readonly string[] = [
  '#1e7a3a',
  '#9bd06b',
  '#e3b23c',
  '#b84a2a',
  '#7a7f86',
  '#e1c88a',
  '#3d7cb7',
  '#7a5230',
  '#c23f38',
  '#e58331',
]

/** A board's hex colour is a pure function of its name, so it matches wherever the board is listed. */
export function boardColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return BOARD_PALETTE[hash % BOARD_PALETTE.length]
}
