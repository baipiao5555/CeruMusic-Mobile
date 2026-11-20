import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = process.env.CERU_TEST_URL || 'http://127.0.0.1:5191'
const plugin = `exports.manifest = {
  manifestVersion: 2, id: 'qa.v270.bugfixes', name: 'Regression QA', version: '1.0.0',
  engines: { hostApi: '^2.0.0', logicRuntime: 'ceru-js@1' },
  modules: { logic: { entry: 'logic.main' } },
  contributes: { providers: [{ id: 'qa', name: 'QA', protocols: ['https'], qualities: ['128k', '320k'] }] }
}
exports.activate = function (core) {
  const item = (id, title) => ({
    ref: { providerId: 'qa', kind: 'track', id, scope: 'provider' }, title,
    subtitle: 'QA', capabilities: ['play'],
    metadata: { artists: ['QA'], durationMs: 60000, qualities: ['128k', '320k'] }
  })
  core.providers.register('qa', { tracks: {
    search: async () => ({ items: [item('one', 'QA One'), item('two', 'QA Two')] }),
    resolve: async (ref, quality) => {
      console.log('QA_RESOLVE:' + ref.id + ':' + quality)
      return { ok: true, url: 'https://audio.test/' + ref.id + '.wav' }
    },
    lyrics: async () => ({ format: 'crlyric', version: 1, lines: [] })
  } })
}`

function wav(seconds = 60) {
  const samples = 8000 * seconds
  const data = Buffer.alloc(44 + samples * 2)
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22)
  data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28)
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34)
  data.write('data', 36); data.writeUInt32LE(samples * 2, 40)
  return data
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']
})
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
const page = await context.newPage()
const resolves = []
let cacheRequests = 0
let directRequests = 0
let duplicateSyncHttpWarnings = 0
page.on('console', message => {
  const match = message.text().match(/^QA_RESOLVE:(one|two):(128k|320k)$/)
  if (match) resolves.push({ id: match[1], quality: match[2] })
  if (message.text().includes('SyncHttp') && message.text().includes('already registered')) duplicateSyncHttpWarnings += 1
})

try {
  await page.addInitScript(({ port }) => {
    localStorage.setItem('ceru.update.v1', JSON.stringify({ autoCheck: false }))
    const instances = new Map()
    const generic = name => {
      if (instances.has(name)) return instances.get(name)
      const value = new Proxy({}, { get: (_, method) => {
        if (method === 'addListener') return async () => ({ remove: async () => {} })
        return async () => ({})
      } })
      instances.set(name, value)
      return value
    }
    instances.set('LocalMedia', {
      check: async () => ({ granted: true }), request: async () => ({ granted: true }),
      scan: async () => ({ tracks: [{ id: '101', title: '本机独有的歌', artist: '离线歌手',
        album: '离线专辑', durationMs: 60000, size: 1000, mime: 'audio/mpeg' }] })
    })
    instances.set('AudioCache', {
      start: async () => ({ port, token: 'qa' }),
      size: async () => ({ bytes: 0 }), clear: async () => ({ bytes: 0 })
    })
    const platform = {
      name: 'android', getPlatform: () => 'android', isNativePlatform: () => true,
      registerPlugin: name => generic(name)
    }
    window.CapacitorPlatforms = { currentPlatform: platform, platforms: new Map([['android', platform]]) }
  }, { port: Number(new URL(base).port) })
  await context.route('https://audio.test/**', route => {
    directRequests += 1
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: wav() })
  })
  await context.route(url => url.origin === new URL(base).origin && url.pathname === '/cache', route => {
    cacheRequests += 1
    return route.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' })
  })

  await page.goto(base + '/#/search', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__ceruDebug && !window.__ceruDebug.pluginState.loading)
  await page.evaluate(async source => {
    const debug = window.__ceruDebug
    const installed = await debug.installPlugin(source, { enable: true, grantDeclared: true })
    debug.selectProvider('qa', installed.pluginId)
  }, plugin)

  const input = page.locator('.searchfield input')
  await input.fill('本机独有')
  const suggestion = page.locator('.srow:not(.direct)').filter({ hasText: '本机独有的歌' })
  await suggestion.waitFor()
  await input.press('Enter')
  const local = page.locator('section').filter({ hasText: '本地结果' })
    .locator('.songrow').filter({ hasText: '本机独有的歌' })
  await local.waitFor()
  assert.equal(await page.locator('.search-page .pad.mt4 > .songrow').count() > 0, true,
    'online results must coexist with the local result')
  console.log('PASS local MediaStore suggestions and submitted results coexist with online results')

  await page.evaluate(() => { location.hash = '#/local' })
  const localInput = page.locator('.searchbar input')
  await localInput.waitFor()
  await page.locator('.song-list .songrow').filter({ hasText: '本机独有的歌' }).waitFor()
  await localInput.fill('没有这首歌')
  await page.getByRole('heading', { name: '没有匹配的歌', exact: true }).waitFor()
  await localInput.fill('离线歌手')
  assert.equal(await page.locator('.song-list .songrow').count(), 1)
  console.log('PASS local music page filters by title/artist and shows a real empty state')
  await page.evaluate(() => { location.hash = '#/search' })
  await input.waitFor()

  await input.fill('QA')
  await input.press('Enter')
  const row = page.locator('.search-page .pad.mt4 > .songrow').first()
  await row.waitFor()
  const directRequest = page.waitForRequest('https://audio.test/one.wav')
  await row.tap()
  await page.waitForFunction(() => window.__ceruDebug.player.playerState.playing)
  await directRequest
  assert.equal(resolves.length, 1, 'one row tap starts one resolve')
  assert.equal(resolves[0].quality, '320k')
  console.log('CACHE_DIAGNOSTIC', JSON.stringify(await page.evaluate(async () => {  const s = await import('/src/core/settings.ts'); const a = await import('/src/core/cache/audioCache.ts'); return { enabled:s.settingsState.playbackCache, cached:await a.cachedAudioUrl('https://audio.test/one.wav'), localStorage:localStorage.getItem('ceru.settings.v1') } })))
  assert.equal(cacheRequests > 0, true)
  assert.equal(directRequests > 0, true)
  assert.equal(await page.evaluate(() => window.__ceruDebug.player.playerState.error), '')
  console.log('PASS one tap starts once; cache HTTP 500 falls back to the direct audio URL')

  await page.locator('.mini-track').tap()
  await page.locator('.p-quality-button').tap()
  await page.locator('.p-quality .chip').filter({ hasText: /^标准$/ }).tap()
  await page.waitForFunction(() => window.__ceruDebug.player.playerState.quality === '128k' &&
    window.__ceruDebug.player.playerState.playing)
  assert.equal(resolves.length, 2)
  assert.equal(resolves[1].quality, '128k', 'manual quality reaches the provider')
  const qualityText = await page.locator('.p-quality-button').innerText()
  assert.equal(qualityText.includes('标准'), true)
  assert.equal(qualityText.includes('自动'), false)
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ceru.settings.v1')).quality), '128k')
  console.log('PASS manual quality is sent to the provider, persisted, and no longer shown as automatic')

  await page.getByRole('button', { name: '关闭音质', exact: true }).tap()
  const favorite = page.locator('.p-favorite')
  await favorite.tap()
  const favoriteCount = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('ceru.library.v1') || '{}').favorites?.length || 0)
  assert.equal(await favoriteCount(), 1)
  await favorite.dispatchEvent('click', { detail: 1 })
  assert.equal(await favoriteCount(), 1, 'duplicate click from the same touch is ignored')
  await favorite.tap()
  assert.equal(await favoriteCount(), 0, 'a real second touch still works')
  console.log('PASS duplicate click suppression does not block a deliberate second tap')

  await page.getByRole('button', { name: '下一首', exact: true }).tap()
  await page.waitForFunction(() => window.__ceruDebug.player.playerState.index === 1 &&
    window.__ceruDebug.player.playerState.playing)
  assert.equal(resolves.length, 3, 'one next tap advances exactly one song')
  assert.equal(resolves[2].id, 'two')
  assert.equal(duplicateSyncHttpWarnings, 0, 'SyncHttp JS proxy must be registered once')
  console.log('PASS one next-tap advances one song and performs one resolve')
  console.log(JSON.stringify({ resolves, cacheRequests, directRequests }))
} finally {
  await browser.close()
}
