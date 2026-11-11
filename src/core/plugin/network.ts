import { Capacitor, registerPlugin } from '@capacitor/core'

interface SecureHttpPlugin {
  request(options: {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
    timeoutMs?: number
    responseType?: 'arraybuffer'
  }): Promise<{ status: number; headers: Record<string, string>; body: string }>
}

const SecureHttp = registerPlugin<SecureHttpPlugin>('SecureHttp')

export interface HttpRequestInput {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  /** Web fetch referrer; native callers should set the Referer header instead. */
  referrer?: string
  responseType?: 'text' | 'json' | 'arraybuffer'
  /** Skip JSON sniffing and return the response body as text. */
  raw?: boolean
  signal?: AbortSignal
}

export interface HttpResponse {
  status: number
  headers: Record<string, string>
  body: any
}

const FORBIDDEN_HEADERS = /^(host|connection|content-length|transfer-encoding|proxy-.*|upgrade)$/i
const MAX_BODY_BYTES = 16 * 1024 * 1024
const MAX_REDIRECTS = 5

function parseIPv4(host: string): number[] | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  const values: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const value = Number(part)
    if (value > 255) return null
    values.push(value)
  }
  return values
}

function isBlockedIPv4([a, b]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0)
  )
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '')
  if (!host) return true
  if (['localhost', 'local', 'internal', 'home.arpa'].some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`)
  )) return true
  // Bare numeric hosts are accepted by browsers as IPv4 integers (e.g. 2130706433).
  if (/^\d+$/.test(host)) return true
  if (/^0x[0-9a-f]+$/i.test(host)) return true
  const ipv4 = parseIPv4(host)
  if (ipv4) return isBlockedIPv4(ipv4)
  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true
    if (/^f[cd]/.test(host)) return true
    if (/^fe[89a-f]/.test(host)) return true
    if (/^ff/.test(host)) return true
    // URL canonicalizes mapped IPv4 tails to hexadecimal, including dotted input.
    const mapped = host.match(/^::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/)
    if (mapped) {
      const prefix = parseInt(mapped[1], 16)
      return isBlockedIPv4([prefix >>> 8, prefix & 255])
    }
  }
  return false
}

/** Only public HTTP(S) endpoints are reachable from plugin code. */
export function validateRemoteUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('无效的请求地址')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只支持 HTTP/HTTPS 请求')
  if (url.username || url.password) throw new Error('请求地址不能包含用户名或密码')
  if (isBlockedHost(url.hostname)) {
    throw new Error('出于安全原因，不能访问本机、回环或局域网地址')
  }
  return url
}

function sanitizeHeaders(input?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(input ?? {})) {
    if (FORBIDDEN_HEADERS.test(name)) continue
    if (typeof value !== 'string') continue
    if (/[\r\n]/.test(name) || /[\r\n]/.test(value)) throw new Error('请求头包含非法字符')
    headers[name] = value
  }
  return headers
}

function parseBody(text: string): any {
  const trimmed = text.trim()
  if (!trimmed) return text
  // Some upstream APIs return JSONP-like wrappers.
  const jsonp = trimmed.replace(/^[\w.$]+\s*\((\{[\s\S]*\})\)\s*;?$/, '$1')
  try {
    return JSON.parse(jsonp)
  } catch {
    return text
  }
}

async function nativeRequest(input: HttpRequestInput, url: URL): Promise<HttpResponse> {
  const response = await SecureHttp.request({
    url: url.href,
    method: (input.method ?? 'GET').toUpperCase(),
    headers: sanitizeHeaders(input.headers),
    body: input.body,
    timeoutMs: Math.min(60_000, Math.max(1_000, input.timeoutMs ?? 30_000)),
    responseType: input.responseType === 'arraybuffer' ? 'arraybuffer' : undefined
  })
  const body = String(response.body ?? '')
  if (body.length > (input.responseType === 'arraybuffer' ? Math.ceil(MAX_BODY_BYTES / 3) * 4 : MAX_BODY_BYTES)) {
    throw new Error('响应内容过大')
  }
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(response.headers ?? {})) {
    headers[key.toLowerCase()] = String(value)
  }
  let data: any = input.raw ? body : parseBody(body)
  if (input.responseType === 'arraybuffer') {
    const binary = atob(body)
    if (binary.length > MAX_BODY_BYTES) throw new Error('响应内容过大')
    data = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  }
  return { status: Number(response.status) || 0, headers, body: data }
}

async function webRequest(input: HttpRequestInput, initialUrl: URL): Promise<HttpResponse> {
  let url = initialUrl
  let method = (input.method ?? 'GET').toUpperCase()
  let headers = sanitizeHeaders(input.headers)
  let body = input.body
  const controller = new AbortController()
  const abort = () => controller.abort()
  input.signal?.addEventListener('abort', abort, { once: true })
  if (input.signal?.aborted) controller.abort()
  const timer = setTimeout(() => controller.abort(), Math.min(60_000, Math.max(1_000, input.timeoutMs ?? 30_000)))
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const response = await fetch(url.href, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        redirect: 'manual',
        signal: controller.signal,
        referrer: input.referrer,
        referrerPolicy: 'unsafe-url'
      } as RequestInit)
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        if (!location) break
        if (redirects === MAX_REDIRECTS) throw new Error('重定向次数过多')
        const next = new URL(location, url)
        validateRemoteUrl(next.href)
        if (next.origin !== url.origin) {
          headers = Object.fromEntries(
            Object.entries(headers).filter(([name]) => !/authorization|cookie|token|key/i.test(name))
          )
        }
        if (response.status === 303 || ([301, 302].includes(response.status) && method === 'POST')) {
          method = 'GET'
          body = undefined
        }
        url = next
        continue
      }
      const length = Number(response.headers.get('content-length') ?? 0)
      if (length > MAX_BODY_BYTES) throw new Error('响应内容过大')
      const data = input.responseType === 'arraybuffer'
        ? new Uint8Array(await response.arrayBuffer())
        : await response.text()
      if (data.length > MAX_BODY_BYTES) throw new Error('响应内容过大')
      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value
      })
      return {
        status: response.status,
        headers: responseHeaders,
        body: typeof data === 'string' && !input.raw ? parseBody(data) : data
      }
    }
    throw new Error('网络请求失败')
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', abort)
  }
}

export async function requestRemote(input: HttpRequestInput): Promise<HttpResponse> {
  input.signal?.throwIfAborted()
  const url = validateRemoteUrl(input.url)
  const response = Capacitor.isNativePlatform() ? await nativeRequest(input, url) : await webRequest(input, url)
  input.signal?.throwIfAborted()
  return response
}
