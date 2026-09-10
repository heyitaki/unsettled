import { createWorker } from 'tesseract.js'
import type { Rect, RgbaImage } from './image'

export interface TextReader {
  read(image: RgbaImage, rect: Rect): Promise<string>
  terminate?(): Promise<void>
}

function imageDataFor(image: RgbaImage): ImageData {
  return new ImageData(new Uint8ClampedArray(image.data), image.width, image.height)
}

export async function createBrowserTextReader(): Promise<TextReader> {
  // BASE_URL is '/unsettled/' in the deployed build, '/' in dev — keep the
  // self-hosted Tesseract assets resolving under whatever base we ship on.
  const base = import.meta.env.BASE_URL
  const worker = await createWorker('eng', 1, {
    workerPath: `${base}tesseract/worker.min.js`,
    corePath: `${base}tesseract`,
    langPath: `${base}tessdata`,
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
