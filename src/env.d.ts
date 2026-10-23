/// <reference types="vite/client" />

declare const __APP_VERSION__: string
declare const __DEBUG_LOGS__: boolean

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface Window {
  Capacitor?: {
    isNativePlatform?: () => boolean
    getPlatform?: () => string
  }
}
