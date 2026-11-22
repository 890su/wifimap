import type { Point, Wall } from './types'

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Proper segment crossing. Endpoints do not count, so shared corners are not double-hit. */
export function segmentsCross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const d1x = bx - ax
  const d1y = by - ay
  const d2x = dx - cx
  const d2y = dy - cy
  const den = d1x * d2y - d1y * d2x
  if (den === 0) return false
  const acx = cx - ax
  const acy = cy - ay
  const t = (acx * d2y - acy * d2x) / den
  const u = (acx * d1y - acy * d1x) / den
  return t > 0.02 && t < 0.998 && u > 0.001 && u < 0.999
}

export interface Segment {
  x1: number
  y1: number
  x2: number
  y2: number
  loss: number
  materialId: string
}

export function wallSegments(wall: Wall, loss: number): Segment[] {
  const n = Math.floor(wall.points.length / 2)
  if (n < 2) return []
  const segs: Segment[] = []
  const last = wall.closed ? n : n - 1
  for (let i = 0; i < last; i++) {
    const j = wall.closed ? (i + 1) % n : i + 1
    segs.push({
      x1: wall.points[i * 2],
      y1: wall.points[i * 2 + 1],
      x2: wall.points[j * 2],
      y2: wall.points[j * 2 + 1],
      loss,
      materialId: wall.materialId,
    })
  }
  return segs
}

export function distToSegment(p: Point, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - ax, p.y - ay)
  let t = ((p.x - ax) * dx + (p.y - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy))
}

export function hitsWall(p: Point, wall: Wall, threshold: number): boolean {
  const n = Math.floor(wall.points.length / 2)
  if (n < 2) return false
  const last = wall.closed ? n : n - 1
  for (let i = 0; i < last; i++) {
    const j = wall.closed ? (i + 1) % n : i + 1
    const d = distToSegment(
      p,
      wall.points[i * 2],
      wall.points[i * 2 + 1],
      wall.points[j * 2],
      wall.points[j * 2 + 1],
    )
    if (d <= threshold) return true
  }
  return false
}

export function nearestEndpoint(p: Point, walls: Wall[], threshold: number): Point | null {
  let best: Point | null = null
  let bestD = threshold
  for (const wall of walls) {
    for (let i = 0; i < wall.points.length; i += 2) {
      const q = { x: wall.points[i], y: wall.points[i + 1] }
      const d = dist(p, q)
      if (d <= bestD) {
        bestD = d
        best = q
      }
    }
  }
  return best
}

export function snapGrid(p: Point, grid: number): Point {
  if (grid <= 0) return p
  return { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid }
}

/** Snap a segment to 45° increments when it is already close. */
export function snapAngle(origin: Point, p: Point, toleranceDeg = 12): Point {
  const dx = p.x - origin.x
  const dy = p.y - origin.y
  const len = Math.hypot(dx, dy)
  if (len < 1) return p
  const ang = Math.atan2(dy, dx)
  const step = Math.PI / 4
  const snapped = Math.round(ang / step) * step
  const diff = Math.abs(Math.atan2(Math.sin(ang - snapped), Math.cos(ang - snapped)))
  if (diff > (toleranceDeg * Math.PI) / 180) return p
  return { x: origin.x + Math.cos(snapped) * len, y: origin.y + Math.sin(snapped) * len }
}

function douglasPeucker(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points.slice()
  let maxD = 0
  let index = 0
  const end = points.length - 1
  for (let i = 1; i < end; i++) {
    const d = distToSegment(points[i], points[0].x, points[0].y, points[end].x, points[end].y)
    if (d > maxD) {
      maxD = d
      index = i
    }
  }
  if (maxD > epsilon) {
    const left = douglasPeucker(points.slice(0, index + 1), epsilon)
    const right = douglasPeucker(points.slice(index), epsilon)
    return left.slice(0, -1).concat(right)
  }
  return [points[0], points[end]]
}

function mergeClose(points: Point[], minLen: number): Point[] {
  if (points.length === 0) return []
  const out: Point[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    if (dist(out[out.length - 1], points[i]) >= minLen) out.push(points[i])
  }
  if (out.length === 1 && points.length > 1) out.push(points[points.length - 1])
  return out
}

/**
 * Simplify a freehand stroke and straighten segments that are nearly
 * horizontal, vertical, or diagonal.
 */
export function straightenFreehand(points: Point[], epsilon: number): Point[] {
  if (points.length < 2) return points.slice()
  const simple = douglasPeucker(points, epsilon)
  const merged = mergeClose(simple, epsilon * 0.85)
  if (merged.length < 2) return merged
  const out: Point[] = [merged[0]]
  for (let i = 1; i < merged.length; i++) {
    out.push(snapAngle(out[out.length - 1], merged[i], 14))
  }
  return mergeClose(out, epsilon * 0.6)
}
