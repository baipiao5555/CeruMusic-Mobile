import { registerPlugin } from '@capacitor/core'

export interface SyncHttpResponse {
  status: number
  headers: Record<string, string>
  body: string
}

export interface SyncHttpNative {
  initialize(): Promise<void>
  authorize(options: {
    connectionId: string
    origin: string
    basePath: string
    confirmed: boolean
    allowInsecureHttp: boolean
    capability: string
  }): Promise<void>
  revoke(options: { connectionId: string; capability: string }): Promise<void>
  request(options: {
    connectionId: string
    url: string
    method: string
    body?: string
    headers: Record<string, string>
    timeoutMs: number
    capability: string
  }): Promise<SyncHttpResponse>
}

/** One JS proxy for the native SyncHttp plugin; registering twice logs a warning. */
export const nativeSyncHttp = registerPlugin<SyncHttpNative>('SyncHttp')
