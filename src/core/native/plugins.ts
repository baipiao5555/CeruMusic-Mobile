import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export interface DownloadProgressEvent {
  id: string
  received: number
  /** -1 when the server does not send Content-Length. */
  total: number
}

interface DownloadResult {
  id: string
  path: string
  fileName: string
  size: number
  location?: string
}

export interface DownloaderPlugin {
  download(options: {
    id: string
    url: string
    fileName: string
    headers?: Record<string, string>
  }): Promise<DownloadResult>
  cancel(options: { id: string }): Promise<void>
  delete(options: { fileName: string; path?: string }): Promise<void>
  stat(options: { path: string }): Promise<{ size: number }>
  downloadUpdate(options: { id: string; url: string; fileName: string; headers?: Record<string, string> }): Promise<DownloadResult>
  deleteUpdate(options: { path: string }): Promise<void>
  exportLegacy(options: { path: string; fileName: string }): Promise<DownloadResult>
  addListener(
    event: 'progress',
    listener: (event: DownloadProgressEvent) => void
  ): Promise<PluginListenerHandle>
}

export interface ExternalPlugin {
  open(options: { url: string }): Promise<void>
  openAuth(options: { url: string }): Promise<{ url?: string; cancelled?: boolean }>
  installApk(options: { fileName?: string; path?: string }): Promise<{ needsPermission?: boolean; started?: boolean }>
  notifyUpdate(options: { title: string; body: string }): Promise<void>
}

export const Downloader = registerPlugin<DownloaderPlugin>('Downloader')
export const External = registerPlugin<ExternalPlugin>('External')
