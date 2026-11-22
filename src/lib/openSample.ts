import { useEditor } from '../store/editor'
import { buildSampleProject } from './sampleProject'
import { saveProject } from './storage'

let pending: Promise<void> = Promise.resolve()

/** Opens the built-in apartment and writes it before any service-worker reload can drop it. */
export function openSampleApartment(name: string): void {
  try {
    const project = buildSampleProject(name)
    useEditor.getState().replaceProject(project)
    pending = saveProject(project).then(
      () => undefined,
      () => undefined,
    )
  } catch {
    useEditor.getState().setToast('sample-fail')
  }
}

/** Finishes the in-flight sample write, then stores whatever is on screen. */
export function persistCurrentProject(): Promise<void> {
  const write = saveProject(useEditor.getState().project).then(
    () => undefined,
    () => undefined,
  )
  pending = pending.then(() => write, () => write)
  return pending
}
