import { PLAYER_PALETTE, type Player, type Resource } from '../model/types'
import {
  colorDistanceSquared,
  type Rgb,
} from './image'

export interface ParserPalette {
  bgBlue: Rgb
  tiles: Record<Resource | 'desert', Rgb>
  tokenCream: Rgb
  chipCream: Rgb
  pillHighlight: Rgb
  counterInk: Rgb
  inkDark: Rgb
  inkRed: Rgb
  robberBlack: Rgb
  player: Record<keyof typeof PLAYER_PALETTE, Rgb>
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

type PlayerSeed = keyof ParserPalette['player']

export function playerFromSeed(id: string, seed: PlayerSeed): Player {
  return { id, name: seed[0].toUpperCase() + seed.slice(1), color: PLAYER_PALETTE[seed] }
}

export function classifyPlayerSeed(color: Rgb, palette: ParserPalette): PlayerSeed | null {
  return nearest(color, Object.entries(palette.player) as [PlayerSeed, Rgb][], 22)
}
