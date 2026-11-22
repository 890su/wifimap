import { materialLoss } from './materials'
import { segmentsCross, wallSegments, type Segment } from './geometry'
import type { AccessPoint, BandId, HeatmapGrid, HeatmapRequest, Wall } from './types'

/** 40 px = 1 m until the user sets a measured scale. */
export const APPROX_METERS_PER_PIXEL = 1 / 40

export const BAND_FREQ_MHZ: Record<BandId, number> = {
  '2.4': 2437,
  '5': 5200,
}

export const BAND_NOISE_DBM: Record<BandId, number> = {
  '2.4': -96,
  '5': -98,
}

export const WALL_LOSS_CAP_DB = 80

export function effectiveScale(scale: { metersPerPixel: number } | null): {
  metersPerPixel: number
  approximate: boolean
} {
  if (scale && scale.metersPerPixel > 0 && Number.isFinite(scale.metersPerPixel)) {
    return { metersPerPixel: scale.metersPerPixel, approximate: false }
  }
  return { metersPerPixel: APPROX_METERS_PER_PIXEL, approximate: true }
}

/** Free-space path loss at 1 m for a frequency in MHz. */
export function fsplAt1m(freqMHz: number): number {
  return 20 * Math.log10(freqMHz) - 27.55
}

/**
 * Log-distance loss plus explicit wall crossings (multi-wall model).
 * At 1 m with no walls this is free-space loss.
 */
export function pathLossDb(
  distanceM: number,
  freqMHz: number,
  exponent: number,
  wallLossDb: number,
): number {
  const d = Math.max(distanceM, 0.25)
  return fsplAt1m(freqMHz) + 10 * exponent * Math.log10(d) + wallLossDb
}

/**
 * Without drawn walls the floor plan is an unknown interior, so the
 * distance exponent is raised. Drawn walls carry the obstruction loss
 * and the user exponent (default 2.2) is used as-is.
 */
export function resolveExponent(userExponent: number, wallCount: number, autoClutter: boolean): number {
  const n = Number.isFinite(userExponent) ? userExponent : 2.2
  if (autoClutter && wallCount === 0) return Math.max(n, 3.5)
  return n
}

export function radioFor(ap: AccessPoint, band: BandId) {
  return band === '2.4' ? ap.band24 : ap.band5
}

export function buildSegments(walls: Wall[], band: BandId): Segment[] {
  const segs: Segment[] = []
  for (const wall of walls) {
    segs.push(...wallSegments(wall, materialLoss(wall.materialId, band)))
  }
  return segs
}

export function wallLossBetween(ax: number, ay: number, bx: number, by: number, segs: Segment[]): number {
  let loss = 0
  for (const s of segs) {
    if (segmentsCross(ax, ay, bx, by, s.x1, s.y1, s.x2, s.y2)) loss += s.loss
  }
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
  segs: Segment[]
  metersPerPixel: number
  freqMHz: number
  exponent: number
  noiseDbm: number
}): LinkBudget {
  const distanceM = Math.max(Math.hypot(args.x2 - args.x1, args.y2 - args.y1) * args.metersPerPixel, 0.25)
  const wallLossDb = wallLossBetween(args.x1, args.y1, args.x2, args.y2, args.segs)
  const pl = pathLossDb(distanceM, args.freqMHz, args.exponent, wallLossDb)
  const rssiDbm = args.txPowerDbm + args.gainDbi - pl
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

  const exponent = resolveExponent(req.exponent, req.walls.length, req.autoClutter)
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
          noiseDbm: BAND_NOISE_DBM[req.band],
        })
        if (budget.rssiDbm > best) best = budget.rssiDbm
      }
      rssi[y * cols + x] = best
    }
  }

  return { width: cols, height: rows, cellPx, originX: req.originX, originY: req.originY, rssi }
}

/** Share of cells at or above the threshold. Cells with no AP are ignored. */
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
