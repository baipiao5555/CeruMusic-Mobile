import { Capacitor, registerPlugin } from '@capacitor/core'
import { secureStore } from '../native/secureStore'
import { mainFrameCapability } from '../native/mainFrameCapability'
import { randomUUID } from '../../shims/crypto'
import { exportLibrarySnapshot, parseLibrarySnapshot, commitLibrarySnapshot, applyLibrarySnapshot, snapshotCounts, type LibrarySnapshot } from '../librarySnapshot'
import { mergeSnapshots, snapshotsEqual, type MergeConflict, type MergeStats } from './merge'

const CONFIG_KEY = 'ceru.sync.webdav.v1'
const SYNC_STATE_KEY = 'ceru.sync.webdav.state.v1'
export const SYNC_MAX_BYTES = 5 * 1024 * 1024
const CURRENT_FILE = '.ceru-library-v1.json'
const DEFAULT_AUTO_SYNC_MINUTES = 3
const METHODS = ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'PROPFIND', 'MKCOL'] as const
type Method = typeof METHODS[number]
export interface WebDavConnection {
  id: string; name: string; origin: string; basePath: string; confirmed: true; allowInsecureHttp: boolean
  testedAt?: number; etagVerified?: boolean
}
export interface WebDavSyncStatus {
  connectionId: string
  enabled: boolean
  autoSyncMinutes: number
  hasBaseline: boolean
  baselinePlaylists: number
  baselineTracks: number
  baselineFavorites: number
  lastSyncedAt?: number
  lastAttemptAt?: number
  lastError?: string
  lastSummary?: string
  remoteEtag?: string
  remoteAt?: number
  remoteExists?: boolean
  remotePlaylists?: number
  remoteTracks?: number
  remoteFavorites?: number
  conflicts: number
}
export interface SyncResult {
  status: 'up-to-date' | 'pushed' | 'pulled' | 'merged'
  pushed: boolean
  pulled: boolean
  conflicts: MergeConflict[]
  stats: MergeStats
  remoteEtag: string
  summary: string
  undo?: () => void
}
interface StoredSyncEntry {
  origin: string
  basePath: string
  enabled: boolean
  autoSyncMinutes: number
  baseline?: LibrarySnapshot
  remoteEtag?: string
  lastSyncedAt?: number
  lastAttemptAt?: number
  lastError?: string
  lastSummary?: string
  remoteAt?: number
  remoteExists?: boolean
  remotePlaylists?: number
  remoteTracks?: number
  remoteFavorites?: number
  conflicts?: number
}
interface StoredSyncState { version: 1; connections: Record<string, StoredSyncEntry> }
interface RemoteState { missing: boolean; snapshot?: LibrarySnapshot; etag?: string }
interface Response { status: number; headers: Record<string, string>; body: string }
interface NativeSyncHttp {
  initialize(): Promise<void>
  authorize(options: { connectionId: string; origin: string; basePath: string; confirmed: boolean; allowInsecureHttp: boolean; capability: string }): Promise<void>
  revoke(options: { connectionId: string; capability: string }): Promise<void>
  request(options: { connectionId: string; url: string; method: Method; body?: string; headers: Record<string, string>; timeoutMs: number; capability: string }): Promise<Response>
}
const native = registerPlugin<NativeSyncHttp>('SyncHttp')
const approved = new Map<string, string>()
const proofs = new Map<string, boolean>()
const observed = new Map<string, string>()
const namespace = (id: string): string => `sync.webdav.${id}`
const android = (): boolean => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
export class SyncError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'SyncError' }
}
function fail(code: string, message: string): never { throw new SyncError(code, message) }
function safePath(path: string): boolean { return !/\\|%2f|%5c|%2e|%25/i.test(path) }
export function normalizeEndpoint(raw: string, allowInsecureHttp = false): { origin: string; basePath: string } {
  if (typeof raw !== 'string' || raw.length > 4096 || /(?:^|\/)\.\.?(?:\/|$)|%2e|%2f|%5c|%25|\\/i.test(raw)) fail('ADDRESS', '地址不能包含路径跳转或重复编码')
  let url: URL
  try { url = new URL(raw.trim()) } catch { return fail('ADDRESS', '请输入完整的 WebDAV HTTP(S) 专用目录地址') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail('ADDRESS', '请将账号密码单独填写，地址不能携带查询参数或凭据')
  if (url.protocol === 'http:' && !allowInsecureHttp) fail('HTTP', 'HTTP 不加密传输；如为可信局域网，请明确确认风险')
  const basePath = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`
  if (basePath.length > 2048 || !safePath(basePath)) fail('ADDRESS', '专用目录地址无效')
  return { origin: url.origin, basePath }
}
function publicConnection(input: any): WebDavConnection | undefined {
  if (!input || typeof input.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.id) || input.confirmed !== true) return
  try {
    const endpoint = normalizeEndpoint(`${input.origin}${input.basePath}`, input.allowInsecureHttp === true)
    if (endpoint.origin !== input.origin || endpoint.basePath !== input.basePath) return
    return { id: input.id, name: typeof input.name === 'string' ? input.name.slice(0, 80) : 'WebDAV', ...endpoint, confirmed: true, allowInsecureHttp: input.allowInsecureHttp === true,
      ...(Number.isFinite(input.testedAt) ? { testedAt: input.testedAt, etagVerified: input.etagVerified === true } : {}) }
  } catch { return }
}
const syncLocks = new Set<string>()
const emptySyncState = (): StoredSyncState => ({ version: 1, connections: {} })
function loadSyncState(): StoredSyncState {
  try {
    const parsed = JSON.parse(localStorage.getItem(SYNC_STATE_KEY) || '{}')
    if (parsed?.version !== 1 || !parsed.connections || typeof parsed.connections !== 'object' || Array.isArray(parsed.connections)) return emptySyncState()
    return { version: 1, connections: parsed.connections as Record<string, StoredSyncEntry> }
  } catch { return emptySyncState() }
}
function saveSyncState(state: StoredSyncState): void {
  try { localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state)) }
  catch { fail('STORAGE', '同步状态保存失败（可能本地存储空间不足）；本次本地状态未提交') }
}
function storedEntry(state: StoredSyncState, connection: WebDavConnection): StoredSyncEntry | undefined {
  const entry = state.connections[connection.id]
  return entry && entry.origin === connection.origin && entry.basePath === connection.basePath ? entry : undefined
}
function entryFor(state: StoredSyncState, connection: WebDavConnection): StoredSyncEntry {
  const existing = storedEntry(state, connection)
  if (existing) return existing
  const entry: StoredSyncEntry = { origin: connection.origin, basePath: connection.basePath, enabled: false, autoSyncMinutes: DEFAULT_AUTO_SYNC_MINUTES }
  state.connections[connection.id] = entry
  return entry
}
function baselineCounts(entry?: StoredSyncEntry): { playlists: number; tracks: number; favorites: number } | undefined {
  const baseline = entry?.baseline
  if (!baseline || baseline.schema !== 'ceru.library.sync' || !Array.isArray(baseline.favorites) || !Array.isArray(baseline.playlists)) return
  let tracks = 0
  for (const playlist of baseline.playlists) { if (!playlist || !Array.isArray(playlist.tracks)) return; tracks += playlist.tracks.length }
  return { playlists: baseline.playlists.length, tracks, favorites: baseline.favorites.length }
}
function autoMinutes(entry?: StoredSyncEntry): number {
  const value = Number(entry?.autoSyncMinutes)
  return Number.isInteger(value) && value >= 1 && value <= 60 ? value : DEFAULT_AUTO_SYNC_MINUTES
}
export function getSyncStatus(connection: WebDavConnection): WebDavSyncStatus {
  const valid = publicConnection(connection)
  const empty: WebDavSyncStatus = { connectionId: valid?.id || '', enabled: false, autoSyncMinutes: DEFAULT_AUTO_SYNC_MINUTES, hasBaseline: false,
    baselinePlaylists: 0, baselineTracks: 0, baselineFavorites: 0, conflicts: 0 }
  if (!valid) return empty
  const state = loadSyncState()
  const entry = storedEntry(state, valid)
  const counts = baselineCounts(entry)
  return { connectionId: valid.id, enabled: entry?.enabled === true, autoSyncMinutes: autoMinutes(entry),
    hasBaseline: Boolean(counts), baselinePlaylists: counts?.playlists || 0, baselineTracks: counts?.tracks || 0, baselineFavorites: counts?.favorites || 0,
    ...(entry?.lastSyncedAt ? { lastSyncedAt: entry.lastSyncedAt } : {}), ...(entry?.lastAttemptAt ? { lastAttemptAt: entry.lastAttemptAt } : {}),
    ...(entry?.lastError ? { lastError: entry.lastError } : {}), ...(entry?.lastSummary ? { lastSummary: entry.lastSummary } : {}),
    ...(entry?.remoteEtag ? { remoteEtag: entry.remoteEtag } : {}), ...(entry?.remoteAt ? { remoteAt: entry.remoteAt } : {}),
    ...(entry?.remoteExists !== undefined ? { remoteExists: entry.remoteExists } : {}),
    ...(entry?.remotePlaylists !== undefined ? { remotePlaylists: entry.remotePlaylists } : {}),
    ...(entry?.remoteTracks !== undefined ? { remoteTracks: entry.remoteTracks } : {}),
    ...(entry?.remoteFavorites !== undefined ? { remoteFavorites: entry.remoteFavorites } : {}),
    conflicts: entry?.conflicts || 0 }
}
export async function setSyncSettings(connection: WebDavConnection, patch: { enabled?: boolean; autoSyncMinutes?: number }): Promise<WebDavSyncStatus> {
  const valid = publicConnection(connection)
  if (!valid) fail('SCOPE', '同步连接未授权或已失效')
  if (typeof patch?.enabled !== 'boolean' && patch?.autoSyncMinutes === undefined) fail('SETTINGS', '没有可保存的同步设置')
  if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') fail('SETTINGS', '自动同步开关格式无效')
  const state = loadSyncState()
  const entry = entryFor(state, valid)
  if (typeof patch.enabled === 'boolean') {
    entry.enabled = patch.enabled
    if (patch.enabled) for (const [id, other] of Object.entries(state.connections)) if (id !== valid.id && other && typeof other === 'object') other.enabled = false
  }
  if (patch.autoSyncMinutes !== undefined) {
    if (!Number.isInteger(patch.autoSyncMinutes) || patch.autoSyncMinutes < 1 || patch.autoSyncMinutes > 60) fail('SETTINGS', '自动同步间隔需在 1–60 分钟内')
    entry.autoSyncMinutes = patch.autoSyncMinutes
  }
  saveSyncState(state)
  return getSyncStatus(valid)
}
export function listConnections(): WebDavConnection[] {
  try { const raw = JSON.parse(localStorage.getItem(CONFIG_KEY) || '[]'); return Array.isArray(raw) ? raw.slice(0, 20).map(publicConnection).filter(Boolean) as WebDavConnection[] : [] }
  catch { return [] }
}
function persist(list: WebDavConnection[]): void {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(list.map(publicConnection).filter(Boolean))) }
  catch { fail('STORAGE', '公开连接配置保存失败，未保存明文凭据') }
}
export async function saveConnection(input: { name: string; address: string; username: string; password: string; confirmed: boolean; allowInsecureHttp: boolean }): Promise<WebDavConnection> {
  if (input.confirmed !== true || typeof input.allowInsecureHttp !== 'boolean') fail('CONSENT', '请先明确确认只授权此 WebDAV 地址和专用目录')
  if (typeof input.username !== 'string' || typeof input.password !== 'string' || input.username.length > 512 || input.password.length > 8192 || /[\r\n]/.test(input.username + input.password)) fail('CREDENTIAL', '账号密码格式或长度无效')
  const list = listConnections(); if (list.length >= 20) fail('LIMIT', '最多保存 20 个同步连接')
  const connection: WebDavConnection = { id: randomUUID(), name: input.name.trim().slice(0, 80) || 'WebDAV', ...normalizeEndpoint(input.address, input.allowInsecureHttp), confirmed: true, allowInsecureHttp: input.allowInsecureHttp }
  await secureStore.set(namespace(connection.id), 'auth', JSON.stringify({ username: input.username, password: input.password, origin: connection.origin, basePath: connection.basePath }))
  try { persist([...list, connection]) } catch (error) { await secureStore.clearNamespace(namespace(connection.id)); throw error }
  return connection
}
export async function removeConnection(connection: WebDavConnection): Promise<void> {
  if (android()) await native.revoke({ connectionId: connection.id, capability: await mainFrameCapability(native) })
  await secureStore.clearNamespace(namespace(connection.id)); persist(listConnections().filter(item => item.id !== connection.id)); approved.delete(connection.id); proofs.delete(connection.id)
  for (const key of observed.keys()) if (key.startsWith(connection.id + ':')) observed.delete(key)
  try {
    const state = loadSyncState()
    if (state.connections[connection.id]) { delete state.connections[connection.id]; saveSyncState(state) }
  } catch {}
}
function fileUrl(connection: WebDavConnection, file = ''): string {
  if (file && !/^(?:\.ceru-library-v1\.json|\.ceru-backup-[A-Za-z0-9_-]+\.json|\.ceru-test-[A-Za-z0-9_-]+\.txt)$/.test(file)) fail('SCOPE', '只允许澜音专用备份或临时测试文件')
  return `${connection.origin}${connection.basePath}${file}`
}
async function auth(connection: WebDavConnection): Promise<string> {
  const raw = await secureStore.get(namespace(connection.id), 'auth')
  if (raw === null) fail('CREDENTIAL', '此连接的安全凭据不可用；Web 会话重开后需重新配置')
  let value: any
  try { value = JSON.parse(raw) } catch { return fail('CREDENTIAL', '安全凭据已失效，请重新配置连接') }
  if (typeof value.username !== 'string' || typeof value.password !== 'string' || value.username.length > 512 || value.password.length > 8192) fail('CREDENTIAL', '安全凭据格式无效')
  if (value.origin !== connection.origin || value.basePath !== connection.basePath) fail('CREDENTIAL_SCOPE', '连接地址已变化，请重新确认地址并配置安全凭据')
  if (!value.username && !value.password) return ''
  const bytes = new TextEncoder().encode(`${value.username}:${value.password}`)
  return 'Basic ' + btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))
}
export async function webDavRequest(connection: WebDavConnection, method: Method, file = '', body?: string, headers: Record<string, string> = {}): Promise<Response> {
  const valid = publicConnection(connection); if (!valid) fail('SCOPE', '同步连接未授权或已失效')
  if (method === 'DELETE' && !/^\.ceru-test-[A-Za-z0-9_-]+\.txt$/.test(file)) fail('SCOPE', '只允许清理专用临时测试文件')
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (!['accept', 'content-type', 'depth', 'if-match', 'if-none-match'].includes(lower) || typeof value !== 'string' || /[\r\n]/.test(value) || value.length > 32768 || (lower === 'depth' && !['0', '1'].includes(value))) fail('HEADER', '同步请求头无效或超出范围')
  }
  if (body !== undefined && typeof body !== 'string') fail('BODY', '同步请求正文必须是有界文本')
  if (!METHODS.includes(method) || (body !== undefined && new TextEncoder().encode(body).length > SYNC_MAX_BYTES)) fail('LIMIT', '请求方法或大小超出同步限制')
  const authorization = await auth(valid), requestHeaders = { Accept: 'application/json, application/xml', ...headers, ...(authorization ? { Authorization: authorization } : {}) }
  const url = fileUrl(valid, file)
  try {
    if (android()) {
      const capability = await mainFrameCapability(native)
      const signature = `${valid.origin}${valid.basePath}:${valid.allowInsecureHttp}`
      if (approved.get(valid.id) !== signature) { await native.authorize({ connectionId: valid.id, ...valid, capability }); approved.set(valid.id, signature) }
      return await native.request({ connectionId: valid.id, url, method, body, headers: requestHeaders, timeoutMs: 20000, capability })
    }
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000)
    try {
      const response = await fetch(url, { method, headers: requestHeaders, body, redirect: 'manual', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal })
      const responseHeaders: Record<string, string> = {}; for (const name of ['etag', 'dav', 'allow', 'content-type', 'content-length', 'last-modified']) { const value = response.headers.get(name); if (value) responseHeaders[name] = value }
      if (Number(response.headers.get('content-length')) > SYNC_MAX_BYTES) fail('LIMIT', '远端文件超过 5 MiB 限制')
      let content = ''
      if (method !== 'HEAD' && response.status < 400 && response.body) {
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0
        for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > SYNC_MAX_BYTES) { await reader.cancel(); fail('LIMIT', '远端文件超过 5 MiB 限制') } chunks.push(next.value) }
        const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length } content = new TextDecoder().decode(bytes)
      }
      return { status: response.status, headers: responseHeaders, body: content }
    } finally { clearTimeout(timeout) }
  } catch (error) {
    if (error instanceof SyncError) throw error
    return fail('NETWORK', 'WebDAV 网络请求失败；请检查网络、证书或浏览器 CORS/混合内容限制')
  }
}
function status(response: Response, accepted: number[]): void {
  if (accepted.includes(response.status)) return
  if (response.status === 401) fail('AUTH', 'WebDAV 身份验证失败，请检查安全凭据')
  if (response.status === 403) fail('FORBIDDEN', 'WebDAV 拒绝访问或写入，请检查目录权限')
  if (response.status === 412) fail('CONFLICT', '远端版本已变化，已停止写入；请重新读取预览后处理冲突')
  if (response.status >= 300 && response.status < 400 || response.status === 0) fail('REDIRECT', '同步地址发生重定向，请填写最终专用目录地址')
  fail('HTTP_STATUS', `WebDAV 请求未成功（HTTP ${response.status}）`)
}
function strongETag(value?: string): value is string { return typeof value === 'string' && /^"[^"\r\n]{1,256}"$/.test(value) }
export interface ConnectionTest { readWrite: boolean; etagVerified: boolean; cleanup: boolean; message: string }
export async function testConnection(connection: WebDavConnection): Promise<ConnectionTest> {
  proofs.delete(connection.id)
  const file = `.ceru-test-${randomUUID()}.txt`, first = `ceru-webdav-test-v1:${randomUUID()}`, second = first + ':updated'
  let created = false, etag: string | undefined, cleanup = false, result: ConnectionTest | undefined
  try {
    status(await webDavRequest(connection, 'OPTIONS'), [200, 204, 207])
    status(await webDavRequest(connection, 'PROPFIND', '', '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>', { Depth: '0', 'Content-Type': 'application/xml' }), [200, 207])
    status(await webDavRequest(connection, 'PUT', file, first, { 'If-None-Match': '*', 'Content-Type': 'text/plain; charset=utf-8' }), [200, 201, 204]); created = true
    const read = await webDavRequest(connection, 'GET', file); status(read, [200]); if (read.body !== first) fail('ROUNDTRIP', 'WebDAV 专用测试文件读回不一致')
    etag = read.headers.etag
    const absent = await webDavRequest(connection, 'PUT', file, first, { 'If-None-Match': '*' })
    const wrong = await webDavRequest(connection, 'PUT', file, first, { 'If-Match': '"ceru-deliberately-wrong-etag"' })
    let etagVerified = strongETag(etag) && absent.status === 412 && wrong.status === 412
    if (etagVerified) {
      status(await webDavRequest(connection, 'PUT', file, second, { 'If-Match': etag! }), [200, 204]); const updated = await webDavRequest(connection, 'GET', file); status(updated, [200])
      etagVerified = updated.body === second && strongETag(updated.headers.etag) && updated.headers.etag !== etag; etag = updated.headers.etag
    }
    proofs.set(connection.id, etagVerified)
    result = { readWrite: true, etagVerified, cleanup: false, message: etagVerified ? '专用文件读写和真实 ETag 条件写验证通过；可用于双向同步，冲突会保留副本。' : '专用文件读写通过，但条件写未验证；仅开放独立备份/恢复，不启用双向同步。' }
  } finally {
    if (created) { try { const response = await webDavRequest(connection, 'DELETE', file, undefined, strongETag(etag) ? { 'If-Match': etag } : {}); cleanup = [200, 204, 404].includes(response.status) } catch { cleanup = false } }
  }
  result!.cleanup = cleanup; if (!cleanup) result!.message += ' 临时测试文件清理失败，请检查专用目录中的 .ceru-test 文件。'
  persist(listConnections().map(item => item.id === connection.id ? { ...item, testedAt: Date.now(), etagVerified: result!.etagVerified } : item))
  return result!
}
function snapshotTextOf(snapshot: LibrarySnapshot): string {
  const raw = JSON.stringify(parseLibrarySnapshot(JSON.stringify(snapshot))); if (new TextEncoder().encode(raw).length > SYNC_MAX_BYTES) fail('LIMIT', '本地可移植快照超过 5 MiB 限制')
  return raw
}
function snapshotText(): string { return snapshotTextOf(exportLibrarySnapshot()) }
async function readRemote(connection: WebDavConnection): Promise<RemoteState> {
  const response = await webDavRequest(connection, 'GET', CURRENT_FILE)
  if (response.status === 404) return { missing: true }
  status(response, [200])
  if (!strongETag(response.headers.etag)) fail('UNVERIFIED', '远端快照没有可验证的强 ETag；已停止同步，本地库未修改')
  let snapshot: LibrarySnapshot
  try { snapshot = parseLibrarySnapshot(response.body) }
  catch { return fail('CORRUPT', '远端同步快照损坏或不是受支持的澜音快照；本地库未修改') }
  return { missing: false, snapshot, etag: response.headers.etag }
}
async function writeRemote(connection: WebDavConnection, snapshot: LibrarySnapshot, expectedEtag?: string): Promise<{ conflict: boolean; etag?: string }> {
  const headers: Record<string, string> = expectedEtag
    ? { 'If-Match': expectedEtag, 'Content-Type': 'application/json; charset=utf-8' }
    : { 'If-None-Match': '*', 'Content-Type': 'application/json; charset=utf-8' }
  const response = await webDavRequest(connection, 'PUT', CURRENT_FILE, snapshotTextOf(snapshot), headers)
  if (response.status === 412) return { conflict: true }
  status(response, [200, 201, 204])
  let etag = strongETag(response.headers.etag) ? response.headers.etag : undefined
  if (!etag) {
    const head = await webDavRequest(connection, 'HEAD', CURRENT_FILE)
    if (head.status === 404) fail('UNVERIFIED', '远端写入后快照消失，无法确认 ETag；本地基线未更新')
    status(head, [200])
    if (!strongETag(head.headers.etag)) fail('UNVERIFIED', '远端拒绝提供强 ETag；已停止同步，本地库未修改')
    etag = head.headers.etag
  }
  return { conflict: false, etag }
}
async function ensureEtagProof(connection: WebDavConnection): Promise<void> {
  if (proofs.get(connection.id) === true) return
  const proof = await testConnection(connection)
  if (!proof.etagVerified) fail('UNVERIFIED', '服务器未通过真实 ETag 条件写验证，已停止双向同步；本地库未修改')
}
function syncSummary(merged: ReturnType<typeof mergeSnapshots>, pushed: boolean, pulled: boolean): string {
  const parts: string[] = []
  if (pushed) parts.push('已条件写入远端')
  if (pulled) parts.push('已应用远端到本地')
  if (merged.conflicts.length) parts.push(`保留 ${merged.conflicts.length} 个冲突副本`)
  if (merged.stats.resurrectedTracks) parts.push(`首版不传播删除，保留 ${merged.stats.resurrectedTracks} 首歌单曲目`)
  if (merged.stats.resurrectedPlaylists) parts.push(`首版不传播删除，保留 ${merged.stats.resurrectedPlaylists} 个歌单`)
  if (merged.stats.favoriteResurrections) parts.push(`保留 ${merged.stats.favoriteResurrections} 首被删除收藏`)
  if (!parts.length) parts.push('本地与远端一致')
  return parts.join('；') + '。'
}
function assertLocalSnapshot(local: LibrarySnapshot): void {
  if (!snapshotsEqual(exportLibrarySnapshot(), local)) fail('LOCAL_CHANGED', '同步期间本地库已变化，已停止本次同步；本地库未修改')
}
export async function syncNow(connection: WebDavConnection): Promise<SyncResult> {
  const valid = publicConnection(connection)
  if (!valid) fail('SCOPE', '同步连接未授权或已失效')
  if (syncLocks.has(valid.id)) fail('BUSY', '此连接正在同步，请稍后再试')
  if (syncLocks.size > 0) fail('BUSY', '已有同步任务正在进行，请稍后再试')
  syncLocks.add(valid.id)
  const startedAt = new Date(), attemptAt = startedAt.getTime()
  const state = loadSyncState()
  const entry = entryFor(state, valid)
  const previousRemoteEtag = entry.remoteEtag, previousSyncedAt = entry.lastSyncedAt, previousSummary = entry.lastSummary, previousConflicts = entry.conflicts
  try {
    await ensureEtagProof(valid)
    const local = exportLibrarySnapshot()
    let baseline: LibrarySnapshot | undefined
    if (entry.baseline) {
      try { baseline = parseLibrarySnapshot(JSON.stringify(entry.baseline)) }
      catch { entry.baseline = undefined; entry.remoteEtag = undefined }
    }
    let remote = await readRemote(valid)
    entry.remoteAt = Date.now()
    entry.remoteExists = !remote.missing
    let merged = mergeSnapshots(local, baseline, local, { now: startedAt })
    let pushed = false, writeAttempts = 0
    for (;;) {
      if (remote.missing) {
        merged = mergeSnapshots(local, undefined, local, { now: startedAt })
        assertLocalSnapshot(local)
        const write = await writeRemote(valid, local)
        if (!write.conflict) { entry.remoteEtag = write.etag; pushed = true; break }
      } else {
        if (!remote.snapshot || !remote.etag) fail('UNVERIFIED', '远端快照或 ETag 缺失；已停止同步，本地库未修改')
        merged = mergeSnapshots(local, baseline, remote.snapshot, { now: startedAt })
        if (snapshotsEqual(merged.snapshot, remote.snapshot)) { entry.remoteEtag = remote.etag; break }
        assertLocalSnapshot(local)
        const write = await writeRemote(valid, merged.snapshot, remote.etag)
        if (!write.conflict) { entry.remoteEtag = write.etag; pushed = true; break }
      }
      if (++writeAttempts >= 2) fail('CONFLICT', '远端在读取后连续变化，已停止写入；本地库未修改，请稍后重试')
      remote = await readRemote(valid)
      entry.remoteAt = Date.now()
      entry.remoteExists = !remote.missing
    }
    const remoteEtag = entry.remoteEtag
    if (!remoteEtag) fail('UNVERIFIED', '同步完成后没有可验证的远端 ETag；本地基线未更新')
    const localChanged = !snapshotsEqual(local, merged.snapshot)
    const previousBaseline = localChanged && !pushed && entry.baseline ? JSON.parse(JSON.stringify(entry.baseline)) as LibrarySnapshot : undefined
    let committed: ReturnType<typeof applyLibrarySnapshot> | undefined
    if (localChanged) { assertLocalSnapshot(local); committed = applyLibrarySnapshot(merged.snapshot) }
    else assertLocalSnapshot(local)
    const counts = snapshotCounts(merged.snapshot)
    entry.remoteExists = true
    entry.remotePlaylists = counts.playlists
    entry.remoteTracks = counts.tracks
    entry.remoteFavorites = counts.favorites
    entry.baseline = merged.snapshot
    entry.remoteEtag = remoteEtag
    entry.lastSyncedAt = Date.now()
    entry.lastAttemptAt = attemptAt
    entry.lastError = undefined
    entry.conflicts = merged.conflicts.length
    const summary = syncSummary(merged, pushed, localChanged)
    entry.lastSummary = summary
    try { saveSyncState(state) }
    catch (error) {
      if (committed) { try { committed.undo() } catch {} }
      throw error
    }
    const undo = localChanged && !pushed && committed ? () => {
      committed!.undo()
      const latest = loadSyncState()
      const current = entryFor(latest, valid)
      current.baseline = previousBaseline
      current.remoteEtag = previousRemoteEtag
      current.lastSyncedAt = previousSyncedAt
      current.lastSummary = previousSummary
      current.conflicts = previousConflicts
      saveSyncState(latest)
    } : undefined
    return { status: pushed && localChanged ? 'merged' : pushed ? 'pushed' : localChanged ? 'pulled' : 'up-to-date',
      pushed, pulled: localChanged, conflicts: merged.conflicts, stats: merged.stats, remoteEtag, summary, ...(undo ? { undo } : {}) }
  } catch (error) {
    try {
      const latest = loadSyncState()
      const failed = entryFor(latest, valid)
      failed.lastAttemptAt = attemptAt
      failed.lastError = error instanceof Error ? error.message.slice(0, 500) : '同步失败，本地库未修改'
      saveSyncState(latest)
    } catch {}
    throw error
  } finally { syncLocks.delete(valid.id) }
}
export async function createBackup(connection: WebDavConnection): Promise<string> {
  const file = `.ceru-backup-${Date.now()}-${randomUUID()}.json`
  status(await webDavRequest(connection, 'PUT', file, snapshotText(), { 'If-None-Match': '*', 'Content-Type': 'application/json; charset=utf-8' }), [200, 201, 204])
  return file
}
export interface RemotePreview { file: string; snapshot: ReturnType<typeof parseLibrarySnapshot>; etag?: string }
export async function readBackup(connection: WebDavConnection, file: string): Promise<RemotePreview> {
  const response = await webDavRequest(connection, 'GET', file); status(response, [200])
  let snapshot: ReturnType<typeof parseLibrarySnapshot>
  try { snapshot = parseLibrarySnapshot(response.body) } catch { return fail('CORRUPT', '远端文件损坏或不是受支持的澜音白名单快照；没有修改本地库') }
  if (strongETag(response.headers.etag)) observed.set(`${connection.id}:${file}`, response.headers.etag)
  return { file, snapshot, ...(strongETag(response.headers.etag) ? { etag: response.headers.etag } : {}) }
}
export async function publishCurrentBackup(connection: WebDavConnection): Promise<void> {
  if (proofs.get(connection.id) !== true) fail('UNVERIFIED', '请先完成本次连接的真实 ETag 条件写测试；未开放覆盖备份')
  const etag = observed.get(`${connection.id}:${CURRENT_FILE}`)
  if (!etag) {
    const existing = await webDavRequest(connection, 'HEAD', CURRENT_FILE)
    if (existing.status !== 404) { status(existing, [200, 204]); fail('REMOTE_EXISTS', '远端当前备份已存在，请先读取预览以确认版本，或保存独立新备份') }
  }
  const response = await webDavRequest(connection, 'PUT', CURRENT_FILE, snapshotText(), etag ? { 'If-Match': etag, 'Content-Type': 'application/json; charset=utf-8' } : { 'If-None-Match': '*', 'Content-Type': 'application/json; charset=utf-8' })
  status(response, [200, 201, 204]); if (strongETag(response.headers.etag)) observed.set(`${connection.id}:${CURRENT_FILE}`, response.headers.etag); else observed.delete(`${connection.id}:${CURRENT_FILE}`)
}
export function commitRestore(preview: RemotePreview, mode: 'merge' | 'replace'): ReturnType<typeof commitLibrarySnapshot> {
  return commitLibrarySnapshot(preview.snapshot, { mode })
}
export const currentBackupFile = CURRENT_FILE
export async function listBackups(connection: WebDavConnection): Promise<string[]> {
  const response = await webDavRequest(connection, 'PROPFIND', '', '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>', { Depth: '1', 'Content-Type': 'application/xml' }); status(response, [207])
  if (/<!DOCTYPE|<!ENTITY/i.test(response.body)) fail('XML', '目录响应包含不允许的 XML 声明')
  const document = new DOMParser().parseFromString(response.body, 'application/xml'); if (document.querySelector('parsererror')) fail('XML', 'WebDAV 目录响应无效')
  const files = new Set<string>()
  for (const node of Array.from(document.getElementsByTagNameNS('DAV:', 'href')).slice(0, 500)) {
    try { const url = new URL(node.textContent || '', fileUrl(connection)); if (url.origin !== connection.origin || !url.pathname.startsWith(connection.basePath)) continue; const file = decodeURIComponent(url.pathname.slice(connection.basePath.length)); fileUrl(connection, file); if (!file.startsWith('.ceru-test-')) files.add(file) } catch {}
  }
  return [...files].sort().reverse().slice(0, 200)
}
