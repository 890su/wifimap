import { describe, expect, it } from 'vitest'
import { getMaterial } from '../model/materials'
import { readProject } from './project'

const legacy = {
  version: 1,
  id: 'old',
  name: 'Старый',
  updatedAt: 1,
  world: { width: 400, height: 300 },
  floorPlan: null,
  scale: null,
  walls: [{ id: 'm', points: [0, 0, 10, 0], materialId: 'metal' }],
  aps: [
    {
      id: 'a',
      x: 1,
      y: 2,
      name: 'AP',
      preset: 'wifi6',
      wifiGen: 'wifi6',
      mimo: 2,
      backhaul: 'wired',
    },
  ],
  clients: [],
  isp: { downMbps: 100, upMbps: 50 },
  propagation: { exponent: 2.2, autoClutter: true, noiseExtraDb: 3 },
}

describe('legacy project migration', () => {
  it('keeps metal at 25/32 dB, lifts exponent 2.2, and clears legacy antenna gain', () => {
    const { project, notices } = readProject(legacy)
    expect(project?.walls[0].materialId).toBe('metal')
    expect(getMaterial('metal').lossDb['5']).toBe(32)
    expect(getMaterial('metal').lossDb['2.4']).toBe(25)
    expect(getMaterial('unknown').id).toBe('drywall')
    expect(project?.propagation.exponent).toBe(2.8)
    expect(project?.aps[0].band24.gainDbi).toBe(0)
    expect(project?.aps[0].band5.gainDbi).toBe(0)
    expect(project?.schemaVersion).toBe(2)
    expect(notices).toEqual(['metal', 'exponent', 'gain'])
  })

  it('resets an explicit legacy Wi-Fi 6 gain of 4/5 dBi', () => {
    const { project, notices } = readProject({
      ...legacy,
      walls: [],
      propagation: { exponent: 2.8, autoClutter: false },
      aps: [
        {
          ...legacy.aps[0],
          band24: { enabled: true, txPowerDbm: 20, gainDbi: 4, channelWidthMHz: 20 },
          band5: { enabled: true, txPowerDbm: 23, gainDbi: 5, channelWidthMHz: 80 },
        },
      ],
    })
    expect(project?.aps[0].band24.gainDbi).toBe(0)
    expect(project?.aps[0].band5.gainDbi).toBe(0)
    expect(notices).toEqual(['gain'])
  })

  it('does not rewrite a schema 2 file', () => {
    const current = {
      ...legacy,
      schemaVersion: 2,
      propagation: { exponent: 2.2, autoClutter: false, noiseExtraDb: 3 },
      aps: [
        {
          ...legacy.aps[0],
          band24: { enabled: true, txPowerDbm: 20, gainDbi: 4, channelWidthMHz: 20 },
          band5: { enabled: true, txPowerDbm: 23, gainDbi: 5, channelWidthMHz: 80 },
        },
      ],
    }
    const { project, notices } = readProject(current)
    expect(notices).toEqual([])
    expect(project?.propagation.exponent).toBe(2.2)
    expect(project?.aps[0].band24.gainDbi).toBe(4)
    expect(project?.aps[0].band5.gainDbi).toBe(5)
    expect(project?.walls[0].materialId).toBe('metal')
  })
})
