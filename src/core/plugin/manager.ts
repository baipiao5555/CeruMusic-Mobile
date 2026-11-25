import { reactive, ref } from 'vue'
import { readPluginArtifact } from '@shiqianjiang/ceru-plugin-core'
import { PluginHost, type PluginHostHooks, type PluginNotice } from './host'
import { requestRemote, validateRemoteUrl } from './network'
import { idb, sha256Hex } from '../storage/idb'
import { toTrack, type Track } from '../track'
import { logEvent } from '../logs'
import { assertAccountSummary, type AccountSummary } from '@shiqianjiang/ceru-plugin-sdk'
import { accountSurfaceEvent, type AccountSurfaceSpec } from './accountSurface'
import { invalidateOwnerResources } from '../resourceNavigation'
import { secureStore } from '../native/secureStore'
import { inspectLxPlugin } from './lx'
import { normalizeKnownPluginCode } from './compat'
export { normalizeKnownPluginCode as preparePluginCode } from './compat'
import { repositoryPath, requestRepository } from './distribution'
import { compareVersions } from '../version'

interface PluginProviderInfo {
  id: string
  name: string
  qualities: string[]
  protocols: string[]
  methods: string[]
  iconUrl?: string
}

export interface PluginDescriptor {
  pluginId: string
  manifestId: string
  name: string
  version: string
  author: string
  description: string
  enabled: boolean
  running: boolean
  loadError?: string
  order: number
  providers: PluginProviderInfo[]
  iconUrls: Record<string, string>
  configSchema: any[]
  configDefaults: Record<string, any>
  permissions: any[]
  homeSections: any[]
  commands: any[]
  playlistImporters: any[]
  accountItems: any[]
  surfaces: any[]
  sourceUrl?: string
  /** Effective URL used for auto-update; local files may get this from metadata. */
  updateUrl?: string
  installOrigin?: 'market' | 'url' | 'file' | 'unknown'
  catalogKey?: string
  artifactSha256?: string
  hasRollback?: boolean
  format?: 'lx' | 'musicfree'
}

interface PluginRecord {
  pluginId: string
  code: string
  manifest: any
  enabled: boolean
  order: number
  grants: string[]
  denied: string[]
  installedAt: number
  sourceUrl?: string
  updateUrl?: string
  loadError?: string
  installOrigin?: 'market' | 'url' | 'file' | 'unknown'
  catalogKey?: string
  artifactSha256?: string
  previous?: PluginRecord
  previousConfig?: Record<string, any>
}

export interface SearchSourceSelection { pluginId: string; providerId: string }
export const pluginState = reactive({
  plugins: [] as PluginDescriptor[],
  loading: true,
  initialized: false,
  selectedProvider: '' as string,
  selectedSourcePlugin: {} as Record<string, string>,
  searchSources: [] as SearchSourceSelection[],
  accountEpochs: {} as Record<string, number>
})

export const pluginToasts = ref<
  Array<{ id: number; message: string; level: string; actionLabel?: string; actionTo?: string }>
>([])
export const permissionRequest = ref<{
  pluginName: string
  name: string
  reason: string
} | null>(null)
export const navigationRequest = ref<any>(null)

let resolvePermission: ((allowed: boolean) => void) | null = null
let toastId = 0
const hosts = new Map<string, PluginHost>()
const records = new Map<string, PluginRecord>()
const hostHooks: Partial<PluginHostHooks> = {}

function showToast(message: string, level = 'info'): void {
  if (!message) return
  if (level === 'error') logEvent('error', 'UI', message)
  else if (level === 'warning' || level === 'warn') logEvent('warn', 'UI', message)
  const id = ++toastId
  const toast: { id: number; message: string; level: string; actionLabel?: string; actionTo?: string } = {
    id,
    message,
    level
  }
  if (level === 'error') {
    toast.actionLabel = '查看日志'
    toast.actionTo = '/logs?level=error'
  }
  pluginToasts.value.push(toast)
  setTimeout(
    () => {
      pluginToasts.value = pluginToasts.value.filter((item) => item.id !== id)
    },
    toast.actionLabel ? 6000 : 3200
  )
}

/** General-purpose toast, reusing the plugin toast stack. */
export function notify(message: string, level = 'info'): void {
  showToast(message, level)
}

export function answerPermission(allowed: boolean): void {
  const resolver = resolvePermission
  resolvePermission = null
  permissionRequest.value = null
  resolver?.(allowed)
}

export function registerHostHooks(hooks: Partial<PluginHostHooks>): void {
  Object.assign(hostHooks, hooks)
}

function hooksFor(): PluginHostHooks {
  return {
    onNotice: (notice: PluginNotice) => showToast(notice.message, notice.level ?? 'info'),
    onPermissionRequest: (request) =>
      new Promise<boolean>((resolve) => {
        resolvePermission = resolve
        permissionRequest.value = {
          pluginName: request.pluginName,
          name: request.name,
          reason: request.reason
        }
      }),
    onNavigate: (request) => {
      if (request.type === 'state' || request.type === 'close-view') { accountSurfaceEvent(request); return }
      navigationRequest.value = request
    },
    player: {
      getState: (args) => hostHooks.player?.getState?.(args),
      play: (args) => hostHooks.player?.play?.(args),
      pause: (args) => hostHooks.player?.pause?.(args),
      next: (args) => hostHooks.player?.next?.(args),
      previous: (args) => hostHooks.player?.previous?.(args),
      seek: (args) => hostHooks.player?.seek?.(args),
      setVolume: (args) => hostHooks.player?.setVolume?.(args),
      setMode: (args) => hostHooks.player?.setMode?.(args)
    },
    queue: {
      get: (args) => hostHooks.queue?.get?.(args),
      append: (args) => hostHooks.queue?.append?.(args),
      replace: (args) => hostHooks.queue?.replace?.(args),
      remove: (args) => hostHooks.queue?.remove?.(args),
      reorder: (args) => hostHooks.queue?.reorder?.(args)
    },
    favorites: {
      contains: (args) => hostHooks.favorites?.contains?.(args),
      add: (args) => hostHooks.favorites?.add?.(args),
      remove: (args) => hostHooks.favorites?.remove?.(args)
    },
    history: () => hostHooks.history?.() ?? [],
    settings: hostHooks.settings,
    library: {
      list: () => hostHooks.library?.list() ?? [],
      getTracks: (id) => hostHooks.library?.getTracks?.(id) ?? []
    },
    downloads: hostHooks.downloads
  }
}

function descriptorFor(record: PluginRecord, host?: PluginHost): PluginDescriptor {
  const manifest = host?.getManifest() ?? record.manifest
  const methods = host?.getProviderMethods() ?? {}
  const iconUrls = host?.getProviderIconUrls() ?? {}
  const providers: PluginProviderInfo[] = (manifest.contributes?.providers ?? []).map((provider: any) => ({
    id: provider.id,
    name: provider.name ?? provider.id,
    qualities: provider.qualities ?? [],
    protocols: provider.protocols ?? [],
    methods: methods[provider.id] ?? [],
    iconUrl: iconUrls[provider.id]
  }))
  return {
    pluginId: record.pluginId,
    manifestId: manifest.id,
    name: manifest.name,
    version: manifest.version,
    author: manifest.author ?? manifest.publisher ?? '',
    description: manifest.description ?? '',
    enabled: record.enabled,
    running: Boolean(host),
    loadError: record.loadError,
    order: record.order,
    providers,
    iconUrls,
    configSchema: host?.getConfigSchema() ?? [],
    configDefaults:
      host?.getConfigDefaults() ??
      (manifest.config && typeof manifest.config === 'object' ? manifest.config : {}),
    permissions: manifest.permissions ?? [],
    homeSections: manifest.contributes?.homeSections ?? [],
    commands: manifest.contributes?.commands ?? [],
    playlistImporters: manifest.contributes?.playlistImporters ?? [],
    accountItems: manifest.contributes?.accountItems ?? [],
    surfaces: manifest.modules?.surfaces ?? [],
    sourceUrl: record.sourceUrl,
    updateUrl: record.updateUrl ?? record.sourceUrl,
    installOrigin: record.installOrigin,
    catalogKey: record.catalogKey,
    artifactSha256: record.artifactSha256,
    hasRollback: Boolean(record.previous),
    format: manifest.id?.startsWith('musicfree.') ? 'musicfree' : manifest.format
  }
}

function refresh(): void {
  pluginState.plugins = [...records.values()]
    .sort((a, b) => a.order - b.order)
    .map((record) => descriptorFor(record, hosts.get(record.pluginId)))
  const selected = pluginState.selectedProvider, active = allProviders(true)
  const owner = pluginState.selectedSourcePlugin[selected]
  if (active.some(p => p.providerId === selected && (!owner || p.pluginId === owner))) return
  const eligible = pluginState.searchSources.length ? active.filter(p => pluginState.searchSources.some(s => s.pluginId === p.pluginId && s.providerId === p.providerId)) : active
  const platform = (id: string) => ({kw:'kuwo',kg:'kugou',tx:'qq',wy:'netease',mg:'migu'} as Record<string,string>)[id] || id
  const next = eligible.find(p => platform(p.providerId) === platform(selected)) || eligible[0]
  pluginState.selectedProvider = next?.providerId || ''
  if (next) pluginState.selectedSourcePlugin[next.providerId] = next.pluginId

}

async function save(record: PluginRecord): Promise<void> {
  await idb.set('plugins', record.pluginId, record)
  records.set(record.pluginId, record)
}

const pluginOperations = new Set<string>()
async function withPluginOperation<T>(id: string, operation: () => Promise<T>): Promise<T> {
  if (pluginOperations.has(id)) throw new Error('这个插件正在安装、更新或管理，请稍后重试')
  pluginOperations.add(id)
  try { return await operation() } finally { pluginOperations.delete(id) }
}

async function getConfig(pluginId: string): Promise<Record<string, any>> {
  return (await idb.get('pluginConfig', pluginId)) ?? {}
}

async function saveConfig(pluginId: string, config: Record<string, any>): Promise<void> {
  // Config is JSON data; Vue reactive proxies cannot be cloned by IndexedDB.
  await idb.set('pluginConfig', pluginId, JSON.parse(JSON.stringify(config)))
}

export interface ProviderHandle {
  pluginId: string
  manifestId: string
  pluginName: string
  providerId: string
  name: string
  qualities: string[]
  protocols: string[]
  methods: string[]
}

function providerHandle(
  plugin: Pick<PluginDescriptor, 'pluginId' | 'manifestId' | 'name'>,
  provider: {
    id: string
    name?: string
    qualities?: string[]
    protocols?: string[]
    methods?: string[]
  }
): ProviderHandle {
  return {
    pluginId: plugin.pluginId,
    manifestId: plugin.manifestId,
    pluginName: plugin.name,
    providerId: provider.id,
    name: provider.name ?? provider.id,
    qualities: provider.qualities ?? [],
    protocols: provider.protocols ?? [],
    methods: provider.methods ?? []
  }
}

export function allProviders(includeAlternatives = false): ProviderHandle[] {
  const result: ProviderHandle[] = []
  for (const plugin of pluginState.plugins) {
    if (!plugin.running) continue
    for (const provider of plugin.providers) {
      const owner = pluginState.selectedSourcePlugin[provider.id]
      const ownerRunning = owner && pluginState.plugins.some(
        (item) => item.pluginId === owner && item.running &&
          item.providers.some((candidate) => candidate.id === provider.id)
      )
      if (!includeAlternatives && ownerRunning && owner !== plugin.pluginId) continue
      result.push(providerHandle(plugin, provider))
    }
  }
  return result
}

/** Explicit multi-source search scope, separate from default provider and plugin enable flags. */
export function searchProviders(): ProviderHandle[] {
  if (pluginState.searchSources.length) return allProviders(true).filter(p => pluginState.searchSources.some(s => s.pluginId === p.pluginId && s.providerId === p.providerId))
  const providers = allProviders()
  const selected = providers.find(p => p.providerId === pluginState.selectedProvider && (!pluginState.selectedSourcePlugin[p.providerId] || pluginState.selectedSourcePlugin[p.providerId] === p.pluginId))
  return selected ? [selected] : providers.slice(0, 1)
}
export function setSearchSources(sources: SearchSourceSelection[]): void {
  const active = allProviders(true)
  if (!sources.length || sources.some(s => !active.some(p => p.pluginId === s.pluginId && p.providerId === s.providerId))) throw new Error('请选择至少一个已启用的平台来源')
  const unique = sources.filter((s, i) => sources.findIndex(x => x.pluginId === s.pluginId && x.providerId === s.providerId) === i).map(s => ({ pluginId:s.pluginId, providerId:s.providerId }))
  localStorage.setItem('ceru.searchSources.v1', JSON.stringify(unique))
  pluginState.searchSources = unique
}
export interface PlaylistImporterHandle {
  pluginId: string
  pluginName: string
  id: string
  title: string
  description?: string
  placeholder?: string
  instructions: string[]
  examples: Array<{ label: string; value: string }>
  providerId?: string
}

export interface ImportedPlaylist {
  name: string
  tracks: Track[]
}

export function allImporters(): PlaylistImporterHandle[] {
  return pluginState.plugins
    .filter((plugin) => plugin.running)
    .flatMap((plugin) =>
      (plugin.playlistImporters ?? []).map((item: any) => ({
        pluginId: plugin.pluginId,
        pluginName: plugin.name,
        id: item.id,
        title: item.title ?? item.id,
        description: item.description,
        placeholder: item.placeholder,
        instructions: Array.isArray(item.instructions) ? item.instructions : [],
        examples: Array.isArray(item.examples) ? item.examples : [],
        providerId: item.providerId
      }))
    )
}

function providerHandleFor(pluginId: string, providerId?: string): ProviderHandle | null {
  const plugin = pluginState.plugins.find((item) => item.pluginId === pluginId)
  if (!plugin) return null
  const provider = plugin.providers.find((item) => item.id === providerId) ?? plugin.providers[0]
  return providerHandle(plugin, {
    id: provider?.id ?? providerId ?? 'import',
    name: provider?.name ?? providerId ?? '导入歌单',
    qualities: provider?.qualities,
    protocols: provider?.protocols,
    methods: provider?.methods
  })
}

const SHARE_URL_RE = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/i
const LABELED_ID_RE = /(?:playlist\s*id|playlistid|pid|歌单\s*id|歌单id)\s*[=:：]\s*([A-Za-z0-9_-]+)/i
const BARE_ID_RE = /^[A-Za-z0-9_-]+$/
const TRAILING_PUNCT_RE = /[)\]）】,，。;；!！?？"'”’]+$/

/**
 * Share sheets usually copy a sentence around the link. Extract the first
 * usable link or playlist ID so importers do not receive the whole message.
 */
function normalizePlaylistInput(raw: string): string {
  const value = raw.trim()
  if (!value) return value
  const url = value.match(SHARE_URL_RE)?.[0]
  if (url) return url.replace(TRAILING_PUNCT_RE, '')
  const labeled = value.match(LABELED_ID_RE)?.[1]
  if (labeled) return labeled
  if (BARE_ID_RE.test(value)) return value
  const numericIds = value.match(/\d{6,}/g)
  if (numericIds?.length === 1) return numericIds[0]
  return value
}

/** Import a playlist through a plugin importer, following pagination. */
export async function importPlaylist(
  importer: PlaylistImporterHandle,
  value: string
): Promise<ImportedPlaylist> {
  const host = hosts.get(importer.pluginId)
  if (!host) throw new Error('插件未运行，请先启用插件')
  // 桌面端把内容原样交给插件；部分插件会从整段分享文案里解析参数。
  // 先按原样调用，失败后再用提取出的链接/ID 重试。
  const raw = value.trim().slice(0, 8192)
  // LX validates the platform URL itself; never retry a foreign URL as a bare ID.
  const candidates = (pluginState.plugins.find(p => p.pluginId === importer.pluginId)?.format === 'lx' ? [raw] : [raw, normalizePlaylistInput(value)]).filter(
    (item, index, list) => item && list.indexOf(item) === index
  )
  let lastError: unknown
  for (const candidate of candidates) {
    try {
      return await importPlaylistWith(host, importer, candidate)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('导入失败')
}

async function importPlaylistWith(
  host: PluginHost,
  importer: PlaylistImporterHandle,
  target: string
): Promise<ImportedPlaylist> {
  const tracks: Track[] = []
  const seen = new Set<string>()
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  let name = importer.title
  for (let page = 0; page < 50; page++) {
    const result = await host.importPlaylist(importer.id, target, cursor, 100)
    if (result?.playlist?.name) name = result.playlist.name
    else if (result?.name) name = result.name
    for (const item of result?.items ?? []) {
      if (item?.ref?.kind !== 'track') continue
      const provider = providerHandleFor(importer.pluginId, importer.providerId ?? item.ref.providerId)
      if (!provider) continue
      const track = toTrack(item, provider)
      const key = `${track.providerId}:${track.id}`
      if (seen.has(key)) continue
      seen.add(key)
      tracks.push(track)
    }
    cursor = result?.nextCursor
    if (!cursor) break
    if (seenCursors.has(cursor)) throw new Error('歌单分页游标重复，导入已取消')
    seenCursors.add(cursor)
    if (tracks.length >= 5000 || page === 49) throw new Error('歌单超过 5000 首导入上限，未提交不完整歌单')
  }
  return { name, tracks }
}

export async function initPlugins(): Promise<void> {
  if (pluginState.initialized) return
  pluginState.initialized = true
  try {
    let selectedProvider = pluginState.selectedProvider
    try {
      const selected = JSON.parse(localStorage.getItem('ceru.selectedSourcePlugin') || '{}')
      if (selected && typeof selected === 'object' && !Array.isArray(selected)) {
        pluginState.selectedSourcePlugin = Object.fromEntries(
          Object.entries(selected).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        )
      }
      selectedProvider = localStorage.getItem('ceru.selectedProvider') || ''
      const scope = JSON.parse(localStorage.getItem('ceru.searchSources.v1') || '[]')
      if (Array.isArray(scope) && scope.length <= 200) pluginState.searchSources = scope.filter(x => typeof x?.pluginId === 'string' && typeof x?.providerId === 'string').map(x => ({pluginId:x.pluginId,providerId:x.providerId}))
    } catch {}
    const list = await idb.all<PluginRecord>('plugins')
    for (const record of list) {
      records.set(record.pluginId, record)
      // 旧版本只给链接安装的插件记录更新地址。升级后补全一次，
      // 让文件安装的插件也能使用 manifest 里声明的更新地址。
      if (!record.updateUrl) {
        const updateUrl = record.sourceUrl ?? manifestUpdateUrl(record.manifest)
        if (updateUrl) {
          record.updateUrl = updateUrl
          await save(record).catch(() => undefined)
        }
      }
    }
    refresh()
    for (const record of list) {
      if (!record.enabled) continue
      try {
        await enablePlugin(record.pluginId)
      } catch (error) {
        console.warn('恢复插件失败:', error)
      }
    }
    if (allProviders().some((provider) => provider.providerId === selectedProvider)) {
      pluginState.selectedProvider = selectedProvider
    }
    pluginState.loading = false
  } catch (error) {
    console.error('读取插件失败:', error)
    pluginState.loading = false
  }
}

function manifestUpdateUrl(manifest: any): string | undefined {
  const explicit = manifest?.updateUrl ?? manifest?.updateurl
  if (typeof explicit === 'string' && /^https?:\/\//i.test(explicit.trim())) {
    return explicit.trim()
  }
  const homepage = manifest?.homepage
  // 只有明确指向脚本文件的 homepage 才作为更新地址，避免把项目主页当 JS 下载。
  if (typeof homepage === 'string' && /^https?:\/\/.+\.(?:js|mjs)(?:[?#].*)?$/i.test(homepage.trim())) {
    return homepage.trim()
  }
  return undefined
}

export async function installPlugin(
  code: string,
  options: {
    enable?: boolean
    grantDeclared?: boolean
    sourceUrl?: string
    updateUrl?: string
    installOrigin?: 'market' | 'url' | 'file' | 'unknown'
    catalogKey?: string
  } = {}
): Promise<PluginDescriptor> {
  if (new TextEncoder().encode(code).byteLength > 16 * 1024 * 1024) throw new Error('插件文件过大')
  code = await normalizeKnownPluginCode(code)
  const manifest = inspectPlugin(code)
  if (typeof manifest.id !== 'string' || !manifest.id || !Array.isArray(manifest.permissions || [])) throw new Error('插件声明缺少有效 ID 或权限清单')
  if (manifest.format !== 'lx' && manifest.manifestVersion !== 2) throw new Error('只支持澜音 v2 插件或洛雪音源')
  const pluginId = (await sha256Hex(manifest.id)).slice(0, 32)
  return withPluginOperation(pluginId, async () => {
  const original = records.get(pluginId)
  const existing: PluginRecord | undefined = original ? JSON.parse(JSON.stringify(original)) : undefined
  if (existing && (existing.manifest.publisher || existing.manifest.author || '') !== (manifest.publisher || manifest.author || '')) {
    throw new Error('同 ID 插件的发布身份发生变化，不能自动覆盖；请核对来源')
  }
  const configBefore = existing ? await getConfig(pluginId) : {}
  const selectedBefore = pluginState.selectedProvider
  const ownerBefore = pluginState.selectedSourcePlugin[selectedBefore] || allProviders().find(p => p.providerId === selectedBefore)?.pluginId
  const declarations = manifest.permissions ?? []
  const grants = options.grantDeclared === false
    ? existing?.grants ?? []
    : declarations.map((permission: any) =>
        `${permission.key}:${permission.name}:${stableScope(permission.scope ?? {})}`
      )
  const record: PluginRecord = {
    pluginId,
    code,
    manifest,
    enabled: options.enable ?? existing?.enabled ?? false,
    order: existing?.order ?? records.size,
    grants,
    denied: existing?.denied ?? [],
    installedAt: existing?.installedAt ?? Date.now(),
    sourceUrl: options.installOrigin === 'file' ? undefined : options.sourceUrl ?? existing?.sourceUrl,
    updateUrl:
      options.updateUrl ??
      options.sourceUrl ??
      existing?.updateUrl ??
      manifestUpdateUrl(manifest),
    installOrigin: options.installOrigin ?? existing?.installOrigin ?? (options.sourceUrl ? 'url' : 'file'),
    catalogKey: options.catalogKey ?? existing?.catalogKey,
    artifactSha256: await sha256Hex(code),
    previous: existing ? { ...existing, previous: undefined, previousConfig: undefined } : undefined,
    previousConfig: existing ? configBefore : undefined
  }
  const oldHost = hosts.get(pluginId)
  let saved = false, disposed = false
  try {
    // Persist first. Quota/storage failures must not stop the currently working host.
    await save(record); saved = true
    if (oldHost) { hosts.delete(pluginId); disposed = true; await oldHost.dispose() }
    refresh()
    if (options.enable !== false && (options.enable !== undefined || !existing || existing.enabled)) await enablePluginInternal(pluginId)
    if (selectedBefore && allProviders(true).some(p => p.providerId === selectedBefore && (!ownerBefore || p.pluginId === ownerBefore))) {
      selectProvider(selectedBefore, ownerBefore)
    }
    return descriptorFor(record, hosts.get(pluginId))
  } catch (error: any) {
    if (!saved) throw error
    const failedHost = hosts.get(pluginId)
    hosts.delete(pluginId)
    await failedHost?.dispose().catch(() => undefined)
    try {
      if (existing) {
        await save(existing); await saveConfig(pluginId, configBefore)
        if (existing.enabled && disposed) await enablePluginInternal(pluginId)
      } else { await idb.del('plugins', pluginId); records.delete(pluginId) }
      refresh()
      if (selectedBefore && allProviders(true).some(p => p.providerId === selectedBefore && (!ownerBefore || p.pluginId === ownerBefore))) selectProvider(selectedBefore, ownerBefore)
    } catch (restoreError: any) { throw new Error(`${error?.message || error}；旧版恢复失败：${restoreError?.message || restoreError}`) }
    throw error
  }
  })
}

export async function restorePluginPrevious(pluginId: string): Promise<PluginDescriptor> {
  return withPluginOperation(pluginId, async () => {
    const current = records.get(pluginId), previous = current?.previous
    if (!current || !previous) throw new Error('没有可恢复的上一版插件')
    if (inspectPlugin(previous.code).id !== current.manifest.id) throw new Error('恢复文件身份不一致')
    const config = await getConfig(pluginId)
    await save(previous)
    const host = hosts.get(pluginId); hosts.delete(pluginId)
    try {
      await host?.dispose()
      await saveConfig(pluginId, current.previousConfig || {})
      if (previous.enabled) await enablePluginInternal(pluginId)
      refresh(); return descriptorFor(previous, hosts.get(pluginId))
    } catch (error) {
      const failedHost = hosts.get(pluginId); hosts.delete(pluginId)
      await failedHost?.dispose().catch(() => undefined)
      await save(current); await saveConfig(pluginId, config)
      if (current.enabled) await enablePluginInternal(pluginId)
      refresh(); throw error
    }
  })
}

export interface PluginUpdateCandidate {
  pluginId: string; code: string; manifest: any; previousVersion: string; version: string
  previousHash: string; contentHash: string; versionOrder: number; contentChanged: boolean
  permissionsChanged: boolean; removedProviders: string[]
}
export async function previewPluginUpdate(pluginId: string): Promise<PluginUpdateCandidate> {
  const record = records.get(pluginId)
  if (!record) throw new Error('插件不存在')
  const url = record.updateUrl || record.sourceUrl
  if (!url) throw new Error('没有更新地址；可在来源详情绑定同一插件的文件链接')
  const code = await fetchPluginCode(url), manifest = inspectPlugin(code)
  if (manifest.id !== record.manifest.id) throw new Error('更新文件与已安装音源 ID 不一致')
  if ((manifest.publisher || manifest.author || '') !== (record.manifest.publisher || record.manifest.author || '')) throw new Error('更新文件发布身份发生变化，需人工核对')
  const permissionKeys = (m: any) => (m.permissions || []).map((p: any) => `${p.key}:${p.name}:${stableScope(p.scope || {})}`).sort()
  const previousHash = await sha256Hex(record.code), contentHash = await sha256Hex(code)
  const nextProviders = new Set((manifest.contributes?.providers || []).map((p: any) => p.id))
  return { pluginId, code, manifest, previousVersion: record.manifest.version, version: manifest.version,
    previousHash, contentHash, versionOrder: comparePluginVersions(manifest.version, record.manifest.version),
    contentChanged: previousHash !== contentHash,
    permissionsChanged: permissionKeys(manifest).some((p: string) => !permissionKeys(record.manifest).includes(p)),
    removedProviders: manifest.format === 'lx' ? [] : (record.manifest.contributes?.providers || []).filter((p: any) => !nextProviders.has(p.id)).map((p: any) => p.name || p.id) }
}
export async function applyPluginUpdate(candidate: PluginUpdateCandidate, confirmPermissions = false): Promise<PluginDescriptor> {
  const record = records.get(candidate.pluginId)
  if (!record || await sha256Hex(record.code) !== candidate.previousHash || await sha256Hex(candidate.code) !== candidate.contentHash) throw new Error('插件或候选文件已经变化，请重新检查并确认')
  if (candidate.versionOrder < 0) throw new Error('不自动降级；如需回退请恢复上一版')
  if (candidate.permissionsChanged && !confirmPermissions) throw new Error('更新权限发生变化，需要重新确认')
  return installPlugin(candidate.code, { enable: record.enabled, grantDeclared: confirmPermissions && candidate.permissionsChanged,
    sourceUrl: record.sourceUrl, updateUrl: record.updateUrl, installOrigin: record.installOrigin, catalogKey: record.catalogKey })
}

export const comparePluginVersions = compareVersions

/** Re-downloads a plugin with an update URL and replaces it when the manifest version is newer. */
export async function checkPluginUpdate(
  pluginId: string
): Promise<{ updated: boolean; previousVersion: string; version: string }> {
  const candidate = await previewPluginUpdate(pluginId)
  if (candidate.versionOrder <= 0) return { updated: false, previousVersion: candidate.previousVersion, version: candidate.previousVersion }
  if (candidate.permissionsChanged || candidate.removedProviders.length) throw new Error('更新权限或平台发生变化，请到音源市场确认后更新')
  await applyPluginUpdate(candidate)
  return { updated: true, previousVersion: candidate.previousVersion, version: candidate.version }
}

/** Allows a file-installed plugin to get a remote update source. */
export async function setPluginUpdateUrl(pluginId: string, url: string): Promise<PluginDescriptor> {
  return withPluginOperation(pluginId, async () => {
  const record = records.get(pluginId)
  if (!record) throw new Error('插件不存在')
  const value = url.trim()
  if (!/^https?:\/\//i.test(value)) throw new Error('更新地址必须是公网 HTTP(S) 链接')
  const code = await fetchPluginCode(value)
  const manifest = inspectPlugin(code)
  if (manifest.id !== record.manifest.id) throw new Error('更新地址返回的音源与已安装的不一致')
  if ((manifest.publisher || manifest.author || '') !== (record.manifest.publisher || record.manifest.author || '')) throw new Error('更新地址的发布身份发生变化，请核对来源')
  const previousUrl = record.updateUrl
  record.updateUrl = value
  try { await save(record) } catch (error) { record.updateUrl = previousUrl; throw error }
  refresh()
  return descriptorFor(record, hosts.get(pluginId))
  })
}

const PLUGIN_UPDATE_CLOCK_KEY = 'ceru.pluginUpdate.lastChecked'
const PLUGIN_UPDATE_INTERVAL = 6 * 60 * 60 * 1000

export interface PluginUpdateSummary {
  pluginId: string
  name: string
  updated: boolean
  version: string
  previousVersion: string
  error?: string
  available?: boolean
}

function readUpdateClock(): number {
  try {
    return Number(localStorage.getItem(PLUGIN_UPDATE_CLOCK_KEY)) || 0
  } catch {
    return 0
  }
}

function markUpdateChecked(): void {
  try {
    localStorage.setItem(PLUGIN_UPDATE_CLOCK_KEY, String(Date.now()))
  } catch {}
}

/**
 * 自动检查带有更新地址的插件（链接安装或手动绑定）：有新版本就替换并提示。
 * 默认 6 小时内只跑一次，force 可以无视节流；单个插件失败不影响其它插件。
 */
export async function checkAllPluginUpdates(
  options: { force?: boolean; quiet?: boolean; previewOnly?: boolean } = {}
): Promise<PluginUpdateSummary[]> {
  if (!options.force && Date.now() - readUpdateClock() < PLUGIN_UPDATE_INTERVAL) return []
  const targets = [...records.values()].filter(
    (record) => (record.updateUrl || record.sourceUrl) && record.enabled
  )
  const results: PluginUpdateSummary[] = []
  for (const record of targets) {
    const name = String(record.manifest?.name ?? record.pluginId)
    const previousVersion = String(record.manifest?.version ?? '')
    try {
      if (options.previewOnly) {
        const preview = await previewPluginUpdate(record.pluginId)
        const available = preview.versionOrder >= 0 && preview.contentChanged
        results.push({ pluginId: record.pluginId, name, previousVersion, version: preview.version, updated: false, available })
        if (available && !options.quiet) showToast(`${name} 有可确认的更新，请到音源市场查看`)
        continue
      }
      const result = await checkPluginUpdate(record.pluginId)
      results.push({
        pluginId: record.pluginId,
        name,
        updated: result.updated,
        version: result.version,
        previousVersion
      })
      if (result.updated && !options.quiet) {
        showToast(`${name} 已更新到 v${result.version}`, 'success')
      }
    } catch (error: any) {
      results.push({
        pluginId: record.pluginId,
        name,
        updated: false,
        version: previousVersion,
        previousVersion,
        error: error?.message ?? String(error)
      })
    }
  }
  markUpdateChecked()
  return results
}

function stableScope(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stableScope).join(',') + ']'
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + stableScope(value[key]))
      .join(',') +
    '}'
  )
}

function normalizePluginFileUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.hostname === 'github.com') {
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length >= 5 && (parts[2] === 'blob' || parts[2] === 'raw')) {
        url.hostname = 'raw.githubusercontent.com'
        url.pathname = '/' + parts[0] + '/' + parts[1] + '/' + parts.slice(3).join('/')
      }
    }
    return url.href
  } catch { return value }
}

export async function fetchPluginCode(url: string, options: { signal?: AbortSignal; onAttempt?: (message: string) => void } = {}): Promise<string> {
  let response: { status: number; body?: unknown }
  try {
    const path = repositoryPath(url)
    if (path) response = await requestRepository(path, options)
    else {
      options.onAttempt?.('正在获取在线插件文件…')
      response = await requestRemote({ url: normalizePluginFileUrl(url), raw: true, timeoutMs: 20_000, signal: options.signal })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('仓库下载失败')) throw new Error(message)
    if (/Failed to fetch|NetworkError|Load failed|Network request failed/i.test(message)) {
      throw new Error('无法下载插件：链接不可访问，或该地址未允许跨域访问')
    }
    if (/timeout|timed out|超时/i.test(message)) {
      throw new Error('下载插件超时：请检查网络后重试')
    }
    throw new Error(message || '下载插件失败')
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error('下载插件失败: HTTP ' + response.status)
  }
  const code = String(response.body ?? '').trim()
  if (!code) throw new Error('插件文件内容为空')
  if (new TextEncoder().encode(code).byteLength > 16 * 1024 * 1024) throw new Error('插件文件过大')
  return normalizeKnownPluginCode(code, url)
}

export function inspectPlugin(code: string): any {
  const text = String(code ?? '')
  if (
    /"lines"\s*:\s*\[/.test(text) &&
    /"searchApi"\s*:/.test(text) &&
    /"detailApi"\s*:/.test(text) &&
    !/\bexports\s*\.\s*manifest\b/.test(text)
  ) {
    throw new Error(
      '这个地址返回的是第三方音源配置（如青听音源），不是澜音 v2 插件或洛雪 LX 脚本，不能直接导入。请找该音源提供的 .js 插件，或使用支持该配置格式的客户端。'
    )
  }
  try {
    return readPluginArtifact(code).header.manifest
  } catch (error) {
    const manifest = inspectLxPlugin(code)
    if (manifest) return manifest
    throw error
  }
}

export async function installDemoPlugin(): Promise<PluginDescriptor> {
  if (!pluginState.initialized) await initPlugins()
  const response = await fetch('/demo-plugin.js', { cache: 'no-store' })
  if (!response.ok) throw new Error('读取内置示例插件失败')
  return installPlugin(await response.text(), { enable: true, grantDeclared: true })
}

async function enablePluginInternal(pluginId: string): Promise<void> {
  const record = records.get(pluginId)
  if (!record) throw new Error('插件不存在')
  if (hosts.has(pluginId)) {
    record.enabled = true
    await save(record)
    refresh()
    return
  }
  const host = new PluginHost({
    pluginId,
    code: record.code,
    manifest: record.manifest,
    grants: record.grants,
    denied: record.denied,
    saveGrants: async (grants, denied) => {
      record.grants = grants
      record.denied = denied
      await save(record)
    },
    getConfig: () => getConfig(pluginId),
    saveConfig: (config) => saveConfig(pluginId, config),
    hooks: hooksFor()
  })
  try {
    await host.ensureReady()
  } catch (error: any) {
    await host.dispose()
    record.enabled = false
    record.loadError = error?.message ?? String(error)
    await save(record)
    refresh()
    throw error
  }
  hosts.set(pluginId, host)
  if (record.manifest.format === 'lx') record.manifest = host.getManifest()
  record.enabled = true
  record.loadError = undefined
  await save(record)
  refresh()
}

export async function enablePlugin(pluginId: string): Promise<void> {
  return withPluginOperation(pluginId, () => enablePluginInternal(pluginId))
}
async function disablePluginInternal(pluginId: string): Promise<void> {
  const record = records.get(pluginId)
  if (!record) return
  const host = hosts.get(pluginId)
  hosts.delete(pluginId)
  await host?.dispose()
  record.enabled = false
  await save(record)
  refresh()
}

export async function disablePlugin(pluginId: string): Promise<void> {
  return withPluginOperation(pluginId, () => disablePluginInternal(pluginId))
}
export async function removePlugin(pluginId: string): Promise<void> {
  return withPluginOperation(pluginId, async () => {
  await disablePluginInternal(pluginId)
  await secureStore.clearNamespace('plugin.account.' + pluginId)
  invalidatePluginAccountCache(pluginId)
  records.delete(pluginId)
  await idb.del('plugins', pluginId)
  await idb.del('pluginConfig', pluginId)
  const keys = await idb.keys('pluginStorage')
  for (const key of keys) {
    if (String(key).startsWith(pluginId + ':')) await idb.del('pluginStorage', key)
  }
  refresh()
  })
}

export async function getPluginConfig(pluginId: string): Promise<Record<string, any>> {
  return (await idb.get('pluginConfig', pluginId)) ?? {}
}

export async function savePluginConfig(
  pluginId: string,
  config: Record<string, any>
): Promise<void> {
  await saveConfig(pluginId, config)
}

export async function invokeProvider(
  provider: ProviderHandle,
  method: string,
  args: any[] = [],
  signal?: AbortSignal
): Promise<any> {
  const host = hosts.get(provider.pluginId)
  if (!host) throw new Error('插件未运行，请先在设置中启用')
  return host.invokeProvider(provider.providerId, method, args, signal)
}

export function selectProvider(providerId: string, pluginId?: string): void {
  pluginState.selectedProvider = providerId
  if (pluginId) pluginState.selectedSourcePlugin[providerId] = pluginId
  try {
    localStorage.setItem('ceru.selectedProvider', providerId)
    localStorage.setItem('ceru.selectedSourcePlugin', JSON.stringify(pluginState.selectedSourcePlugin))
  } catch {}
}

/** Set a source owner without changing the homepage's current platform. */
export function preferProvider(providerId: string, pluginId: string): void {
  if (!allProviders(true).some(p => p.providerId === providerId && p.pluginId === pluginId)) throw new Error('请选择已启用的来源')
  const next = { ...pluginState.selectedSourcePlugin }
  delete next[providerId]
  next[providerId] = pluginId
  localStorage.setItem('ceru.selectedSourcePlugin', JSON.stringify(next))
  pluginState.selectedSourcePlugin = next
}

function accountHost(pluginId: string, accountId: string): { host: PluginHost; item: any } {
  const host = hosts.get(pluginId)
  const item = host?.getManifest().contributes?.accountItems?.find((a: any) => a.id === accountId)
  if (!host || !item) throw new Error('账号音源已停用或未声明该登录能力')
  return { host, item }
}
export async function pluginAccountSummary(pluginId: string, accountId: string): Promise<AccountSummary> {
  const { host, item } = accountHost(pluginId, accountId)
  const result = await host.invokeAction(item.action)
  assertAccountSummary(result)
  let avatarUrl: string | undefined
  if (result.avatarUrl) { try { const u = validateRemoteUrl(result.avatarUrl); if (u.protocol === 'https:') { u.search = ''; u.hash = ''; avatarUrl = u.href } } catch { /* Never load private/credentialed avatar URLs. */ } }
  return { signedIn: result.signedIn, displayName: result.displayName, ...(result.badge ? { badge: result.badge } : {}), ...(avatarUrl ? { avatarUrl } : {}) }
}
export async function logoutPluginAccount(pluginId: string, accountId: string): Promise<AccountSummary> {
  const { host, item } = accountHost(pluginId, accountId)
  if (!item.logoutAction) throw new Error('该音源没有提供退出动作')
  await host.invokeAction(item.logoutAction)
  invalidatePluginAccountCache(pluginId)
  return pluginAccountSummary(pluginId, accountId)
}
export function invalidatePluginAccountCache(pluginId: string): void {
  invalidateOwnerResources(pluginId)
  pluginState.accountEpochs[pluginId] = (pluginState.accountEpochs[pluginId] || 0) + 1
}
export function getPluginAccountSurface(pluginId: string, accountId: string): AccountSurfaceSpec { return accountHost(pluginId, accountId).host.getAccountSurface(accountId) }
export function invokePluginAccountAction(pluginId: string, accountId: string, action: string, input: any, signal?: AbortSignal): Promise<any> {
  const { host } = accountHost(pluginId, accountId)
  return host.invokeAction(action, input, signal)
}
