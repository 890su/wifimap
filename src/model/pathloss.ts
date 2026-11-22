import { materialLoss } from './materials'
import { crossingT, wallSegments, type Segment } from './geometry'
import type { AccessPoint, BandId, HeatmapGrid, HeatmapRequest, Wall } from './types'

/** 40 px = 1 m until the user sets a measured scale. */
export const APPROX_METERS_PER_PIXEL = 1 / 40

export const BAND_FREQ_MHZ: Record<BandId, number> = {
  '2.4': 2437,
  '5': 5200,
}

/** Reference noise at 20 MHz. Wider channels add 10·log10(B/20). */
export const NOISE_20MHZ_DBM = -95

export const WALL_LOSS_CAP_DB = 60

export const NO_LINK_RSSI_DBM = -82

/** Apartment neighbour density used when a project does not say otherwise. */
export const DEFAULT_NOISE_EXTRA_DB = 3

export const PL0_DB: Record<BandId, number> = { '2.4': 40, '5': 47 }

export function effectiveScale(scale: { metersPerPixel: number } | null): {
  metersPerPixel: number
  approximate: boolean
} {
  if (scale && scale.metersPerPixel > 0 && Number.isFinite(scale.metersPerPixel)) {
    return { metersPerPixel: scale.metersPerPixel, approximate: false }
  }
  return { metersPerPixel: APPROX_METERS_PER_PIXEL, approximate: true }
}

/** Free-space path loss at 1 m for a frequency in MHz. The planner uses {@link pl0Db}. */
export function fsplAt1m(freqMHz: number): number {
  return 20 * Math.log10(freqMHz) - 27.55
}

/** Planning PL0 from the specification: 40 dB at 2.4 GHz, 47 dB at 5 GHz. */
export function pl0Db(freqMHz: number): number {
  return freqMHz < 3000 ? PL0_DB['2.4'] : PL0_DB['5']
}

/**
 * Noise floor for a channel width, plus a constant neighbour-density offset.
 * 20 MHz → −95 dBm, 80 MHz → −89 dBm, 160 MHz → −86 dBm, before the offset.
 */
export function noiseFloorDbm(widthMHz: number, neighborDb = 0): number {
  const steps: [number, number][] = [
    [20, -95],
    [40, -92],
    [80, -89],
    [160, -86],
    [320, -83],
  ]
  let base = -95
  for (const [width, floor] of steps) if (widthMHz + 1e-6 >= width) base = floor
  return base + neighborDb
}

/**
 * Log-distance loss plus explicit wall crossings (multi-wall model).
 * The exponent does not depend on whether walls are drawn.
 */
export function pathLossDb(
  distanceM: number,
  freqMHz: number,
  exponent: number,
  wallLossDb: number,
): number {
  const d = Math.max(distanceM, 0.5)
  return pl0Db(freqMHz) + 10 * exponent * Math.log10(d) + wallLossDb
}

/** The configured exponent is used as-is. Walls are added separately. */
export function resolveExponent(userExponent: number, _wallCount = 0, _autoClutter = false): number {
  return Number.isFinite(userExponent) ? userExponent : 2.8
}

export function radioFor(ap: AccessPoint, band: BandId) {
  return band === '2.4' ? ap.band24 : ap.band5
}

export function buildSegments(walls: Wall[], band: BandId): Segment[] {
  const segs: Segment[] = []
  for (const wall of walls) {
    segs.push(...wallSegments(wall, materialLoss(wall.materialId, band, wall.thicknessCm)))
  }
  return segs
}

/**
 * Sum of wall crossings. Segments that the ray meets within 12 cm of each
 * other (a shared edge of two rooms) count once, at the larger loss.
 */
export function wallLossBetween(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  segs: Segment[],
  metersPerPixel = 1,
): number {
  const lengthM = Math.max(Math.hypot(bx - ax, by - ay) * metersPerPixel, 0.01)
  const hits: { alongM: number; loss: number }[] = []
  for (const s of segs) {
    const t = crossingT(ax, ay, bx, by, s.x1, s.y1, s.x2, s.y2)
    if (t === null) continue
    hits.push({ alongM: t * lengthM, loss: s.loss })
  }
  hits.sort((a, b) => a.alongM - b.alongM)
  let loss = 0
  let groupMax = 0
  let groupAt = -1
  for (const hit of hits) {
    if (groupAt >= 0 && hit.alongM - groupAt <= 0.12) {
      groupMax = Math.max(groupMax, hit.loss)
      continue
    }
    loss += groupMax
    groupMax = hit.loss
    groupAt = hit.alongM
  }
  loss += groupMax
  return Math.min(loss, WALL_LOSS_CAP_DB)
}

export interface LinkBudget {
  distanceM: number
  wallLossDb: number
  pathLossDb: number
  rssiDbm: number
  snrDb: number
}

export function linkBudget(args: {
  x1: number
  y1: number
  x2: number
  y2: number
  txPowerDbm: number
  gainDbi: number
  rxGainDbi?: number
  segs: Segment[]
  metersPerPixel: number
  freqMHz: number
  exponent: number
  noiseDbm: number
}): LinkBudget {
  const distanceM = Math.max(Math.hypot(args.x2 - args.x1, args.y2 - args.y1) * args.metersPerPixel, 0.5)
  const wallLossDb = wallLossBetween(args.x1, args.y1, args.x2, args.y2, args.segs, args.metersPerPixel)
  const pl = pathLossDb(distanceM, args.freqMHz, args.exponent, wallLossDb)
  const rssiDbm = args.txPowerDbm + args.gainDbi + (args.rxGainDbi ?? 0) - pl
  return {
    distanceM,
    wallLossDb,
    pathLossDb: pl,
    rssiDbm,
    snrDb: rssiDbm - args.noiseDbm,
  }
}

export function computeRssiGrid(req: HeatmapRequest): HeatmapGrid {
  const mpp = Math.max(req.metersPerPixel, 1e-6)
  let cellPx = Math.max(req.cellM, 0.05) / mpp
  let cols = Math.max(1, Math.ceil(req.widthPx / cellPx))
  let rows = Math.max(1, Math.ceil(req.heightPx / cellPx))
  const maxDim = 200
  if (cols > maxDim || rows > maxDim) {
    const factor = Math.max(cols / maxDim, rows / maxDim)
    cellPx *= factor
    cols = Math.max(1, Math.ceil(req.widthPx / cellPx))
    rows = Math.max(1, Math.ceil(req.heightPx / cellPx))
  }

  const exponent = resolveExponent(req.exponent)
  const segs = buildSegments(req.walls, req.band)
  const freq = BAND_FREQ_MHZ[req.band]
  const rssi = new Float32Array(cols * rows)
  rssi.fill(-120)

  const radios = req.aps
    .map((ap) => {
      const radio = radioFor(ap, req.band)
      return radio.enabled ? { x: ap.x, y: ap.y, tx: radio.txPowerDbm, gain: radio.gainDbi } : null
    })
    .filter((r): r is { x: number; y: number; tx: number; gain: number } => r !== null)

  if (radios.length === 0) {
    return { width: cols, height: rows, cellPx, originX: req.originX, originY: req.originY, rssi }
  }

  for (let y = 0; y < rows; y++) {
    const py = req.originY + (y + 0.5) * cellPx
    for (let x = 0; x < cols; x++) {
      const px = req.originX + (x + 0.5) * cellPx
      let best = -200
      for (const ap of radios) {
        const budget = linkBudget({
          x1: ap.x,
          y1: ap.y,
          x2: px,
          y2: py,
          txPowerDbm: ap.tx,
          gainDbi: ap.gain,
          segs,
          metersPerPixel: mpp,
          freqMHz: freq,
          exponent,
          noiseDbm: noiseFloorDbm(20, 0),
        })
        if (budget.rssiDbm > best) best = budget.rssiDbm
      }
      rssi[y * cols + x] = best
    }
  }

  return { width: cols, height: rows, cellPx, originX: req.originX, originY: req.originY, rssi }
}

/** Share of cells at or above the threshold. Cells with no AP are ignored. */
export interface ZoneShare {
  excellent: number
  good: number
  fair: number
  weak: number
  dead: number
}

export function coverageZones(rssi: ArrayLike<number>): ZoneShare {
  const bins = { excellent: 0, good: 0, fair: 0, weak: 0, dead: 0 }
  let total = 0
  for (let i = 0; i < rssi.length; i++) {
    const value = rssi[i]
    if (value <= -110) continue
    total++
    if (value >= -55) bins.excellent++
    else if (value >= -67) bins.good++
    else if (value >= -75) bins.fair++
    else if (value >= -82) bins.weak++
    else bins.dead++
  }
  if (total === 0) return bins
  return {
    excellent: bins.excellent / total,
    good: bins.good / total,
    fair: bins.fair / total,
    weak: bins.weak / total,
    dead: bins.dead / total,
  }
}

export function coverageFraction(rssi: ArrayLike<number>, thresholdDbm: number): number {
  let total = 0
  let ok = 0
  for (let i = 0; i < rssi.length; i++) {
    if (rssi[i] <= -110) continue
    total++
    if (rssi[i] >= thresholdDbm) ok++
  }
  if (total === 0) return 0
  return ok / total
}
