const WIDTH = 66
const HEIGHT = 27
const DATA = 'PwB8AAAAAAD4APgBAAAAAOAH4AMAAAAAAB/ADwAAAAAA/AAfAAAAAADgA34AAAAAAAAf+AD+AfABPnzwAf4fwAf44MMH/P8AH+CDjw/4/wd8gA98PvAHP/ABPvB/wA/8wAf4gP8BH+ADH+AD/gN+AB98gA/wD/gAfPABPoAf4APwwQf4AH6AD8AHH+AD+AA+AB98gA/gA/gAfPABPoAP4AfwwQf4AD4AH+AHH+AD+AD8gA/8wA/gA/ADP/CHP4APgP9/gP//AD4A/P8A/u8D+ADg/wHwnw/gAwD+AQA/Pg=='

function decodeTemplate(): Set<string> {
  const decoded = atob(DATA)
  const pixels = new Set<string>()
  for (let bit = 0; bit < WIDTH * HEIGHT; bit += 1) {
    if ((decoded.charCodeAt(Math.floor(bit / 8)) & (1 << (bit % 8))) !== 0) {
      pixels.add(`${bit % WIDTH},${Math.floor(bit / WIDTH)}`)
    }
  }
  return pixels
}

export const YOU_TEMPLATE = {
  width: WIDTH,
  height: HEIGHT,
  pixels: decodeTemplate(),
}
