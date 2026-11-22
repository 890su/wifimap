import { describe, expect, it } from 'vitest'
import { AP_PRESETS, CLIENT_PRESETS } from './presets'
import {
  coverageFraction,
  effectiveScale,
  fsplAt1m,
  linkBudget,
  noiseFloorDbm as noiseFromWidth,
  pathLossDb,
  resolveExponent,
  wallLossBetween,
  buildSegments,
  computeRssiGrid,
} from './pathloss'
import { snapAngle, straightenFreehand, segmentsCross } from './geometry'
import { activityLevel, estimateClients, phyMbpsFromSnr, scoreActivity } from './throughput'
import type { AccessPoint, ClientDevice, Project, Wall } from './types'

function wall(id: string, points: number[], materialId = 'brick'): Wall {
  return { id, points, materialId }
}

function ap(partial: Partial<AccessPoint> & Pick<AccessPoint, 'id' | 'x' | 'y'>): AccessPoint {
  const preset = AP_PRESETS.wifi6
  return {
    name: partial.id,
    preset: 'wifi6',
    wifiGen: preset.wifiGen,
    mimo: preset.mimo,
    backhaul: 'wired',
    band24: { ...preset.band24 },
    band5: { ...preset.band5 },
    ...partial,
  }
}

function client(partial: Partial<ClientDevice> & Pick<ClientDevice, 'id' | 'x' | 'y'>): ClientDevice {
  const preset = CLIENT_PRESETS.laptop
  return {
    name: partial.id,
    preset: 'laptop',
    ...preset,
    ...partial,
  }
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    version: 1,
    id: 'p',
    name: 't',
    updatedAt: 0,
    world: { width: 800, height: 600 },
    floorPlan: null,
    scale: { metersPerPixel: 0.02 },
    walls: [],
    aps: [],
    clients: [],
    isp: { downMbps: 500, upMbps: 500 },
    propagation: { exponent: 2.2, autoClutter: true },
    ...overrides,
  }
}

describe('path loss', () => {
  it('matches free-space loss at 1 m', () => {
    expect(fsplAt1m(2437)).toBeCloseTo(40.19, 1)
    expect(fsplAt1m(5200)).toBeCloseTo(46.77, 1)
    expect(fsplAt1m(5200)).toBeGreaterThan(fsplAt1m(2437))
    expect(pathLossDb(1, 2437, 2.8, 0)).toBeCloseTo(40, 5)
    expect(pathLossDb(1, 5200, 2.8, 0)).toBeCloseTo(47, 5)
  })

  it('grows with distance and exponent', () => {
    const near = pathLossDb(2, 2437, 2.8, 0)
    const far = pathLossDb(20, 2437, 2.8, 0)
    const steeper = pathLossDb(20, 2437, 3.4, 0)
    expect(far).toBeGreaterThan(near + 10)
    expect(steeper).toBeGreaterThan(far)
    expect(pathLossDb(10, 2437, 2.8, 0)).toBeCloseTo(40 + 28, 5)
  })

  it('does not change the exponent when walls appear', () => {
    expect(resolveExponent(2.8, 0, true)).toBe(2.8)
    expect(resolveExponent(2.8, 3, true)).toBe(2.8)
    expect(resolveExponent(2.8, 0, false)).toBe(2.8)
  })

  it('uses a measured scale and falls back when it is missing', () => {
    expect(effectiveScale({ metersPerPixel: 0.025 }).approximate).toBe(false)
    expect(effectiveScale(null).approximate).toBe(true)
    expect(effectiveScale(null).metersPerPixel).toBeCloseTo(1 / 40, 6)
  })
})

describe('walls', () => {
  it('counts a crossing once and ignores a miss', () => {
    expect(segmentsCross(0, -10, 0, 10, -10, 0, 10, 0)).toBe(true)
    expect(segmentsCross(0, -10, 0, -1, -10, 0, 10, 0)).toBe(false)
    const segs = buildSegments([wall('h', [-10, 0, 10, 0], 'brick')], '2.4')
    expect(wallLossBetween(0, -10, 0, 10, segs)).toBe(9)
    expect(wallLossBetween(-30, -10, -30, 10, segs)).toBe(0)
  })

  it('sums materials and applies a higher 5 GHz loss', () => {
    const walls = [wall('a', [-10, 0, 10, 0], 'brick'), wall('b', [-10, 5, 10, 5], 'concrete')]
    const loss24 = wallLossBetween(0, -5, 0, 12, buildSegments(walls, '2.4'))
    const loss5 = wallLossBetween(0, -5, 0, 12, buildSegments(walls, '5'))
    expect(loss24).toBe(9 + 12)
    expect(loss5).toBe(15 + 20)
    expect(loss5).toBeGreaterThan(loss24)
  })

  it('caps stacked wall loss', () => {
    const walls = Array.from({ length: 4 }, (_, i) => wall(`m${i}`, [-5, i * 2, 5, i * 2], 'shaft'))
    const loss = wallLossBetween(0, -1, 0, 20, buildSegments(walls, '2.4'))
    expect(loss).toBe(60)
  })

  it('does not treat a shared room corner as two walls', () => {
    const room: Wall = { id: 'room', points: [0, 0, 100, 0, 100, 80, 0, 80], materialId: 'drywall', closed: true }
    const segs = buildSegments([room], '2.4')
    expect(segs).toHaveLength(4)
    expect(wallLossBetween(50, -20, 50, 40, segs)).toBe(3)
  })
})

describe('heatmap', () => {
  it('is stronger near the AP and weaker behind a wall', () => {
    const grid = computeRssiGrid({
      walls: [wall('w', [0, 100, 400, 100], 'concrete')],
      aps: [ap({ id: 'a', x: 200, y: 40 })],
      band: '5',
      exponent: 2.2,
      autoClutter: false,
      metersPerPixel: 0.02,
      originX: 0,
      originY: 0,
      widthPx: 400,
      heightPx: 240,
      cellM: 0.5,
    })
    const at = (px: number, py: number) => {
      const x = Math.floor(px / grid.cellPx)
      const y = Math.floor(py / grid.cellPx)
      return grid.rssi[y * grid.width + x]
    }
    expect(at(200, 50)).toBeGreaterThan(at(200, 180))
    const open = linkBudget({
      x1: 200,
      y1: 40,
      x2: 200,
      y2: 180,
      txPowerDbm: 23,
      gainDbi: 5,
      segs: [],
      metersPerPixel: 0.02,
      freqMHz: 5200,
      exponent: 2.2,
      noiseDbm: -98,
    })
    const blocked = linkBudget({
      x1: 200,
      y1: 40,
      x2: 200,
      y2: 180,
      txPowerDbm: 23,
      gainDbi: 5,
      segs: buildSegments([wall('w', [0, 100, 400, 100], 'concrete')], '5'),
      metersPerPixel: 0.02,
      freqMHz: 5200,
      exponent: 2.2,
      noiseDbm: -98,
    })
    expect(blocked.rssiDbm).toBeLessThan(open.rssiDbm - 15)
    expect(blocked.wallLossDb).toBe(20)
  })

  it('keeps the best of two access points', () => {
    const grid = computeRssiGrid({
      walls: [],
      aps: [ap({ id: 'a', x: 20, y: 20 }), ap({ id: 'b', x: 300, y: 20 })],
      band: '2.4',
      exponent: 2.2,
      autoClutter: false,
      metersPerPixel: 0.02,
      originX: 0,
      originY: 0,
      widthPx: 320,
      heightPx: 80,
      cellM: 0.4,
    })
    const left = grid.rssi[0]
    const midIndex = Math.floor(grid.width / 2)
    const mid = grid.rssi[midIndex]
    expect(left).toBeGreaterThan(-40)
    expect(mid).toBeGreaterThan(-70)
    expect(coverageFraction(grid.rssi, -67)).toBeGreaterThan(0.5)
  })

  it('penalises 5 GHz more than 2.4 GHz through the same wall', () => {
    const base = {
      walls: [wall('w', [0, 50, 200, 50], 'brick')],
      aps: [ap({ id: 'a', x: 100, y: 10 })],
      exponent: 2.2,
      autoClutter: false,
      metersPerPixel: 0.02,
      originX: 0,
      originY: 0,
      widthPx: 200,
      heightPx: 120,
      cellM: 0.4,
    }
    const g24 = computeRssiGrid({ ...base, band: '2.4' })
    const g5 = computeRssiGrid({ ...base, band: '5' })
    const idx = g24.width * (g24.height - 1) + Math.floor(g24.width / 2)
    expect(g5.rssi[idx]).toBeLessThan(g24.rssi[idx])
  })
})

describe('throughput and scores', () => {
  it('maps SNR onto the MCS table', () => {
    expect(phyMbpsFromSnr(4, 'wifi6', 80, 2)).toBe(0)
    expect(phyMbpsFromSnr(18, 'wifi6', 80, 2)).toBeCloseTo(51.6 * 4.19 * 2, 1)
    expect(phyMbpsFromSnr(40, 'wifi4', 40, 1)).toBeLessThanOrEqual(150)
    expect(phyMbpsFromSnr(40, 'wifi4', 40, 1)).toBeCloseTo(150, 1)
    expect(phyMbpsFromSnr(40, 'wifi4', 80, 1)).toBeLessThanOrEqual(150)
    expect(phyMbpsFromSnr(40, 'wifi5', 80, 2)).toBeLessThanOrEqual(867)
  })

  it('gives a nearby client usable throughput on a wired AP', () => {
    const p = project({
      aps: [ap({ id: 'a', x: 0, y: 0 })],
      clients: [client({ id: 'c', x: 150, y: 0 })],
    })
    const [est] = estimateClients(p, 0.02, false)
    expect(est.downMbps).toBeGreaterThan(20)
    expect(est.upMbps).toBeGreaterThan(10)
    expect(est.pingMs).toBeLessThan(40)
    expect(est.band).toBe('5')
    expect(est.scores.surfing).toBeGreaterThanOrEqual(70)
    expect(est.warnings).not.toContain('no-ap')
  })

  it('limits every client by a fair share of the ISP plan', () => {
    const p = project({
      isp: { downMbps: 40, upMbps: 20 },
      aps: [ap({ id: 'a', x: 0, y: 0 })],
      clients: [client({ id: 'c1', x: 40, y: 0 }), client({ id: 'c2', x: 80, y: 0 })],
    })
    const estimates = estimateClients(p, 0.02, false)
    for (const est of estimates) {
      expect(est.downMbps).toBeLessThanOrEqual(20.01)
      expect(est.upMbps).toBeLessThanOrEqual(10.01)
    }
  })

  it('cuts throughput when the only AP is a repeater without a wired parent', () => {
    const wired = project({
      aps: [ap({ id: 'a', x: 0, y: 0, backhaul: 'wired' })],
      clients: [client({ id: 'c', x: 100, y: 0 })],
    })
    const repeated = project({
      aps: [ap({ id: 'a', x: 0, y: 0, backhaul: 'repeater', preset: 'repeater' })],
      clients: [client({ id: 'c', x: 100, y: 0 })],
    })
    const a = estimateClients(wired, 0.02, false)[0]
    const b = estimateClients(repeated, 0.02, false)[0]
    expect(a.downMbps).toBeGreaterThan(b.downMbps + 20)
    expect(b.warnings).toContain('no-parent')
    expect(b.downMbps).toBeLessThanOrEqual(12)
  })

  it('prefers a local wired AP over one behind metal', () => {
    const p = project({
      walls: [
        wall('m1', [180, -40, 180, 240], 'metal'),
        wall('m2', [230, -40, 230, 240], 'metal'),
      ],
      aps: [
        ap({ id: 'far', x: 0, y: 0 }),
        ap({ id: 'near', x: 420, y: 0 }),
      ],
      clients: [client({ id: 'c', x: 480, y: 0 })],
    })
    const est = estimateClients(p, 0.02, false)[0]
    expect(est.apId).toBe('near')
    expect(est.downMbps).toBeGreaterThan(20)
  })

  it('drops gaming harder than surfing when latency is poor', () => {
    const good = { downMbps: 80, upMbps: 40, pingMs: 12, jitterMs: 2 }
    const laggy = { downMbps: 80, upMbps: 40, pingMs: 130, jitterMs: 45 }
    expect(scoreActivity(good, 'gaming')).toBeGreaterThan(scoreActivity(laggy, 'gaming') + 25)
    expect(scoreActivity({ downMbps: 6, upMbps: 3, pingMs: 20, jitterMs: 4 }, 'surfing')).toBeGreaterThan(
      scoreActivity({ downMbps: 6, upMbps: 3, pingMs: 20, jitterMs: 4 }, 'cloud'),
    )
  })

  it('reports no access point', () => {
    const p = project({ clients: [client({ id: 'c', x: 10, y: 10 })] })
    const est = estimateClients(p, 0.02, true)[0]
    expect(est.downMbps).toBe(0)
    expect(est.pingMs).toBeNull()
    expect(est.warnings).toContain('no-ap')
    expect(est.warnings).toContain('approx-scale')
  })
})

describe('freehand straightening', () => {
  it('collapses a noisy horizontal stroke to a straight segment', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 12, y: 2 },
      { x: 24, y: -1 },
      { x: 40, y: 1 },
      { x: 70, y: -2 },
      { x: 100, y: 1 },
    ]
    const straightened = straightenFreehand(points, 6)
    expect(straightened.length).toBeLessThan(points.length)
    expect(straightened[0]).toEqual({ x: 0, y: 0 })
    const end = straightened[straightened.length - 1]
    expect(Math.abs(end.y)).toBeLessThan(3)
    expect(end.x).toBeGreaterThan(90)
  })

  it('snaps a shallow angle to the horizontal', () => {
    const snapped = snapAngle({ x: 0, y: 0 }, { x: 100, y: 6 }, 12)
    expect(snapped.y).toBeCloseTo(0, 5)
    expect(snapped.x).toBeGreaterThan(99)
  })
})

describe('specification reference values', () => {
  it('uses the planning noise floor for the channel width and neighbours', () => {
    expect(noiseFromWidth(20, 0)).toBeCloseTo(-95, 5)
    expect(noiseFromWidth(80, 0)).toBeCloseTo(-89, 5)
    expect(noiseFromWidth(160, 0)).toBeCloseTo(-86, 5)
    expect(noiseFromWidth(80, 3)).toBeCloseTo(-86, 5)
  })

  it('rates −68 dBm on 80 MHz as MCS4, about 432 Mbit/s PHY', () => {
    const noise = noiseFromWidth(80, 3)
    const rssi = -68
    const snr = rssi - noise
    expect(snr).toBeCloseTo(18, 5)
    expect(phyMbpsFromSnr(snr, 'wifi6', 80, 2)).toBeCloseTo(432.4, 0)
  })

  it('reports no connection at −82 dBm behind two concrete walls', () => {
    const mpp = 0.02
    const p = project({
      propagation: { exponent: 2.8, autoClutter: false, noiseExtraDb: 3 },
      isp: { downMbps: 500, upMbps: 500, pingMs: 8 },
      walls: [wall('c1', [200, -40, 200, 40], 'concrete'), wall('c2', [400, -40, 400, 40], 'concrete')],
      aps: [ap({ id: 'a', x: 0, y: 0, band24: { enabled: false, txPowerDbm: 20, gainDbi: 0, channelWidthMHz: 20 } })],
      clients: [client({ id: 'c', x: 700, y: 0 })],
    })
    const est = estimateClients(p, mpp, false)[0]
    expect(est.band).toBe('5')
    expect(est.wallLossDb).toBe(40)
    expect(est.rssiDbm ?? 0).toBeLessThan(-82)
    expect(est.downMbps).toBe(0)
    expect(est.scores.surfing).toBe(0)
    expect(est.scores.gaming).toBe(0)
    expect(est.warnings).toContain('no-link')
  })

  it('does not improve a clear path when a wall is added off to the side', () => {
    const open = project({
      propagation: { exponent: 2.8, autoClutter: true, noiseExtraDb: 0 },
      aps: [ap({ id: 'a', x: 0, y: 0 })],
      clients: [client({ id: 'c', x: 500, y: 0 })],
    })
    const walled = project({
      ...open,
      walls: [wall('far', [900, -100, 900, 100], 'drywall')],
    })
    const a = estimateClients(open, 0.02, false)[0]
    const b = estimateClients(walled, 0.02, false)[0]
    expect(b.rssiDbm).toBeCloseTo(a.rssiDbm ?? 0, 5)
    const direct = linkBudget({
      x1: 0, y1: 0, x2: 500, y2: 0,
      txPowerDbm: 20, gainDbi: 0,
      segs: [], metersPerPixel: 0.02, freqMHz: 2437, exponent: 2.8, noiseDbm: -95,
    })
    expect(direct.rssiDbm).toBeCloseTo(-48, 5)
  })

  it('counts a shared room edge once', () => {
    const shared = [
      wall('left', [0, 0, 200, 0, 200, 200, 0, 200], 'brick'),
      wall('right', [200, 0, 400, 0, 400, 200, 200, 200], 'brick'),
    ]
    shared[0].closed = true
    shared[1].closed = true
    const loss = wallLossBetween(100, 100, 300, 100, buildSegments(shared, '5'), 0.02)
    expect(loss).toBe(15)
  })

  it('scores scenarios by the worst requirement in the specification', () => {
    expect(activityLevel({ downMbps: 1, upMbps: 0.5, pingMs: 20, jitterMs: 2 }, 'surfing')).toBe(0)
    expect(activityLevel({ downMbps: 1, upMbps: 0.5, pingMs: 20, jitterMs: 2 }, 'video')).toBe(0)
    expect(activityLevel({ downMbps: 8, upMbps: 2, pingMs: 20, jitterMs: 2 }, 'video')).toBe(3)
    expect(activityLevel({ downMbps: 25, upMbps: 5, pingMs: 20, jitterMs: 2 }, 'video')).toBe(4)
    expect(activityLevel({ downMbps: 10, upMbps: 2, pingMs: 20, jitterMs: 2 }, 'broadcast')).toBe(0)
    expect(activityLevel({ downMbps: 20, upMbps: 12, pingMs: 20, jitterMs: 2 }, 'broadcast')).toBe(4)
    expect(scoreActivity({ downMbps: 80, upMbps: 40, pingMs: 12, jitterMs: 2 }, 'gaming')).toBe(100)
    expect(scoreActivity({ downMbps: 80, upMbps: 40, pingMs: 130, jitterMs: 20 }, 'gaming')).toBe(0)
    expect(activityLevel({ downMbps: 100, upMbps: 0, pingMs: 10, jitterMs: 1 }, 'surfing')).toBe(0)
    expect(activityLevel({ downMbps: 80, upMbps: 40, pingMs: 12, jitterMs: 2, lossPct: 4 }, 'cloud')).toBe(0)
    expect(activityLevel({ downMbps: 80, upMbps: 40, pingMs: 12, jitterMs: 2, lossPct: 4 }, 'gaming')).toBe(0)
  })

  it('does not raise ping when the signal gets stronger', () => {
    const p = project({
      propagation: { exponent: 2.8, autoClutter: false, noiseExtraDb: 3 },
      isp: { downMbps: 1000, upMbps: 1000, pingMs: 8 },
      aps: [ap({ id: 'a', x: 0, y: 0, band24: { enabled: false, txPowerDbm: 20, gainDbi: 0, channelWidthMHz: 20 } })],
      clients: [
        client({ id: 'near', x: 50, y: 0 }),
        client({ id: 'far', x: 2000, y: 0 }),
      ],
    })
    const estimates = estimateClients(p, 0.02, false)
    const near = estimates.find((item) => item.clientId === 'near')
    const far = estimates.find((item) => item.clientId === 'far')
    expect(near?.pingMs).not.toBeNull()
    expect(far?.pingMs).not.toBeNull()
    expect(near!.pingMs!).toBeLessThanOrEqual(far!.pingMs!)
  })

  it('treats a dead uplink as no connection', () => {
    const p = project({
      propagation: { exponent: 2.8, autoClutter: false, noiseExtraDb: 3 },
      isp: { downMbps: 500, upMbps: 500, pingMs: 8 },
      aps: [ap({ id: 'a', x: 0, y: 0, band24: { enabled: false, txPowerDbm: 23, gainDbi: 0, channelWidthMHz: 80 } })],
      clients: [client({ id: 'c', x: 3000, y: 0, txPowerDbm: 15, gainDbi: -2 })],
    })
    const est = estimateClients(p, 0.02, false)[0]
    expect(est.downMbps).toBe(0)
    expect(est.upMbps).toBe(0)
    expect(est.scores.surfing).toBe(0)
    expect(est.warnings).toContain('no-link')
  })
})
