import { readProject, type ReadProject } from './project'
import type { Project } from '../model/types'

const HASH_PREFIX = 'wifiplan='
const MAX_HASH = 12000

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64ToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded + '='.repeat((4 - (padded.length % 4)) % 4)
  const binary = atob(pad)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function projectToHash(project: Project): Promise<string | null> {
  const json = JSON.stringify(project)
  if (typeof CompressionStream === 'undefined') return null
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  const hash = HASH_PREFIX + bytesToBase64(bytes)
  return hash.length <= MAX_HASH ? hash : null
}

export async function projectFromHash(hash: string): Promise<ReadProject | null> {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw.startsWith(HASH_PREFIX)) return null
  try {
    const bytes = base64ToBytes(raw.slice(HASH_PREFIX.length))
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream('gzip'))
    const text = await new Response(stream).text()
    const read = readProject(JSON.parse(text) as unknown)
    return read.project ? read : null
  } catch {
    return null
  }
}

/** Opens the planner without noopener so the new tab can receive the project. */
export function openPlannerWindow(project: Project): void {
  const url = new URL(window.location.href)
  url.searchParams.delete('embed')
  url.hash = ''
  const child = window.open(url.toString(), '_blank')
  if (!child) return
  const payload = { type: 'wifiplan:project', project }
  const send = () => {
    if (child.closed) return
    child.postMessage(payload, window.location.origin)
  }
  send()
  const timer = window.setInterval(() => {
    if (child.closed) {
      window.clearInterval(timer)
      return
    }
    send()
  }, 200)
  window.setTimeout(() => window.clearInterval(timer), 4000)
  void projectToHash(project).then((hash) => {
    if (!hash || child.closed) return
    try {
      const next = new URL(child.location.href)
      next.hash = hash
      child.location.replace(next.toString())
    } catch {
      // The new document may not be readable yet; postMessage still carries the plan.
    }
  })
}

/** Hash or a same-origin message from window.opener wins over IndexedDB. */
export async function receiveProjectHandoff(aborted: () => boolean): Promise<ReadProject | null> {
  if (aborted()) return null
  const fromHash = await projectFromHash(window.location.hash)
  if (aborted()) return null
  if (fromHash?.project) return fromHash
  if (!window.opener) return null
  return new Promise((resolve) => {
    const stop = (value: ReadProject | null) => {
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      resolve(value)
    }
    const timer = window.setTimeout(() => stop(null), 4000)
    const onMessage = (event: MessageEvent) => {
      if (aborted()) {
        stop(null)
        return
      }
      if (event.origin !== window.location.origin) return
      if (event.source !== window.opener) return
      const data = event.data as { type?: string; project?: unknown } | null
      if (!data || data.type !== 'wifiplan:project') return
      const read = readProject(data.project)
      if (!read.project) return
      stop(read)
    }
    window.addEventListener('message', onMessage)
  })
}
