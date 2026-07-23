import { createWorker, type Worker } from 'tesseract.js'
import { cropImage, type Rect, type RgbaImage } from './image'

export interface TextReader {
  read(image: RgbaImage, rect: Rect): Promise<string>
  terminate?(): Promise<void>
}

function imageDataFor(image: RgbaImage): ImageData {
  return new ImageData(new Uint8ClampedArray(image.data), image.width, image.height)
}

export async function createBrowserTextReader(): Promise<TextReader> {
  const worker = await createWorker('eng', 1, {
    workerPath: '/tesseract/worker.min.js',
    corePath: '/tesseract',
    langPath: '/tessdata',
    cacheMethod: 'none',
    gzip: true,
  })
  const canvas = document.createElement('canvas')
  return {
    async read(image, rect) {
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas 2D context is unavailable')
      context.putImageData(imageDataFor(image), 0, 0)
      const result = await worker.recognize(canvas, {
        rectangle: {
          left: Math.max(0, Math.round(rect.x)),
          top: Math.max(0, Math.round(rect.y)),
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
        },
      })
      return result.data.text.trim().replace(/\s+/g, ' ')
    },
    async terminate() {
      await worker.terminate()
    },
  }
}

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
