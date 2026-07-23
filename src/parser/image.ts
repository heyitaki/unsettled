export type Rgb = readonly [number, number, number]

export interface RgbaImage {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const colorDistanceSquared = (a: Rgb, b: Rgb): number =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2

export const nearColor = (color: Rgb, reference: Rgb, tolerance: number): boolean =>
  colorDistanceSquared(color, reference) <= tolerance * tolerance

export function pixel(image: RgbaImage, x: number, y: number): Rgb {
  const safeX = Math.max(0, Math.min(image.width - 1, Math.round(x)))
  const safeY = Math.max(0, Math.min(image.height - 1, Math.round(y)))
  const index = (safeY * image.width + safeX) * 4
  return [image.data[index], image.data[index + 1], image.data[index + 2]]
}

export function cropImage(image: RgbaImage, rect: Rect): RgbaImage {
  const x0 = Math.max(0, Math.round(rect.x))
  const y0 = Math.max(0, Math.round(rect.y))
  const width = Math.max(1, Math.min(image.width - x0, Math.round(rect.width)))
  const height = Math.max(1, Math.min(image.height - y0, Math.round(rect.height)))
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const source = ((y0 + y) * image.width + x0) * 4
    data.set(image.data.subarray(source, source + width * 4), y * width * 4)
  }
  return { width, height, data }
}
