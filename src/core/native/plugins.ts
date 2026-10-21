import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export interface DownloadProgressEvent {
  id: string
  received: number
  /** -1 when the server does not send Content-Length. */
  total: number
}

export interface DownloadResult {
  id: string
  path: string
  fileName: string
  size: number
}

export interface DownloaderPlugin {
  download(options: {
    id: string
    url: string
    fileName: string
    headers?: Record<string, string>
  }): Promise<DownloadResult>
  cancel(options: { id: string }): Promise<void>
  delete(options: { fileName: string }): Promise<void>
  addListener(
    event: 'progress',
    listener: (event: DownloadProgressEvent) => void
  ): Promise<PluginListenerHandle>
}

export interface ExternalPlugin {
  open(options: { url: string }): Promise<void>
  installApk(options: { fileName: string }): Promise<{ needsPermission?: boolean; started?: boolean }>
  notifyUpdate(options: { title: string; body: string }): Promise<void>
}

export const Downloader = registerPlugin<DownloaderPlugin>('Downloader')
export const External = registerPlugin<ExternalPlugin>('External')
