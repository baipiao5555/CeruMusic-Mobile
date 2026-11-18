import { Capacitor, registerPlugin } from '@capacitor/core'
import { secureStore } from '../native/secureStore'
import { mainFrameCapability } from '../native/mainFrameCapability'
import { commitPlaylistImport, type PlaylistImportResult } from '../library'
import type { Track } from '../track'
import { listConnections, type WebDavConnection } from './webdav'

export const WEBDAV_MEDIA_PROVIDER_ID = 'webdav'
export const WEBDAV_MEDIA_PLUGIN_ID = 'webdav'
export const WEBDAV_MEDIA_MAX_DEPTH = 5

const DAV_NS = 'DAV:'
const AUTH_KEY = 'auth'
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const MAX_FILE_PATH = 4096
const MAX_DIRECTORY_PATH = 2048
const MAX_FILES = 5000
const MAX_DIRECTORIES = 500
const REQUEST_TIMEOUT_MS = 20_000
const PROPFIND_BODY = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getcontenttype/></d:prop></d:propfind>'
const AUDIO_EXTENSIONS = new Set([
  'mp3', 'flac', 'm4a', 'm4b', 'aac', 'ogg', 'oga', 'opus', 'wav', 'wma',
  'ape', 'aiff', 'aif', 'alac', 'mp4', 'dsf', 'dff'
])

interface NativeSyncHttp {
  initialize(): Promise<void>
  authorize(options: { connectionId: string; origin: string; basePath: string; confirmed: boolean; allowInsecureHttp: boolean; capability: string }): Promise<void>
  request(options: { connectionId: string; url: string; method: 'PROPFIND'; body?: string; headers: Record<string, string>; timeoutMs: number; capability: string }): Promise<DavResponse>
}

interface DavResponse {
  status: number
  headers: Record<string, string>
  body: string
}

interface ParsedEntry {
  path: string
  collection: boolean
  displayName: string
  size?: number
  lastModified?: number
  contentType?: string
}

interface ParsedDirectory {
  entries: ParsedEntry[]
  skipped: number
}

export interface WebDavMediaFile {
  id: string
  connectionId: string
  path: string
  displayName: string
  url: string
  extension: string
  size?: number
  lastModified?: number
  contentType?: string
}

export interface WebDavScanProgress {
  directories: number
  files: number
  current: string
}

export interface WebDavScanOptions {
  directory?: string
  maxDepth?: number
  signal?: AbortSignal
  onProgress?: (progress: WebDavScanProgress) => void
}

export interface WebDavScanResult {
  connectionId: string
  directory: string
  maxDepth: number
  files: WebDavMediaFile[]
  directories: number
  skipped: number
  truncated: boolean
}

export interface WebDavImportOptions {
  connectionName: string
  mode: 'new' | 'merge'
  name: string
  targetId?: string
}

export interface WebDavTrackSource {
  url: string
  headers?: Record<string, string>
}

export class WebDavMediaError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'WebDavMediaError'
  }
}

function fail(code: string, message: string): never {
  throw new WebDavMediaError(code, message)
}

const native = registerPlugin<NativeSyncHttp>('SyncHttp')
const authorized = new Map<string, string>()
const android = (): boolean => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'

function approvedConnection(input: WebDavConnection | string): WebDavConnection {
  const id = typeof input === 'string' ? input : input?.id
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) fail('SCOPE', 'WebDAV 连接标识无效')
  const connection = listConnections().find(item => item.id === id)
  if (!connection) fail('CONNECTION', 'WebDAV 连接不存在或已失效，请回到同步服务重新配置')
  return connection
}

function safeSegments(path: string, max: number, relative: boolean, allowUrlSpecial: boolean): string {
  if (typeof path !== 'string' || path.length > max) fail('SCOPE', 'WebDAV 路径长度超出限制')
  if (!relative && (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path))) fail('SCOPE', '只能使用连接专用目录内的相对路径')
  if (/[\u0000-\u001f\\]/.test(path) || (!allowUrlSpecial && /[?#]/.test(path)) || /%(?:2e|2f|5c|25)/i.test(path)) {
    fail('SCOPE', 'WebDAV 路径包含不允许的跳转或编码')
  }
  if (!path) return ''
  const segments = path.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) fail('SCOPE', 'WebDAV 路径不能包含空段、当前目录或上级目录')
  return segments.join('/')
}

function directoryScope(raw: unknown): string {
  if (raw === undefined || raw === null) return ''
  if (typeof raw !== 'string') fail('SCOPE', '扫描目录格式无效')
  return safeSegments(raw.trim(), MAX_DIRECTORY_PATH, true, false)
}

function fileScope(raw: unknown): string {
  const path = safeSegments(raw as string, MAX_FILE_PATH, false, true)
  if (!path) fail('SCOPE', '远端文件路径为空')
  return path
}

function encodeRelativePath(path: string): string {
  return path.split('/').map(segment => encodeURIComponent(segment)).join('/')
}

function directoryUrl(connection: WebDavConnection, directory: string): string {
  return `${connection.origin}${connection.basePath}${directory ? `${encodeRelativePath(directory)}/` : ''}`
}

function mediaUrl(connection: WebDavConnection, path: string): string {
  return `${connection.origin}${connection.basePath}${encodeRelativePath(path)}`
}

function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isAudioFileName(name: string): boolean {
  return AUDIO_EXTENSIONS.has(extensionOf(name))
}

export function webDavFileId(connectionId: string, path: string): string {
  return `webdav:${encodeURIComponent(connectionId)}:${encodeURIComponent(path)}`
}

function credentialNamespace(connectionId: string): string {
  return `sync.webdav.${connectionId}`
}

interface Credential {
  header: string
}

async function readCredential(connection: WebDavConnection): Promise<Credential> {
  const raw = await secureStore.get(credentialNamespace(connection.id), AUTH_KEY)
  if (raw === null) fail('CREDENTIAL', '此 WebDAV 连接的安全凭据不可用；Web 会话重开后需重新配置连接')
  let value: any
  try {
    value = JSON.parse(raw)
  } catch {
    fail('CREDENTIAL', 'WebDAV 安全凭据已失效，请重新配置连接')
  }
  if (!value || typeof value.username !== 'string' || typeof value.password !== 'string' ||
    value.username.length > 512 || value.password.length > 8192) {
    fail('CREDENTIAL', 'WebDAV 安全凭据格式无效')
  }
  if (value.origin !== connection.origin || value.basePath !== connection.basePath) {
    fail('CREDENTIAL_SCOPE', 'WebDAV 连接地址已变化，请重新确认地址并配置安全凭据')
  }
  if (!value.username && !value.password) return { header: '' }
  const bytes = new TextEncoder().encode(`${value.username}:${value.password}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return { header: `Basic ${btoa(binary)}` }
}

function responseHeader(headers: Headers, name: string): string | undefined {
  const value = headers.get(name)
  return value || undefined
}

function responseStatus(response: DavResponse): void {
  if (response.status === 401) fail('AUTH', 'WebDAV 身份验证失败，请检查用户名、密码或应用密码')
  if (response.status === 403) fail('FORBIDDEN', 'WebDAV 拒绝访问此目录，请检查目录权限')
  if (response.status === 404) fail('NOT_FOUND', 'WebDAV 目录不存在，请检查扫描目录')
  if (response.status >= 300 && response.status < 400) fail('REDIRECT', 'WebDAV 目录发生重定向，请填写最终目录地址')
  if (response.status !== 200 && response.status !== 207) fail('HTTP_STATUS', `WebDAV 目录请求未成功（HTTP ${response.status}）`)
  if (!response.body.trim()) fail('XML', 'WebDAV 目录响应为空')
}

async function readLimitedText(response: Response, signal?: AbortSignal): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) fail('LIMIT', 'WebDAV 目录响应超过 5 MiB 限制')
  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).length > MAX_RESPONSE_BYTES) fail('LIMIT', 'WebDAV 目录响应超过 5 MiB 限制')
    return text
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      if (signal?.aborted) {
        await reader.cancel()
        fail('ABORTED', '已停止扫描')
      }
      const next = await reader.read()
      if (next.done) break
      size += next.value.length
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        fail('LIMIT', 'WebDAV 目录响应超过 5 MiB 限制')
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock?.()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return new TextDecoder().decode(bytes)
}

async function requestDirectory(connection: WebDavConnection, directory: string, signal?: AbortSignal): Promise<DavResponse> {
  const credential = await readCredential(connection)
  if (signal?.aborted) fail('ABORTED', '已停止扫描')
  const url = directoryUrl(connection, directory)
  const headers: Record<string, string> = {
    Accept: 'application/xml, text/xml',
    'Content-Type': 'application/xml; charset=utf-8',
    Depth: '1',
    ...(credential.header ? { Authorization: credential.header } : {})
  }
  if (android()) {
    const capability = await mainFrameCapability(native)
    const signature = `${connection.origin}${connection.basePath}:${connection.allowInsecureHttp}`
    try {
      if (authorized.get(connection.id) !== signature) {
        await native.authorize({ connectionId: connection.id, ...connection, capability })
        authorized.set(connection.id, signature)
      }
      const response = await native.request({
        connectionId: connection.id, url, method: 'PROPFIND', body: PROPFIND_BODY,
        headers, timeoutMs: REQUEST_TIMEOUT_MS, capability
      })
      if (signal?.aborted) fail('ABORTED', '已停止扫描')
      return response
    } catch (error) {
      if (error instanceof WebDavMediaError) throw error
      return fail('NETWORK', '无法读取 WebDAV 目录；请检查网络、证书或原生同步通道')
    }
  }

  const controller = new AbortController()
  const abort = (): void => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'PROPFIND', headers, body: PROPFIND_BODY, redirect: 'manual',
      credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      signal: controller.signal
    })
    if (response.status >= 400) {
      return { status: response.status, headers: {}, body: '' }
    }
    const body = await readLimitedText(response, signal)
    return {
      status: response.status,
      headers: {
        ...(responseHeader(response.headers, 'last-modified') ? { 'last-modified': responseHeader(response.headers, 'last-modified')! } : {}),
        ...(responseHeader(response.headers, 'content-type') ? { 'content-type': responseHeader(response.headers, 'content-type')! } : {})
      },
      body
    }
  } catch (error) {
    if (error instanceof WebDavMediaError) throw error
    if (signal?.aborted) fail('ABORTED', '已停止扫描')
    if (controller.signal.aborted) fail('TIMEOUT', 'WebDAV 目录请求超时')
    return fail('NETWORK', '无法连接 WebDAV 目录；请检查网络、证书、CORS 或混合内容限制')
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

function directChildren(element: Element, localName: string): Element[] {
  return (Array.from(element.getElementsByTagNameNS(DAV_NS, localName)) as Element[])
    .filter(child => child.parentNode === element)
}

function firstText(element: Element | undefined, localName: string): string {
  if (!element) return ''
  const child = directChildren(element, localName)[0]
  return child?.textContent?.trim() || ''
}

function parsedSize(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined
  const size = Number(value)
  return Number.isSafeInteger(size) && size >= 0 ? size : undefined
}

function parsedDate(value: string): number | undefined {
  if (!value) return undefined
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : undefined
}

function responseCode(status: string): number {
  const match = /\s(\d{3})(?:\s|$)/.exec(status)
  return match ? Number(match[1]) : 0
}

type ScopedHref = { self: true } | { self: false; name: string; collectionHint: boolean }

function hrefScope(connection: WebDavConnection, requestUrl: string, rawHref: string): ScopedHref | undefined {
  const href = rawHref.trim()
  if (!href || href.length > MAX_FILE_PATH || /[\u0000-\u001f]/.test(href)) return
  if (/%(?:2e|2f|5c|25)/i.test(href)) return
  let url: URL
  try {
    url = new URL(href, requestUrl)
  } catch {
    return
  }
  if (url.origin !== connection.origin || url.username || url.password || url.search || url.hash) return
  const requestPath = new URL(requestUrl).pathname
  if (!url.pathname.startsWith(connection.basePath) || !url.pathname.startsWith(requestPath)) return
  let tail = url.pathname.slice(requestPath.length)
  if (!tail) return { self: true }
  const collectionHint = tail.endsWith('/')
  if (collectionHint) tail = tail.slice(0, -1)
  if (!tail || tail.includes('/')) return
  let name: string
  try {
    name = decodeURIComponent(tail)
  } catch {
    return
  }
  if (!name || name === '.' || name === '..' || /[\u0000-\u001f\\]/.test(name) || /%(?:2e|2f|5c|25)/i.test(name)) return
  return { self: false, name, collectionHint }
}

interface MultistatusContext {
  connection: WebDavConnection
  directory: string
  requestUrl: string
}

export function parseWebDavMultistatus(xml: string, context: MultistatusContext): ParsedDirectory {
  if (typeof xml !== 'string' || !xml.trim()) fail('XML', 'WebDAV 目录响应为空')
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('XML', 'WebDAV 目录响应包含不允许的 XML 声明')
  if (typeof DOMParser === 'undefined') fail('XML', '当前环境无法解析 WebDAV 目录响应')
  let document: Document
  try {
    document = new DOMParser().parseFromString(xml, 'application/xml')
  } catch {
    fail('XML', 'WebDAV 目录响应不是有效 XML')
  }
  if (!document || document.getElementsByTagName('parsererror').length || !document.documentElement ||
    document.documentElement.localName !== 'multistatus') {
    fail('XML', 'WebDAV 目录响应无效或已损坏')
  }

  const entries: ParsedEntry[] = []
  let skipped = 0
  for (const response of Array.from(document.getElementsByTagNameNS(DAV_NS, 'response')) as Element[]) {
    const rawHref = firstText(response, 'href')
    if (!rawHref) {
      skipped += 1
      continue
    }
    const scoped = hrefScope(context.connection, context.requestUrl, rawHref)
    if (!scoped) {
      skipped += 1
      continue
    }
    if (scoped.self) continue
    let prop: Element | undefined
    for (const propstat of directChildren(response, 'propstat')) {
      const code = responseCode(firstText(propstat, 'status'))
      const candidate = directChildren(propstat, 'prop')[0]
      if (code >= 200 && code < 300 && candidate) {
        prop = candidate
        break
      }
    }
    if (!prop) {
      skipped += 1
      continue
    }
    const resourceType = directChildren(prop, 'resourcetype')[0]
    const collection = scoped.collectionHint || Boolean(resourceType && directChildren(resourceType, 'collection').length)
    const displayName = firstText(prop, 'displayname').slice(0, 300) || scoped.name
    entries.push({
      path: context.directory ? `${context.directory}/${scoped.name}` : scoped.name,
      collection,
      displayName,
      ...(() => {
        const size = parsedSize(firstText(prop, 'getcontentlength'))
        return size === undefined ? {} : { size }
      })(),
      ...(() => {
        const lastModified = parsedDate(firstText(prop, 'getlastmodified'))
        return lastModified === undefined ? {} : { lastModified }
      })(),
      ...(() => {
        const contentType = firstText(prop, 'getcontenttype').slice(0, 200)
        return contentType ? { contentType } : {}
      })()
    })
  }
  return { entries, skipped }
}

function comparePath(left: WebDavMediaFile, right: WebDavMediaFile): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0
}

export async function scanWebDavMusic(
  connectionInput: WebDavConnection | string,
  options: WebDavScanOptions = {}
): Promise<WebDavScanResult> {
  const connection = approvedConnection(connectionInput)
  const directory = directoryScope(options.directory)
  const maxDepth = options.maxDepth ?? 1
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > WEBDAV_MEDIA_MAX_DEPTH) {
    fail('DEPTH', `扫描层级需在 1–${WEBDAV_MEDIA_MAX_DEPTH} 之间`)
  }
  if (options.signal?.aborted) fail('ABORTED', '已停止扫描')

  const files = new Map<string, WebDavMediaFile>()
  const queue: Array<{ directory: string; level: number }> = [{ directory, level: 1 }]
  let directories = 0
  let skipped = 0
  let truncated = false

  while (queue.length) {
    if (directories >= MAX_DIRECTORIES) {
      truncated = true
      break
    }
    const current = queue.shift()!
    directories += 1
    options.onProgress?.({ directories, files: files.size, current: current.directory })
    const requestUrl = directoryUrl(connection, current.directory)
    const response = await requestDirectory(connection, current.directory, options.signal)
    responseStatus(response)
    const parsed = parseWebDavMultistatus(response.body, { connection, directory: current.directory, requestUrl })
    skipped += parsed.skipped
    for (const entry of parsed.entries) {
      if (entry.collection) {
        if (current.level < maxDepth) queue.push({ directory: entry.path, level: current.level + 1 })
        continue
      }
      const name = fileNameOf(entry.path)
      if (!isAudioFileName(name)) continue
      if (files.size >= MAX_FILES) {
        truncated = true
        break
      }
      const id = webDavFileId(connection.id, entry.path)
      files.set(entry.path, {
        id,
        connectionId: connection.id,
        path: entry.path,
        displayName: entry.displayName,
        url: mediaUrl(connection, entry.path),
        extension: extensionOf(name),
        ...(entry.size === undefined ? {} : { size: entry.size }),
        ...(entry.lastModified === undefined ? {} : { lastModified: entry.lastModified }),
        ...(entry.contentType ? { contentType: entry.contentType } : {})
      })
    }
    if (truncated) break
  }

  return {
    connectionId: connection.id,
    directory,
    maxDepth,
    files: Array.from(files.values()).sort(comparePath),
    directories,
    skipped,
    truncated
  }
}

function titleOf(displayName: string, path: string): string {
  const name = displayName || fileNameOf(path)
  const extension = extensionOf(name)
  const stripped = extension ? name.slice(0, -(extension.length + 1)) : name
  return (stripped.trim() || name || '未命名曲目').slice(0, 300)
}

export function webDavFileToTrack(file: WebDavMediaFile, connection: Pick<WebDavConnection, 'id' | 'name'>): Track {
  if (!file || file.connectionId !== connection.id || typeof file.path !== 'string') {
    throw new WebDavMediaError('SCOPE', 'WebDAV 文件与连接不匹配')
  }
  const path = fileScope(file.path)
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')).split('/').pop() || '' : ''
  const data: Record<string, string | number> = {
    connectionId: connection.id,
    path,
    displayName: file.displayName || fileNameOf(path)
  }
  if (file.size !== undefined) data.size = file.size
  if (file.lastModified !== undefined) data.lastModified = file.lastModified
  return {
    id: file.id || webDavFileId(connection.id, path),
    providerId: WEBDAV_MEDIA_PROVIDER_ID,
    providerName: connection.name || 'WebDAV',
    pluginId: WEBDAV_MEDIA_PLUGIN_ID,
    ref: {
      kind: 'track',
      id: file.id || webDavFileId(connection.id, path),
      providerId: WEBDAV_MEDIA_PROVIDER_ID,
      pluginId: WEBDAV_MEDIA_PLUGIN_ID,
      connectionId: connection.id,
      data
    },
    title: titleOf(file.displayName, path),
    artist: parent || connection.name || 'WebDAV',
    album: parent,
    durationMs: 0,
    artwork: '/default-cover.png',
    qualities: []
  }
}

export function importWebDavMusic(files: WebDavMediaFile[], options: WebDavImportOptions): PlaylistImportResult {
  if (!Array.isArray(files) || !files.length) throw new WebDavMediaError('EMPTY', '请先选择要添加的 WebDAV 曲目')
  if (!options || (options.mode !== 'new' && options.mode !== 'merge')) throw new WebDavMediaError('IMPORT', '不支持的添加到歌单方式')
  const connectionId = files[0]?.connectionId
  if (!connectionId || files.some(file => !file || file.connectionId !== connectionId)) {
    throw new WebDavMediaError('SCOPE', '一次只能导入同一 WebDAV 连接的曲目')
  }
  const connection = approvedConnection(connectionId)
  const tracks = files.map(file => webDavFileToTrack(file, connection))
  return commitPlaylistImport(
    [{ name: (options.name || '').trim() || `WebDAV · ${connection.name}`, tracks }],
    { mode: options.mode, ...(options.targetId ? { targetId: options.targetId } : {}) }
  )
}

export function isWebDavTrack(track: Track | undefined): boolean {
  return Boolean(track && (track.providerId === WEBDAV_MEDIA_PROVIDER_ID || track.pluginId === WEBDAV_MEDIA_PLUGIN_ID))
}

export async function resolveWebDavTrackSource(track: Track): Promise<WebDavTrackSource> {
  if (!isWebDavTrack(track)) fail('SCOPE', '不是 WebDAV 曲目')
  const data = track.ref?.data as Record<string, unknown> | undefined
  const connectionId = track.ref?.connectionId || data?.connectionId
  if (typeof connectionId !== 'string' || (data?.connectionId !== undefined && data.connectionId !== connectionId)) {
    fail('SCOPE', 'WebDAV 曲目缺少有效的连接标识')
  }
  const path = fileScope(data?.path)
  const connection = approvedConnection(connectionId)
  const credential = await readCredential(connection)
  return {
    url: mediaUrl(connection, path),
    ...(credential.header ? { headers: { Authorization: credential.header } } : {})
  }
}
