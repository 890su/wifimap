import type { BandId, Material } from './types'

/** Typical one-way attenuation for a residential thickness, per band. */
export const MATERIALS: Material[] = [
  { id: 'drywall', lossDb: { '2.4': 3, '5': 5 }, color: '#8a8175' },
  { id: 'brick', lossDb: { '2.4': 7, '5': 11 }, color: '#b85c45' },
  { id: 'concrete', lossDb: { '2.4': 12, '5': 19 }, color: '#6d737a' },
  { id: 'rebar', lossDb: { '2.4': 18, '5': 28 }, color: '#4e545c' },
  { id: 'glass', lossDb: { '2.4': 2, '5': 4 }, color: '#3d8eae' },
  { id: 'wood', lossDb: { '2.4': 4, '5': 6 }, color: '#8d6a3f' },
  { id: 'wood-door', lossDb: { '2.4': 3, '5': 5 }, color: '#7a5a3a' },
  { id: 'metal-door', lossDb: { '2.4': 11, '5': 16 }, color: '#5c6778' },
  { id: 'metal', lossDb: { '2.4': 25, '5': 32 }, color: '#3e4650' },
  { id: 'furniture', lossDb: { '2.4': 3, '5': 5 }, color: '#8a7b6a' },
]

const byId = new Map(MATERIALS.map((m) => [m.id, m]))

export function getMaterial(id: string): Material {
  return byId.get(id) ?? MATERIALS[0]
}

export function materialLoss(id: string, band: BandId): number {
  return getMaterial(id).lossDb[band]
}
