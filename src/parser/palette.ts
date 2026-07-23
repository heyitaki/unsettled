import type { Resource } from '../model/types'
import {
  colorDistanceSquared,
  nearColor,
  pixel,
  type Rgb,
  type RgbaImage,
} from './image'

export interface ParserPalette {
  name: 'raw' | 'srgb'
  bgBlue: Rgb
  tiles: Record<Resource | 'desert', Rgb>
  tokenCream: Rgb
  chipCream: Rgb
  inkDark: Rgb
  inkRed: Rgb
  robberBlack: Rgb
  player: Record<'red' | 'blue' | 'orange' | 'white' | 'green', Rgb>
}

export const RAW_PALETTE: ParserPalette = {
  name: 'raw',
  bgBlue: [77, 125, 186],
  tokenCream: [242, 234, 210],
  chipCream: [249, 243, 226],
  inkDark: [56, 44, 30],
  inkRed: [161, 47, 40],
  robberBlack: [26, 26, 26],
  tiles: {
    wood: [61, 120, 65],
    sheep: [166, 207, 119],
    wheat: [219, 180, 83],
    brick: [172, 81, 52],
    ore: [123, 127, 133],
    desert: [222, 202, 146],
  },
  player: {
    red: [194, 63, 56],
    blue: [48, 99, 186],
    orange: [229, 131, 49],
    white: [255, 255, 255],
    green: [93, 158, 82],
  },
}

export const SRGB_PALETTE: ParserPalette = {
  name: 'srgb',
  bgBlue: [60, 127, 191],
  tokenCream: [244, 234, 207],
  chipCream: [250, 243, 224],
  inkDark: [58, 44, 28],
  inkRed: [175, 32, 32],
  robberBlack: [26, 26, 26],
  tiles: {
    wood: [30, 122, 58],
    sheep: [155, 208, 107],
    wheat: [227, 178, 60],
    brick: [184, 74, 42],
    ore: [122, 127, 134],
    desert: [225, 200, 138],
  },
  player: {
    red: [211, 48, 47],
    blue: [22, 100, 192],
    orange: [244, 125, 2],
    white: [255, 255, 255],
    green: [68, 160, 71],
  },
}

export function choosePalette(image: RgbaImage): ParserPalette | null {
  let raw = 0
  let srgb = 0
  for (let y = 0; y < image.height; y += 16) {
    for (let x = 0; x < image.width; x += 16) {
      const color = pixel(image, x, y)
      if (nearColor(color, RAW_PALETTE.bgBlue, 12)) raw += 1
      if (nearColor(color, SRGB_PALETTE.bgBlue, 12)) srgb += 1
    }
  }
  if (Math.max(raw, srgb) < Math.max(8, image.width * image.height / 160_000)) return null
  return raw >= srgb ? RAW_PALETTE : SRGB_PALETTE
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
