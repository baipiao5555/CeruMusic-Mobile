import { reactive, ref } from 'vue'
import { readPluginArtifact } from '@shiqianjiang/ceru-plugin-core'
import { PluginHost, type PluginHostHooks, type PluginNotice } from './host'
import { requestRemote } from './network'
import { idb, sha256Hex } from '../storage/idb'
import { toTrack, type Track } from '../track'

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
  loadError?: string
}

export const pluginState = reactive({
  plugins: [] as PluginDescriptor[],
  loading: true,
  initialized: false,
  selectedProvider: '' as string,
  selectedSourcePlugin: {} as Record<string, string>
})

export const pluginToasts = ref<Array<{ id: number; message: string; level: string }>>([])
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
  const id = ++toastId
  pluginToasts.value.push({ id, message, level })
  setTimeout(() => {
    pluginToasts.value = pluginToasts.value.filter((item) => item.id !== id)
  }, 3200)
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
    playlistImporters: manifest.contributes?.playlistImporters ?? []
  }
}

function refresh(): void {
  pluginState.plugins = [...records.values()]
    .sort((a, b) => a.order - b.order)
    .map((record) => descriptorFor(record, hosts.get(record.pluginId)))
  const selected = pluginState.selectedProvider
  const providers = allProviders()
  if (!selected || !providers.some((item) => item.providerId === selected)) {
    pluginState.selectedProvider = providers[0]?.providerId ?? ''
  }
}

async function save(record: PluginRecord): Promise<void> {
  records.set(record.pluginId, record)
  await idb.set('plugins', record.pluginId, record)
}

async function getConfig(pluginId: string): Promise<Record<string, any>> {
  return (await idb.get('pluginConfig', pluginId)) ?? {}
}

async function saveConfig(pluginId: string, config: Record<string, any>): Promise<void> {
  await idb.set('pluginConfig', pluginId, config)
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

export function allProviders(): ProviderHandle[] {
  const result: ProviderHandle[] = []
  for (const plugin of pluginState.plugins) {
    if (!plugin.running) continue
    for (const provider of plugin.providers) {
      const owner = pluginState.selectedSourcePlugin[provider.id]
      if (owner && owner !== plugin.pluginId) continue
      result.push(providerHandle(plugin, provider))
    }
  }
  return result
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
  const candidates = [value.trim().slice(0, 8192), normalizePlaylistInput(value)].filter(
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
    if (tracks.length >= 5000) break
  }
  return { name, tracks }
}

export async function initPlugins(): Promise<void> {
  if (pluginState.initialized) return
  pluginState.initialized = true
  try {
    const list = await idb.all<PluginRecord>('plugins')
    for (const record of list) records.set(record.pluginId, record)
    refresh()
    pluginState.loading = false
    for (const record of list) {
      if (!record.enabled) continue
      try {
        await enablePlugin(record.pluginId)
      } catch (error) {
        console.warn('恢复插件失败:', error)
      }
    }
  } catch (error) {
    console.error('读取插件失败:', error)
    pluginState.loading = false
  }
}

export async function installPlugin(
  code: string,
  options: { enable?: boolean; grantDeclared?: boolean } = {}
): Promise<PluginDescriptor> {
  const parsed = readPluginArtifact(code)
  const manifest = parsed.header.manifest
  if (manifest.manifestVersion !== 2) throw new Error('只支持澜音 v2 插件')
  const pluginId = (await sha256Hex(manifest.id)).slice(0, 32)
  const existing = records.get(pluginId)
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
    enabled: existing?.enabled ?? false,
    order: existing?.order ?? records.size,
    grants,
    denied: existing?.denied ?? [],
    installedAt: existing?.installedAt ?? Date.now()
  }
  await save(record)
  refresh()
  if (options.enable !== false) await enablePlugin(pluginId)
  return descriptorFor(record, hosts.get(pluginId))
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

export async function fetchPluginCode(url: string): Promise<string> {
  const response = await requestRemote({ url, raw: true, timeoutMs: 30_000 })
  if (response.status < 200 || response.status >= 300) {
    throw new Error('下载插件失败: HTTP ' + response.status)
  }
  const code = String(response.body ?? '').trim()
  if (!code) throw new Error('插件文件内容为空')
  if (code.length > 16 * 1024 * 1024) throw new Error('插件文件过大')
  return code
}

export function inspectPlugin(code: string): any {
  return readPluginArtifact(code).header.manifest
}

export async function installDemoPlugin(): Promise<PluginDescriptor> {
  if (!pluginState.initialized) await initPlugins()
  const response = await fetch('/demo-plugin.js', { cache: 'no-store' })
  if (!response.ok) throw new Error('读取内置示例插件失败')
  return installPlugin(await response.text(), { enable: true, grantDeclared: true })
}

export async function enablePlugin(pluginId: string): Promise<void> {
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
  record.enabled = true
  record.loadError = undefined
  await save(record)
  refresh()
}

export async function disablePlugin(pluginId: string): Promise<void> {
  const record = records.get(pluginId)
  if (!record) return
  const host = hosts.get(pluginId)
  hosts.delete(pluginId)
  await host?.dispose()
  record.enabled = false
  await save(record)
  refresh()
}

export async function removePlugin(pluginId: string): Promise<void> {
  await disablePlugin(pluginId)
  records.delete(pluginId)
  await idb.del('plugins', pluginId)
  await idb.del('pluginConfig', pluginId)
  const keys = await idb.keys('pluginStorage')
  for (const key of keys) {
    if (String(key).startsWith(pluginId + ':')) await idb.del('pluginStorage', key)
  }
  refresh()
}

export async function getPluginConfig(pluginId: string): Promise<Record<string, any>> {
  return (await idb.get('pluginConfig', pluginId)) ?? {}
}

export async function savePluginConfig(
  pluginId: string,
  config: Record<string, any>
): Promise<void> {
  await idb.set('pluginConfig', pluginId, config)
}

export async function invokeProvider(
  provider: ProviderHandle,
  method: string,
  args: any[] = []
): Promise<any> {
  const host = hosts.get(provider.pluginId)
  if (!host) throw new Error('插件未运行，请先在设置中启用')
  return host.invokeProvider(provider.providerId, method, args)
}

export function selectProvider(providerId: string): void {
  pluginState.selectedProvider = providerId
  try {
    localStorage.setItem('ceru.selectedProvider', providerId)
  } catch {}
}
