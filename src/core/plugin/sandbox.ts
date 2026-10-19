export interface SandboxArtifact {
  header: { manifest: any }
  modules: Record<string, string>
  resources: Record<string, any>
}

type SandboxEvent = (type: string, data: any) => void
type RpcHandler = (method: string, data: any) => Promise<any>

interface PendingCall {
  resolve: (value: any) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let catalogPromise: Promise<any> | undefined

function loadCatalog(): Promise<any> {
  catalogPromise ??= fetch('/plugin-runtime/catalog.json').then((response) => {
    if (!response.ok) throw new Error('插件目录加载失败')
    return response.json()
  })
  return catalogPromise
}

function randomId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

/** Vue reactive proxies cannot be structured-cloned; send plain JSON-compatible data. */
function cloneValue(value: any): any {
  if (value === null || typeof value !== 'object') return value
  if (value instanceof ArrayBuffer) return value
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  if (Array.isArray(value)) return value.map(cloneValue)
  if (value instanceof Date) return new Date(value.getTime())
  const copy: Record<string, any> = {}
  for (const key of Object.keys(value)) copy[key] = cloneValue(value[key])
  return copy
}

function buildFrameDocument(entryCode: string): string {
  const payload = encodeBase64Utf8(JSON.stringify({ entry: entryCode }))
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body>
<script>
(function () {
  // node-globals.js expects a bare Node realm. In a browser iframe its
  // Object.assign override list includes read-only globals (window) and
  // bridge-only shims (parent, addEventListener, timers, crypto). Keep the
  // useful polyfills and let the browser provide the rest.
  var originalAssign = Object.assign;
  var skip = {
    window: 1, self: 1, parent: 1, addEventListener: 1,
    setTimeout: 1, setInterval: 1, clearTimeout: 1, clearInterval: 1,
    TextEncoder: 1, TextDecoder: 1, crypto: 1, __receive: 1,
    URL: 1, URLSearchParams: 1
  };
  Object.assign = function (target) {
    if (target !== globalThis) return originalAssign.apply(null, arguments);
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];
      if (!source) continue;
      for (var key of Object.keys(source)) {
        if (skip[key]) continue;
        try { target[key] = source[key]; } catch (e) {}
      }
    }
    return target;
  };
  globalThis.__restoreAssign = function () { Object.assign = originalAssign; };
})();
</script>
<script src="/plugin-runtime/node-globals.js"></script>
<script>globalThis.__restoreAssign && globalThis.__restoreAssign();</script>
<script src="/plugin-runtime/sandbox.js"></script>
<script>
(function () {
  try {
    var binary = atob("${payload}");
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    var boot = JSON.parse(new TextDecoder().decode(bytes));
    var entry = (0, eval)("(" + boot.entry + ")");
    globalThis.__ceruStart(entry);
  } catch (error) {
    parent.postMessage({ type: "failed", data: { message: String((error && error.message) || error) } }, "*");
  }
})();
</script>
</body></html>`
}

/**
 * Runs a plugin logic module inside a sandboxed iframe using the official
 * Ceru runtime bundle. Mirrors the Node worker protocol used by the desktop app.
 */
export class IframePluginSandbox {
  private iframe?: HTMLIFrameElement
  private generation = randomId()
  private pending = new Map<string, PendingCall>()
  private started = false
  private disposed = false
  private messageHandler?: (event: MessageEvent) => void

  constructor(
    private rpc: RpcHandler,
    private event: SandboxEvent
  ) {}

  async start(artifact: SandboxArtifact, guest?: any): Promise<void> {
    const manifest = artifact.header.manifest
    const entryId = manifest.modules?.logic?.entry
    if (!entryId) return
    const entryCode = artifact.modules?.[entryId]
    if (typeof entryCode !== 'string') throw new Error('插件缺少逻辑入口')
    const catalog = await loadCatalog()

    const iframe = document.createElement('iframe')
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.tabIndex = -1
    iframe.style.cssText =
      'position:fixed;left:-10000px;top:-10000px;width:2px;height:2px;border:0;opacity:0;pointer-events:none'
    iframe.srcdoc = buildFrameDocument(entryCode)
    this.iframe = iframe

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        this.dispose()
        reject(new Error('插件启动超时'))
      }, guest ? 120_000 : 30_000)

      const onMessage = (event: MessageEvent) => {
        if (!this.iframe || event.source !== this.iframe.contentWindow) return
        const message = event.data
        if (!message || typeof message !== 'object') return
        if (message.generation && message.generation !== this.generation) return
        const { type, data } = message
        try {
          if (type === 'ready') {
            this.post('init', {
              generation: this.generation,
              kind: guest ? 'guest' : 'logic',
              guest: guest
                ? { id: guest.id, info: { ...guest.info, rawScript: guest.script } }
                : undefined,
              mode: 'production',
              manifest,
              resources: artifact.resources,
              catalog
            })
            return
          }
          if (type === 'active') {
            this.started = true
            clearTimeout(timer)
            resolve()
            return
          }
          if (type === 'failed') {
            clearTimeout(timer)
            cleanup()
            const error = new Error(String(data?.message || '插件运行失败'))
            this.dispose()
            reject(error)
            return
          }
          if (type === 'rpc') {
            void this.rpc(String(data.method), data.data).then(
              (value) => this.post('rpc-result', { id: data.id, value }),
              (error) =>
                this.post('rpc-result', {
                  id: data.id,
                  error: error instanceof Error ? error.message : '插件请求失败'
                })
            )
            return
          }
          if (type === 'invoke-result') {
            const call = this.pending.get(data.id)
            if (!call) return
            this.pending.delete(data.id)
            clearTimeout(call.timer)
            data.error ? call.reject(new Error(String(data.error))) : call.resolve(data.value)
            return
          }
          this.event(type, data)
        } catch (error) {
          clearTimeout(timer)
          cleanup()
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      }

      const cleanup = () => {
        window.removeEventListener('message', onMessage)
        if (this.messageHandler === onMessage) this.messageHandler = undefined
      }

      this.messageHandler = onMessage
      window.addEventListener('message', onMessage)
      document.body.appendChild(iframe)
    })
  }

  private post(type: string, data: any): void {
    this.iframe?.contentWindow?.postMessage(
      { type, data: cloneValue(data), generation: this.generation },
      '*'
    )
  }

  async send(type: string, data: any): Promise<void> {
    if (!this.iframe || this.disposed) return
    this.post(type, data)
  }

  invoke(
    kind: string,
    target: string,
    method: string,
    args: any[],
    signal?: AbortSignal,
    operationId?: string
  ): Promise<any> {
    const id = operationId ?? randomId()
    return new Promise((resolve, reject) => {
      if (!this.iframe || this.disposed) {
        reject(new Error('插件未运行'))
        return
      }
      const cancel = () => {
        void this.send('cancel', { id })
        finish()
        reject(new Error('操作已取消'))
      }
      const finish = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', cancel)
      }
      const timer = setTimeout(cancel, 120_000)
      this.pending.set(id, {
        resolve: (value) => {
          finish()
          resolve(value)
        },
        reject: (error) => {
          finish()
          reject(error)
        },
        timer
      })
      signal?.addEventListener('abort', cancel, { once: true })
      if (signal?.aborted) {
        cancel()
        return
      }
      this.post('invoke', { id, kind, target, method, args })
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler)
      this.messageHandler = undefined
    }
    try {
      this.post('dispose', {})
    } catch {}
    for (const call of this.pending.values()) {
      clearTimeout(call.timer)
      call.reject(new Error('插件已停止'))
    }
    this.pending.clear()
    this.iframe?.remove()
    this.iframe = undefined
  }
}
