import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { FloorPlan } from '../model/types'

GlobalWorkerOptions.workerSrc = workerUrl

function raster(image: CanvasImageSource, width: number, height: number): FloorPlan {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas')
  context.fillStyle = '#efe8da'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  return { dataUrl: canvas.toDataURL('image/png'), width, height }
}

export async function pdfFileToPlan(file: File): Promise<FloorPlan> {
  const data = await file.arrayBuffer()
  const doc = await getDocument({ data }).promise
  try {
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(2.4, 2000 / Math.max(base.width, base.height))
    const viewport = page.getViewport({ scale: Math.max(1, scale) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas')
    await page.render({ canvasContext: context, viewport }).promise
    return raster(canvas, canvas.width, canvas.height)
  } finally {
    await doc.destroy()
  }
}
