/** Self-contained: serialized into each isolated Ceru sandbox, never the host window. */
export function installRuntimeCompatibility(core: any): void {
  const active = new Set<any>()
  const register = core.providers.register
  core.providers.register = function (id: string, implementation: any): any {
    const copy: any = { ...implementation }
    for (const group of ['tracks', 'charts', 'playlists', 'sharing']) {
      if (!implementation[group]) continue
      copy[group] = { ...implementation[group] }
      for (const name of Object.keys(copy[group])) {
        const original = copy[group][name]
        if (typeof original !== 'function') continue
        copy[group][name] = async function (...args: any[]): Promise<any> {
          const operation = args.at(-1)
          if (operation?.signal) {
            active.add(operation)
            // Older providers omit optional input/cursor arguments when the host calls them.
            while (args.length < Math.min(original.length, 8)) args.splice(args.length - 1, 0, undefined)
          }
          try { return await original.apply(implementation[group], args) }
          finally { if (operation?.signal) active.delete(operation) }
        }
      }
    }
    return register.call(this, id, copy)
  }
  const lowRequest = core.http.request
  const requestCompatible = async (input: any): Promise<any> => {
    input={...input,headers:{...input.headers}}
    if (input.body === undefined && (input.json !== undefined || input.data !== undefined)) input.body=input.json ?? input.data
    if (input.body && typeof input.body === 'object') { input.body=JSON.stringify(input.body); if(!Object.keys(input.headers).some(k=>k.toLowerCase()==='content-type'))input.headers['Content-Type']='application/json' }
    if (!input.operation && active.size===1) input.operation=[...active][0]
    const operations = !input.operation && active.size > 1 ? [...active] : []
    const controller = operations.length ? new AbortController() : undefined
    const abort = () => controller?.abort()
    if (controller) {
      // Match the existing legacy client: without a unique operation identity,
      // cancellation is conservative per plugin, never detached from its calls.
      for (const op of operations) { op.signal.addEventListener('abort', abort, {once:true}); if(op.signal.aborted) abort() }
      const id = globalThis.crypto.randomUUID?.() || [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join('')
      input.operation = {id,deadlineAt:Date.now()+Math.min(20_000,Number(input.timeoutMs)||12_000),signal:controller.signal}
    }
    try { return await lowRequest(input) }
    finally { for (const op of operations) op.signal.removeEventListener('abort', abort) }
  }
  core.http.request=requestCompatible
  if (core.io?.http?.request===lowRequest) core.io.http.request=requestCompatible
  const create = core.http.create
  core.http.create = function (options: any): any {
    options = options || {}
    const normal = create.call(this, options)
    // Operation-less legacy requests may use an already granted permission, never prompt/grant it.
    const legacy = create.call(this, { ...options, requestPermission: false })
    const client: any = { ...normal }
    for (const method of ['get', 'post', 'request']) {
      client[method] = async (url: string, input: any = {}): Promise<any> => {
        input = { ...input }
        if (input.data !== undefined && input.body === undefined && input.json === undefined && !input.form) { input.json=input.data; delete input.data }
        if (input.body && typeof input.body === 'object') {
          input.body=JSON.stringify(input.body); input.headers={...input.headers}
          if (!Object.keys(input.headers).some(k=>k.toLowerCase()==='content-type')) input.headers['Content-Type']='application/json'
        }
        if (input?.operation?.signal) return normal[method](url, input)
        const controller = new AbortController()
        const operations = [...active]
        const abort = () => controller.abort()
        // ponytail: missing legacy operation identity; cancellation is conservative per plugin.
        for (const op of operations) { op.signal.addEventListener('abort', abort, { once: true }); if (op.signal.aborted) abort() }
        const timeout = setTimeout(abort, Math.min(15_000, Math.max(1000, Number(input?.timeoutMs) || 12_000)))
        const id = operations.length === 1 ? operations[0].id : globalThis.crypto.randomUUID?.() || [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('')
        try {
          return await legacy[method](url, { ...input, operation: { id, deadlineAt: Date.now() + 15_000, signal: controller.signal } })
        } finally {
          clearTimeout(timeout)
          for (const op of operations) op.signal.removeEventListener('abort', abort)
        }
      }
    }
    return client
  }
  // Keep WebCrypto/CSPRNG intact; add only APIs already offered by the sandbox's crypto module.
  try {
    const load = core.modules.require
    const cryptoModule = { ...load('@ceru/crypto') }
    if (typeof cryptoModule.createHmac !== 'function') cryptoModule.createHmac = (algorithm: string, key: any) => {
      const name = algorithm.toLowerCase().replace(/-/g, '')
      if (!['md5', 'sha1', 'sha256'].includes(name)) throw new Error('Unsupported HMAC digest: ' + algorithm)
      const Buffer = (globalThis as any).Buffer
      let bytes = Buffer.from(key)
      if (bytes.length > 64) bytes = cryptoModule.createHash(name).update(bytes).digest()
      const inner = Buffer.alloc(64, 0x36), outer = Buffer.alloc(64, 0x5c), parts: any[] = []
      for (let i = 0; i < bytes.length; i++) { inner[i] ^= bytes[i]; outer[i] ^= bytes[i] }
      return {
        update(value: any, encoding?: string) { parts.push(Buffer.from(value, encoding)); return this },
        digest(encoding?: string) { const sum = cryptoModule.createHash(name).update(inner).update(Buffer.concat(parts)).digest(); return cryptoModule.createHash(name).update(outer).update(sum).digest(encoding) }
      }
    }
    const requireCompatible = (name: string) => name === '@ceru/crypto' ? cryptoModule : load.call(core.modules, name)
    core.modules.require = requireCompatible
    if ((globalThis as any).require === load) (globalThis as any).require = requireCompatible
    if ((globalThis as any).__ceruRequire === load) (globalThis as any).__ceruRequire = requireCompatible
    for (const name of ['createHash', 'createCipheriv', 'createDecipheriv', 'publicEncrypt', 'randomBytes', 'createHmac']) {
      if (!(name in globalThis.crypto) && typeof cryptoModule[name] === 'function') Object.defineProperty(globalThis.crypto, name, { value: cryptoModule[name], configurable: true })
    }
  } catch { /* A runtime without that module keeps its original crypto object. */ }
}
