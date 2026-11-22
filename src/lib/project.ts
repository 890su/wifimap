import type { AccessPoint, ClientDevice, Project, Wall } from '../model/types'

export function createEmptyProject(name: string): Project {
  return {
    version: 1,
    id: crypto.randomUUID(),
    name,
    updatedAt: Date.now(),
    world: { width: 1200, height: 800 },
    floorPlan: null,
    scale: null,
    walls: [],
    aps: [],
    clients: [],
    isp: { downMbps: 100, upMbps: 50 },
    propagation: { exponent: 2.2, autoClutter: true },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asWalls(value: unknown): Wall[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || !Array.isArray(item.points)) return []
    const points = item.points.filter((n): n is number => typeof n === 'number')
    if (points.length < 4) return []
    return [
      {
        id: item.id,
        points,
        materialId: typeof item.materialId === 'string' ? item.materialId : 'drywall',
        closed: item.closed === true,
      },
    ]
  })
}

function asRadio(value: unknown, fallback: AccessPoint['band24']): AccessPoint['band24'] {
  if (!isRecord(value)) return fallback
  return {
    enabled: value.enabled !== false,
    txPowerDbm: typeof value.txPowerDbm === 'number' ? value.txPowerDbm : fallback.txPowerDbm,
    gainDbi: typeof value.gainDbi === 'number' ? value.gainDbi : fallback.gainDbi,
    channelWidthMHz: typeof value.channelWidthMHz === 'number' ? value.channelWidthMHz : fallback.channelWidthMHz,
  }
}

function asAps(value: unknown): AccessPoint[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string') return []
    if (typeof item.x !== 'number' || typeof item.y !== 'number') return []
    const draft: AccessPoint = {
      id: item.id,
      x: item.x,
      y: item.y,
      name: typeof item.name === 'string' ? item.name : 'AP',
      preset: item.preset === 'isp' || item.preset === 'wifi5' || item.preset === 'wifi6' || item.preset === 'mesh' || item.preset === 'repeater' ? item.preset : 'wifi6',
      wifiGen: item.wifiGen === 'wifi4' || item.wifiGen === 'wifi5' || item.wifiGen === 'wifi6' ? item.wifiGen : 'wifi6',
      mimo: typeof item.mimo === 'number' ? item.mimo : 2,
      backhaul:
        item.backhaul === 'wired' || item.backhaul === 'repeater' || item.backhaul === 'mesh-wireless' || item.backhaul === 'mesh-wired'
          ? item.backhaul
          : 'wired',
      band24: asRadio(item.band24, { enabled: true, txPowerDbm: 20, gainDbi: 3, channelWidthMHz: 20 }),
      band5: asRadio(item.band5, { enabled: true, txPowerDbm: 23, gainDbi: 4, channelWidthMHz: 80 }),
    }
    return [draft]
  })
}

function asClients(value: unknown): ClientDevice[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string') return []
    if (typeof item.x !== 'number' || typeof item.y !== 'number') return []
    const preset =
      item.preset === 'phone' || item.preset === 'laptop' || item.preset === 'tv' || item.preset === 'console' || item.preset === 'pc'
        ? item.preset
        : 'phone'
    return [
      {
        id: item.id,
        x: item.x,
        y: item.y,
        name: typeof item.name === 'string' ? item.name : 'Client',
        preset,
        wifiGen: item.wifiGen === 'wifi4' || item.wifiGen === 'wifi5' || item.wifiGen === 'wifi6' ? item.wifiGen : 'wifi6',
        mimo: typeof item.mimo === 'number' ? item.mimo : 2,
        supports5: item.supports5 !== false,
      },
    ]
  })
}

export function parseProject(value: unknown): Project | null {
  if (!isRecord(value) || value.version !== 1) return null
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return null
  const world = isRecord(value.world) && typeof value.world.width === 'number' && typeof value.world.height === 'number'
    ? { width: value.world.width, height: value.world.height }
    : { width: 1200, height: 800 }
  let floorPlan: Project['floorPlan'] = null
  if (isRecord(value.floorPlan) && typeof value.floorPlan.dataUrl === 'string') {
    floorPlan = {
      dataUrl: value.floorPlan.dataUrl,
      width: typeof value.floorPlan.width === 'number' ? value.floorPlan.width : world.width,
      height: typeof value.floorPlan.height === 'number' ? value.floorPlan.height : world.height,
    }
  }
  const scale =
    isRecord(value.scale) && typeof value.scale.metersPerPixel === 'number' && value.scale.metersPerPixel > 0
      ? { metersPerPixel: value.scale.metersPerPixel }
      : null
  const isp = isRecord(value.isp)
    ? {
        downMbps: typeof value.isp.downMbps === 'number' ? value.isp.downMbps : 100,
        upMbps: typeof value.isp.upMbps === 'number' ? value.isp.upMbps : 50,
      }
    : { downMbps: 100, upMbps: 50 }
  const propagation = isRecord(value.propagation)
    ? {
        exponent: typeof value.propagation.exponent === 'number' ? value.propagation.exponent : 2.2,
        autoClutter: value.propagation.autoClutter !== false,
      }
    : { exponent: 2.2, autoClutter: true }
  return {
    version: 1,
    id: value.id,
    name: value.name,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
    world,
    floorPlan,
    scale,
    walls: asWalls(value.walls),
    aps: asAps(value.aps),
    clients: asClients(value.clients),
    isp,
    propagation,
  }
}
