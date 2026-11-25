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
export const NO_LINK_SNR_DB = 5
/** Uplink may narrow to this width. Its noise is the 20 MHz floor, without the neighbour offset. */
export const UPLINK_FALLBACK_MHZ = 20
export const UPLINK_FALLBACK_NOISE_DBM = -95
/** An access point hears better than a handset, on top of receive-chain gain. */
export const AP_RX_SENSITIVITY_DB = 2
/** Heatmap reference client: a phone, the stricter of the two common devices. */
export const HEATMAP_CLIENT_TX_DBM = 15
export const HEATMAP_CLIENT_GAIN_DBI = -2

export function apReceiveGainDb(mimo: number): number {
  return 10 * Math.log10(Math.max(1, mimo)) + AP_RX_SENSITIVITY_DB
}

export function directionFails(rssiDbm: number, snrDb: number): boolean {
  return rssiDbm < NO_LINK_RSSI_DBM || snrDb < NO_LINK_SNR_DB
}

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

function vertexKey(x: number, y: number): string {
  return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`
}

function markJoints(segs: Segment[]): void {
  const count = new Map<string, number>()
  const bump = (x: number, y: number) => {
    const key = vertexKey(x, y)
    count.set(key, (count.get(key) ?? 0) + 1)
  }
  for (const seg of segs) {
    bump(seg.x1, seg.y1)
    bump(seg.x2, seg.y2)
  }
  for (const seg of segs) {
    seg.joint1 = (count.get(vertexKey(seg.x1, seg.y1)) ?? 0) > 1 || endpointLiesOnAnother(seg.x1, seg.y1, seg, segs)
    seg.joint2 = (count.get(vertexKey(seg.x2, seg.y2)) ?? 0) > 1 || endpointLiesOnAnother(seg.x2, seg.y2, seg, segs)
  }
}

function endpointLiesOnAnother(x: number, y: number, self: Segment, segs: Segment[]): boolean {
  for (const other of segs) {
    if (other === self) continue
    const ex = other.x2 - other.x1
    const ey = other.y2 - other.y1
    const len2 = ex * ex + ey * ey
    if (len2 < 1e-6) continue
    const t = ((x - other.x1) * ex + (y - other.y1) * ey) / len2
    if (t <= 0.002 || t >= 0.998) continue
    const px = other.x1 + t * ex
    const py = other.y1 + t * ey
    if (Math.hypot(px - x, py - y) <= 0.6) return true
  }
  return false
}

export function buildSegments(walls: Wall[], band: BandId): Segment[] {
  const segs: Segment[] = []
  for (const wall of walls) {
    segs.push(...wallSegments(wall, materialLoss(wall.materialId, band, wall.thicknessCm)))
  }
  markJoints(segs)
  return segs
}

interface SegIndex {
  size: number
  cols: number
  x0: number
  y0: number
  bins: Segment[][]
}

const segmentIndex = new WeakMap<Segment[], SegIndex>()

function indexSegments(segs: Segment[]): SegIndex | null {
  if (segs.length < 48) return null
  const cached = segmentIndex.get(segs)
  if (cached) return cached
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const seg of segs) {
    minX = Math.min(minX, seg.x1, seg.x2)
    minY = Math.min(minY, seg.y1, seg.y2)
    maxX = Math.max(maxX, seg.x1, seg.x2)
    maxY = Math.max(maxY, seg.y1, seg.y2)
  }
  const size = 128
  const cols = Math.max(1, Math.ceil((maxX - minX + 1) / size))
  const rows = Math.max(1, Math.ceil((maxY - minY + 1) / size))
  const bins: Segment[][] = Array.from({ length: cols * rows }, () => [])
  for (const seg of segs) {
    const c0 = Math.max(0, Math.floor((Math.min(seg.x1, seg.x2) - minX) / size))
    const c1 = Math.min(cols - 1, Math.floor((Math.max(seg.x1, seg.x2) - minX) / size))
    const r0 = Math.max(0, Math.floor((Math.min(seg.y1, seg.y2) - minY) / size))
    const r1 = Math.min(rows - 1, Math.floor((Math.max(seg.y1, seg.y2) - minY) / size))
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) bins[row * cols + col].push(seg)
    }
  }
  const index = { size, cols, x0: minX, y0: minY, bins }
  segmentIndex.set(segs, index)
  return index
}

function segmentsOnRay(segs: Segment[], ax: number, ay: number, bx: number, by: number): Segment[] {
  const index = indexSegments(segs)
  if (!index) return segs
  const seen = new Set<Segment>()
  const out: Segment[] = []
  const rows = index.bins.length / index.cols
  const visit = (x: number, y: number) => {
    const col = Math.floor((x - index.x0) / index.size)
    const row = Math.floor((y - index.y0) / index.size)
    if (col < 0 || row < 0 || col >= index.cols || row >= rows) return
    for (const seg of index.bins[row * index.cols + col]) {
      if (seen.has(seg)) continue
      seen.add(seg)
      out.push(seg)
    }
  }
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (index.size * 0.5)))
  for (let i = 0; i <= steps; i++) visit(ax + ((bx - ax) * i) / steps, ay + ((by - ay) * i) / steps)
  return out
}

function nearlyParallel(ax: number, ay: number, bx: number, by: number): boolean {
  const al = Math.hypot(ax, ay) || 1
  const bl = Math.hypot(bx, by) || 1
  return Math.abs(ax * bx + ay * by) / (al * bl) > 0.985
}

/**
 * Sum of wall crossings. A graze of a free tip (within 1 cm) does not count,
 * so the heatmap does not draw a streak past a wall end. A joint does count.
 * Segments of one polyline count once. Parallel walls that share an edge count
 * once; distinct walls that meet at a corner both count.
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
  const dx = bx - ax
  const dy = by - ay
  type Hit = {
    alongM: number
    loss: number
    wallId: string
    sx: number
    sy: number
    interior: boolean
    ox: number
    oy: number
  }
  const hits: Hit[] = []
  for (const s of segmentsOnRay(segs, ax, ay, bx, by)) {
    const t = crossingT(ax, ay, bx, by, s.x1, s.y1, s.x2, s.y2)
    if (t === null) continue
    const hitX = ax + t * dx
    const hitY = ay + t * dy
    const fromStartM = Math.hypot(hitX - s.x1, hitY - s.y1) * metersPerPixel
    const fromEndM = Math.hypot(hitX - s.x2, hitY - s.y2) * metersPerPixel
    const segLenM = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * metersPerPixel
    const atStart = fromStartM < 0.01
    const atEnd = fromEndM < 0.01
    if (segLenM >= 0.03) {
      if (atStart && !s.joint1) continue
      if (atEnd && !s.joint2) continue
    }
    const interior = segLenM < 0.03 || (!atStart && !atEnd)
    hits.push({
      alongM: t * lengthM,
      loss: s.loss,
      wallId: s.wallId,
      sx: s.x2 - s.x1,
      sy: s.y2 - s.y1,
      interior,
      ox: atEnd && !atStart ? s.x1 : s.x2,
      oy: atEnd && !atStart ? s.y1 : s.y2,
    })
  }
  const byWall = new Map<string, Hit>()
  for (const hit of hits) {
    const previous = byWall.get(hit.wallId)
    if (!previous || (hit.interior && !previous.interior) || (hit.interior === previous.interior && hit.loss > previous.loss)) {
      byWall.set(hit.wallId, hit)
    }
  }
  const unique = [...byWall.values()].sort((a, b) => a.alongM - b.alongM)
  let loss = 0
  for (let i = 0; i < unique.length; ) {
    let j = i + 1
    while (j < unique.length && unique[j].alongM - unique[i].alongM <= 0.02) j++
    const cluster = unique.slice(i, j)
    const interiors = cluster.filter((hit) => hit.interior)
    const ends = cluster.filter((hit) => !hit.interior)
    loss += lossOfParallelGroups(interiors)
    if (interiors.length > 0) {
      loss += ends.reduce((sum, hit) => sum + hit.loss, 0)
    } else if (ends.length === 1) {
      loss += ends[0].loss
    } else if (ends.length > 1) {
      const signs = ends.map((hit) => sideOfRay(ax, ay, bx, by, hit.ox, hit.oy)).filter((side) => Math.abs(side) > 1e-4)
      const splits = signs.some((side) => side > 0) && signs.some((side) => side < 0)
      if (splits) loss += Math.max(...ends.map((hit) => hit.loss))
    }
    i = j
  }
  return Math.min(loss, WALL_LOSS_CAP_DB)
}

function sideOfRay(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax)
}

function lossOfParallelGroups(list: { alongM: number; loss: number; sx: number; sy: number }[]): number {
  const sorted = [...list].sort((a, b) => a.alongM - b.alongM)
  let total = 0
  for (let i = 0; i < sorted.length; ) {
    let maxLoss = sorted[i].loss
    let j = i + 1
    while (j < sorted.length && nearlyParallel(sorted[i].sx, sorted[i].sy, sorted[j].sx, sorted[j].sy)) {
      maxLoss = Math.max(maxLoss, sorted[j].loss)
      j++
    }
    total += maxLoss
    i = j
  }
  return total
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
  wallLossDb?: number
}): LinkBudget {
  const distanceM = Math.max(Math.hypot(args.x2 - args.x1, args.y2 - args.y1) * args.metersPerPixel, 0.5)
  const wallLossDb = args.wallLossDb ?? wallLossBetween(args.x1, args.y1, args.x2, args.y2, args.segs, args.metersPerPixel)
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

export interface BidirectionalLink {
  down: LinkBudget
  up: LinkBudget
  uplinkWidthMHz: number
  noLink: boolean
  /** Downlink noise plus the worse of the two SNRs, so it sits on the same legend as downlink RSSI. */
  effectiveRssiDbm: number
  worseSnrDb: number
  /** The return path is what fails, or it is the poorer of the two live directions. */
  uplinkLimits: boolean
}

/**
 * Link at one point. Path loss is reciprocal. The uplink may narrow to 20 MHz
 * (noise −95 dBm) and includes access-point receive-chain gain plus RX sensitivity.
 * Either direction below −82 dBm or SNR 5 is no link.
 */
export function bidirectionalLink(args: {
  apX: number
  apY: number
  clientX: number
  clientY: number
  apTxDbm: number
  apGainDbi: number
  apMimo: number
  channelWidthMHz: number
  clientTxDbm: number
  clientGainDbi: number
  segs: Segment[]
  metersPerPixel: number
  freqMHz: number
  exponent: number
  noiseExtraDb: number
}): BidirectionalLink {
  const geometry = {
    x1: args.apX,
    y1: args.apY,
    x2: args.clientX,
    y2: args.clientY,
    segs: args.segs,
    metersPerPixel: args.metersPerPixel,
    freqMHz: args.freqMHz,
    exponent: args.exponent,
  }
  const downNoise = noiseFloorDbm(args.channelWidthMHz, args.noiseExtraDb)
  const wallLossDb = wallLossBetween(args.apX, args.apY, args.clientX, args.clientY, args.segs, args.metersPerPixel)
  const down = linkBudget({
    ...geometry,
    txPowerDbm: args.apTxDbm,
    gainDbi: args.apGainDbi,
    rxGainDbi: args.clientGainDbi,
    noiseDbm: downNoise,
    wallLossDb,
  })
  const rxAtAp = args.apGainDbi + apReceiveGainDb(args.apMimo)
  const widths = [20, 40, 80, 160, 320].filter((width) => width <= args.channelWidthMHz + 1e-6)
  let chosen: LinkBudget | null = null
  let chosenWidth = UPLINK_FALLBACK_MHZ
  for (const width of widths) {
    const noise = noiseFloorDbm(width, args.noiseExtraDb)
    const up = linkBudget({
      ...geometry,
      txPowerDbm: args.clientTxDbm,
      gainDbi: args.clientGainDbi,
      rxGainDbi: rxAtAp,
      noiseDbm: noise,
      wallLossDb,
    })
    if (directionFails(up.rssiDbm, up.snrDb)) continue
    if (!chosen || width > chosenWidth) {
      chosen = up
      chosenWidth = width
    }
  }
  const up = chosen ?? linkBudget({
    ...geometry,
    txPowerDbm: args.clientTxDbm,
    gainDbi: args.clientGainDbi,
    rxGainDbi: rxAtAp,
    noiseDbm: noiseFloorDbm(UPLINK_FALLBACK_MHZ, args.noiseExtraDb),
    wallLossDb,
  })
  const downFails = directionFails(down.rssiDbm, down.snrDb)
  const upFails = directionFails(up.rssiDbm, up.snrDb)
  const noLink = downFails || upFails
  const worseSnrDb = Math.min(down.snrDb, up.snrDb)
  let effectiveRssiDbm = downNoise + worseSnrDb
  if (noLink) effectiveRssiDbm = Math.min(effectiveRssiDbm, NO_LINK_RSSI_DBM - 0.5)
  return {
    down,
    up,
    uplinkWidthMHz: chosen ? chosenWidth : UPLINK_FALLBACK_MHZ,
    noLink,
    effectiveRssiDbm,
    worseSnrDb,
    uplinkLimits: !downFails && (upFails || up.snrDb + 0.05 < down.snrDb || (chosen !== null && chosenWidth < args.channelWidthMHz)),
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
  const noiseExtraDb = req.noiseExtraDb ?? DEFAULT_NOISE_EXTRA_DB
  const rssi = new Float32Array(cols * rows)
  rssi.fill(-120)

  const radios = req.aps
    .map((ap) => {
      const radio = radioFor(ap, req.band)
      return radio.enabled
        ? { x: ap.x, y: ap.y, tx: radio.txPowerDbm, gain: radio.gainDbi, mimo: ap.mimo, width: radio.channelWidthMHz }
        : null
    })
    .filter((r): r is { x: number; y: number; tx: number; gain: number; mimo: number; width: number } => r !== null)

  if (radios.length === 0) {
    return { width: cols, height: rows, cellPx, originX: req.originX, originY: req.originY, rssi }
  }

  for (let y = 0; y < rows; y++) {
    const py = req.originY + (y + 0.5) * cellPx
    for (let x = 0; x < cols; x++) {
      const px = req.originX + (x + 0.5) * cellPx
      let best = -200
      for (const ap of radios) {
        const link = bidirectionalLink({
          apX: ap.x,
          apY: ap.y,
          clientX: px,
          clientY: py,
          apTxDbm: ap.tx,
          apGainDbi: ap.gain,
          apMimo: ap.mimo,
          channelWidthMHz: ap.width,
          clientTxDbm: req.clientTxDbm ?? HEATMAP_CLIENT_TX_DBM,
          clientGainDbi: req.clientGainDbi ?? HEATMAP_CLIENT_GAIN_DBI,
          segs,
          metersPerPixel: mpp,
          freqMHz: freq,
          exponent,
          noiseExtraDb,
        })
        if (link.effectiveRssiDbm > best) best = link.effectiveRssiDbm
      }
      rssi[y * cols + x] = best
    }
  }

  return { width: cols, height: rows, cellPx, originX: req.originX, originY: req.originY, rssi }
}

/** Share of the plan. Cells below −82 dBm, including beyond AP range, count as no link. */
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
    if (!Number.isFinite(value)) continue
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
    if (!Number.isFinite(rssi[i])) continue
    total++
    if (rssi[i] >= thresholdDbm) ok++
  }
  if (total === 0) return 0
  return ok / total
}
