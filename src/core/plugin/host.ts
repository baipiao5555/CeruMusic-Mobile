import { PluginCore, readPluginArtifact } from '@shiqianjiang/ceru-plugin-core'
import { IframePluginSandbox } from './sandbox'
import { requestRemote, validateRemoteUrl } from './network'
import { idb } from '../storage/idb'

export interface PermissionDeclaration {
  key: string
  name: string
  scope?: Record<string, any>
  reason?: string
  optional?: boolean
}

export interface PluginNotice {
  type: 'toast' | 'notify' | 'error'
  message: string
  level?: string
}

export interface PluginHostHooks {
  onNotice?: (notice: PluginNotice) => void
  onPermissionRequest?: (request: {
    pluginName: string
    key: string
    name: string
    reason: string
  }) => Promise<boolean>
  onNavigate?: (request: any) => void
  player?: Record<string, (args: any[]) => any>
  queue?: Record<string, (args: any[]) => any>
  favorites?: Record<string, (args: any[]) => any>
  history?: () => any[]
  settings?: {
    get: () => Record<string, any>
    update: (patch: Record<string, any>) => any
  }
  library?: {
    list: () => any[]
    getTracks: (id: string) => any[]
  }
}

export interface PluginHostState {
  pluginId: string
  code: string
  manifest: any
  grants: string[]
  denied: string[]
  saveGrants: (grants: string[], denied: string[]) => Promise<void>
  getConfig: () => Promise<Record<string, any>>
  saveConfig: (config: Record<string, any>) => Promise<void>
  hooks: PluginHostHooks
}

function stable(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + stable(value[key]))
      .join(',') +
    '}'
  )
}

function fingerprint(permission: PermissionDeclaration): string {
  return `${permission.key}:${permission.name}:${stable(permission.scope ?? {})}`
}

function randomId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export class PluginHost {
  readonly pluginId: string
  private code: string
  private state: PluginHostState
  private artifact?: any
  private manifest: any
  private core?: PluginCore
  private sandbox?: IframePluginSandbox
  private context?: any
  private registrations = new Map<string, () => unknown>()
  private providerMethods = new Map<string, Set<string>>()
  private actionIds = new Set<string>()
  private controllers = new Map<string, Set<AbortController>>()
  private disposed = false
  private config: Record<string, any> = {}

  constructor(state: PluginHostState) {
    this.pluginId = state.pluginId
    this.code = state.code
    this.state = state
    this.manifest = state.manifest
  }

  private get declarations(): PermissionDeclaration[] {
    const list = this.manifest?.permissions
    return Array.isArray(list) ? list : []
  }

  private status(key: string): 'granted' | 'denied' | 'prompt' | 'undeclared' {
    const declaration = this.declarations.find((item) => item.key === key)
    if (!declaration) return 'undeclared'
    const print = fingerprint(declaration)
    if (this.state.grants.includes(print)) return 'granted'
    if (this.state.denied.includes(print)) return 'denied'
    return 'prompt'
  }

  private async requestPermission(key: string): Promise<'granted' | 'denied' | 'prompt' | 'undeclared'> {
    const current = this.status(key)
    if (current !== 'prompt' && current !== 'denied') return current
    const declaration = this.declarations.find((item) => item.key === key)!
    let allowed = false
    if (this.state.hooks.onPermissionRequest) {
      allowed = await this.state.hooks.onPermissionRequest({
        pluginName: this.manifest?.name ?? this.pluginId,
        key: declaration.key,
        name: declaration.name,
        reason: declaration.reason ?? ''
      })
    }
    const print = fingerprint(declaration)
    this.state.grants = this.state.grants.filter((item) => item !== print)
    this.state.denied = this.state.denied.filter((item) => item !== print)
    if (allowed) this.state.grants.push(print)
    else this.state.denied.push(print)
    await this.state.saveGrants(this.state.grants, this.state.denied)
    return allowed ? 'granted' : 'denied'
  }

  async ensureReady(): Promise<void> {
    if (this.core) return
    if (!this.code) throw new Error('插件文件为空')
    const parsed = readPluginArtifact(this.code)
    if (parsed.header.manifest.manifestVersion !== 2) throw new Error('只支持澜音 v2 插件')
    this.artifact = parsed.artifact
    this.manifest = parsed.header.manifest
    this.config = await this.state.getConfig()
    this.sandbox = new IframePluginSandbox(
      (method, data) => this.rpc(method, data),
      (type, data) => this.handleSandboxEvent(type, data)
    )
    this.core = await PluginCore.load(this.code, {
      host: {
        activate: async (artifact: any, context: any) => {
          this.artifact = artifact
          this.context = context
          await this.sandbox!.start(artifact)
          return () => this.sandbox?.dispose()
        },
        services: {
          permissions: {
            query: async ({ key }: { key: string }) => ({ status: this.status(key) }),
            request: async ({ key }: { key: string }) => ({ status: await this.requestPermission(key) })
          }
        },
        onNotice: (notice: any) => {
          this.state.hooks.onNotice?.({
            type: notice?.type === 'notify' ? 'notify' : 'toast',
            message: String(notice?.data ?? ''),
            level: notice?.level
          })
        }
      } as any
    })
    this.manifest = this.core.manifest
  }

  private handleSandboxEvent(type: string, data: any): void {
    if (this.disposed) return
    if (type === 'log') {
      const level = data?.level ?? 'info'
      const prefix = `[插件 ${this.manifest?.name ?? this.pluginId}]`
      const values = data?.values ?? []
      if (level === 'error') console.error(prefix, ...values)
      else if (level === 'warn') console.warn(prefix, ...values)
      else if (level === 'debug') console.debug(prefix, ...values)
      else console.log(prefix, ...values)
      return
    }
    if (type === 'notify') {
      this.state.hooks.onNotice?.({
        type: 'notify',
        message: String(data?.message ?? data?.content ?? ''),
        level: data?.level
      })
      return
    }
    if (type === 'register') {
      void this.registerContribution(data)
      return
    }
    if (type === 'unregister') {
      const key = `${data?.kind}:${data?.id}`
      this.registrations.get(key)?.()
      this.registrations.delete(key)
      if (data?.kind === 'provider') this.providerMethods.delete(data.id)
      if (data?.kind === 'action') this.actionIds.delete(data.id)
      return
    }
    if (type === 'state' || type === 'open-view' || type === 'close-view') {
      this.state.hooks.onNavigate?.({ type, ...data })
      return
    }
  }

  private async registerContribution(data: any): Promise<void> {
    if (!this.context || !data?.id) return
    const key = `${data.kind}:${data.id}`
    this.registrations.get(key)?.()
    try {
      if (data.kind === 'provider') {
        this.providerMethods.set(data.id, new Set(data.methods ?? []))
        const implementation: any = {}
        for (const path of data.methods ?? []) {
          const match = String(path).match(/^(tracks|playlists|charts|sharing)\.([a-zA-Z]+)$/)
          if (!match) continue
          const [, group, name] = match
          implementation[group] ??= {}
          implementation[group][name] = (...args: any[]) => {
            const operation = args.pop()
            return this.sandbox!.invoke(
              'provider',
              data.id,
              path,
              args,
              operation?.signal,
              operation?.id
            )
          }
        }
        this.registrations.set(key, this.context.providers.register(data.id, implementation))
        return
      }
      if (data.kind === 'action') {
        this.actionIds.add(data.id)
        this.registrations.set(
          key,
          this.context.actions.register(data.id, (input: any, operation: any) =>
            this.sandbox!.invoke('action', data.id, '', [input], operation?.signal, operation?.id)
          )
        )
        return
      }
      if (data.kind === 'playlist-importer') {
        this.registrations.set(
          key,
          this.context.playlistImporters.register(data.id, {
            getTracks: (input: any, operation: any) =>
              this.sandbox!.invoke(
                'playlist-importer',
                data.id,
                'getTracks',
                [input],
                operation?.signal,
                operation?.id
              )
          })
        )
        return
      }
      if (data.kind === 'lyric-converter') {
        this.registrations.set(
          key,
          this.context.lyricConverters.register(data.id, {
            parse: (input: any, operation: any) =>
              this.sandbox!.invoke('lyric-converter', data.id, 'parse', [input], operation?.signal),
            export: (input: any, operation: any) =>
              this.sandbox!.invoke('lyric-converter', data.id, 'export', [input], operation?.signal)
          })
        )
      }
    } catch (error) {
      this.state.hooks.onNotice?.({
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async rpc(method: string, data: any = {}): Promise<any> {
    if (this.disposed) throw new Error('插件已停止')

    if (method === 'permissions.query') return { status: this.status(data.key) }
    if (method === 'permissions.request') return { status: await this.requestPermission(data.key) }
    if (method === 'permissions.getGranted') {
      return this.declarations
        .filter((item) => this.status(item.key) === 'granted')
        .map((item) => ({ ...item, scope: item.scope ?? {}, status: 'granted' }))
    }
    if (method === 'permissions.requestGroup') {
      const entries = this.declarations.filter(
        (item) => !data.keys || data.keys.includes(item.key)
      )
      for (const item of entries) await this.requestPermission(item.key)
      return {
        group: data.group,
        status: entries.every((item) => this.status(item.key) === 'granted') ? 'granted' : 'denied',
        grants: await this.rpc('permissions.getGranted')
      }
    }
    if (method === 'config.get') {
      this.config = await this.state.getConfig()
      return { ...this.configDefaults(), ...this.config }
    }
    if (method === 'config.set') {
      this.config = { ...this.config, ...(data.values ?? data.config ?? {}) }
      await this.state.saveConfig(this.config)
      return { ...this.configDefaults(), ...this.config }
    }
    if (method === 'http.request') {
      if (this.status(data.permissionKey) !== 'granted') {
        throw new Error('插件未获得网络访问权限')
      }
      const url = validateRemoteUrl(String(data.url))
      const controller = new AbortController()
      const operationId = String(data.operation?.id ?? randomId())
      const controllers = this.controllers.get(operationId) ?? new Set<AbortController>()
      controllers.add(controller)
      this.controllers.set(operationId, controllers)
      const timer = setTimeout(() => controller.abort(), 60_000)
      try {
        return await requestRemote({
          url: url.href,
          method: data.method,
          headers: data.headers,
          body: data.body,
          timeoutMs: data.timeoutMs
        })
      } finally {
        clearTimeout(timer)
        controllers.delete(controller)
        if (!controllers.size) this.controllers.delete(operationId)
      }
    }
    if (method === 'operations.cancel') {
      for (const controller of this.controllers.get(data.id) ?? []) controller.abort()
      return null
    }
    if (method === 'storage.get') {
      return (await idb.get('pluginStorage', `${this.pluginId}:${data.key}`)) ?? null
    }
    if (method === 'storage.set') {
      const serialized = JSON.stringify(data.value ?? null)
      if (serialized.length > 1024 * 1024) throw new Error('插件存储内容过大')
      await idb.set('pluginStorage', `${this.pluginId}:${data.key}`, data.value ?? null)
      return null
    }
    if (method === 'storage.delete') {
      await idb.del('pluginStorage', `${this.pluginId}:${data.key}`)
      return null
    }
    if (method === 'services.app.getInfo') {
      return {
        name: '澜音',
        version: '2.3.1-mobile.2',
        platform: 'android',
        locale: navigator.language || 'zh-CN',
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        hostApi: '1.0.0'
      }
    }
    if (method === 'services.app.openExternal') {
      const url = validateRemoteUrl(String(data.args?.[0] ?? ''))
      window.open(url.href, '_blank', 'noopener')
      return null
    }
    if (method.startsWith('services.player.') || method.startsWith('services.queue.')) {
      const name = method.slice(method.lastIndexOf('.') + 1)
      const table = method.startsWith('services.player.')
        ? this.state.hooks.player
        : this.state.hooks.queue
      const fn = table?.[name]
      if (!fn) throw new Error('手机版暂不支持该播放器操作')
      return await fn(data.args ?? [])
    }
    if (method.startsWith('services.favorites.')) {
      const name = method.slice(method.lastIndexOf('.') + 1)
      const fn = this.state.hooks.favorites?.[name]
      if (!fn) throw new Error('手机版暂不支持收藏服务')
      return await fn(data.args ?? [])
    }
    if (method === 'services.history.list') {
      return this.state.hooks.history?.() ?? []
    }
    if (method === 'services.settings.get') {
      return this.state.hooks.settings?.get() ?? {}
    }
    if (method === 'services.settings.update') {
      if (!this.state.hooks.settings) throw new Error('设置服务不可用')
      return this.state.hooks.settings.update(data.args?.[0] ?? {})
    }
    if (method.startsWith('services.library.') || method.startsWith('library.playlists.')) {
      const name = method.slice(method.lastIndexOf('.') + 1)
      if (name === 'list') return { items: this.state.hooks.library?.list() ?? [] }
      if (name === 'getTracks' || name === 'get') {
        const id = String(data.args?.[0]?.playlistId ?? data.args?.[0]?.id ?? data.target?.id ?? data.id ?? '')
        return { items: this.state.hooks.library?.getTracks(id) ?? [] }
      }
      throw new Error('手机版暂不支持修改本地歌单')
    }
    if (method.startsWith('services.capabilities.')) {
      const services = [
        { service: 'app', methods: ['getInfo', 'openSettings', 'openExternal'] },
        { service: 'player', methods: ['getState', 'play', 'pause', 'next', 'previous', 'seek', 'setVolume', 'setMode'] },
        { service: 'queue', methods: ['get', 'append', 'replace', 'remove', 'reorder'] },
        { service: 'favorites', methods: ['contains', 'add', 'remove'] },
        { service: 'history', methods: ['list'] }
      ]
      if (method.endsWith('.list')) return services.map((item) => ({ ...item, version: '1.0.0', available: true, permissionGroups: [] }))
      return services.find((item) => item.service === data.args?.[0]) ?? { service: data.args?.[0], available: false }
    }
    if (method === 'ui.toast') {
      this.state.hooks.onNotice?.({
        type: 'toast',
        message: String(data.message ?? data.data ?? ''),
        level: data.level
      })
      return null
    }
    if (method === 'ui.notifications.show') {
      this.state.hooks.onNotice?.({
        type: 'notify',
        message: String(data.message ?? data.content ?? ''),
        level: data.level
      })
      return null
    }
    if (method === 'ui.navigation.open') {
      this.state.hooks.onNavigate?.({ type: 'navigate', request: data })
      return null
    }
    if (method.startsWith('ui.dialogs.')) return null
    if (method.startsWith('ui.progress.')) return null
    if (method === 'ui.playlistImport.open' || method === 'ui.pluginUpdate.request') return null
    if (method === 'ui.setState') return null
    if (method.startsWith('sockets.')) throw new Error('手机版暂不支持插件实时连接')
    if (method.startsWith('guests.')) throw new Error('手机版暂不支持子插件')
    if (method === 'services.clipboard.readText') {
      try {
        return await navigator.clipboard.readText()
      } catch {
        return ''
      }
    }
    if (method === 'services.clipboard.writeText') {
      await navigator.clipboard.writeText(String(data.args?.[0] ?? ''))
      return null
    }
    throw new Error('手机版暂不支持该插件接口: ' + method)
  }

  async invokeProvider(providerId: string, method: string, args: any[] = []): Promise<any> {
    await this.ensureReady()
    if (!this.core) throw new Error('插件未启动')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60_000)
    try {
      return await this.core.invokeProvider(providerId, method, args, {
        id: randomId(),
        deadlineAt: Date.now() + 60_000,
        signal: controller.signal
      })
    } finally {
      clearTimeout(timer)
    }
  }

  getManifest(): any {
    return this.manifest
  }

  getProviderMethods(): Record<string, string[]> {
    return Object.fromEntries([...this.providerMethods].map(([id, methods]) => [id, [...methods]]))
  }

  getActionIds(): string[] {
    return [...this.actionIds]
  }

  private configDefaults(): Record<string, any> {
    return { ...(this.manifest?.config ?? {}), ...(this.core?.config ?? {}) }
  }

  getConfigDefaults(): Record<string, any> {
    return this.configDefaults()
  }

  getConfigSchema(): any[] {
    const config = this.configDefaults()
    if (!config || typeof config !== 'object') return []
    return Object.entries(config).map(([key, value]) => ({
      key,
      label: key,
      type: typeof value === 'boolean' ? 'switch' : typeof value === 'number' ? 'number' : 'text',
      default: value
    }))
  }

  getProviderIconUrls(): Record<string, string> {
    const icons: Record<string, string> = {}
    for (const provider of this.manifest?.contributes?.providers ?? []) {
      if (provider.icon?.kind !== 'asset') continue
      const resource = this.artifact?.resources?.[provider.icon.resource]
      if (!resource || (resource.type !== 'text' && resource.type !== 'base64')) continue
      const mime = resource.mime
      if (!mime || !['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) continue
      if (typeof resource.value !== 'string' || resource.value.length > 128 * 1024) continue
      icons[provider.id] =
        `data:${mime};base64,` +
        (resource.type === 'base64' ? resource.value : btoa(unescape(encodeURIComponent(resource.value))))
    }
    return icons
  }

  async invokeAction(actionId: string, input: any = {}): Promise<any> {
    await this.ensureReady()
    if (!this.core) throw new Error('插件未启动')
    return this.core.invokeAction(actionId, input, {
      id: randomId(),
      deadlineAt: Date.now() + 60_000,
      signal: new AbortController().signal
    })
  }

  async importPlaylist(
    importerId: string,
    value: string,
    cursor?: string,
    limit = 100
  ): Promise<any> {
    await this.ensureReady()
    if (!this.core) throw new Error('插件未启动')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 120_000)
    try {
      return await this.core.importPlaylist(importerId, value, cursor, limit, {
        id: randomId(),
        deadlineAt: Date.now() + 120_000,
        signal: controller.signal
      })
    } finally {
      clearTimeout(timer)
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const controller of [...this.controllers.values()].flatMap((set) => [...set])) {
      controller.abort()
    }
    this.controllers.clear()
    await this.core?.dispose().catch(() => undefined)
    this.sandbox?.dispose()
    this.core = undefined
  }
}
