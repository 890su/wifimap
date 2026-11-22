import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva'
import type Konva from 'konva'
import { useHeatmap } from '../hooks/useHeatmap'
import { uid } from '../lib/ids'
import { fmtNum } from '../lib/format'
import { buildSampleProject } from '../lib/sampleProject'
import { getMaterial } from '../model/materials'
import {
  dist,
  effectiveScale,
  hitsWall,
  nearestEndpoint,
  snapAngle,
  snapGrid,
  straightenFreehand,
  type Point,
} from '../model'
import { AP_PRESETS, CLIENT_PRESETS } from '../model/presets'
import type { Tool } from '../model/types'
import { useEditor, useT } from '../store/editor'
import { Modal } from './ui/modal'
import { Button } from './ui/button'

interface View {
  x: number
  y: number
  scale: number
}

type Draft =
  | { kind: 'wall' | 'scale'; a: Point; b: Point }
  | { kind: 'room'; a: Point; b: Point }
  | { kind: 'pencil'; points: Point[] }

interface Gesture {
  kind: 'pan' | 'move' | 'room' | 'pencil'
  pointerId: number
  lastX: number
  lastY: number
  lastWorld: Point
  originWorld: Point
  pushed: boolean
  selection: { type: 'wall' | 'ap' | 'client'; id: string } | null
}

export interface StageHandle {
  exportPng: () => void
  fit: () => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function rectPoints(a: Point, b: Point): number[] {
  const x1 = Math.min(a.x, b.x)
  const x2 = Math.max(a.x, b.x)
  const y1 = Math.min(a.y, b.y)
  const y2 = Math.max(a.y, b.y)
  return [x1, y1, x2, y1, x2, y2, x1, y2]
}

export const StageView = forwardRef<StageHandle>(function StageView(_props, ref) {
  const project = useEditor((state) => state.project)
  const tool = useEditor((state) => state.tool)
  const selection = useEditor((state) => state.selection)
  const materialId = useEditor((state) => state.materialId)
  const band = useEditor((state) => state.band)
  const opacity = useEditor((state) => state.heatmapOpacity)
  const apPreset = useEditor((state) => state.apPreset)
  const clientPreset = useEditor((state) => state.clientPreset)
  const t = useT()
  const heat = useHeatmap(project, band)

  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const heatNode = useRef<Konva.Image>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [view, setView] = useState<View>({ x: 24, y: 24, scale: 1 })
  const viewRef = useRef(view)
  viewRef.current = view
  const [draft, setDraft] = useState<Draft | null>(null)
  const [floorImage, setFloorImage] = useState<HTMLImageElement | null>(null)
  const [scaleAsk, setScaleAsk] = useState<{ a: Point; b: Point } | null>(null)
  const [scaleLength, setScaleLength] = useState('')
  const fitted = useRef<string | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef<{ dist: number; view: View; midX: number; midY: number } | null>(null)
  const space = useRef(false)
  const altRef = useRef(false)
  const toolRef = useRef<Tool>(tool)
  toolRef.current = tool
  const downRef = useRef<{ x: number; y: number; world: Point } | null>(null)

  const { metersPerPixel, approximate } = effectiveScale(project.scale)
  const pxPerMeter = Math.round(1 / metersPerPixel)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      setSize({ w: element.clientWidth, h: Math.max(1, element.clientHeight) })
    })
    observer.observe(element)
    setSize({ w: element.clientWidth, h: Math.max(1, element.clientHeight) })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!project.floorPlan) {
      setFloorImage(null)
      return
    }
    const image = new window.Image()
    image.onload = () => setFloorImage(image)
    image.src = project.floorPlan.dataUrl
  }, [project.floorPlan])

  const fitNow = (width = size.w, height = size.h) => {
    const pad = 28
    const next = Math.min((width - pad * 2) / project.world.width, (height - pad * 2) / project.world.height)
    const scale = clamp(next, 0.08, 6)
    const updated = {
      scale,
      x: (width - project.world.width * scale) / 2,
      y: (height - project.world.height * scale) / 2,
    }
    viewRef.current = updated
    setView(updated)
  }

  useEffect(() => {
    if (size.w < 40 || size.h < 40) return
    const key = `${project.id}:${project.floorPlan?.width ?? 0}:${project.world.width}`
    if (fitted.current === key) return
    fitted.current = key
    fitNow(size.w, size.h)
    // fit once per plan, not on every pan
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, project.id, project.floorPlan?.width, project.world.width, project.world.height])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const current = viewRef.current
      const next = clamp(current.scale * (event.deltaY < 0 ? 1.08 : 1 / 1.08), 0.08, 8)
      const rect = element.getBoundingClientRect()
      const cx = event.clientX - rect.left
      const cy = event.clientY - rect.top
      const wx = (cx - current.x) / current.scale
      const wy = (cy - current.y) / current.scale
      const updated = { scale: next, x: cx - wx * next, y: cy - wy * next }
      viewRef.current = updated
      setView(updated)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    setDraft(null)
  }, [tool])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Space') space.current = event.type === 'keydown'
      if (event.key === 'Alt') altRef.current = event.type === 'keydown'
      if (event.code === 'Escape') setDraft(null)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [])

  useEffect(() => {
    const node = heatNode.current
    if (!node) return
    const image = node.image()
    node.image(undefined)
    if (image) node.image(image)
    node.getLayer()?.batchDraw()
  }, [heat.epoch, heat.canvas])

  useImperativeHandle(ref, () => ({
    fit: () => {
      fitted.current = null
      fitNow()
    },
    exportPng: () => {
      const stage = stageRef.current
      if (!stage) return
      const previous = { x: stage.x(), y: stage.y(), sx: stage.scaleX(), sy: stage.scaleY() }
      const pad = 20
      const next = clamp(
        Math.min((size.w - pad * 2) / project.world.width, (size.h - pad * 2) / project.world.height),
        0.08,
        6,
      )
      stage.scale({ x: next, y: next })
      stage.position({ x: (size.w - project.world.width * next) / 2, y: (size.h - project.world.height * next) / 2 })
      stage.draw()
      const url = stage.toDataURL({ pixelRatio: 2, mimeType: 'image/png' })
      stage.scale({ x: previous.sx, y: previous.sy })
      stage.position({ x: previous.x, y: previous.y })
      stage.draw()
      const link = document.createElement('a')
      link.href = url
      link.download = `${useEditor.getState().project.name || 'wifiplan'}.png`
      link.click()
    },
  }))

  const toWorld = (clientX: number, clientY: number): Point => {
    const rect = containerRef.current?.getBoundingClientRect()
    const current = viewRef.current
    return {
      x: (clientX - (rect?.left ?? 0) - current.x) / current.scale,
      y: (clientY - (rect?.top ?? 0) - current.y) / current.scale,
    }
  }

  const snap = (point: Point, origin?: Point): Point => {
    if (altRef.current || !useEditor.getState().snapEnabled) return point
    const tolerance = 14 / viewRef.current.scale
    const endpoint = nearestEndpoint(point, project.walls, tolerance)
    if (endpoint) return endpoint
    if (toolRef.current === 'scale') return point
    const grid = approximate ? 20 : Math.max(4, 0.5 / metersPerPixel)
    const gridded = snapGrid(point, grid)
    return origin ? snapAngle(origin, gridded, 11) : gridded
  }

  const commitWall = (points: number[], closed = false) => {
    if (points.length < 4) return
    useEditor.getState().addWall({ id: uid(), points, materialId, closed })
  }

  const placeAp = (point: Point) => {
    const params = AP_PRESETS[apPreset]
    const count = project.aps.filter((ap) => ap.preset === apPreset).length + 1
    useEditor.getState().addAp({
      id: uid(),
      x: point.x,
      y: point.y,
      name: `${t(`preset.ap.${apPreset}`)} ${count}`,
      preset: apPreset,
      wifiGen: params.wifiGen,
      mimo: params.mimo,
      backhaul: params.backhaul,
      band24: { ...params.band24 },
      band5: { ...params.band5 },
    })
  }

  const placeClient = (point: Point) => {
    const params = CLIENT_PRESETS[clientPreset]
    const count = project.clients.filter((client) => client.preset === clientPreset).length + 1
    useEditor.getState().addClient({
      id: uid(),
      x: point.x,
      y: point.y,
      name: `${t(`preset.client.${clientPreset}`)} ${count}`,
      preset: clientPreset,
      ...params,
    })
  }

  const askScale = (a: Point, b: Point) => {
    if (dist(a, b) < 8) {
      useEditor.getState().setToast(t('scale.short'))
      return
    }
    setScaleLength('')
    setScaleAsk({ a, b })
  }

  const hit = (point: Point) => {
    const tolerance = 16 / viewRef.current.scale
    for (let i = project.aps.length - 1; i >= 0; i--) {
      const ap = project.aps[i]
      if (dist(point, ap) <= tolerance) return { type: 'ap' as const, id: ap.id }
    }
    for (let i = project.clients.length - 1; i >= 0; i--) {
      const client = project.clients[i]
      if (dist(point, client) <= tolerance) return { type: 'client' as const, id: client.id }
    }
    for (let i = project.walls.length - 1; i >= 0; i--) {
      const wall = project.walls[i]
      if (hitsWall(point, wall, tolerance * 0.7)) return { type: 'wall' as const, id: wall.id }
    }
    return null
  }

  const fromChrome = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target
    return target instanceof Element && Boolean(target.closest('[data-overlay], [role="dialog"]'))
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    if (fromChrome(event)) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size >= 2) {
      const pts = [...pointers.current.values()]
      pinch.current = {
        dist: Math.max(1, dist(pts[0], pts[1])),
        view: viewRef.current,
        midX: (pts[0].x + pts[1].x) / 2,
        midY: (pts[0].y + pts[1].y) / 2,
      }
      gesture.current = null
      return
    }
    const world = toWorld(event.clientX, event.clientY)
    downRef.current = { x: event.clientX, y: event.clientY, world }
    const currentTool = space.current ? 'pan' : toolRef.current
    if (currentTool === 'pan' || currentTool === 'select') {
      const found = currentTool === 'select' ? hit(world) : null
      if (currentTool === 'select') useEditor.getState().select(found)
      gesture.current = {
        kind: found ? 'move' : 'pan',
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
        lastWorld: world,
        originWorld: world,
        pushed: false,
        selection: found,
      }
      return
    }
    if (currentTool === 'room') {
      const point = snap(world)
      setDraft({ kind: 'room', a: point, b: point })
      gesture.current = {
        kind: 'room',
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
        lastWorld: point,
        originWorld: point,
        pushed: false,
        selection: null,
      }
      return
    }
    if (currentTool === 'pencil') {
      setDraft({ kind: 'pencil', points: [world] })
      gesture.current = {
        kind: 'pencil',
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
        lastWorld: world,
        originWorld: world,
        pushed: false,
        selection: null,
      }
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (fromChrome(event)) return
    if (pointers.current.has(event.pointerId)) {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }
    if (pinch.current && pointers.current.size >= 2) {
      const pts = [...pointers.current.values()]
      const rect = containerRef.current?.getBoundingClientRect()
      const distance = Math.max(1, dist(pts[0], pts[1]))
      const midX = (pts[0].x + pts[1].x) / 2
      const midY = (pts[0].y + pts[1].y) / 2
      const next = clamp(pinch.current.view.scale * (distance / pinch.current.dist), 0.08, 8)
      const wx = (pinch.current.midX - (rect?.left ?? 0) - pinch.current.view.x) / pinch.current.view.scale
      const wy = (pinch.current.midY - (rect?.top ?? 0) - pinch.current.view.y) / pinch.current.view.scale
      const updated = { scale: next, x: midX - (rect?.left ?? 0) - wx * next, y: midY - (rect?.top ?? 0) - wy * next }
      viewRef.current = updated
      setView(updated)
      return
    }
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) {
      if (draft && (draft.kind === 'wall' || draft.kind === 'scale')) {
        setDraft({ ...draft, b: snap(toWorld(event.clientX, event.clientY), draft.a) })
      }
      return
    }
    if (active.kind === 'pan') {
      const dx = event.clientX - active.lastX
      const dy = event.clientY - active.lastY
      active.lastX = event.clientX
      active.lastY = event.clientY
      const updated = { ...viewRef.current, x: viewRef.current.x + dx, y: viewRef.current.y + dy }
      viewRef.current = updated
      setView(updated)
      return
    }
    if (active.kind === 'move' && active.selection) {
      const world = toWorld(event.clientX, event.clientY)
      const moved = dist({ x: event.clientX, y: event.clientY }, { x: active.lastX, y: active.lastY })
      if (!active.pushed && (moved > 2 || dist(world, active.originWorld) > 2)) {
        useEditor.getState().pushHistory()
        active.pushed = true
      }
      if (active.pushed) useEditor.getState().translate(active.selection, world.x - active.lastWorld.x, world.y - active.lastWorld.y)
      active.lastWorld = world
      active.lastX = event.clientX
      active.lastY = event.clientY
      return
    }
    if (active.kind === 'room' && draft?.kind === 'room') {
      setDraft({ kind: 'room', a: draft.a, b: snap(toWorld(event.clientX, event.clientY)) })
      return
    }
    if (active.kind === 'pencil' && draft?.kind === 'pencil') {
      const world = toWorld(event.clientX, event.clientY)
      const last = draft.points[draft.points.length - 1]
      if (dist(world, last) >= 3 / viewRef.current.scale) setDraft({ kind: 'pencil', points: [...draft.points, world] })
    }
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (fromChrome(event)) return
    const wasPinch = pinch.current !== null || pointers.current.size >= 2
    const down = downRef.current
    pointers.current.delete(event.pointerId)
    downRef.current = null
    if (pointers.current.size < 2) pinch.current = null
    const active = gesture.current
    gesture.current = null
    if (wasPinch) return
    if (active?.kind === 'room' && draft?.kind === 'room') {
      const points = rectPoints(draft.a, draft.b)
      if (points[2] - points[0] > 8 && points[5] - points[1] > 8) commitWall(points, true)
      setDraft(null)
      return
    }
    if (active?.kind === 'pencil' && draft?.kind === 'pencil') {
      const simplified = straightenFreehand(draft.points, 12 / viewRef.current.scale)
      const tolerance = 14 / viewRef.current.scale
      const snapped = simplified.map((point, index) => {
        if (altRef.current || !useEditor.getState().snapEnabled) return point
        const endpoint = nearestEndpoint(point, project.walls, tolerance)
        if (endpoint) return endpoint
        if (index === 0 || index === simplified.length - 1) return snapGrid(point, approximate ? 20 : Math.max(4, 0.5 / metersPerPixel))
        return point
      })
      let closed = false
      if (snapped.length > 3 && dist(snapped[0], snapped[snapped.length - 1]) <= tolerance) {
        snapped.pop()
        closed = true
      }
      commitWall(snapped.flatMap((point) => [point.x, point.y]), closed)
      setDraft(null)
      return
    }
    if (active) return
    const currentTool = toolRef.current
    if (currentTool !== 'wall' && currentTool !== 'scale' && currentTool !== 'ap' && currentTool !== 'client') return
    const moved = down ? Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6 : false
    const origin = draft && (draft.kind === 'wall' || draft.kind === 'scale') ? draft.a : undefined
    const world = snap(toWorld(event.clientX, event.clientY), origin)
    if (currentTool === 'ap') {
      placeAp(world)
      return
    }
    if (currentTool === 'client') {
      placeClient(world)
      return
    }
    if (draft && (draft.kind === 'wall' || draft.kind === 'scale')) {
      if (dist(draft.a, world) < 4) {
        if (draft.kind === 'wall') setDraft(null)
        return
      }
      if (draft.kind === 'wall') {
        commitWall([draft.a.x, draft.a.y, world.x, world.y])
        setDraft({ kind: 'wall', a: world, b: world })
      } else {
        askScale(draft.a, world)
        setDraft(null)
      }
      return
    }
    if ((currentTool === 'wall' || currentTool === 'scale') && moved && down) {
      const start = snap(down.world)
      const end = snap(world, start)
      if (dist(start, end) < 4) return
      if (currentTool === 'wall') {
        commitWall([start.x, start.y, end.x, end.y])
        setDraft({ kind: 'wall', a: end, b: end })
      } else askScale(start, end)
      return
    }
    if (currentTool === 'wall' || currentTool === 'scale') setDraft({ kind: currentTool, a: world, b: world })
  }

  const gridStep = (() => {
    let step = approximate ? 40 : 1 / metersPerPixel
    while (project.world.width / step > 36) step *= 2
    return step
  })()
  const stroke = 1 / view.scale
  const empty = !project.floorPlan && project.walls.length === 0 && project.aps.length === 0 && project.clients.length === 0

  return (
    <div
      className="stage-wrap"
      data-testid="stage"
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <Stage ref={stageRef} width={size.w} height={size.h} x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale} listening={false}>
        <Layer>
          <Rect
            x={0}
            y={0}
            width={project.world.width}
            height={project.world.height}
            fill="#e7e1d4"
            shadowColor="rgba(0,0,0,0.45)"
            shadowBlur={28}
            shadowOffsetY={10}
            listening={false}
          />
          {Array.from({ length: Math.floor(project.world.width / gridStep) + 1 }, (_, index) => (
            <Line
              key={`v${index}`}
              points={[index * gridStep, 0, index * gridStep, project.world.height]}
              stroke={index % 4 === 0 ? 'rgba(55,48,38,0.16)' : 'rgba(55,48,38,0.07)'}
              strokeWidth={stroke}
              listening={false}
            />
          ))}
          {Array.from({ length: Math.floor(project.world.height / gridStep) + 1 }, (_, index) => (
            <Line
              key={`h${index}`}
              points={[0, index * gridStep, project.world.width, index * gridStep]}
              stroke={index % 4 === 0 ? 'rgba(55,48,38,0.16)' : 'rgba(55,48,38,0.07)'}
              strokeWidth={stroke}
              listening={false}
            />
          ))}
          {floorImage && <KonvaImage image={floorImage} width={project.world.width} height={project.world.height} listening={false} />}
          {heat.canvas && (
            <KonvaImage
              ref={heatNode}
              image={heat.canvas}
              x={heat.placement.x}
              y={heat.placement.y}
              width={heat.placement.w}
              height={heat.placement.h}
              opacity={opacity}
              listening={false}
            />
          )}
          {project.walls.map((wall) => {
            const color = getMaterial(wall.materialId).color
            const selected = selection?.type === 'wall' && selection.id === wall.id
            return (
              <Group key={wall.id} listening={false}>
                {wall.closed && <Line points={wall.points} closed fill={color} opacity={0.14} listening={false} />}
                <Line
                  points={wall.points}
                  closed={wall.closed}
                  stroke={selected ? '#f0b429' : color}
                  strokeWidth={(selected ? 5 : 3.2) / view.scale}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
              </Group>
            )
          })}
          {draft?.kind === 'room' && (
            <Line points={rectPoints(draft.a, draft.b)} closed stroke="#f0b429" strokeWidth={2.5 / view.scale} dash={[8 / view.scale, 6 / view.scale]} listening={false} />
          )}
          {draft?.kind === 'pencil' && (
            <Line points={draft.points.flatMap((point) => [point.x, point.y])} stroke="#f0b429" strokeWidth={2.5 / view.scale} lineCap="round" listening={false} />
          )}
          {draft && (draft.kind === 'wall' || draft.kind === 'scale') && (
            <Group listening={false}>
              <Line points={[draft.a.x, draft.a.y, draft.b.x, draft.b.y]} stroke="#f0b429" strokeWidth={2.5 / view.scale} dash={[8 / view.scale, 6 / view.scale]} />
              <Circle x={draft.a.x} y={draft.a.y} radius={5 / view.scale} fill="#f0b429" />
              <Circle x={draft.b.x} y={draft.b.y} radius={5 / view.scale} fill="#f0b429" />
            </Group>
          )}
          {project.aps.map((ap) => {
            const selected = selection?.type === 'ap' && selection.id === ap.id
            const radius = 13 / view.scale
            return (
              <Group key={ap.id} x={ap.x} y={ap.y} listening={false}>
                <Circle radius={radius} fill="#1b1712" stroke={selected ? '#fff6df' : '#f0b429'} strokeWidth={2 / view.scale} />
                <Circle radius={radius * 0.28} fill="#f0b429" />
                <Text
                  text={ap.name}
                  y={radius + 3 / view.scale}
                  width={140 / view.scale}
                  offsetX={70 / view.scale}
                  align="center"
                  fontSize={12 / view.scale}
                  fontFamily="Manrope, sans-serif"
                  fill="#1c1915"
                  stroke="#f6f1e6"
                  strokeWidth={3 / view.scale}
                  fillAfterStrokeEnabled
                />
              </Group>
            )
          })}
          {project.clients.map((client) => {
            const selected = selection?.type === 'client' && selection.id === client.id
            const radius = 12 / view.scale
            return (
              <Group key={client.id} x={client.x} y={client.y} listening={false}>
                <Circle radius={radius} fill="#10233f" stroke={selected ? '#fff6df' : '#7eb6ff'} strokeWidth={2 / view.scale} />
                <Text
                  text={t(`mark.${client.preset}`)}
                  width={radius * 2}
                  offsetX={radius}
                  offsetY={(6 / view.scale)}
                  align="center"
                  fontSize={10 / view.scale}
                  fontStyle="700"
                  fontFamily="Manrope, sans-serif"
                  fill="#d7e8ff"
                />
                <Text
                  text={client.name}
                  y={radius + 2 / view.scale}
                  width={130 / view.scale}
                  offsetX={65 / view.scale}
                  align="center"
                  fontSize={12 / view.scale}
                  fontFamily="Manrope, sans-serif"
                  fill="#1c1915"
                  stroke="#f6f1e6"
                  strokeWidth={3 / view.scale}
                  fillAfterStrokeEnabled
                />
              </Group>
            )
          })}
          <Group x={16} y={16} listening={false}>
            <Rect width={210} height={36} fill="rgba(255,250,242,0.92)" cornerRadius={6} />
            {['#c4302a', '#e07a32', '#e0b030', '#9bb83a', '#2fbe9a'].map((color, index) => (
              <Rect key={color} x={8 + index * 28} y={6} width={26} height={10} fill={color} />
            ))}
            <Text x={8} y={18} text="−82   −75   −67   −55 дБм" fontSize={10} fontFamily="Manrope, sans-serif" fill="#2c261f" />
            <Text x={148} y={4} text={band === '5' ? t('band.5') : t('band.24')} fontSize={11} fontFamily="Manrope, sans-serif" fill="#2c261f" />
          </Group>
        </Layer>
      </Stage>

      {empty && (
        <div className="empty-card">
          <p className="empty-kicker">{t('app.tagline')}</p>
          <h2>{t('empty.title')}</h2>
          <p>{t('empty.body')}</p>
          <Button
            variant="primary"
            onClick={() => useEditor.getState().replaceProject(buildSampleProject(t('project.sample')))}
          >
            {t('empty.sample')}
          </Button>
        </div>
      )}

      <div className="stage-status" data-overlay>
        <span data-testid="status-scale" data-approximate={approximate ? 'yes' : 'no'}>
          {approximate ? t('status.approx') : `1 ${t('unit.m')} = ${pxPerMeter} ${t('unit.px')}`}
        </span>
        <span>
          {t('status.walls')} <strong data-testid="status-walls">{project.walls.length}</strong>
        </span>
        <span>
          {t('status.aps')} <strong data-testid="status-aps">{project.aps.length}</strong>
        </span>
        <span>
          {t('status.clients')} <strong data-testid="status-clients">{project.clients.length}</strong>
        </span>
      </div>
      <div className="zoom-controls" data-overlay>
        <button type="button" aria-label={t('tool.zoomIn')} onClick={() => zoomAt(1.15)}>+</button>
        <button type="button" aria-label={t('tool.zoomOut')} onClick={() => zoomAt(1 / 1.15)}>−</button>
        <button type="button" aria-label={t('tool.fit')} onClick={() => fitNow()}>{t('tool.fit')}</button>
      </div>
      <span className="sr-only" data-testid="plan-loaded">{project.floorPlan ? 'yes' : 'no'}</span>

      <Modal
        open={scaleAsk !== null}
        title={t('scale.title')}
        description={t('scale.body')}
        onClose={() => setScaleAsk(null)}
        testId="scale-dialog"
      >
        <label className="field-label" htmlFor="scale-length">{t('scale.length')}</label>
        <input
          id="scale-length"
          data-testid="scale-length"
          className="field"
          inputMode="decimal"
          value={scaleLength}
          autoFocus
          onChange={(event) => setScaleLength(event.target.value.replace(',', '.'))}
        />
        <p className="field-note">
          {t('scale.pixels')}: {scaleAsk ? Math.round(dist(scaleAsk.a, scaleAsk.b)) : 0} {t('unit.px')}
          {project.scale ? ` · ${fmtNum(scaleAsk ? dist(scaleAsk.a, scaleAsk.b) * project.scale.metersPerPixel : null, 2)} ${t('unit.m')}` : ''}
        </p>
        <div className="modal-actions">
          <Button onClick={() => setScaleAsk(null)}>{t('scale.cancel')}</Button>
          <Button
            variant="primary"
            data-testid="scale-confirm"
            onClick={() => {
              const field = document.querySelector('[data-testid="scale-length"]')
              const typed = field instanceof HTMLInputElement ? field.value : scaleLength
              const meters = Number(typed.replace(',', '.'))
              if (!scaleAsk || !(meters > 0)) return
              useEditor.getState().setScale(meters / dist(scaleAsk.a, scaleAsk.b))
              setScaleAsk(null)
            }}
          >
            {t('scale.confirm')}
          </Button>
        </div>
      </Modal>
    </div>
  )

  function zoomAt(factor: number) {
    const current = viewRef.current
    const next = clamp(current.scale * factor, 0.08, 8)
    const cx = size.w / 2
    const cy = size.h / 2
    const wx = (cx - current.x) / current.scale
    const wy = (cy - current.y) / current.scale
    const updated = { scale: next, x: cx - wx * next, y: cy - wy * next }
    viewRef.current = updated
    setView(updated)
  }
})
