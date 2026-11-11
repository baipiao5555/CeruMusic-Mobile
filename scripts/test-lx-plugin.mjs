import assert from 'node:assert/strict'
import { constants, createCipheriv, generateKeyPairSync, publicEncrypt } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { chromium } from 'playwright-core'

const base = process.env.CERU_TEST_URL || process.env.CERU_URL || 'http://127.0.0.1:5181'
const origin = 'https://lx-fixture.example'
const cipher = createCipheriv('aes-128-cbc', '1234567890123456', '1234567890123456')
const encrypted = Buffer.concat([cipher.update('hello'), cipher.final()]).toString('hex')
const { publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 1024,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
})
const rsaExpected = publicEncrypt(
  { key: publicKey, padding: constants.RSA_NO_PADDING },
  Buffer.concat([Buffer.alloc(123), Buffer.from('hello')])
).toString('hex')
const fixture = (version = '1.0.0') => `/**
 * @name LX test source
 * @version ${version}
 * @author Ceru test
 */
const { EVENT_NAMES, on, send, request, utils, env } = globalThis.lx;
if (env !== 'mobile') throw new Error('wrong environment');
if (!globalThis.lx.currentScriptInfo.id) throw new Error('missing script id');
if (globalThis.lx.version !== '2.0.0') throw new Error('wrong API version');
if (utils.crypto.md5('abc') !== '900150983cd24fb0d6963f7d28e17f72') throw new Error('MD5 mismatch');
if (utils.buffer.bufToString(utils.crypto.aesEncrypt('hello', 'aes-128-cbc', '1234567890123456', '1234567890123456'), 'hex') !== '${encrypted}') throw new Error('AES mismatch');
if (utils.crypto.randomBytes(8).length !== 8) throw new Error('random bytes mismatch');
if (utils.buffer.bufToString(utils.crypto.rsaEncrypt(utils.buffer.from('hello'), ${JSON.stringify(publicKey)}), 'hex') !== '${rsaExpected}') throw new Error('RSA mismatch');
on(EVENT_NAMES.request, async function ({ source, action, info }) {
  if (this !== globalThis.lx) throw new Error('request context lost');
  if (source !== 'kw' || info.musicInfo.songmid !== '123') throw new Error('music info lost');
  if (action === 'lyric') return { lyric: '[00:01.00]Test lyric', tlyric: '[00:01.00]Translation' };
  if (action === 'pic') return '${origin}/cover.png';
  if (info.type !== '128k') throw new Error('quality lost');
  return new Promise((resolve, reject) => request('${origin}/resolve', {}, (error, response, body) => {
    if (error) return reject(error);
    if (response.statusCode !== 200) return reject(new Error('bad status'));
    if (response.bytes !== response.raw.length || !utils.buffer.bufToString(response.raw).includes(body.url)) return reject(new Error('raw response mismatch'));
    resolve(body.url);
  }));
}).then(() => {});
request('${origin}/init', { json: true }, (error) => {
  if (error) throw error;
  send(EVENT_NAMES.inited, { sources: { kw: { type: 'music', actions: ['musicUrl', 'lyric', 'pic'], qualitys: ['128k'] } } });
});`

let sourceCode = fixture()
let resolverCalls = 0
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true
})
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  const bypassRequests = []
  page.on('pageerror', (error) => errors.push(error.message))
  if (process.env.CERU_TEST_DEBUG) page.on('console', (message) => console.log(message.type(), message.text()))
  await page.context().route('**/*sandbox-probe*', (route) => {
    bypassRequests.push(route.request().url())
    return route.fulfill({ contentType: 'text/javascript', body: 'globalThis.externalScriptLoaded = true' })
  })
  await page.routeWebSocket('wss://lx-blocked.example/sandbox-probe', (socket) => {
    bypassRequests.push(socket.url())
    socket.close()
  })
  await page.route(origin + '/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/source.js') {
      await route.fulfill({ contentType: 'text/javascript', body: sourceCode, headers: { 'Access-Control-Allow-Origin': '*' } })
      return
    }
    if (path === '/binary') {
      await route.fulfill({
        contentType: 'application/octet-stream',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: Buffer.from([0, 255, 128, 10, 65])
      })
      return
    }
    if (path === '/resolve') resolverCalls++
    await route.fulfill({
      contentType: 'text/plain',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(path === '/resolve' ? { url: origin + '/audio.mp3' } : { ok: true })
    })
  })
  await page.route('https://search.kuwo.cn/**', (route) => route.fulfill({
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ TOTAL: '1', abslist: [{ MUSICRID: 'MUSIC_123', SONGNAME: '\u6211\u4eec', ARTIST: 'Test', DURATION: '60', N_MINFO: 'level:a,bitrate:128,format:mp3,size:1Mb;level:b,bitrate:320,format:mp3,size:3Mb;level:c,bitrate:2000,format:flac,size:10Mb' }] })
  }))
  await page.goto(base + '/#/plugins', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__ceruDebug?.pluginState.initialized && !window.__ceruDebug.pluginState.loading)
  const preview = await page.evaluate((code) => {
    const debug = window.__ceruDebug
    const count = document.querySelectorAll('iframe').length
    const info = debug.inspectPlugin(code)
    return { name: info.name, format: info.format, before: count, after: document.querySelectorAll('iframe').length }
  }, sourceCode)
  assert.equal(preview.format, 'lx')
  assert.equal(preview.before, preview.after, 'inspection must not run the script')
  await page.getByRole('textbox', { name: '\u63d2\u4ef6\u5730\u5740' }).fill(origin + '/source.js')
  await page.getByRole('button', { name: '\u83b7\u53d6', exact: true }).click()
  await page.getByRole('button', { name: '\u5b89\u88c5\u5e76\u542f\u7528', exact: true }).click()
  await page.waitForFunction(() => window.__ceruDebug.pluginState.plugins.some((item) => item.name === 'LX test source' && item.running), { timeout: 35000 })
  const first = await page.evaluate(async () => {
    const debug = window.__ceruDebug
    const plugin = debug.pluginState.plugins.find((item) => item.name === 'LX test source')
    const provider = debug.allProviders().find((item) => item.pluginId === plugin.pluginId)
    const result = await debug.invokeProvider(provider, 'tracks.search', [{ query: '\u6211', limit: 10 }])
    const ref = JSON.parse(JSON.stringify(result.items[0].ref))
    return {
      id: plugin.pluginId,
      providers: plugin.providers.map((item) => item.id),
      title: result.items[0].title,
      qualities: result.items[0].metadata.qualities,
      playback: await debug.invokeProvider(provider, 'tracks.resolve', [ref, 'flac']),
      lyrics: await debug.invokeProvider(provider, 'tracks.lyrics', [ref]),
      artwork: await debug.invokeProvider(provider, 'tracks.artwork', [ref])
    }
  })
  assert.deepEqual(first.providers, ['kw'])
  assert.equal(first.title, '\u6211\u4eec')
  assert.deepEqual(first.qualities, ['128k'])
  assert.equal(first.playback.url, origin + '/audio.mp3')
  assert.equal(first.lyrics.lines[0].translation, 'Translation')
  assert.equal(first.artwork.url, origin + '/cover.png')
  assert.equal(resolverCalls, 1)

  const other = `exports.manifest = {
    manifestVersion: 2, id: 'test.v2.same.provider', name: 'v2 same platform', version: '1.0.0',
    engines: { hostApi: '^2.0.0', logicRuntime: 'ceru-js@1' },
    modules: { logic: { entry: 'logic.main' } },
    contributes: { providers: [{id:'kw',name:'Other Kuwo',qualities:['128k'],protocols:['https']}] }
  }; exports.activate = function(core) { core.providers.register('kw', {tracks:{search:async()=>({items:[]})}}); };`
  const selection = await page.evaluate(async ({ code, lxId }) => {
    const debug = window.__ceruDebug
    const old = await debug.installPlugin(code)
    debug.selectProvider('kw', old.pluginId)
    const selectedOld = debug.allProviders().find((item) => item.providerId === 'kw').pluginId
    debug.selectProvider('kw', lxId)
    const selectedLx = debug.allProviders().find((item) => item.providerId === 'kw').pluginId
    const { providerForTrack } = await import('/src/core/playback/source.ts')
    const originalOwner = providerForTrack({ providerId: 'kw', pluginId: old.pluginId }).pluginId
    await debug.disablePlugin(lxId)
    const fallback = debug.allProviders().find((item) => item.providerId === 'kw').pluginId
    await debug.enablePlugin(lxId)
    return { oldId: old.pluginId, selectedOld, selectedLx, fallback, originalOwner }
  }, { code: other, lxId: first.id })
  assert.equal(selection.selectedOld, selection.oldId)
  assert.equal(selection.selectedLx, first.id)
  assert.equal(selection.fallback, selection.oldId)
  assert.equal(selection.originalOwner, selection.oldId)
  sourceCode = fixture('1.1.0')
  const update = await page.evaluate((id) => window.__ceruDebug.checkPluginUpdate(id), first.id)
  assert.equal(update.updated, true)
  assert.equal(update.version, '1.1.0')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction((id) => window.__ceruDebug?.pluginState.plugins.some((item) => item.pluginId === id && item.running), first.id)
  const restored = await page.evaluate(() => {
    const debug = window.__ceruDebug
    const provider = debug.allProviders().find((item) => item.providerId === 'kw')
    return {
      id: provider.pluginId,
      version: debug.pluginState.plugins.find((item) => item.pluginId === provider.pluginId).version,
      selected: debug.pluginState.selectedProvider
    }
  })
  assert.deepEqual(restored, { id: first.id, version: '1.1.0', selected: 'kw' })

  for (const frame of page.frames()) {
    assert.equal(await frame.evaluate(() => Boolean(globalThis.lx)), false)
  }
  const probeSandbox = async ({ compressed, origin, base }) => {
    const probe = 'https://lx-blocked.example/sandbox-probe'
    let readDenied = false
    let writeDenied = false
    let parentDenied = false
    let directDenied = false
    let publicDenied = false
    let scriptDenied = false
    let localScriptDenied = false
    let xhrDenied = false
    try { await globalThis.__ceruContext.settings.get() } catch { readDenied = true }
    try { await globalThis.__ceruContext.settings.update({ theme: 'dark' }) } catch { writeDenied = true }
    try { parent.document.body } catch { parentDenied = true }
    try { await fetch(base + '/sandbox-probe-private') } catch { directDenied = true }
    try { await fetch(probe) } catch { publicDenied = true }
    try { importScripts(probe + '?script') } catch { scriptDenied = true }
    try { importScripts(base + '/plugin-runtime/sandbox.js?sandbox-probe') } catch { localScriptDenied = true }
    try {
      const xhr = new XMLHttpRequest()
      xhr.open('GET', probe + '?xhr', false)
      xhr.send()
    } catch { xhrDenied = true }
    const websocketDenied = await new Promise((resolve) => {
      let socket
      const timer = setTimeout(() => { socket?.close(); resolve(false) }, 3000)
      try {
        socket = new WebSocket('wss://lx-blocked.example/sandbox-probe')
        socket.onerror = () => { clearTimeout(timer); resolve(true) }
        socket.onopen = () => { clearTimeout(timer); socket.close(); resolve(false) }
      } catch { clearTimeout(timer); resolve(true) }
    })
    const beforeNavigation = location.href
    try { location.href = probe + '?navigation' } catch {}
    try { location.assign(probe + '?assign') } catch {}
    const navigationDenied = location.href === beforeNavigation && typeof document === 'undefined'
    const nestedDenied = await new Promise((resolve) => {
      const code = `(async () => {
        let fetchDenied = false, scriptDenied = false;
        try { await fetch(${JSON.stringify(probe + '?nested')}); } catch { fetchDenied = true; }
        try { importScripts(${JSON.stringify(probe + '?nested-script')}); } catch { scriptDenied = true; }
        postMessage(fetchDenied && scriptDenied && typeof document === 'undefined');
      })();`
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
      let nested
      const done = (value) => {
        clearTimeout(timer)
        nested?.terminate()
        URL.revokeObjectURL(url)
        resolve(value)
      }
      const timer = setTimeout(() => done(false), 3000)
      try {
        nested = new Worker(url)
        nested.onmessage = (event) => done(event.data)
        nested.onerror = (event) => { event.preventDefault(); done(true) }
      } catch { done(true) }
    })
    const privateDenied = await new Promise((resolve) => globalThis.lx.request(
      base + '/sandbox-probe-private', {}, (error) => resolve(Boolean(error))
    ))
    const utils = globalThis.lx.utils
    const inflated = await utils.zlib.inflate(utils.buffer.from(compressed, 'base64'))
    const packed = await utils.zlib.deflate(utils.buffer.from('roundtrip'))
    const unpacked = await utils.zlib.inflate(packed)
    const binary = await new Promise((resolve, reject) => globalThis.lx.request(
      origin + '/binary', { binary: true }, (error, response, body) => error
        ? reject(error)
        : resolve({ raw: Array.from(response.raw), body: Array.from(body), size: response.bytes })
    ))
    return {
      workerRealm: typeof DedicatedWorkerGlobalScope === 'function' && self instanceof DedicatedWorkerGlobalScope,
      readDenied, writeDenied, parentDenied, directDenied, privateDenied,
      publicDenied, scriptDenied, localScriptDenied, xhrDenied, websocketDenied,
      navigationDenied, nestedDenied,
      inflated: utils.buffer.bufToString(inflated),
      unpacked: utils.buffer.bufToString(unpacked),
      binary
    }
  }
  const sandbox = await page.evaluate(async ({ probe, options }) => {
    const debug = window.__ceruDebug
    const plugin = await debug.installPlugin(`/**
 * @name LX sandbox probe
 */
lx.on('request', async () => ({ lines: [{
  startTimeMs: 0, text: JSON.stringify(await (${probe})(${JSON.stringify(options)}))
}] }));
lx.send('inited', { sources: {
  kw: { type: 'music', actions: ['musicUrl', 'lyric'], qualitys: ['128k'] }
} });`)
    try {
      const lyrics = await debug.invokeProvider(
        { pluginId: plugin.pluginId, providerId: 'kw' },
        'tracks.lyrics',
        [{ providerId: 'kw', kind: 'track', id: 'sandbox-probe' }]
      )
      return JSON.parse(lyrics.lines[0].text)
    } finally {
      await debug.removePlugin(plugin.pluginId)
    }
  }, { probe: probeSandbox.toString(), options: { compressed: deflateSync('hello').toString('base64'), origin, base } })
  assert.deepEqual(sandbox, {
    workerRealm: true,
    readDenied: true, writeDenied: true, parentDenied: true, directDenied: true, privateDenied: true,
    publicDenied: true, scriptDenied: true, localScriptDenied: true, xhrDenied: true, websocketDenied: true,
    navigationDenied: true, nestedDenied: true,
    inflated: 'hello', unpacked: 'roundtrip',
    binary: { raw: [0, 255, 128, 10, 65], body: [0, 255, 128, 10, 65], size: 5 }
  })
  assert.deepEqual(bypassRequests, [], 'all script traffic must pass through the host network checks')

  sourceCode = fixture('1.2.0').replace("if (env !== 'mobile')", "throw new Error('broken upgrade'); if (env !== 'mobile')")
  const rolledBack = await page.evaluate(async (id) => {
    const debug = window.__ceruDebug
    let failed = false
    try { await debug.checkPluginUpdate(id) } catch { failed = true }
    const plugin = debug.pluginState.plugins.find((item) => item.pluginId === id)
    return { failed, running: plugin.running, version: plugin.version }
  }, first.id)
  assert.deepEqual(rolledBack, { failed: true, running: true, version: '1.1.0' })

  sourceCode = fixture('1.3.0').replace('@name LX test source', '@name Different source')
  const identityRejected = await page.evaluate(async (id) => {
    const debug = window.__ceruDebug
    let rejected = false
    try { await debug.checkPluginUpdate(id) } catch { rejected = true }
    return { rejected, version: debug.pluginState.plugins.find((item) => item.pluginId === id).version }
  }, first.id)
  assert.deepEqual(identityRejected, { rejected: true, version: '1.1.0' })

  sourceCode = fixture('1.3.0')
  const disabledUpdate = await page.evaluate(async (id) => {
    const debug = window.__ceruDebug
    await debug.disablePlugin(id)
    const result = await debug.checkPluginUpdate(id)
    const plugin = debug.pluginState.plugins.find((item) => item.pluginId === id)
    const state = { updated: result.updated, running: plugin.running, enabled: plugin.enabled }
    await debug.enablePlugin(id)
    return state
  }, first.id)
  assert.deepEqual(disabledUpdate, { updated: true, running: false, enabled: false })

  const framesBeforeFile = page.frames().length
  const workersBeforeFile = page.workers().length
  const fileWorkerCreated = page.waitForEvent('worker')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'lx-file.js',
    mimeType: 'text/javascript',
    buffer: Buffer.from(fixture().replace('@name LX test source', '@name LX file source') + `
lx.on('request', () => {
  lx.request('${origin}/pending-invoke', {}, () => {});
  return new Promise(() => {});
});`)
  })
  await page.getByRole('button', { name: '\u5b89\u88c5\u5e76\u542f\u7528', exact: true }).click()
  await page.waitForFunction(() => window.__ceruDebug.pluginState.plugins.some((item) => item.name === 'LX file source' && item.running))
  const fileWorker = await fileWorkerCreated
  const pendingStarted = page.waitForRequest(origin + '/pending-invoke')
  const fileId = await page.evaluate(() => {
    const debug = window.__ceruDebug
    const plugin = debug.pluginState.plugins.find((item) => item.name === 'LX file source')
    window.__pendingLxRequest = debug.invokeProvider(
      { pluginId: plugin.pluginId, providerId: 'kw' },
      'tracks.lyrics',
      [{ providerId: 'kw', kind: 'track', id: '123' }]
    ).then(() => false, () => true)
    return plugin.pluginId
  })
  await pendingStarted
  const fileWorkerClosed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Uninstalled LX worker is still running')), 3000)
    fileWorker.once('close', () => { clearTimeout(timer); resolve() })
  })
  const cancelled = await page.evaluate(async (id) => {
    await window.__ceruDebug.removePlugin(id)
    return Promise.race([
      window.__pendingLxRequest,
      new Promise((resolve) => setTimeout(() => resolve(false), 1000))
    ])
  }, fileId)
  await fileWorkerClosed
  assert.equal(cancelled, true, 'uninstall must reject pending plugin invocations')
  await page.waitForFunction((count) => document.querySelectorAll('iframe').length === count, framesBeforeFile - 1, { timeout: 3000 })
  assert.equal(page.frames().length, framesBeforeFile)
  assert.equal(page.workers().length, workersBeforeFile)

  const failed = `/**\n * @name LX failed source\n */\nglobalThis.lx.send('inited', {status:false});`
  const rejected = await page.evaluate(async (code) => {
    try { await window.__ceruDebug.installPlugin(code); return false } catch { return true }
  }, failed)
  assert.equal(rejected, true)
  assert.deepEqual(errors, [])
  console.log('PASS: LX URL/file install, crypto/zlib, binary HTTP, catalog/playback, Worker/CSP isolation, ownership/reload, update rollback, pending-call cleanup, and initialization errors')
} finally {
  await browser.close()
}
