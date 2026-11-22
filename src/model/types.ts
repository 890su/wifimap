export type BandId = '2.4' | '5'

export type WifiGen = 'wifi4' | 'wifi5' | 'wifi6'

export type Backhaul = 'wired' | 'repeater' | 'mesh-wireless' | 'mesh-wired'

export type ApPreset = 'isp' | 'wifi5' | 'wifi6' | 'mesh' | 'repeater'

export type ClientPreset = 'phone' | 'laptop' | 'tv' | 'console' | 'pc'

export type Tool = 'select' | 'pan' | 'scale' | 'wall' | 'room' | 'pencil' | 'ap' | 'client'

export type ActivityId = 'surfing' | 'video' | 'calls' | 'broadcast' | 'gaming' | 'cloud'

export interface Radio {
  enabled: boolean
  txPowerDbm: number
  gainDbi: number
  channelWidthMHz: number
}

export interface Wall {
  id: string
  /** Flat polyline in plan pixels: [x0, y0, x1, y1, ...]. */
  points: number[]
  materialId: string
  /** When true, the last vertex connects back to the first (a room). */
  closed?: boolean
  /** Optional thickness. Loss scales against the 12 cm reference. */
  thicknessCm?: number
}

export interface AccessPoint {
  id: string
  x: number
  y: number
  name: string
  preset: ApPreset
  wifiGen: WifiGen
  mimo: number
  backhaul: Backhaul
  band24: Radio
  band5: Radio
}

export interface ClientDevice {
  id: string
  x: number
  y: number
  name: string
  preset: ClientPreset
  wifiGen: WifiGen
  mimo: number
  supports5: boolean
  txPowerDbm?: number
  gainDbi?: number
}

export interface FloorPlan {
  dataUrl: string
  width: number
  height: number
}

export interface Project {
  version: 1
  id: string
  name: string
  updatedAt: number
  world: { width: number; height: number }
  floorPlan: FloorPlan | null
  /** Null until the user measures a known length. */
  scale: { metersPerPixel: number } | null
  walls: Wall[]
  aps: AccessPoint[]
  clients: ClientDevice[]
  isp: { downMbps: number; upMbps: number; pingMs?: number }
  propagation: { exponent: number; autoClutter: boolean; noiseExtraDb?: number }
}

export interface Material {
  id: string
  /** Attenuation of one crossing, dB. */
  lossDb: Record<BandId, number>
  color: string
}

export interface Point {
  x: number
  y: number
}

export type WarningCode = 'no-ap' | 'no-link' | 'weak-signal' | 'approx-scale' | 'wireless-backhaul' | 'no-parent' | 'eirp'

export interface ClientEstimate {
  clientId: string
  apId: string | null
  apName: string | null
  band: BandId | null
  distanceM: number | null
  wallLossDb: number | null
  rssiDbm: number | null
  snrDb: number | null
  phyMbps: number
  downMbps: number
  upMbps: number
  pingMs: number | null
  jitterMs: number | null
  scores: Record<ActivityId, number>
  warnings: WarningCode[]
}

export interface HeatmapRequest {
  walls: Wall[]
  aps: AccessPoint[]
  band: BandId
  exponent: number
  autoClutter: boolean
  metersPerPixel: number
  originX: number
  originY: number
  widthPx: number
  heightPx: number
  cellM: number
}

export interface HeatmapGrid {
  width: number
  height: number
  cellPx: number
  originX: number
  originY: number
  rssi: Float32Array
}
