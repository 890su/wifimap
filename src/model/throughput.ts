import { buildSegments, linkBudget, noiseFloorDbm, NO_LINK_RSSI_DBM, radioFor, resolveExponent } from './pathloss'
import type { Segment } from './geometry'
import { CLIENT_PRESETS } from './presets'
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

export const ACTIVITY_IDS: ActivityId[] = ['surfing', 'video', 'calls', 'broadcast', 'gaming', 'cloud']

/** Kept so older imports still resolve. Thresholds now live in {@link activityLevel}. */
export const ACTIVITIES: Record<ActivityId, { down: number; up: number; ping: number; jitter: number }> = {
  surfing: { down: 5, up: 1, ping: 100, jitter: 30 },
  video: { down: 8, up: 1, ping: 100, jitter: 30 },
  calls: { down: 1.5, up: 1.5, ping: 150, jitter: 30 },
  broadcast: { down: 1, up: 6, ping: 100, jitter: 30 },
  gaming: { down: 3, up: 1, ping: 60, jitter: 15 },
  cloud: { down: 15, up: 3, ping: 50, jitter: 15 },
}

/** 802.11 PHY rate for one stream at 20 MHz, and the SNR required to hold that MCS. */
export const MCS_TABLE: { mcs: number; snr: number; mbps20: number }[] = [
  { mcs: 0, snr: 5, mbps20: 8.6 },
  { mcs: 1, snr: 8, mbps20: 17.2 },
  { mcs: 2, snr: 11, mbps20: 25.8 },
  { mcs: 3, snr: 14, mbps20: 34.4 },
  { mcs: 4, snr: 17, mbps20: 51.6 },
  { mcs: 5, snr: 21, mbps20: 68.8 },
  { mcs: 6, snr: 23.5, mbps20: 77.4 },
  { mcs: 7, snr: 26, mbps20: 86 },
  { mcs: 8, snr: 28.5, mbps20: 103.2 },
  { mcs: 9, snr: 31, mbps20: 114.7 },
  { mcs: 10, snr: 33.5, mbps20: 129 },
  { mcs: 11, snr: 36, mbps20: 143.4 },
  { mcs: 12, snr: 38.5, mbps20: 154.9 },
  { mcs: 13, snr: 41, mbps20: 172.1 },
]

const WIDTH_FACTORS: [number, number][] = [
  [20, 1],
  [40, 2],
  [80, 4.19],
  [160, 8.37],
  [320, 16.75],
]

export const MAC_ETA: Record<WifiGen, number> = { wifi4: 0.5, wifi5: 0.6, wifi6: 0.65 }

const GEN_RANK: Record<WifiGen, number> = { wifi4: 4, wifi5: 5, wifi6: 6 }

function olderGen(a: WifiGen, b: WifiGen): WifiGen {
  return GEN_RANK[a] <= GEN_RANK[b] ? a : b
}

function maxMcs(gen: WifiGen): number {
  if (gen === 'wifi4') return 7
  if (gen === 'wifi5') return 9
  return 11
}

export function widthFactor(widthMHz: number): number {
  let factor = 1
  for (const [width, value] of WIDTH_FACTORS) if (widthMHz + 1e-6 >= width) factor = value
  return factor
}

/** Highest MCS the SNR can hold, times the channel-width factor and spatial streams. */
export function phyMbpsFromSnr(snrDb: number, gen: WifiGen, widthMHz: number, streams: number): number {
  if (snrDb < 5) return 0
  const cap = maxMcs(gen)
  let rate = 0
  for (const row of MCS_TABLE) {
    if (row.mcs > cap) break
    if (snrDb + 1e-6 >= row.snr) rate = row.mbps20
  }
  return rate * widthFactor(widthMHz) * Math.max(1, streams)
}

/** @deprecated Smooth curve kept only so older tests can import a monotonic helper. */
export function phyEfficiency(snrDb: number): number {
  if (snrDb < 5) return 0
  const cap = phyMbpsFromSnr(snrDb, 'wifi6', 20, 1)
  return Math.min(1, cap / 143.4)
}

export function phyPerStreamMbps(gen: WifiGen, widthMHz: number): number {
  return phyMbpsFromSnr(80, gen, widthMHz, 1)
}

export function macThroughputMbps(phyMbps: number, gen: WifiGen = 'wifi6'): number {
  return phyMbps * MAC_ETA[gen]
}

export function noiseAwarePhyMbps(rssiDbm: number, snrDb: number, gen: WifiGen, widthMHz: number, streams: number): number {
  if (rssiDbm < NO_LINK_RSSI_DBM || snrDb < 5) return 0
  return phyMbpsFromSnr(snrDb, gen, widthMHz, streams)
}

function levelAt(value: number, bands: [number, number][]): number {
  let level = 0
  for (const [threshold, next] of bands) if (value >= threshold) level = next
  return level
}

function lowerLevel(value: number, excellent: number, good: number, mid: number): number {
  if (value < excellent) return 4
  if (value < good) return 3
  if (value <= mid) return 2
  if (value <= mid * 1.4) return 1
  return 0
}

/**
 * 0–4 from the specification thresholds. The result is the worst component.
 * 4 отлично, 3 хорошо, 2 нормально, 1 слабо, 0 плохо.
 */
export function activityLevel(
  metrics: { downMbps: number; upMbps: number; pingMs: number; jitterMs: number; lossPct?: number },
  activity: ActivityId,
): number {
  if (metrics.downMbps <= 0 && metrics.upMbps <= 0) return 0
  const loss = metrics.lossPct ?? 0
  if (activity === 'surfing') {
    return Math.min(levelAt(metrics.downMbps, [[2, 2], [5, 3], [25, 4]]), lowerLevel(metrics.pingMs, 50, 100, 200))
  }
  if (activity === 'video') {
    return levelAt(metrics.downMbps, [[3, 1], [5, 2], [8, 3], [25, 4]])
  }
  if (activity === 'calls') {
    return Math.min(
      levelAt(metrics.downMbps, [[0.5, 1], [1.5, 3], [4, 4]]),
      levelAt(metrics.upMbps, [[0.5, 1], [1.5, 3], [4, 4]]),
      lowerLevel(metrics.pingMs, 50, 150, 250),
      lowerLevel(metrics.jitterMs, 10, 30, 50),
    )
  }
  if (activity === 'broadcast') {
    return levelAt(metrics.upMbps, [[3, 1], [4, 2], [6, 3], [12, 4]])
  }
  if (activity === 'gaming') {
    if (loss > 2 || metrics.pingMs > 120) return 0
    return Math.min(
      lowerLevel(metrics.pingMs, 30, 60, 120),
      lowerLevel(metrics.jitterMs, 5, 15, 30),
      loss < 0.5 ? 4 : loss < 1 ? 3 : 1,
    )
  }
  return Math.min(levelAt(metrics.downMbps, [[5, 1], [10, 2], [15, 3], [35, 4]]), lowerLevel(metrics.pingMs, 30, 50, 80))
}

export function scoreActivity(
  metrics: { downMbps: number; upMbps: number; pingMs: number; jitterMs: number; lossPct?: number },
  activity: ActivityId,
): number {
  return activityLevel(metrics, activity) * 25
}

function emptyScores(): Record<ActivityId, number> {
  return { surfing: 0, video: 0, calls: 0, broadcast: 0, gaming: 0, cloud: 0 }
}

function isWired(backhaul: Backhaul): boolean {
  return backhaul === 'wired' || backhaul === 'mesh-wired'
}

function clientTx(client: ClientDevice): { tx: number; gain: number } {
  const preset = CLIENT_PRESETS[client.preset]
  return {
    tx: client.txPowerDbm ?? preset.txPowerDbm ?? 17,
    gain: client.gainDbi ?? preset.gainDbi ?? 0,
  }
}

interface AirLink {
  mbps: number
  upMbps: number
  phy: number
  rssi: number
  snr: number
  distanceM: number
  wallLossDb: number
}

function airLink(
  ap: AccessPoint,
  client: { x: number; y: number; wifiGen: WifiGen; mimo: number; tx: number; gain: number },
  band: BandId,
  segs: Segment[],
  metersPerPixel: number,
  exponent: number,
  noiseExtraDb: number,
): AirLink {
  const radio = radioFor(ap, band)
  const common = {
    x1: ap.x,
    y1: ap.y,
    x2: client.x,
    y2: client.y,
    segs,
    metersPerPixel,
    freqMHz: band === '2.4' ? 2437 : 5200,
    exponent,
    noiseDbm: noiseFloorDbm(radio.channelWidthMHz, noiseExtraDb),
  }
  const down = linkBudget({ ...common, txPowerDbm: radio.txPowerDbm, gainDbi: radio.gainDbi, rxGainDbi: client.gain })
  const up = linkBudget({ ...common, txPowerDbm: client.tx, gainDbi: client.gain, rxGainDbi: radio.gainDbi })
  const gen = olderGen(ap.wifiGen, client.wifiGen)
  const streams = Math.max(1, Math.min(ap.mimo, client.mimo))
  const dead = down.rssiDbm < NO_LINK_RSSI_DBM || down.snrDb < 5
  const phy = dead ? 0 : phyMbpsFromSnr(down.snrDb, gen, radio.channelWidthMHz, streams)
  const upPhy = up.rssiDbm < NO_LINK_RSSI_DBM || up.snrDb < 5 ? 0 : phyMbpsFromSnr(up.snrDb, gen, radio.channelWidthMHz, streams)
  return {
    mbps: phy * MAC_ETA[gen],
    upMbps: upPhy * MAC_ETA[gen],
    phy,
    rssi: down.rssiDbm,
    snr: down.snrDb,
    distanceM: down.distanceM,
    wallLossDb: down.wallLossDb,
  }
}

interface Uplink {
  capMbps: number
  wireless: boolean
  hasParent: boolean
  parentId: string | null
  band: BandId | null
  penalty: number
}

function backhaulOf(
  ap: AccessPoint,
  aps: AccessPoint[],
  segsByBand: Record<BandId, Segment[]>,
  metersPerPixel: number,
  exponent: number,
  noiseExtraDb: number,
): Uplink {
  const wiredCap = 1000 * 0.94
  if (isWired(ap.backhaul)) return { capMbps: wiredCap, wireless: false, hasParent: true, parentId: null, band: null, penalty: 1 }
  let best = 0
  let parentId: string | null = null
  let band: BandId | null = null
  for (const parent of aps) {
    if (parent.id === ap.id || !isWired(parent.backhaul)) continue
    const bands: BandId[] = []
    if (parent.band5.enabled && ap.band5.enabled) bands.push('5')
    if (parent.band24.enabled && ap.band24.enabled) bands.push('2.4')
    for (const candidate of bands) {
      const link = airLink(
        parent,
        { x: ap.x, y: ap.y, wifiGen: ap.wifiGen, mimo: ap.mimo, tx: radioFor(ap, candidate).txPowerDbm, gain: radioFor(ap, candidate).gainDbi },
        candidate,
        segsByBand[candidate],
        metersPerPixel,
        exponent,
        noiseExtraDb,
      )
      if (link.mbps > best) {
        best = link.mbps
        parentId = parent.id
        band = candidate
      }
    }
  }
  const penalty = ap.backhaul === 'repeater' || ap.backhaul === 'mesh-wireless' ? 0.5 : 1
  if (!parentId) return { capMbps: 0, wireless: true, hasParent: false, parentId: null, band: null, penalty }
  return { capMbps: best, wireless: true, hasParent: true, parentId, band, penalty }
}

interface Choice {
  ap: AccessPoint
  band: BandId
  link: AirLink
  uplink: Uplink
}

function disconnected(client: ClientDevice, approximate: boolean, warning: 'no-ap' | 'no-link' | 'weak-signal'): ClientEstimate {
  const warnings: ClientEstimate['warnings'] = [warning]
  if (approximate) warnings.push('approx-scale')
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
    warnings,
  }
}

export function estimateClients(
  project: Pick<Project, 'walls' | 'aps' | 'clients' | 'isp' | 'propagation' | 'scale'>,
  metersPerPixel: number,
  approximateScale: boolean,
): ClientEstimate[] {
  const exponent = resolveExponent(project.propagation.exponent)
  const noiseExtraDb = project.propagation.noiseExtraDb ?? 3
  const segsByBand: Record<BandId, Segment[]> = {
    '2.4': buildSegments(project.walls, '2.4'),
    '5': buildSegments(project.walls, '5'),
  }
  const uplinks = new Map<string, Uplink>()
  for (const ap of project.aps) uplinks.set(ap.id, backhaulOf(ap, project.aps, segsByBand, metersPerPixel, exponent, noiseExtraDb))

  const choices = new Map<string, Choice | null>()
  for (const client of project.clients) {
    const tx = clientTx(client)
    let best: Choice | null = null
    for (const ap of project.aps) {
      const bands: BandId[] = []
      if (client.supports5 && ap.band5.enabled) bands.push('5')
      if (ap.band24.enabled) bands.push('2.4')
      for (const band of bands) {
        const link = airLink(ap, { x: client.x, y: client.y, wifiGen: client.wifiGen, mimo: client.mimo, ...tx }, band, segsByBand[band], metersPerPixel, exponent, noiseExtraDb)
        const uplink = uplinks.get(ap.id)!
        const limited = Math.min(link.mbps, uplink.capMbps)
        if (!best || limited > Math.min(best.link.mbps, best.uplink.capMbps)) best = { ap, band, link, uplink }
      }
    }
    choices.set(client.id, best)
  }

  const perRadio = new Map<string, number>()
  for (const choice of choices.values()) {
    if (!choice || choice.link.mbps <= 0) continue
    const key = `${choice.ap.id}:${choice.band}`
    perRadio.set(key, (perRadio.get(key) ?? 0) + 1)
  }
  for (const uplink of uplinks.values()) {
    if (!uplink.parentId || !uplink.band) continue
    const key = `${uplink.parentId}:${uplink.band}`
    perRadio.set(key, (perRadio.get(key) ?? 0) + 1)
  }

  const nClients = Math.max(1, project.clients.length)
  const ispDown = Math.max(0, project.isp.downMbps) / nClients
  const ispUp = Math.max(0, project.isp.upMbps) / nClients
  const ispPing = project.isp.pingMs ?? 8

  return project.clients.map((client) => {
    const choice = choices.get(client.id) ?? null
    if (!choice || choice.link.mbps <= 0) {
      const estimate = disconnected(client, approximateScale, project.aps.length === 0 ? 'no-ap' : 'no-link')
      if (choice) {
        estimate.apId = choice.ap.id
        estimate.apName = choice.ap.name
        estimate.band = choice.band
        estimate.rssiDbm = choice.link.rssi
        estimate.snrDb = choice.link.snr
        estimate.distanceM = choice.link.distanceM
        estimate.wallLossDb = choice.link.wallLossDb
      }
      return estimate
    }

    const shares = Math.max(1, perRadio.get(`${choice.ap.id}:${choice.band}`) ?? 1)
    const penalty = choice.uplink.penalty
    const down = Math.max(0, Math.min((choice.link.mbps * penalty) / shares, choice.uplink.capMbps, ispDown))
    const up = Math.max(0, Math.min((choice.link.upMbps * penalty) / shares, choice.uplink.capMbps, ispUp))
    const twifi = choice.link.snr > 25 ? 2 : choice.link.snr > 15 ? 5 : 8
    const hop = choice.uplink.wireless ? 4 : 0.2
    const queue = down > 0 && down >= ispDown * 0.8 ? 12 : 0
    const pingMs = ispPing + twifi + hop + queue
    const jitterMs = 1 + (choice.link.snr < 15 ? 4 : 0) + (choice.uplink.wireless ? 2 : 0)
    const lossPct = choice.link.snr - 5 < 3 ? 4 : choice.link.snr < 15 ? 0.8 : 0.1
    const metrics = { downMbps: down, upMbps: up, pingMs, jitterMs, lossPct }
    const scores = emptyScores()
    for (const id of ACTIVITY_IDS) scores[id] = scoreActivity(metrics, id)

    const warnings: ClientEstimate['warnings'] = []
    if (approximateScale) warnings.push('approx-scale')
    if (choice.link.rssi < -75) warnings.push('weak-signal')
    if (choice.uplink.wireless) warnings.push('wireless-backhaul')
    if (!choice.uplink.hasParent) warnings.push('no-parent')
    const radio = radioFor(choice.ap, choice.band)
    const limit = choice.band === '2.4' ? 20 : 23
    if (radio.txPowerDbm + radio.gainDbi > limit + 0.1) warnings.push('eirp')

    return {
      clientId: client.id,
      apId: choice.ap.id,
      apName: choice.ap.name,
      band: choice.band,
      distanceM: choice.link.distanceM,
      wallLossDb: choice.link.wallLossDb,
      rssiDbm: choice.link.rssi,
      snrDb: choice.link.snr,
      phyMbps: choice.link.phy,
      downMbps: down,
      upMbps: up,
      pingMs,
      jitterMs,
      scores,
      warnings,
    }
  })
}
