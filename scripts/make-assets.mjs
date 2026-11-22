import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y, width, height)
      const i = row + 1 + x * 4
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
      raw[i + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function rounded(x, y, w, h, radius) {
  const dx = x < radius ? radius - x : x > w - radius ? x - (w - radius) : 0
  const dy = y < radius ? radius - y : y > h - radius ? y - (h - radius) : 0
  return dx * dx + dy * dy <= radius * radius
}

function iconPixel(x, y, w) {
  const pad = w * 0.08
  if (!rounded(x, y, w, w, w * 0.22) || x < pad || y < pad || x > w - pad || y > w - pad) return [0, 0, 0, 0]
  const cx = w * 0.5
  const cy = w * 0.68
  const dx = x - cx
  const dy = y - cy
  const dist = Math.hypot(dx, dy)
  const ang = Math.atan2(dy, dx)
  const inArc = ang < -0.35 && ang > -Math.PI + 0.35
  const amber = [240, 180, 41, 255]
  const teal = [61, 190, 165, 255]
  if (dist < w * 0.045) return teal
  for (const radius of [0.16, 0.28, 0.4]) {
    if (inArc && Math.abs(dist - w * radius) < w * 0.028) return amber
  }
  return [28, 25, 21, 255]
}

function planPixel(x, y, w, h) {
  const paper = [239, 230, 214, 255]
  const ink = [70, 64, 56, 255]
  const room = [247, 241, 228, 255]
  const wall = (x0, y0, x1, y1, thick = 4) => {
    const dx = x1 - x0
    const dy = y1 - y0
    const len2 = dx * dx + dy * dy
    let t = ((x - x0) * dx + (y - y0) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    const px = x0 + t * dx
    const py = y0 + t * dy
    return Math.hypot(x - px, y - py) <= thick
  }
  if (x < 16 || y < 16 || x > w - 16 || y > h - 16) return paper
  if (wall(40, 40, w - 40, 40, 5) || wall(w - 40, 40, w - 40, h - 40, 5) || wall(40, h - 40, w - 40, h - 40, 5) || wall(40, 40, 40, h - 40, 5)) return ink
  if (wall(w * 0.42, 40, w * 0.42, h * 0.62, 4) || wall(40, h * 0.55, w * 0.42, h * 0.55, 4)) return ink
  if (x > 48 && x < w - 48 && y > 48 && y < h - 48) return room
  return paper
}

const root = path.resolve(import.meta.dirname, '..')
fs.mkdirSync(path.join(root, 'public/icons'), { recursive: true })
fs.mkdirSync(path.join(root, 'e2e/fixtures'), { recursive: true })
fs.writeFileSync(path.join(root, 'public/icons/icon-192.png'), png(192, 192, iconPixel))
fs.writeFileSync(path.join(root, 'public/icons/icon-512.png'), png(512, 512, iconPixel))
fs.writeFileSync(path.join(root, 'e2e/fixtures/plan.png'), png(640, 400, planPixel))
console.log('assets written')
