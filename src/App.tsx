import { useEffect, useRef } from 'react'
import { Header } from './components/Header'
import { SidePanel } from './components/SidePanel'
import { StageView, type StageHandle } from './components/StageView'
import { ToolRail } from './components/ToolRail'
import { translate, type MessageKey } from './i18n'
import { fileToPlan } from './lib/planFile'
import { parseProject } from './lib/project'
import { loadLastProject, saveProject } from './lib/storage'
import type { Tool } from './model/types'
import { useEditor } from './store/editor'

const TOOL_KEYS: Record<string, Tool> = {
  KeyV: 'select',
  KeyH: 'pan',
  KeyS: 'scale',
  KeyL: 'wall',
  KeyR: 'room',
  KeyP: 'pencil',
  KeyA: 'ap',
  KeyC: 'client',
}

function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
}

export function App({ embed }: { embed: boolean }) {
  const stageRef = useRef<StageHandle>(null)
  const planRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const jsonRef = useRef<HTMLInputElement>(null)
  const toast = useEditor((state) => state.toast)
  const setToast = useEditor((state) => state.setToast)
  const hydrated = useEditor((state) => state.hydrated)
  const lang = useEditor((state) => state.lang)

  useEffect(() => {
    let cancel = false
    void (async () => {
      try {
        const params = new URLSearchParams(window.location.search)
        const code = params.get('link')
        if (code) {
          const response = await fetch(`/api/short-links?code=${encodeURIComponent(code)}`)
          if (response.ok && !cancel && !useEditor.getState().touched) {
            const body: unknown = await response.json()
            const project = parseProject(body)
            if (project) useEditor.getState().replaceProject(project)
          } else if (!cancel && !response.ok) {
            useEditor.getState().setToast(response.status === 501 ? 'short' : 'share-fail')
          }
        }
        const saved = await loadLastProject()
        if (!cancel && saved && !useEditor.getState().touched) {
          useEditor.getState().replaceProject(saved)
          useEditor.setState({ touched: false })
        }
      } catch {
        // storage can be unavailable; the editor still works in memory
      } finally {
        if (!cancel) useEditor.getState().markHydrated()
      }
    })()
    return () => {
      cancel = true
    }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    let timer = 0
    const unsubscribe = useEditor.subscribe((state, previous) => {
      if (state.project === previous.project) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        void saveProject(useEditor.getState().project).catch(() => undefined)
      }, 450)
    })
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
    }
  }, [hydrated])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3400)
    return () => window.clearTimeout(timer)
  }, [toast, setToast])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (typingTarget(event.target)) return
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
        event.preventDefault()
        if (event.shiftKey) useEditor.getState().redo()
        else useEditor.getState().undo()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') {
        event.preventDefault()
        useEditor.getState().redo()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        useEditor.getState().deleteSelection()
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const tool = TOOL_KEYS[event.code]
      if (tool) useEditor.getState().setTool(tool)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const loadPlan = async (file: File | undefined) => {
    if (!file) return
    try {
      const plan = await fileToPlan(file)
      useEditor.getState().setFloorPlan(plan)
      useEditor.getState().setToast('plan')
    } catch {
      const pdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      useEditor.getState().setToast(pdf ? 'pdf' : 'image')
    }
  }

  const openJson = async (file: File | undefined) => {
    if (!file) return
    try {
      const project = parseProject(JSON.parse(await file.text()))
      if (!project) {
        useEditor.getState().setToast('json')
        return
      }
      useEditor.getState().replaceProject(project)
    } catch {
      useEditor.getState().setToast('json')
    }
  }

  const saveJson = () => {
    const project = useEditor.getState().project
    const blob = new Blob([JSON.stringify(project)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${project.name || 'wifiplan'}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const share = async () => {
    try {
      const response = await fetch('/api/short-links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(useEditor.getState().project),
      })
      if (response.status === 501 || response.status === 404) {
        setToast('short')
        return
      }
      if (!response.ok) throw new Error('share')
      const body = (await response.json()) as { url?: string }
      if (body.url) {
        await navigator.clipboard.writeText(body.url)
        setToast('copied')
      }
    } catch {
      setToast('share-fail')
    }
  }

  const toastText = toastMessage(toast, lang)

  return (
    <div className={embed ? 'app is-embed' : 'app'}>
      <Header
        embed={embed}
        onUpload={() => planRef.current?.click()}
        onCamera={() => cameraRef.current?.click()}
        onOpenJson={() => jsonRef.current?.click()}
        onSaveJson={saveJson}
        onExportPng={() => stageRef.current?.exportPng()}
        onShare={() => void share()}
      />
      <ToolRail />
      <StageView ref={stageRef} />
      <SidePanel />
      <input ref={planRef} data-testid="plan-file" className="sr-only" type="file" accept="image/*,application/pdf" aria-label={translate(lang, 'a11y.planFile')} onChange={(event) => void loadPlan(event.target.files?.[0])} />
      <input ref={cameraRef} data-testid="camera-file" className="sr-only" type="file" accept="image/*" capture="environment" aria-label={translate(lang, 'a11y.cameraFile')} onChange={(event) => void loadPlan(event.target.files?.[0])} />
      <input ref={jsonRef} data-testid="json-file" className="sr-only" type="file" accept="application/json" aria-label={translate(lang, 'a11y.jsonFile')} onChange={(event) => void openJson(event.target.files?.[0])} />
      {toastText && <div className="toast" role="status">{toastText}</div>}
    </div>
  )
}

function toastMessage(code: string | null, lang: 'ru' | 'en'): string | null {
  if (!code) return null
  const map: Record<string, MessageKey> = {
    plan: 'toast.plan',
    pdf: 'toast.pdf',
    image: 'toast.image',
    json: 'toast.json',
    short: 'toast.shareOff',
    copied: 'toast.shareOn',
    'share-fail': 'toast.shareFail',
  }
  const key = map[code]
  return key ? translate(lang, key) : null
}
