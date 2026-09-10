import type { Resource } from '../model/types'
import {
  colorDistanceSquared,
  type Rgb,
} from './image'

export interface ParserPalette {
  bgBlue: Rgb
  tiles: Record<Resource | 'desert', Rgb>
  tokenCream: Rgb
  chipCream: Rgb
  inkDark: Rgb
  inkRed: Rgb
  robberBlack: Rgb
  player: Record<'red' | 'blue' | 'orange' | 'white' | 'green', Rgb>
}

export function nearest<Entry>(color: Rgb, entries: readonly (readonly [Entry, Rgb])[], tolerance: number): Entry | null {
  let best: Entry | null = null
  let distance = tolerance ** 2
  for (const [entry, reference] of entries) {
    const candidate = colorDistanceSquared(color, reference)
    if (candidate <= distance) {
      distance = candidate
      best = entry
    }
  }
  return best
}

export function classifyTile(color: Rgb, palette: ParserPalette): Resource | 'desert' | null {
  return nearest(color, Object.entries(palette.tiles) as [Resource | 'desert', Rgb][], 25)
}

export type PlayerSeed = keyof ParserPalette['player']

export function classifyPlayerSeed(color: Rgb, palette: ParserPalette): PlayerSeed | null {
  return nearest(color, Object.entries(palette.player) as [PlayerSeed, Rgb][], 22)
}
