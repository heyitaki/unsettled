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

export function classifyTile(color: Rgb, palette: ParserPalette): Resource | 'desert' | null {
  let best: Resource | 'desert' | null = null
  let distance = 25 ** 2
  for (const [resource, reference] of Object.entries(palette.tiles) as [Resource | 'desert', Rgb][]) {
    const candidate = colorDistanceSquared(color, reference)
    if (candidate <= distance) {
      distance = candidate
      best = resource
    }
  }
  return best
}

export type PlayerSeed = keyof ParserPalette['player']

export function classifyPlayerSeed(color: Rgb, palette: ParserPalette): PlayerSeed | null {
  let best: PlayerSeed | null = null
  let distance = 22 ** 2
  for (const [name, reference] of Object.entries(palette.player) as [PlayerSeed, Rgb][]) {
    const candidate = colorDistanceSquared(color, reference)
    if (candidate <= distance) {
      distance = candidate
      best = name
    }
  }
  return best
}
