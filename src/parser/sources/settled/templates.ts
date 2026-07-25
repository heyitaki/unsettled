export interface BinaryMask {
  width: number
  height: number
  pixels: Set<string>
}

function decodeMask(width: number, height: number, data: string): BinaryMask {
  const decoded = atob(data)
  const pixels = new Set<string>()
  for (let bit = 0; bit < width * height; bit += 1) {
    if ((decoded.charCodeAt(Math.floor(bit / 8)) & (1 << (bit % 8))) !== 0) {
      pixels.add(`${bit % width},${Math.floor(bit / width)}`)
    }
  }
  return { width, height, pixels }
}

// Traced from the native-resolution "You" label in the committed Settled
// fixtures, then trimmed to its ink bounds.
export const YOU_TEMPLATE = decodeMask(
  66,
  27,
  'PwB8AAAAAAD4APgBAAAAAOAH4AMAAAAAAB/ADwAAAAAA/AAfAAAAAADgA34AAAAAAAAf+AD+AfABPnzwAf4fwAf44MMH/P8AH+CDjw/4/wd8gA98PvAHP/ABPvB/wA/8wAf4gP8BH+ADH+AD/gN+AB98gA/wD/gAfPABPoAf4APwwQf4AH6AD8AHH+AD+AA+AB98gA/gA/gAfPABPoAP4AfwwQf4AD4AH+AHH+AD+AD8gA/8wA/gA/ADP/CHP4APgP9/gP//AD4A/P8A/u8D+ADg/wHwnw/gAwD+AQA/Pg==',
)

// Counter masks were thresholded from the hand-verified raw fixture at their
// native ink bounds. Runtime matching height-normalizes them before scoring.
export const DIGIT_TEMPLATES: Readonly<Record<string, BinaryMask>> = {
  '0': decodeMask(20, 28, 'AA8A/gfw/4D/H3zgwwM8PsDnAXgegPcB+A8A/wDwDwD/APAPAP8A8A8A/wDwD4D/AXgegOcBeD7Awwc++PCB/w/wfwD8Aw=='),
  '1': decodeMask(11, 27, 'wIc//vn/+ccfPvCABzzgAQ94wAMe8IAHPOABD3jAAx7wgAc84AE='),
  '2': decodeMask(19, 28, 'gA+A/wH+P/j74wMfD/A9AO8BeADAAwAeAPAAwAMAHwB8APABwAcAHwB8APABgAcAHgB4AOABgA8A/v//////////Dw=='),
  '3': decodeMask(20, 28, 'gA8A/gf4/8H/P37g4wF8HsD3AHgAgAMAPADAAwAfgH8A+AGAfwCAHwDAAwB8AIAHAPgAgP8A+B+A5wN8/vDD/z/4/wD+Aw=='),
  '4': decodeMask(22, 27, 'APgDAP8AwD8AeA8AzgPA8wB4PAAOD8DDA3jwAA48wAMPcMADHvDAAzxwAA8ewIMD8PD/////////PwDwAAA8AAAPAMADAPAAADwA'),
  '5': decodeMask(18, 27, '/v/5/+f/nwMADgA4AOAAgAMADwA8GPD8w/s///x9wPcAPgDwAMADAA8AOADwD8A/AP8Bng9+/P/g/wH+AQ=='),
  '6': decodeMask(20, 28, 'AB4A/Afw/4H/P3zAxwN4HoDvAQAeAPAAAA8Y8PgPz//xvj9/wPcDeB8A/wHwHwD/AfAeAO8B8D6Axwd8+OCD/z/g/wD8Aw=='),
  '7': decodeMask(19, 27, '/////////wGADwA8AOABgAcAPADwAIAHAB4A+ADAAwAfAHgA4AMADwB8AOABgA8APADwAYAHAD4A8ADABwAeAAA='),
  '8': decodeMask(24, 30, 'ABgAwP8D8P8P+P8f/P8//IE//gB//gB/fgB//gB//AA//IE/+OMf4P8HgP8B4P8H+P8f/ME//gB/fgB+fwD+fwD+fwD+fwD+/gB//sN//P8/+P8f8P8PgP8B'),
  '9': decodeMask(20, 28, 'gA8A/wf4/8D/Hz7g4wE8H4D3AHgPgP8A+A+A/wD4H4DvA/x+cM//8/gfD/7wAAAPAPAAgAcAeB7A4wM+fPCB/w/wfwD+AQ=='),
}

export type CounterIcon = 'trophy' | 'bag' | 'scroll' | 'sword' | 'road'

export const ICON_TEMPLATES: Readonly<Record<CounterIcon, BinaryMask>> = {
  trophy: decodeMask(30, 31, 'wP//APj/fwD+/x/A//8P////f/j/fxj+/x+G//+H4///sfj/f2T+/5+x//83+P//B/z//wD+/x8A//8DwP//AOD/HwDw/wMA+H8AAPgHAAB4AAAADAAAAAMAAMAAAAAwAAAADAAAAAMAAMAAAID/BwDg/wEA'),
  bag: decodeMask(28, 28, 'wP8/APz/AwAAAAAAAAD4//8BAAAAAAAA4P//f/////////////////////////////////////////////////////////////////////////////////////z//wMAAAA='),
  scroll: decodeMask(30, 29, 'gP//D/D//wf+/4+B///j4P//OHgAPAAeAA+AB8AD4AHwAPj/PwD+/w+AB/AD4AH8AHgAPwAewA+A//8D4P//APj/PwD+/w+A//8DAADgAAAAOAAAAAwAAAAA//8HwP//AeD//wH4//8B/P8/AA=='),
  sword: decodeMask(25, 25, 'fwAA/gEA/AcAGB4AcHgA4OEBwIcHgB8eAH54APjhAeCHB4AfHgB+eAb44R/ghx+AHx4Afh4A+B8A4H8AgP8BAP4HAJ4fAB5+ABj4AADgAA=='),
  road: decodeMask(26, 23, '8Ic/wB/+AH/4A/7hD/j/f+D//4H//wf+4R/4h3/wD/7DP/gP/+A//IP/8P//4///n///f/4D//kP/Oc/8N//wH//A///D/z/P/A/'),
}

export const PAREN_TEMPLATE = decodeMask(
  8,
  35,
  '4HB4ODw8HB4eHh8PDw8PDw8PDw8PDw8fHh4eHDw8OHhw4OA=',
)

export const RIGHT_PAREN_TEMPLATE: BinaryMask = {
  ...PAREN_TEMPLATE,
  pixels: new Set([...PAREN_TEMPLATE.pixels].map((key) => {
    const [x, y] = key.split(',').map(Number)
    return `${PAREN_TEMPLATE.width - x - 1},${y}`
  })),
}
