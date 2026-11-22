import { create } from 'zustand'
import { translate, type MessageKey } from '../i18n'
import { createEmptyProject } from '../lib/project'
import type { AccessPoint, ApPreset, ClientDevice, ClientPreset, Project, Tool, Wall } from '../model/types'

export type Selection =
  | { type: 'wall'; id: string }
  | { type: 'ap'; id: string }
  | { type: 'client'; id: string }
  | null

export type HeatStatus = 'idle' | 'computing' | 'ready' | 'error'

interface Snapshot {
  walls: Wall[]
  aps: AccessPoint[]
  clients: ClientDevice[]
  scale: Project['scale']
  isp: Project['isp']
  propagation: Project['propagation']
  floorPlan: Project['floorPlan']
  world: Project['world']
}

function cloneSnapshot(project: Project): Snapshot {
  return {
    walls: project.walls.map((wall) => ({ ...wall, points: wall.points.slice() })),
    aps: project.aps.map((ap) => ({ ...ap, band24: { ...ap.band24 }, band5: { ...ap.band5 } })),
    clients: project.clients.map((client) => ({ ...client })),
    scale: project.scale ? { ...project.scale } : null,
    isp: { ...project.isp },
    propagation: { ...project.propagation },
    floorPlan: project.floorPlan ? { ...project.floorPlan } : null,
    world: { ...project.world },
  }
}

function applySnapshot(project: Project, snapshot: Snapshot): Project {
  return { ...project, ...snapshot, updatedAt: Date.now() }
}

function readEnum<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return allowed.includes(value as T) ? (value as T) : fallback
  } catch {
    return fallback
  }
}

interface EditorState {
  project: Project
  past: Snapshot[]
  future: Snapshot[]
  tool: Tool
  selection: Selection
  materialId: string
  apPreset: ApPreset
  clientPreset: ClientPreset
  band: '2.4' | '5'
  mode: 'simple' | 'advanced'
  lang: 'ru' | 'en'
  heatmapOpacity: number
  snapEnabled: boolean
  touched: boolean
  /** Bumps on every user-driven project replacement so a late IndexedDB read cannot overwrite it. */
  epoch: number
  hydrated: boolean
  heatmapStatus: HeatStatus
  coverage67: number | null
  zones: { excellent: number; good: number; fair: number; weak: number; dead: number } | null
  renderer: 'webgl2' | 'canvas2d' | null
  toast: string | null
  setTool: (tool: Tool) => void
  setBand: (band: '2.4' | '5') => void
  setMode: (mode: 'simple' | 'advanced') => void
  setLang: (lang: 'ru' | 'en') => void
  setMaterial: (id: string) => void
  setApPreset: (preset: ApPreset) => void
  setClientPreset: (preset: ClientPreset) => void
  setOpacity: (value: number) => void
  setSnapEnabled: (value: boolean) => void
  setToast: (toast: string | null) => void
  setHeatmap: (patch: { status: HeatStatus; coverage67: number | null; renderer: 'webgl2' | 'canvas2d' | null }) => void
  setZones: (zones: EditorState['zones']) => void
  select: (selection: Selection) => void
  markHydrated: () => void
  pushHistory: () => void
  undo: () => void
  redo: () => void
  addWall: (wall: Wall) => void
  updateWall: (id: string, patch: Partial<Wall>, history?: boolean) => void
  addAp: (ap: AccessPoint) => void
  updateAp: (id: string, patch: Partial<AccessPoint>, history?: boolean) => void
  addClient: (client: ClientDevice) => void
  updateClient: (id: string, patch: Partial<ClientDevice>, history?: boolean) => void
  translate: (selection: Selection, dx: number, dy: number) => void
  deleteSelection: () => void
  setScale: (metersPerPixel: number) => void
  setIsp: (patch: Partial<Project['isp']>, history?: boolean) => void
  setPropagation: (patch: Partial<Project['propagation']>, history?: boolean) => void
  setFloorPlan: (plan: Project['floorPlan']) => void
  rename: (name: string) => void
  replaceProject: (project: Project) => void
  newProject: (name: string) => void
}

function patch(set: (partial: Partial<EditorState>) => void, get: () => EditorState, history: boolean, recipe: (project: Project) => Project) {
  if (history) get().pushHistory()
  set({ project: { ...recipe(get().project), updatedAt: Date.now() }, touched: true })
}

export const useEditor = create<EditorState>((set, get) => ({
  project: createEmptyProject('Новый план'),
  past: [],
  future: [],
  tool: 'select',
  selection: null,
  materialId: 'drywall',
  apPreset: 'wifi6',
  clientPreset: 'phone',
  band: readEnum('wifiplan:band', ['2.4', '5'] as const, '5'),
  mode: readEnum('wifiplan:mode', ['simple', 'advanced'] as const, 'simple'),
  lang: readEnum('wifiplan:lang', ['ru', 'en'] as const, 'ru'),
  heatmapOpacity: 0.62,
  snapEnabled: true,
  touched: false,
  epoch: 0,
  hydrated: false,
  heatmapStatus: 'idle',
  coverage67: null,
  zones: null,
  renderer: null,
  toast: null,
  setTool: (tool) => set({ tool }),
  setBand: (band) => {
    localStorage.setItem('wifiplan:band', band)
    set({ band })
  },
  setMode: (mode) => {
    localStorage.setItem('wifiplan:mode', mode)
    set({ mode })
  },
  setLang: (lang) => {
    localStorage.setItem('wifiplan:lang', lang)
    set({ lang })
  },
  setMaterial: (materialId) => set({ materialId }),
  setApPreset: (apPreset) => set({ apPreset }),
  setClientPreset: (clientPreset) => set({ clientPreset }),
  setOpacity: (heatmapOpacity) => set({ heatmapOpacity }),
  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
  setToast: (toast) => set({ toast }),
  setHeatmap: (next) => set({ heatmapStatus: next.status, coverage67: next.coverage67, renderer: next.renderer }),
  setZones: (zones) => set({ zones }),
  select: (selection) => set({ selection }),
  markHydrated: () => set({ hydrated: true }),
  pushHistory: () => {
    const { project, past } = get()
    set({ past: [...past, cloneSnapshot(project)].slice(-100), future: [] })
  },
  undo: () => {
    const { past, future, project } = get()
    if (past.length === 0) return
    const previous = past[past.length - 1]
    set({
      past: past.slice(0, -1),
      future: [...future, cloneSnapshot(project)],
      project: applySnapshot(project, previous),
      selection: null,
      touched: true,
    })
  },
  redo: () => {
    const { past, future, project } = get()
    if (future.length === 0) return
    const next = future[future.length - 1]
    set({
      future: future.slice(0, -1),
      past: [...past, cloneSnapshot(project)],
      project: applySnapshot(project, next),
      selection: null,
      touched: true,
    })
  },
  addWall: (wall) => {
    get().pushHistory()
    set({
      project: { ...get().project, walls: [...get().project.walls, wall], updatedAt: Date.now() },
      selection: { type: 'wall', id: wall.id },
      touched: true,
    })
  },
  updateWall: (id, next, history = true) =>
    patch(set, get, history, (project) => ({
      ...project,
      walls: project.walls.map((wall) => (wall.id === id ? { ...wall, ...next, points: next.points ?? wall.points } : wall)),
    })),
  addAp: (ap) => {
    get().pushHistory()
    set({
      project: { ...get().project, aps: [...get().project.aps, ap], updatedAt: Date.now() },
      selection: { type: 'ap', id: ap.id },
      touched: true,
    })
  },
  updateAp: (id, next, history = true) =>
    patch(set, get, history, (project) => ({
      ...project,
      aps: project.aps.map((ap) =>
        ap.id === id
          ? {
              ...ap,
              ...next,
              band24: next.band24 ? { ...next.band24 } : ap.band24,
              band5: next.band5 ? { ...next.band5 } : ap.band5,
            }
          : ap,
      ),
    })),
  addClient: (client) => {
    get().pushHistory()
    set({
      project: { ...get().project, clients: [...get().project.clients, client], updatedAt: Date.now() },
      selection: { type: 'client', id: client.id },
      touched: true,
    })
  },
  updateClient: (id, next, history = true) =>
    patch(set, get, history, (project) => ({
      ...project,
      clients: project.clients.map((client) => (client.id === id ? { ...client, ...next } : client)),
    })),
  translate: (selection, dx, dy) => {
    if (!selection) return
    set({
      touched: true,
      project: {
        ...get().project,
        updatedAt: Date.now(),
        aps:
          selection.type === 'ap'
            ? get().project.aps.map((ap) => (ap.id === selection.id ? { ...ap, x: ap.x + dx, y: ap.y + dy } : ap))
            : get().project.aps,
        clients:
          selection.type === 'client'
            ? get().project.clients.map((client) => (client.id === selection.id ? { ...client, x: client.x + dx, y: client.y + dy } : client))
            : get().project.clients,
        walls:
          selection.type === 'wall'
            ? get().project.walls.map((wall) =>
                wall.id === selection.id ? { ...wall, points: wall.points.map((value, index) => value + (index % 2 === 0 ? dx : dy)) } : wall,
              )
            : get().project.walls,
      },
    })
  },
  deleteSelection: () => {
    const selection = get().selection
    if (!selection) return
    get().pushHistory()
    const project = get().project
    set({
      selection: null,
      touched: true,
      project: {
        ...project,
        updatedAt: Date.now(),
        walls: selection.type === 'wall' ? project.walls.filter((wall) => wall.id !== selection.id) : project.walls,
        aps: selection.type === 'ap' ? project.aps.filter((ap) => ap.id !== selection.id) : project.aps,
        clients: selection.type === 'client' ? project.clients.filter((client) => client.id !== selection.id) : project.clients,
      },
    })
  },
  setScale: (metersPerPixel) =>
    patch(set, get, true, (project) => ({ ...project, scale: { metersPerPixel } })),
  setIsp: (next, history = false) => patch(set, get, history, (project) => ({ ...project, isp: { ...project.isp, ...next } })),
  setPropagation: (next, history = false) =>
    patch(set, get, history, (project) => ({ ...project, propagation: { ...project.propagation, ...next } })),
  setFloorPlan: (plan) => {
    get().pushHistory()
    const project = get().project
    set({
      touched: true,
      selection: null,
      project: {
        ...project,
        floorPlan: plan,
        world: plan ? { width: plan.width, height: plan.height } : project.world,
        scale: null,
        updatedAt: Date.now(),
      },
    })
  },
  rename: (name) => set({ project: { ...get().project, name, updatedAt: Date.now() }, touched: true }),
  replaceProject: (project) =>
    set((state) => ({ project, past: [], future: [], selection: null, touched: true, epoch: state.epoch + 1 })),
  newProject: (name) =>
    set((state) => ({
      project: createEmptyProject(name),
      past: [],
      future: [],
      selection: null,
      touched: true,
      tool: 'select',
      epoch: state.epoch + 1,
    })),
}))

export function useT(): (key: MessageKey) => string {
  const lang = useEditor((state) => state.lang)
  return (key) => translate(lang, key)
}
