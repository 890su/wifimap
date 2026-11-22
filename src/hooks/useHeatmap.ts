import { useEffect, useMemo, useRef, useState } from 'react'
import { renderRssi } from '../lib/heatmapRender'
import { computeRssiGrid, coverageFraction, coverageZones, effectiveScale } from '../model/pathloss'
import type { HeatmapGrid, HeatmapRequest, Project } from '../model/types'
import { useEditor } from '../store/editor'

export interface HeatPlacement {
  x: number
  y: number
  w: number
  h: number
}

function boundsOf(project: Project) {
  let minX = 0
  let minY = 0
  let maxX = project.world.width
  let maxY = project.world.height
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  for (const wall of project.walls) {
    for (let i = 0; i < wall.points.length; i += 2) grow(wall.points[i], wall.points[i + 1])
  }
  for (const ap of project.aps) grow(ap.x, ap.y)
  for (const client of project.clients) grow(client.x, client.y)
  const pad = 12
  return {
    originX: minX - pad,
    originY: minY - pad,
    widthPx: Math.max(32, maxX - minX + pad * 2),
    heightPx: Math.max(32, maxY - minY + pad * 2),
  }
}

let sharedWorker: Worker | null = null

function getWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL('../worker/heatmap.worker.ts', import.meta.url), { type: 'module' })
  }
  return sharedWorker
}

export function useHeatmap(project: Project, band: '2.4' | '5') {
  const setHeatmap = useEditor((state) => state.setHeatmap)
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const [placement, setPlacement] = useState<HeatPlacement>({ x: 0, y: 0, w: 1, h: 1 })
  const [epoch, setEpoch] = useState(0)
  const seq = useRef(0)

  const signature = useMemo(
    () =>
      JSON.stringify({
        walls: project.walls,
        aps: project.aps.map((ap) => ({ x: ap.x, y: ap.y, band24: ap.band24, band5: ap.band5 })),
        band,
        propagation: project.propagation,
        scale: project.scale,
        world: project.world,
      }),
    [project.walls, project.aps, project.propagation, project.scale, project.world, band],
  )

  useEffect(() => {
    const id = ++seq.current
    const currentProject = project
    if (currentProject.aps.length === 0) {
      setCanvas(null)
      setHeatmap({ status: 'idle', coverage67: null, renderer: null })
      useEditor.getState().setZones(null)
      return
    }
    const previous = useEditor.getState()
    setHeatmap({ status: 'computing', coverage67: previous.coverage67, renderer: previous.renderer })

    let worker: Worker | null = null
    let onMessage: ((event: MessageEvent) => void) | null = null
    let onError: (() => void) | null = null

    const timer = window.setTimeout(() => {
      const bounds = boundsOf(currentProject)
      const { metersPerPixel } = effectiveScale(currentProject.scale)
      const request: HeatmapRequest = {
        walls: currentProject.walls,
        aps: currentProject.aps,
        band,
        exponent: currentProject.propagation.exponent,
        autoClutter: currentProject.propagation.autoClutter,
        metersPerPixel,
        originX: bounds.originX,
        originY: bounds.originY,
        widthPx: bounds.widthPx,
        heightPx: bounds.heightPx,
        cellM: 0.25,
      }
      const apply = (grid: HeatmapGrid) => {
        if (seq.current !== id) return
        const rendered = renderRssi(grid.rssi, grid.width, grid.height)
        setCanvas(rendered.canvas)
        setPlacement({
          x: grid.originX,
          y: grid.originY,
          w: grid.width * grid.cellPx,
          h: grid.height * grid.cellPx,
        })
        setEpoch((value) => value + 1)
        setHeatmap({ status: 'ready', coverage67: coverageFraction(grid.rssi, -67), renderer: rendered.renderer })
        useEditor.getState().setZones(coverageZones(grid.rssi))
      }
      const runLocal = () => {
        try {
          apply(computeRssiGrid(request))
        } catch {
          if (seq.current === id) setHeatmap({ status: 'error', coverage67: null, renderer: null })
        }
      }
      try {
        worker = getWorker()
        onMessage = (event: MessageEvent) => {
          if (event.data?.id !== id) return
          const rssi = new Float32Array(event.data.rssi as ArrayBuffer)
          apply({
            width: event.data.width as number,
            height: event.data.height as number,
            cellPx: event.data.cellPx as number,
            originX: event.data.originX as number,
            originY: event.data.originY as number,
            rssi,
          })
        }
        onError = () => {
          sharedWorker = null
          worker = null
          runLocal()
        }
        worker.addEventListener('message', onMessage)
        worker.addEventListener('error', onError)
        worker.postMessage({ id, ...request })
      } catch {
        runLocal()
      }
    }, 70)

    return () => {
      window.clearTimeout(timer)
      if (worker && onMessage) worker.removeEventListener('message', onMessage)
      if (worker && onError) worker.removeEventListener('error', onError)
    }
  }, [signature, band, setHeatmap, project])

  return { canvas, placement, epoch }
}
