import type { BandId, Material } from './types'

/** Planning losses from the specification, for a typical thickness. */
export const MATERIALS: Material[] = [
  { id: 'drywall', lossDb: { '2.4': 3, '5': 4 }, color: '#8a8175' },
  { id: 'wood-door', lossDb: { '2.4': 3, '5': 6 }, color: '#7a5a3a' },
  { id: 'glass', lossDb: { '2.4': 3, '5': 7 }, color: '#3d8eae' },
  { id: 'aerated', lossDb: { '2.4': 6, '5': 10 }, color: '#b7a48a' },
  { id: 'brick', lossDb: { '2.4': 9, '5': 15 }, color: '#b85c45' },
  { id: 'concrete', lossDb: { '2.4': 12, '5': 20 }, color: '#6d737a' },
  { id: 'rebar', lossDb: { '2.4': 18, '5': 30 }, color: '#4e545c' },
  { id: 'low-e', lossDb: { '2.4': 20, '5': 30 }, color: '#2f6f86' },
  { id: 'metal-door', lossDb: { '2.4': 18, '5': 28 }, color: '#5c6778' },
  { id: 'shaft', lossDb: { '2.4': 30, '5': 40 }, color: '#3e4650' },
  { id: 'wood', lossDb: { '2.4': 4, '5': 6 }, color: '#8d6a3f' },
  { id: 'furniture', lossDb: { '2.4': 3, '5': 5 }, color: '#8a7b6a' },
  /** Kept for projects saved before the material was removed. 25/32 dB, not drywall. */
  { id: 'metal', lossDb: { '2.4': 25, '5': 32 }, color: '#3a4048' },
]

/** Shown in simple mode. The rest stay available in advanced mode. */
export const SIMPLE_MATERIAL_IDS = ['drywall', 'wood-door', 'glass', 'brick', 'concrete']

export const REFERENCE_THICKNESS_CM = 12

const byId = new Map(MATERIALS.map((material) => [material.id, material]))

export function getMaterial(id: string): Material {
  return byId.get(id) ?? MATERIALS[0]
}

export function materialLoss(id: string, band: BandId, thicknessCm?: number): number {
  const base = getMaterial(id).lossDb[band]
  if (!thicknessCm || thicknessCm <= 0) return base
  return base * (thicknessCm / REFERENCE_THICKNESS_CM)
}
