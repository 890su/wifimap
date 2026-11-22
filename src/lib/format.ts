export function fmtMbps(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 10) return String(Math.round(value))
  return value.toFixed(1)
}

export function fmtMs(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return String(Math.round(value))
}

export function fmtNum(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return value.toFixed(digits).replace('-', '−')
}
