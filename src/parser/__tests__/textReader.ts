import { createWorker, type Worker } from 'tesseract.js'
import { cropImage, type RgbaImage } from '../image'
import type { TextReader } from '../textReader'

function bmpBuffer(image: RgbaImage): Buffer {
  const rowSize = Math.ceil(image.width * 3 / 4) * 4
  const pixelSize = rowSize * image.height
  const bytes = new Uint8Array(54 + pixelSize)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0x42
  bytes[1] = 0x4d
  view.setUint32(2, bytes.length, true)
  view.setUint32(10, 54, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, image.width, true)
  view.setInt32(22, image.height, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, 24, true)
  view.setUint32(34, pixelSize, true)
  for (let y = 0; y < image.height; y += 1) {
    const targetY = image.height - y - 1
    for (let x = 0; x < image.width; x += 1) {
      const source = (y * image.width + x) * 4
      const target = 54 + targetY * rowSize + x * 3
      bytes[target] = image.data[source + 2]
      bytes[target + 1] = image.data[source + 1]
      bytes[target + 2] = image.data[source]
    }
  }
  return Buffer.from(bytes)
}

export async function createNodeTextReader(langPath: string): Promise<TextReader> {
  const worker: Worker = await createWorker('eng', 1, {
    langPath,
    cacheMethod: 'none',
    gzip: true,
  })
  return {
    async read(image, rect) {
      const result = await worker.recognize(bmpBuffer(cropImage(image, rect)))
      return result.data.text.trim().replace(/\s+/g, ' ')
    },
    async terminate() {
      await worker.terminate()
    },
  }
}
