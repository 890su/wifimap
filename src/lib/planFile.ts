import type { FloorPlan } from '../model/types'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('image'))
    image.src = src
  })
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function raster(image: CanvasImageSource, width: number, height: number, type: 'image/png' | 'image/jpeg'): FloorPlan {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas')
  context.fillStyle = '#efe8da'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  const dataUrl = type === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.86)
  return { dataUrl, width, height }
}

async function imageFileToPlan(file: File): Promise<FloorPlan> {
  const src = await readFile(file)
  const image = await loadImage(src)
  const maxDim = 2000
  const scale = Math.min(1, maxDim / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const keepPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')
  return raster(image, width, height, keepPng ? 'image/png' : 'image/jpeg')
}

export async function fileToPlan(file: File): Promise<FloorPlan> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (isPdf) {
    const pdf = await import('./pdfPlan')
    return pdf.pdfFileToPlan(file)
  }
  return imageFileToPlan(file)
}
