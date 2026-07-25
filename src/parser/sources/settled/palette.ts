import type { Rgb, RgbaImage } from '../../image'
import type { ParserPalette } from '../../palette'

export const RAW_PALETTE: ParserPalette = {
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

interface PaletteMatch {
  palette: ParserPalette
  confidence: number
}

export function matchPalette(image: RgbaImage): PaletteMatch | null {
  const nearReference = (index: number, reference: Rgb): boolean => {
    const red = image.data[index] - reference[0]
    const green = image.data[index + 1] - reference[1]
    const blue = image.data[index + 2] - reference[2]
    return red * red + green * green + blue * blue <= 12 ** 2
  }
  let raw = 0
  let srgb = 0
  let samples = 0
  for (let y = 0; y < image.height; y += 16) {
    for (let x = 0; x < image.width; x += 16) {
      samples += 1
      const index = (y * image.width + x) * 4
      if (nearReference(index, RAW_PALETTE.bgBlue)) raw += 1
      if (nearReference(index, SRGB_PALETTE.bgBlue)) srgb += 1
    }
  }
  const matched = Math.max(raw, srgb)
  if (matched < Math.max(8, image.width * image.height / 160_000)) return null
  return {
    palette: raw >= srgb ? RAW_PALETTE : SRGB_PALETTE,
    confidence: Math.min(1, 0.65 + 4 * matched / samples),
  }
}

export function choosePalette(image: RgbaImage): ParserPalette | null {
  return matchPalette(image)?.palette ?? null
}
