import { registerSW } from 'virtual:pwa-register'
import { persistCurrentProject } from './lib/openSample'
import { useEditor } from './store/editor'

/** Take an updated worker without discarding a sample that has not been stored yet. */
export function registerAppServiceWorker(): void {
  registerSW({
    immediate: true,
    onNeedReload() {
      if (!useEditor.getState().touched) {
        window.location.reload()
        return
      }
      void persistCurrentProject().then(() => window.location.reload())
    },
  })
}
