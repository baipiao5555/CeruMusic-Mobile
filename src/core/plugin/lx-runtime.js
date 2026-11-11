async function startLx(core, rawScript, scriptInfo) {
  const Buffer = globalThis.Buffer
  const crypto = core.modules.require('@ceru/crypto')
  const compression = core.modules.require('@ceru/compression')
  const controllers = new Set()
  let requestHandler
  let initialized = false
  let updateSent = false
  let resolveReady
  let rejectReady
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const timer = setTimeout(() => rejectReady(new Error('LX source initialization timed out')), 25000)
  const bytes = (value) => Buffer.from(value)

  function request(url, options, callback) {
    if (typeof options === 'function') {
      callback = options
      options = {}
    }
    options = options || {}
    const controller = new AbortController()
    controllers.add(controller)
    const headers = { ...options.headers }
    let body = options.body
    if (options.form) {
      body = new URLSearchParams(options.form).toString()
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    } else if (options.formData) {
      const boundary = '----ceru' + Date.now().toString(16)
      body = Object.entries(options.formData).map(([key, value]) =>
        '--' + boundary + '\r\nContent-Disposition: form-data; name="' +
        String(key).replace(/["\r\n]/g, '') + '"\r\n\r\n' + String(value) + '\r\n'
      ).join('') + '--' + boundary + '--\r\n'
      headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary
    } else if (body != null && typeof body !== 'string') {
      body = JSON.stringify(body)
      if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json'
      }
    }
    const operation = {
      id: 'lx-http-' + crypto.randomUUID(),
      signal: controller.signal,
      deadlineAt: Date.now() + Math.min(60000, Math.max(1000, options.timeout || 30000))
    }
    core.http.request({
      url: String(url),
      method: options.method || 'GET',
      headers,
      body,
      permissionKey: 'network',
      timeoutMs: options.timeout,
      raw: true,
      responseType: 'arraybuffer',
      operation
    }).then((response) => {
      if (controller.signal.aborted) return
      const raw = Buffer.from(response.body)
      let body = options.binary === true ? raw : raw.toString()
      if (typeof body === 'string') {
        try { body = JSON.parse(body) } catch {}
      }
      callback?.(null, {
        statusCode: response.status,
        statusMessage: String(response.status),
        headers: response.headers,
        bytes: raw.length,
        raw,
        body
      }, body)
    }, (error) => {
      if (!controller.signal.aborted) callback?.(error, null, null)
    }).finally(() => controllers.delete(controller))
    return () => {
      controller.abort()
      controllers.delete(controller)
    }
  }

  const lx = {
    EVENT_NAMES: { request: 'request', inited: 'inited', updateAlert: 'updateAlert' },
    env: 'mobile',
    version: '2.0.0',
    apiVersion: '1.0.0',
    currentScriptInfo: { ...scriptInfo, rawScript },
    request,
    async on(event, handler) {
      if (event !== 'request' || typeof handler !== 'function') throw new Error('Unsupported LX event')
      requestHandler = handler
    },
    async send(event, data) {
      if (event === 'inited') {
        if (initialized) return
        initialized = true
        if (!data || data.status === false || !data.sources) {
          rejectReady(new Error('LX source initialization failed'))
          return
        }
        parent.postMessage({ type: 'lx-inited', data: { sources: data.sources } }, '*')
        resolveReady()
      } else if (event === 'updateAlert' && !updateSent) {
        updateSent = true
        const message = String(data?.log || '').slice(0, 1024)
        if (message) await core.ui.toast({ message, level: 'info' })
      }
    },
    utils: {
      buffer: {
        from: (value, encoding) => Buffer.from(value, encoding),
        bufToString: (value, encoding = 'utf8') => Buffer.from(value).toString(encoding)
      },
      crypto: {
        md5: (value) => crypto.createHash('md5').update(bytes(value)).digest('hex'),
        randomBytes: (size) => crypto.randomBytes(size),
        aesEncrypt(data, mode, key, iv) {
          const cipher = crypto.createCipheriv(mode, bytes(key), iv ? bytes(iv) : null)
          return Buffer.concat([cipher.update(bytes(data)), cipher.final()])
        },
        rsaEncrypt(data, key) {
          return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_NO_PADDING }, bytes(data))
        }
      },
      zlib: {
        inflate: (data) => new Promise((resolve, reject) => {
          compression.inflate(bytes(data), (error, result) => error ? reject(error) : resolve(result))
        }),
        async deflate(data) {
          const stream = new CompressionStream('deflate')
          const writer = stream.writable.getWriter()
          const output = (async () => {
            const reader = stream.readable.getReader()
            const chunks = []
            for (;;) {
              const { done, value } = await reader.read()
              if (done) return Buffer.concat(chunks)
              chunks.push(Buffer.from(value))
            }
          })()
          await writer.write(bytes(data))
          await writer.close()
          return output
        }
      }
    }
  }
  globalThis.lx = lx
  const fail = (event) => {
    event.preventDefault()
    rejectReady(event.reason || event.error || new Error(event.message || 'LX source initialization failed'))
  }
  globalThis.addEventListener('error', fail)
  globalThis.addEventListener('unhandledrejection', fail)
  try {
    // The host only calls this entry inside its restricted Worker.
    ;(0, eval)(rawScript)
    await ready
    if (typeof requestHandler !== 'function') throw new Error('LX source has no request handler')
    core.actions.register('lx-request', async (input, operation) => {
      operation.signal.throwIfAborted()
      const value = await requestHandler.call(lx, input)
      operation.signal.throwIfAborted()
      return value
    })
  } finally {
    clearTimeout(timer)
    globalThis.removeEventListener('error', fail)
    globalThis.removeEventListener('unhandledrejection', fail)
  }
  return () => {
    for (const controller of controllers) controller.abort()
    controllers.clear()
  }
}
