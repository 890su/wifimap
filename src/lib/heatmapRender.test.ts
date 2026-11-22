import { describe, expect, it } from 'vitest'
import { DEAD_RED, HEATMAP_FRAG, heatmapColor } from './heatmapRender'
import { coverageZones } from '../model/pathloss'

describe('no-link heatmap color', () => {
  it('paints below −82 dBm, including no reading, as opaque dark red', () => {
    for (const rssi of [-82.01, -90, -108, -120, -200]) {
      const [r, g, b, a] = heatmapColor(rssi, 0.4)
      expect(r).toBe(DEAD_RED[0])
      expect(g).toBe(DEAD_RED[1])
      expect(b).toBe(DEAD_RED[2])
      expect(a).toBeGreaterThanOrEqual(230)
    }
  })

  it('keeps a linked cell on the color scale and out of the dead red', () => {
    const [r, g, b, a] = heatmapColor(-60, 0.8)
    expect(g).toBeGreaterThan(DEAD_RED[1] + 40)
    expect(a).toBeGreaterThan(180)
    expect(r).not.toBe(DEAD_RED[0])
  })

  it('does not discard the dead zone in the WebGL shader', () => {
    expect(HEATMAP_FRAG).toContain('rssi >= -82.0')
    expect(HEATMAP_FRAG).not.toContain('rssi < -100.0')
    expect(HEATMAP_FRAG).toContain('0.451, 0.071, 0.125, 0.95')
  })

  it('counts cells beyond range as нет связи', () => {
    const zones = coverageZones([-50, -130, -120])
    expect(zones.dead).toBeCloseTo(2 / 3, 5)
    expect(zones.excellent).toBeCloseTo(1 / 3, 5)
  })
})
