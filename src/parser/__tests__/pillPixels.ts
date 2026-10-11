import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import type { Board } from '../../model/types'
import { pixel, type Rect, type Rgb, type RgbaImage } from '../image'

export function load(name = 'settled-2p-first-pick'): RgbaImage {
  const path = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures', `${name}.png`)
  const png = PNG.sync.read(readFileSync(path))
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }
}

export function paint(image: RgbaImage, rect: Rect, color: Rgb) {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      image.data.set([...color, 255], (y * image.width + x) * 4)
    }
  }
}

export function copy(image: RgbaImage, rect: Rect, targetX: number, targetY: number, source = image) {
  const original = { ...source, data: source.data.slice() }
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      image.data.set([...pixel(original, rect.x + x, rect.y + y), 255], ((targetY + y) * image.width + targetX + x) * 4)
    }
  }
}

export function withCounterTen(field: 'vp' | 'hand'): RgbaImage {
  const source = load()
  const image = { ...source, data: source.data.slice() }
  const split = field === 'vp' ? 552 : 620
  const extra = field === 'vp' ? 22 : 14
  for (let y = 310; y < 420; y += 1) {
    for (let x = split; x < 654 + extra; x += 1) {
      paint(image, { x, y, width: 1, height: 1 }, pixel(source, Math.max(split, x - extra), y))
    }
  }
  const left = field === 'vp' ? 525 : 597
  paint(image, { x: left - 2, y: 347, width: 36, height: 35 }, [248, 243, 225])
  for (const [rect, target] of [
    [{ x: 525, y: 352, width: 10, height: 25 }, left],
    [{ x: 597, y: 351, width: 18, height: 26 }, left + 14],
  ] as const) {
    copy(image, rect, target, rect.y, source)
  }
  return image
}

export function toSrgb(image: RgbaImage): RgbaImage {
  const data = image.data.slice()
  const converted = new Map<number, Rgb>()
  const linear = (byte: number) => byte / 255 <= 0.04045 ? byte / 255 / 12.92 : ((byte / 255 + 0.055) / 1.055) ** 2.4
  const encoded = (value: number) => Math.round(255 * Math.max(0, Math.min(1, value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055)))
  for (let index = 0; index < data.length; index += 4) {
    const key = (data[index] << 16) | (data[index + 1] << 8) | data[index + 2]
    let rgb = converted.get(key)
    if (!rgb) {
      const [r, g, b] = [data[index], data[index + 1], data[index + 2]].map(linear)

      // Display-P3 and sRGB share D65, so their linear matrices combine without adaptation.
      rgb = [
        encoded(1.22494017628056 * r - 0.22494017628056 * g),
        encoded(-0.042056954709688 * r + 1.042056954709688 * g),
        encoded(-0.019637554590334 * r - 0.078636045550631 * g + 1.098273600140966 * b),
      ]
      converted.set(key, rgb)
    }
    data.set(rgb, index)
  }
  return { ...image, data }
}

export function nearestScale(img: RgbaImage, factor = 2): RgbaImage {
  const width = Math.floor(img.width / factor)
  const height = Math.floor(img.height / factor)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = (Math.floor(y * factor) * img.width + Math.floor(x * factor)) * 4
      data.set(img.data.subarray(source, source + 4), (y * width + x) * 4)
    }
  }
  return { width, height, data }
}

export const sorted = <T extends object>(values: T[]) => [...values].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
export const colored = <T extends { playerId: string }>(board: Board, pieces: T[]) => pieces.map((piece) => ({
  ...piece, playerId: board.players.find((player) => player.id === piece.playerId)!.color,
}))
