import { buildSegments, BAND_FREQ_MHZ, BAND_NOISE_DBM, linkBudget, radioFor, resolveExponent } from './pathloss'
import type { Segment } from './geometry'
import type {
  AccessPoint,
  ActivityId,
  Backhaul,
  BandId,
  ClientDevice,
  ClientEstimate,
  Project,
  WifiGen,
} from './types'

export const ACTIVITIES: Record<ActivityId, { down: number; up: number; ping: number; jitter: number }> = {
  surfing: { down: 5, up: 1, ping: 150, jitter: 40 },
  video: { down: 8, up: 1.5, ping: 100, jitter: 30 },
  calls: { down: 2.5, up: 2.5, ping: 80, jitter: 20 },
  broadcast: { down: 6, up: 8, ping: 100, jitter: 25 },
  gaming: { down: 3, up: 1, ping: 35, jitter: 12 },
  cloud: { down: 25, up: 6, ping: 30, jitter: 8 },
}

export const ACTIVITY_IDS: ActivityId[] = ['surfing', 'video', 'calls', 'broadcast', 'gaming', 'cloud']

const PHY_PER_STREAM: Record<WifiGen, Record<number, number>> = {
  wifi4: { 20: 72, 40: 150 },
  wifi5: { 20: 87, 40: 200, 80: 433, 160: 867 },
  wifi6: { 20: 143, 40: 287, 80: 600, 160: 1201 },
}

const GEN_RANK: Record<WifiGen, number> = { wifi4: 4, wifi5: 5, wifi6: 6 }

function olderGen(a: WifiGen, b: WifiGen): WifiGen {
  return GEN_RANK[a] <= GEN_RANK[b] ? a : b
}

function maxWidth(gen: WifiGen): number {
  return gen === 'wifi4' ? 40 : 160
}

export function phyPerStreamMbps(gen: WifiGen, widthMHz: number): number {
  const table = PHY_PER_STREAM[gen]
  const widths = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b)
  let chosen = widths[0]
  const capped = Math.min(widthMHz, maxWidth(gen))
  for (const w of widths) if (w <= capped) chosen = w
  return table[chosen]
}

/** Fraction of the peak PHY rate that a given SNR can hold, 0..0.93. */
export function phyEfficiency(snrDb: number): number {
  if (snrDb <= 4) return 0
  const logistic = 1 / (1 + Math.exp(-(snrDb - 18) / 4.2))
  return Math.min(0.93, Math.max(0, logistic))
}

const MAC_EFFICIENCY = 0.62

export function macThroughputMbps(phyMbps: number, snrDb: number): number {
  return phyMbps * phyEfficiency(snrDb) * MAC_EFFICIENCY
}

function higherScore(actual: number, need: number): number {
  if (need <= 0) return 1
  if (actual >= need) return 1
  return Math.max(0, actual / need)
}

function lowerScore(actual: number, limit: number): number {
  if (actual <= limit) return 1
  if (actual <= 0) return 0
  return Math.max(0, limit / actual)
}

export function scoreActivity(
  metrics: { downMbps: number; upMbps: number; pingMs: number; jitterMs: number },
  activity: ActivityId,
): number {
  const spec = ACTIVITIES[activity]
  const s =
    0.35 * higherScore(metrics.downMbps, spec.down) +
    0.2 * higherScore(metrics.upMbps, spec.up) +
    0.3 * lowerScore(metrics.pingMs, spec.ping) +
    0.15 * lowerScore(metrics.jitterMs, spec.jitter)
  return Math.round(s * 100)
}

function emptyScores(): Record<ActivityId, number> {
  return { surfing: 0, video: 0, calls: 0, broadcast: 0, gaming: 0, cloud: 0 }
}

function isWired(backhaul: Backhaul): boolean {
  return backhaul === 'wired' || backhaul === 'mesh-wired'
}

interface Uplink {
  capMbps: number
  wireless: boolean
  hasParent: boolean
}

function bandsOf(ap: AccessPoint, prefer5: boolean): BandId[] {
  const out: BandId[] = []
  if (prefer5 && ap.band5.enabled) out.push('5')
  if (ap.band24.enabled) out.push('2.4')
  if (!prefer5 && ap.band5.enabled && !out.includes('5')) out.push('5')
  return out
}

function airLinkMbps(
  from: { x: number; y: number; wifiGen: WifiGen; mimo: number },
  to: { x: number; y: number; wifiGen: WifiGen; mimo: number },
  band: BandId,
  txPowerDbm: number,
  gainDbi: number,
  widthMHz: number,
  segs: Segment[],
  metersPerPixel: number,
  exponent: number,
): { mbps: number; rssi: number; snr: number; distanceM: number; wallLossDb: number } | null {
  const budget = linkBudget({
    x1: from.x,
    y1: from.y,
    x2: to.x,
    y2: to.y,
    txPowerDbm,
    gainDbi,
    segs,
    metersPerPixel,
    freqMHz: BAND_FREQ_MHZ[band],
    exponent,
    noiseDbm: BAND_NOISE_DBM[band],
  })
  if (budget.snrDb < 4) {
    return { mbps: 0, rssi: budget.rssiDbm, snr: budget.snrDb, distanceM: budget.distanceM, wallLossDb: budget.wallLossDb }
  }
  const gen = olderGen(from.wifiGen, to.wifiGen)
  const streams = Math.max(1, Math.min(from.mimo, to.mimo))
  const phy = phyPerStreamMbps(gen, widthMHz) * streams
  return {
    mbps: macThroughputMbps(phy, budget.snrDb),
    rssi: budget.rssiDbm,
    snr: budget.snrDb,
    distanceM: budget.distanceM,
    wallLossDb: budget.wallLossDb,
  }
}

function backhaulOf(
  ap: AccessPoint,
  aps: AccessPoint[],
  segsByBand: Record<BandId, Segment[]>,
  metersPerPixel: number,
  exponent: number,
): Uplink {
  if (isWired(ap.backhaul)) return { capMbps: 2500, wireless: false, hasParent: true }
  let best = 0
  let found = false
  for (const parent of aps) {
    if (parent.id === ap.id || !isWired(parent.backhaul)) continue
    const bands = bandsOf(parent, true).filter((b) => radioFor(ap, b).enabled)
    for (const band of bands) {
      const radio = radioFor(parent, band)
      const link = airLinkMbps(
        { x: parent.x, y: parent.y, wifiGen: parent.wifiGen, mimo: parent.mimo },
        { x: ap.x, y: ap.y, wifiGen: ap.wifiGen, mimo: ap.mimo },
        band,
        radio.txPowerDbm,
        radio.gainDbi,
        radio.channelWidthMHz,
        segsByBand[band],
        metersPerPixel,
        exponent,
      )
      if (!link) continue
      found = true
      const factor = ap.backhaul === 'repeater' ? 0.45 : 0.55
      best = Math.max(best, link.mbps * factor)
    }
  }
  if (!found) return { capMbps: 12, wireless: true, hasParent: false }
  return { capMbps: best, wireless: true, hasParent: true }
}

interface Choice {
  ap: AccessPoint
  band: BandId
  linkMbps: number
  rssi: number
  snr: number
  distanceM: number
  wallLossDb: number
  uplink: Uplink
}

function disconnected(client: ClientDevice, approximate: boolean): ClientEstimate {
  return {
    clientId: client.id,
    apId: null,
    apName: null,
    band: null,
    distanceM: null,
    wallLossDb: null,
    rssiDbm: null,
    snrDb: null,
    phyMbps: 0,
    downMbps: 0,
    upMbps: 0,
    pingMs: null,
    jitterMs: null,
    scores: emptyScores(),
    warnings: approximate ? ['no-ap', 'approx-scale'] : ['no-ap'],
  }
}

export function estimateClients(
  project: Pick<Project, 'walls' | 'aps' | 'clients' | 'isp' | 'propagation' | 'scale'>,
  metersPerPixel: number,
  approximateScale: boolean,
): ClientEstimate[] {
  const exponent = resolveExponent(project.propagation.exponent, project.walls.length, project.propagation.autoClutter)
  const segsByBand: Record<BandId, Segment[]> = {
    '2.4': buildSegments(project.walls, '2.4'),
    '5': buildSegments(project.walls, '5'),
  }
  const uplinks = new Map<string, Uplink>()
  for (const ap of project.aps) {
    uplinks.set(ap.id, backhaulOf(ap, project.aps, segsByBand, metersPerPixel, exponent))
  }

  const choices = new Map<string, Choice | null>()
  for (const client of project.clients) {
    let best: Choice | null = null
    for (const ap of project.aps) {
      const bands: BandId[] = []
      if (client.supports5 && ap.band5.enabled) bands.push('5')
      if (ap.band24.enabled) bands.push('2.4')
      for (const band of bands) {
        const radio = radioFor(ap, band)
        const link = airLinkMbps(
          { x: ap.x, y: ap.y, wifiGen: ap.wifiGen, mimo: ap.mimo },
          { x: client.x, y: client.y, wifiGen: client.wifiGen, mimo: client.mimo },
          band,
          radio.txPowerDbm,
          radio.gainDbi,
          radio.channelWidthMHz,
          segsByBand[band],
          metersPerPixel,
          exponent,
        )
        if (!link) continue
        const uplink = uplinks.get(ap.id)!
        const limited = Math.min(link.mbps, uplink.capMbps)
        const candidate: Choice = { ap, band, linkMbps: link.mbps, rssi: link.rssi, snr: link.snr, distanceM: link.distanceM, wallLossDb: link.wallLossDb, uplink }
        if (!best || limited > Math.min(best.linkMbps, best.uplink.capMbps)) best = candidate
      }
    }
    choices.set(client.id, best)
  }

  const perRadio = new Map<string, number>()
  const perAp = new Map<string, number>()
  for (const choice of choices.values()) {
    if (!choice) continue
    const radioKey = `${choice.ap.id}:${choice.band}`
    perRadio.set(radioKey, (perRadio.get(radioKey) ?? 0) + 1)
    perAp.set(choice.ap.id, (perAp.get(choice.ap.id) ?? 0) + 1)
  }
  const nClients = Math.max(1, project.clients.length)
  const ispDown = Math.max(0, project.isp.downMbps) / nClients
  const ispUp = Math.max(0, project.isp.upMbps) / nClients

  return project.clients.map((client) => {
    const choice = choices.get(client.id)
    if (!choice || choice.linkMbps <= 0) {
      const base = disconnected(client, approximateScale)
      if (project.aps.length > 0) {
        base.warnings = base.warnings.filter((w) => w !== 'no-ap')
        base.warnings.unshift('weak-signal')
        if (choice) {
          base.apId = choice.ap.id
          base.apName = choice.ap.name
          base.band = choice.band
          base.rssiDbm = choice.rssi
          base.snrDb = choice.snr
          base.distanceM = choice.distanceM
          base.wallLossDb = choice.wallLossDb
        }
      }
      return base
    }

    const nRadio = perRadio.get(`${choice.ap.id}:${choice.band}`) ?? 1
    const nAp = perAp.get(choice.ap.id) ?? 1
    const down = Math.max(0, Math.min(choice.linkMbps / nRadio, choice.uplink.capMbps / nAp, ispDown))
    const upLink = choice.linkMbps * 0.85
    const up = Math.max(0, Math.min(upLink / nRadio, choice.uplink.capMbps / nAp, ispUp))

    const wifiLatency = choice.snr >= 28 ? 2 : choice.snr >= 20 ? 5 : choice.snr >= 14 ? 12 : choice.snr >= 8 ? 25 : 55
    const hop = choice.uplink.wireless ? 8 + wifiLatency * 0.45 : 1
    const pingMs = 8 + wifiLatency + hop
    const jitterMs = Math.max(1, wifiLatency * 0.4 + (choice.uplink.wireless ? 4 : 0.8))
    const metrics = { downMbps: down, upMbps: up, pingMs, jitterMs }
    const scores = emptyScores()
    for (const id of ACTIVITY_IDS) scores[id] = scoreActivity(metrics, id)

    const warnings: ClientEstimate['warnings'] = []
    if (approximateScale) warnings.push('approx-scale')
    if (choice.rssi < -75 || choice.snr < 10) warnings.push('weak-signal')
    if (choice.uplink.wireless) warnings.push('wireless-backhaul')
    if (!choice.uplink.hasParent) warnings.push('no-parent')

    const gen = olderGen(choice.ap.wifiGen, client.wifiGen)
    const streams = Math.max(1, Math.min(choice.ap.mimo, client.mimo))
    const phyMbps = phyPerStreamMbps(gen, radioFor(choice.ap, choice.band).channelWidthMHz) * streams * phyEfficiency(choice.snr)

    return {
      clientId: client.id,
      apId: choice.ap.id,
      apName: choice.ap.name,
      band: choice.band,
      distanceM: choice.distanceM,
      wallLossDb: choice.wallLossDb,
      rssiDbm: choice.rssi,
      snrDb: choice.snr,
      phyMbps,
      downMbps: down,
      upMbps: up,
      pingMs,
      jitterMs,
      scores,
      warnings,
    }
  })
}
