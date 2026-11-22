import { AP_PRESETS, CLIENT_PRESETS } from '../model/presets'
import type { AccessPoint, ClientDevice, Project, Wall } from '../model/types'

const PPM = 76

function mx(meters: number, margin: number): number {
  return margin + meters * PPM
}

function seg(id: string, x1: number, y1: number, x2: number, y2: number, materialId: string, margin: number): Wall {
  return {
    id,
    materialId,
    points: [mx(x1, margin), mx(y1, margin), mx(x2, margin), mx(y2, margin)],
  }
}

function drawPlan(width: number, height: number, margin: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#efe6d6'
  ctx.fillRect(0, 0, width, height)

  const rooms = [
    { name: 'Спальня', x: 0, y: 0, w: 4.4, h: 3.6, fill: '#f7f1e4' },
    { name: 'Санузел', x: 0, y: 3.6, w: 2.3, h: 4, fill: '#e5eef2' },
    { name: 'Холл', x: 2.3, y: 3.6, w: 2.1, h: 4, fill: '#f4efe4' },
    { name: 'Кухня', x: 4.4, y: 0, w: 7.2, h: 2.8, fill: '#f8f4ea' },
    { name: 'Гостиная', x: 4.4, y: 2.8, w: 7.2, h: 4.8, fill: '#f3eee3' },
  ]
  for (const room of rooms) {
    ctx.fillStyle = room.fill
    ctx.fillRect(mx(room.x, margin), mx(room.y, margin), room.w * PPM, room.h * PPM)
  }

  ctx.save()
  ctx.strokeStyle = 'rgba(70, 62, 50, 0.35)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(mx(0.35, margin), mx(0.35, margin), 1.7 * PPM, 2.15 * PPM)
  ctx.strokeRect(mx(6.3, margin), mx(5.55, margin), 3.1 * PPM, 1.05 * PPM)
  ctx.strokeRect(mx(8.5, margin), mx(0.45, margin), 2.2 * PPM, 0.9 * PPM)
  ctx.restore()

  ctx.fillStyle = '#5e584e'
  ctx.font = '600 20px Manrope, sans-serif'
  ctx.fillText('Спальня', mx(0.4, margin), mx(0.55, margin))
  ctx.fillText('Санузел', mx(0.28, margin), mx(4.15, margin))
  ctx.fillText('Холл', mx(2.55, margin), mx(4.2, margin))
  ctx.fillText('Кухня', mx(4.7, margin), mx(0.5, margin))
  ctx.fillText('Гостиная', mx(4.75, margin), mx(3.25, margin))

  ctx.strokeStyle = '#2f2a24'
  ctx.fillStyle = '#2f2a24'
  ctx.lineWidth = 2
  const barX = mx(0.4, margin)
  const barY = height - margin * 0.55
  ctx.beginPath()
  ctx.moveTo(barX, barY)
  ctx.lineTo(barX + PPM, barY)
  ctx.stroke()
  ctx.font = '500 13px Manrope, sans-serif'
  ctx.fillText('1 м', barX + PPM + 8, barY + 4)
  ctx.font = '500 13px Manrope, sans-serif'
  ctx.fillText('Квартира · пример', margin, margin * 0.62)
  return canvas.toDataURL('image/png')
}

export function buildSampleProject(name: string): Project {
  const margin = 0.55 * PPM
  const planW = 11.6
  const planH = 7.6
  const width = Math.round(planW * PPM + margin * 2)
  const height = Math.round(planH * PPM + margin * 2)
  const wifi6 = AP_PRESETS.wifi6
  const ap: AccessPoint = {
    id: 'sample-ap',
    x: mx(3.3, margin),
    y: mx(5.5, margin),
    name: 'Wi-Fi 6 в холле',
    preset: 'wifi6',
    wifiGen: wifi6.wifiGen,
    mimo: wifi6.mimo,
    backhaul: wifi6.backhaul,
    band24: { ...wifi6.band24 },
    band5: { ...wifi6.band5 },
  }
  const clients: ClientDevice[] = [
    {
      id: 'sample-phone',
      x: mx(1.7, margin),
      y: mx(1.8, margin),
      name: 'Телефон',
      preset: 'phone',
      ...CLIENT_PRESETS.phone,
    },
    {
      id: 'sample-laptop',
      x: mx(9.6, margin),
      y: mx(1.3, margin),
      name: 'Ноутбук',
      preset: 'laptop',
      ...CLIENT_PRESETS.laptop,
    },
    {
      id: 'sample-tv',
      x: mx(9.2, margin),
      y: mx(5.6, margin),
      name: 'Телевизор',
      preset: 'tv',
      ...CLIENT_PRESETS.tv,
    },
  ]
  const walls: Wall[] = [
    seg('s-top', 0, 0, 11.6, 0, 'concrete', margin),
    seg('s-right', 11.6, 0, 11.6, 7.6, 'concrete', margin),
    seg('s-bot-r', 11.6, 7.6, 5.15, 7.6, 'concrete', margin),
    seg('s-bot-l', 4.25, 7.6, 0, 7.6, 'concrete', margin),
    seg('s-left', 0, 7.6, 0, 0, 'concrete', margin),
    seg('s-bed-1', 4.4, 0, 4.4, 2.55, 'brick', margin),
    seg('s-bed-2', 4.4, 3.35, 4.4, 3.6, 'brick', margin),
    seg('s-bed-b1', 0, 3.6, 1.45, 3.6, 'brick', margin),
    seg('s-bed-b2', 2.35, 3.6, 4.4, 3.6, 'brick', margin),
    seg('s-bath-1', 2.3, 3.6, 2.3, 5.85, 'drywall', margin),
    seg('s-bath-2', 2.3, 6.7, 2.3, 7.6, 'drywall', margin),
    seg('s-kit-1', 4.4, 2.8, 5.85, 2.8, 'brick', margin),
    seg('s-kit-2', 6.75, 2.8, 11.6, 2.8, 'brick', margin),
    seg('s-ward', 3.55, 0.3, 3.55, 1.9, 'furniture', margin),
    seg('s-sofa', 6.4, 6.55, 9.5, 6.55, 'furniture', margin),
  ]
  return {
    version: 1,
    id: crypto.randomUUID(),
    name,
    updatedAt: Date.now(),
    world: { width, height },
    floorPlan: { dataUrl: drawPlan(width, height, margin), width, height },
    scale: { metersPerPixel: 1 / PPM },
    walls,
    aps: [ap],
    clients,
    isp: { downMbps: 100, upMbps: 50 },
    propagation: { exponent: 2.8, autoClutter: false, noiseExtraDb: 3 },
  }
}
