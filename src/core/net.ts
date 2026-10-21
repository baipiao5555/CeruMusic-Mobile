import { Capacitor, CapacitorHttp } from '@capacitor/core'

export interface HttpRequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  /** Only string bodies are supported by the native bridge. */
  body?: string
  responseType?: 'json' | 'text'
}

export interface HttpResponse {
  status: number
  data: any
}

/**
 * Native requests go through CapacitorHttp so they are not subject to WebView
 * CORS rules and can talk to the Logto token endpoint directly.
 */
export async function httpRequest(options: HttpRequestOptions): Promise<HttpResponse> {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.request({
      url: options.url,
      method: options.method ?? 'GET',
      headers: options.headers,
      data: options.body,
      responseType: options.responseType ?? 'json',
      connectTimeout: 30_000,
      readTimeout: 30_000
    })
    let data = response.data
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch {}
    }
    return { status: response.status, data }
  }

  const response = await fetch(options.url, {
    method: options.method ?? 'GET',
    headers: options.headers,
    body: options.body
  })
  const text = await response.text()
  let data: any = text
  try {
    data = JSON.parse(text)
  } catch {}
  return { status: response.status, data }
}

export function errorMessage(data: any, fallback: string): string {
  if (!data) return fallback
  if (typeof data === 'string') return data || fallback
  const message = data.message ?? data.error_description ?? data.error ?? data.msg
  if (Array.isArray(message)) return message.join('；')
  if (typeof message === 'string' && message) return message
  try {
    return JSON.stringify(data).slice(0, 200)
  } catch {
    return fallback
  }
}
