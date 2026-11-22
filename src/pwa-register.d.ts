declare module 'virtual:pwa-register' {
  export function registerSW(options?: {
    immediate?: boolean
    onNeedReload?: () => void
  }): (reloadPage?: boolean) => Promise<void>
}
