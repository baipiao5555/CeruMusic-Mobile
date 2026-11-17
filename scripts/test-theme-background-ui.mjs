import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
const product = 'D:/LX/CeruMusic-Mobile'
const stage = 'D:/LX/CeruMusic-Mobile-账号主题与同步-2026-11-16'
const baseline = process.argv.includes('--baseline')
const { chromium } = createRequire(product + '/package.json')('playwright-core')
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' })
const checks = [], errors = [], requests = []
let finished = false
page.on('pageerror', error => errors.push(error.message))
page.on('request', request => requests.push(request.url()))
await page.route('https://**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{}}' }))
await page.addInitScript(() => {
  if (top !== window) return
  localStorage.setItem('ceru.update.v1', '{"autoCheck":false}')
  localStorage.setItem('ceru.settings.v1', '{"cloudLyrics":false,"pluginAutoUpdate":false,"logsEnabled":false}')
  window.__themeURLs = new Set()
  window.__themeCreated = []
  window.__themeRevoked = []
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL)
  URL.createObjectURL = blob => { const url = create(blob); if (/^(image|video)\//.test(blob.type)) { window.__themeURLs.add(url); window.__themeCreated.push({ url, type: blob.type, size: blob.size }) } return url }
  URL.revokeObjectURL = url => { window.__themeURLs.delete(url); window.__themeRevoked.push(url); return revoke(url) }
  window.__themeListeners = []
  const addListener = EventTarget.prototype.addEventListener, removeListener = EventTarget.prototype.removeEventListener
  const listenerNames = ['updateVisibility', 'pageHide', 'updateMotion', 'updateData']
  EventTarget.prototype.addEventListener = function (type, listener, options) { if (listener && listenerNames.includes(listener.name)) window.__themeListeners.push({ target: this, type, listener }); return addListener.call(this, type, listener, options) }
  EventTarget.prototype.removeEventListener = function (type, listener, options) { window.__themeListeners = window.__themeListeners.filter(value => !(value.target === this && value.type === type && value.listener === listener)); return removeListener.call(this, type, listener, options) }
  window.__themeWrites = []
  const put = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function (value, key) {
    if (this.name === 'kv' && key === 'theme.background.v1') {
      const state = document.querySelector('.theme-background-settings')?.__vueParentComponent.setupState.themeBackgroundState
      window.__themeWrites.push({ beforeId: state?.config?.assetId ?? null, nextId: value.config?.assetId, beforeMask: state?.config?.mask ?? null })
      if (window.__failThemePut) throw new DOMException('controlled quota failure', 'QuotaExceededError')
    }
    const request = put.apply(this, arguments)
    if (this.name === 'kv' && key === 'theme.background.v1' && window.__abortThemePut) {
      window.__abortThemePut = false
      const transaction = this.transaction
      request.addEventListener('success', () => transaction.abort(), { once: true })
    }
    return request
  }
  const deleteKey = IDBObjectStore.prototype.delete
  IDBObjectStore.prototype.delete = function (key) { if (this.name === 'kv' && key === 'theme.background.v1' && window.__failThemeDelete) throw new DOMException('controlled delete failure', 'QuotaExceededError'); return deleteKey.apply(this, arguments) }
  window.__videoStarts = []
  const play = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function () {
    if (this.tagName === 'VIDEO') window.__videoStarts.push({ muted: this.muted, defaultMuted: this.defaultMuted, volume: this.volume, inline: this.playsInline })
    if (this.tagName === 'AUDIO') window.__musicAudio = this
    return play.apply(this, arguments)
  }
})
const check = (name, actual, expected = true) => { assert.deepEqual(actual, expected, name); checks.push({ name, actual, expected, result: 'PASS' }); console.log(JSON.stringify(checks.at(-1))) }
try {
  await page.goto(process.env.CERU_TEST_URL || 'http://127.0.0.1:5199', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__ceruDebug && !window.__ceruDebug.pluginState.loading)
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/settings'))
  await page.locator('#settings-appearance').scrollIntoViewIfNeeded()
  if (baseline) {
    check('baseline has no background route', await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$router.getRoutes().some(route => route.path === '/theme-background')), false)
    check('baseline has no shared background media layer', await page.locator('.theme-background-layer').count(), 0)
    check('baseline has no background file input in settings', await page.locator('input[type=file]').count(), 0)
    await page.screenshot({ path: stage + '/evidence/theme-background-before.png' })
  } else {
    check('background route integrated', await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$router.getRoutes().some(route => route.path === '/theme-background')))
    const navigate = async path => { await page.evaluate(path => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(path), path); await page.waitForTimeout(100) }
    const state = () => page.evaluate(() => { const value = document.querySelector('.theme-background-settings').__vueParentComponent.setupState.themeBackgroundState; return { config: JSON.parse(JSON.stringify(value.config)), url: value.url, posterUrl: value.posterUrl, saving: value.saving, probing: value.probing, playbackUnavailable: value.playbackUnavailable, error: value.error } })
    const stored = () => page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('ceru-music-mobile')
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('kv', 'readonly'), request = tx.objectStore('kv').get('theme.background.v1')
        request.onsuccess = () => { const value = request.result; resolve(value ? { config: value.config, blobSize: value.blob.size, blobType: value.blob.type, posterSize: value.poster?.size ?? 0, posterType: value.poster?.type ?? '' } : null); db.close() }
        request.onerror = () => reject(request.error)
      }
    }))
    const upload = async (name, mimeType = 'application/octet-stream') => {
      await page.locator('.theme-background-settings input[type=file]').setInputFiles({ name, mimeType, buffer: await fs.readFile(stage + '/evidence/' + (name.endsWith('.bin') ? 'theme-image.png' : name)) })
      await page.waitForFunction(() => { const state = document.querySelector('.theme-background-settings').__vueParentComponent.setupState.themeBackgroundState; return !state.saving && !state.probing })
    }
    const music = () => page.evaluate(() => ({ playing: window.__ceruDebug.player.playerState.playing, title: window.__ceruDebug.player.currentTrack()?.title, mediaTitle: navigator.mediaSession?.metadata?.title, audioPaused: window.__musicAudio?.paused }))
    // A local, generated WAV plus local test provider, not a user/private plugin.
    const rate = 22050, samples = rate * 12, wav = Buffer.alloc(44 + samples * 2)
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40)
    for (let index = 0; index < samples; index++) wav.writeInt16LE(Math.round(Math.sin(index * Math.PI * 2 * 330 / rate) * 5000), 44 + index * 2)
    await page.route('https://theme-fixture.test/audio.wav', route => route.fulfill({ status: 200, contentType: 'audio/wav', body: wav }))
    const plugin = `exports.manifest={manifestVersion:2,id:'ceru.theme.fixture',name:'背景音乐回归样本',version:'1.0.0',engines:{hostApi:'^2.0.0',logicRuntime:'ceru-js@1'},modules:{logic:{entry:'logic.main'}},contributes:{providers:[{id:'theme-fixture',name:'受控音源',protocols:['https'],qualities:['128k']}]}};exports.activate=core=>core.providers.register('theme-fixture',{tracks:{search:async()=>({items:[{ref:{providerId:'theme-fixture',kind:'track',id:'music-1',scope:'provider'},title:'音乐不受背景影响',capabilities:['play'],metadata:{artists:['受控样本'],durationMs:12000,qualities:['128k']}}]}),resolve:async()=>({ok:true,url:'https://theme-fixture.test/audio.wav'}),lyrics:async()=>({format:'crlyric',version:1,lines:[{startTimeMs:0,text:'受控歌词样本'}]})}});`
    await page.evaluate(async code => {
      const api = window.__ceruDebug
      await api.installPlugin(code, { enable: true, grantDeclared: true })
      const provider = api.allProviders().find(item => item.providerId === 'theme-fixture')
      const result = await api.invokeProvider(provider, 'tracks.search', [{ query: 'sample' }])
      await api.player.playTracks(result.items.map(item => api.player.toTrack(item, provider)), 0)
    }, plugin)
    await page.waitForFunction(() => window.__ceruDebug.player.playerState.playing && window.__musicAudio && !window.__musicAudio.paused)
    const beforeMusic = await music()
    check('real controlled music initially playing', beforeMusic.playing)
    await navigate('/player')
    check('default has no custom player layer', await page.locator('.theme-background-layer').count(), 0)
    check('default keeps existing player cover', await page.locator('.p-bg').evaluate(element => getComputedStyle(element).display !== 'none'))
    await navigate('/theme-background')
    check('input has no extension/MIME filtering', await page.locator('.theme-background-settings input[type=file]').getAttribute('accept'), null)
    check('starts with default background', (await state()).config, null)
    await upload('theme-animated.gif')
    check('animated GIF safely stored as controllable static image', [(await state()).config.mime, (await stored()).blobType], ['image/png', 'image/png'])
    check('GIF static import has no video/extra decoder', await page.locator('video').count(), 0)
    check('first import only changes reactive state after persistence begins', await page.evaluate(() => window.__themeWrites[0].beforeId), null)
    await page.evaluate(() => { window.__themeWrites = [] })
    await upload('image-with-unusual-extension.bin')
    let value = await state(), saved = await stored()
    check('actual PNG decoded despite extension and generic MIME', [value.config.kind, value.config.mime, value.config.width, value.config.height], ['image', 'image/png', 640, 360])
    check('actual Blob persisted, not base64/string', [saved.blobType, saved.blobSize], ['image/png', (await fs.stat(stage + '/evidence/theme-image.png')).size])
    check('reactive asset is still previous GIF when replacement write begins', await page.evaluate(() => window.__themeWrites[0].beforeId !== window.__themeWrites[0].nextId))
    check('one live object URL for image', await page.evaluate(() => window.__themeURLs.size), 1)
    check('shared layer displays decoded image', await page.locator('.theme-background-layer img').evaluate(image => image.complete && image.naturalWidth === 640))
    await page.locator('.theme-body').evaluate(element => { element.scrollTop = 0 }); await page.waitForTimeout(400)
    check('settings body never overlays its back/title bar', await page.evaluate(() => document.querySelector('.theme-body').getBoundingClientRect().top >= document.querySelector('.theme-background-settings .appbar').getBoundingClientRect().bottom))
    await page.screenshot({ path: stage + '/evidence/theme-background-image.png' })
    const setOption = async (id, option) => { await page.locator(id).selectOption(option); await page.waitForFunction(() => !document.querySelector('.theme-background-settings').__vueParentComponent.setupState.themeBackgroundState.saving) }
    const setRange = async (id, value) => { await page.locator(id).evaluate((input, value) => { input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })) }, String(value)); await page.waitForFunction(() => !document.querySelector('.theme-background-settings').__vueParentComponent.setupState.themeBackgroundState.saving) }
    await setRange('#theme-mask', 0.4); await setRange('#theme-blur', 3); await setOption('#theme-fit', 'contain'); await setOption('#theme-dark', 'true')
    check('mask/blur/fit/dark settings persist', [(await stored()).config.mask, (await stored()).config.blur, (await stored()).config.fit, (await stored()).config.dark], [0.4, 3, 'contain', true])
    const oldImage = await state(), oldStored = await stored()
    await page.evaluate(() => { window.__failThemePut = true })
    await upload('theme-av.mp4')
    check('quota failure retains original reactive asset', (await state()).url, oldImage.url)
    check('quota failure retains original stored record', await stored(), oldStored)
    check('failed candidate URLs released but original survives', await page.evaluate(url => window.__themeURLs.has(url) && window.__themeURLs.size === 1, oldImage.url))
    check('storage failure clearly shown', (await state()).error.includes('未替换'))
    await page.evaluate(() => { window.__failThemePut = false })
    await upload('theme-av.mp4')
    value = await state(); saved = await stored()
    check('actual H264 video decoded/persisted', [value.config.kind, value.config.width, value.config.height, Math.round(value.config.duration)], ['video', 320, 180, 2])
    check('video poster saved as actual JPEG Blob', saved.posterType === 'image/jpeg' && saved.posterSize > 100)
    check('replaced image object URL reclaimed', await page.evaluate(url => window.__themeRevoked.includes(url) && !window.__themeURLs.has(url), oldImage.url))
    await page.waitForTimeout(180)
    console.log('background video diagnostic', await page.evaluate(() => { const video = document.querySelector('.theme-background-layer video'), layer = document.querySelector('.theme-background-layer'); return { paused: video?.paused, readyState: video?.readyState, currentTime: video?.currentTime, moving: layer?.getAttribute('data-moving'), foreground: layer?.__vueParentComponent.props.foreground, error: document.querySelector('.theme-background-settings').__vueParentComponent.setupState.themeBackgroundState.error, starts: window.__videoStarts } }))
    await page.waitForFunction(() => document.querySelector('.theme-background-layer video') && !document.querySelector('.theme-background-layer video').paused && document.querySelector('.theme-background-layer video').currentTime > 0.1)
    check('only singleton background video, preview is image', await page.locator('video').count(), 1)
    check('video always muted/inline/loop including probe', await page.evaluate(() => window.__videoStarts.length >= 2 && window.__videoStarts.every(value => value.muted && value.defaultMuted && value.volume === 0 && value.inline)))
    check('runtime video muted and no controls', await page.locator('.theme-background-layer video').evaluate(video => video.muted && video.volume === 0 && video.loop && video.playsInline && !video.controls))
    check('two live URLs for video plus poster', await page.evaluate(() => window.__themeURLs.size), 2)
    check('background video never changes music identity/MediaSession', [(await music()).title, (await music()).mediaTitle], [beforeMusic.title, beforeMusic.mediaTitle])
    check('music remains playing during video selection', (await music()).playing && !(await music()).audioPaused)
    await page.locator('.theme-body').evaluate(element => { element.scrollTop = 0 }); await page.waitForTimeout(400)
    await page.screenshot({ path: stage + '/evidence/theme-background-video.png' })
    await page.evaluate(() => { window.__themeVisibility = 'hidden'; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__themeVisibility }); document.dispatchEvent(new Event('visibilitychange')) })
    await page.waitForFunction(() => !document.querySelector('.theme-background-layer video'))
    check('simulated hidden document releases active video', await page.locator('video').count(), 0)
    check('hidden document shows static poster', await page.locator('.theme-background-layer .theme-background-poster').count(), 1)
    check('background gate does not pause music', (await music()).playing && !(await music()).audioPaused)
    await page.evaluate(() => { window.__themeVisibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')) })
    await page.waitForFunction(() => document.querySelector('.theme-background-layer video') && !document.querySelector('.theme-background-layer video').paused)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForFunction(() => !document.querySelector('video'))
    check('reduced motion uses poster not second decoder', await page.locator('.theme-background-layer .theme-background-poster').count(), 1)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.waitForFunction(() => document.querySelector('video') && !document.querySelector('video').paused)
    await page.evaluate(() => { document.querySelector('.theme-background-layer').__vueParentComponent.props.foreground = false })
    await page.waitForFunction(() => !document.querySelector('video'))
    check('controlled native-foreground false pauses video', await page.locator('.theme-background-layer .theme-background-poster').count(), 1)
    await page.evaluate(() => { document.querySelector('.theme-background-layer').__vueParentComponent.props.foreground = true })
    await page.waitForFunction(() => document.querySelector('video') && !document.querySelector('video').paused)
    await page.evaluate(() => { const props = document.querySelector('.theme-background-layer').__vueParentComponent.props; props.foreground = false; props.foreground = true })
    await page.waitForFunction(() => document.querySelector('video') && !document.querySelector('video').paused && document.querySelector('video').readyState >= 2)
    check('rapid foreground toggle restores cleared src even when DOM patch coalesces', await page.locator('video').evaluate(video => video.src.startsWith('blob:') && !video.paused))
    await setOption('#theme-motion', 'poster')
    check('explicit poster mode releases decoder', await page.locator('video').count(), 0)
    await setOption('#theme-motion', 'auto')
    await page.waitForFunction(() => document.querySelector('video') && !document.querySelector('video').paused)
    const beforeAbort = await state(), beforeAbortStored = await stored()
    await page.evaluate(() => { window.__abortThemePut = true })
    await upload('image-with-unusual-extension.bin')
    check('request success plus transaction abort cannot replace reactive background', (await state()).url, beforeAbort.url)
    check('aborted transaction preserves persisted Blob', await stored(), beforeAbortStored)
    check('abort releases candidate and retains existing video URLs', await page.evaluate(url => window.__themeURLs.has(url) && window.__themeURLs.size === 2, beforeAbort.url))
    await page.locator('.theme-background-settings input[type=file]').setInputFiles({ name: 'fake.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not media') })
    await page.waitForFunction(() => !document.querySelector('.theme-background-settings').__vueParentComponent.setupState.themeBackgroundState.saving)
    check('misleading extension/MIME does not destroy original', (await state()).url, beforeAbort.url)
    check('misleading extension/MIME reports actual failure', (await state()).error.includes('未识别'))
    const badPng = Buffer.from(await fs.readFile(stage + '/evidence/theme-image.png')); badPng.writeUInt32BE(200000, 16)
    await page.locator('.theme-background-settings input[type=file]').setInputFiles({ name: 'huge-resolution.png', mimeType: 'image/png', buffer: badPng })
    await page.waitForFunction(() => !document.querySelector('.theme-background-settings').__vueParentComponent.setupState.themeBackgroundState.saving)
    check('pixel bound rejects before massive decode/allocation', (await state()).error.includes('分辨率'))
    check('invalid resolution keeps stored record', await stored(), beforeAbortStored)
    await setOption('#theme-scope', 'main'); await navigate('/player')
    check('main scope still preserves player cover after video configured', await page.locator('.p-bg').evaluate(element => getComputedStyle(element).display !== 'none'))
    check('main scope has no active video on player', await page.locator('video').count(), 0)
    await navigate('/theme-background'); await setOption('#theme-scope', 'player'); await navigate('/player')
    await page.waitForFunction(() => document.querySelector('.theme-background-layer video') && !document.querySelector('.theme-background-layer video').paused)
    check('explicit player scope active with one video', await page.locator('video').count(), 1)
    check('explicit player scope hides old cover only locally', await page.locator('.p-bg').evaluate(element => getComputedStyle(element).display), 'none')
    await page.getByRole('button', { name: '打开完整歌词', exact: true }).click()
    await page.locator('.ly').waitFor()
    check('full lyrics inherit same singleton video', await page.locator('video').count(), 1)
    check('explicit lyric theme is actually visible, old lyric image removed', await page.locator('.ly-bg').evaluate(element => getComputedStyle(element).display), 'none')
    await navigate('/theme-background'); await setOption('#theme-scope', 'lyrics'); await navigate('/player')
    check('lyrics-only scope preserves ordinary player cover', await page.locator('.p-bg').evaluate(element => getComputedStyle(element).display !== 'none'))
    check('lyrics-only has no video before opening lyrics', await page.locator('video').count(), 0)
    await page.getByRole('button', { name: '打开完整歌词', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.ly') && document.querySelector('.theme-background-layer video'))
    check('explicit lyrics-only scope opens single video', await page.locator('video').count(), 1)
    check('lyrics-only theme removes old full-lyric image layer', await page.locator('.ly-bg').evaluate(element => getComputedStyle(element).display), 'none')
    await navigate('/theme-background'); await setOption('#theme-scope', 'all')
    const beforeReload = await state(), persistedBeforeReload = await stored()
    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('.theme-background-settings').waitFor()
    await page.waitForFunction(() => { const state = document.querySelector('.theme-background-settings').__vueParentComponent.setupState.themeBackgroundState; return state.initialized && !state.probing && !!state.config })
    check('cold reload restores same saved asset/metadata', (await state()).config.assetId, beforeReload.config.assetId)
    check('cold reload leaves persisted Blob/config unchanged', await stored(), persistedBeforeReload)
    await page.waitForFunction(() => document.querySelector('video') && !document.querySelector('video').paused)
    check('cold reload has only one video owner', await page.locator('video').count(), 1)
    await upload('theme-video.webm')
    check('actual VP9 WebM first frame decodes on this browser', [(await state()).config.mime, (await state()).config.width, (await state()).config.height], ['video/webm', 320, 180])
    const validWebm = await state(), validWebmStored = await stored()
    await page.locator('.theme-background-settings input[type=file]').setInputFiles({ name: 'truncated-video.mp4', mimeType: 'video/mp4', buffer: (await fs.readFile(stage + '/evidence/theme-av.mp4')).subarray(0, 64) })
    await page.waitForFunction(() => !document.querySelector('.theme-background-settings').__vueParentComponent.setupState.themeBackgroundState.saving)
    check('real video header with undecodable payload cannot replace original', (await state()).url, validWebm.url)
    check('actual decoder failure has a concrete reason', /媒体错误|解码超时/.test((await state()).error))
    await page.locator('.theme-background-settings input[type=file]').setInputFiles({ name: 'truncated-image.png', mimeType: 'image/png', buffer: (await fs.readFile(stage + '/evidence/theme-image.png')).subarray(0, 24) })
    await page.waitForFunction(() => !document.querySelector('.theme-background-settings').__vueParentComponent.setupState.themeBackgroundState.saving)
    check('real image header with undecodable payload retains stored original', await stored(), validWebmStored)
    const styleBeforeFailure = await stored()
    await page.evaluate(() => { window.__failThemePut = true })
    await setRange('#theme-mask', 0.7)
    check('style write failure does not change saved mask', (await state()).config.mask, styleBeforeFailure.config.mask)
    check('style write failure resets visible range', await page.locator('#theme-mask').inputValue(), String(styleBeforeFailure.config.mask))
    await page.evaluate(() => { window.__failThemePut = false })
    // Corrupt only this isolated test's theme key. Keep a valid saved poster to
    // exercise restored-device decode failure without deleting the original record.
    await page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('ceru-music-mobile')
      open.onsuccess = () => { const db = open.result, tx = db.transaction('kv', 'readwrite'), store = tx.objectStore('kv'), get = store.get('theme.background.v1'); get.onsuccess = () => store.put({ ...get.result, blob: new Blob(['bad-video'], { type: 'video/mp4' }) }, 'theme.background.v1'); tx.oncomplete = () => { db.close(); resolve() }; tx.onerror = () => reject(tx.error) }
    }))
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForFunction(() => { const value = document.querySelector('.theme-background-settings')?.__vueParentComponent.setupState.themeBackgroundState; return value?.initialized && !value.probing })
    check('restored undecodable video uses validated saved poster', (await state()).playbackUnavailable && await page.locator('.theme-background-layer .theme-background-poster').count() === 1)
    check('restored unsupported video never starts a decoder', await page.locator('video').count(), 0)
    check('restored decode failure stays transparent and keeps record', (await state()).error.includes('首帧') && (await stored()).blobSize === 9)
    await page.evaluate(() => new Promise((resolve, reject) => { const open = indexedDB.open('ceru-music-mobile'); open.onsuccess = () => { const db = open.result, tx = db.transaction('kv', 'readwrite'), store = tx.objectStore('kv'), get = store.get('theme.background.v1'); get.onsuccess = () => store.put({ ...get.result, config: { ...get.result.config, kind: 'image' }, blob: new Blob(['bad-image'], { type: 'image/png' }), poster: null }, 'theme.background.v1'); tx.oncomplete = () => { db.close(); resolve() }; tx.onerror = () => reject(tx.error) } }))
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForFunction(() => { const value = document.querySelector('.theme-background-settings')?.__vueParentComponent.setupState.themeBackgroundState; return value?.initialized && !value.probing })
    check('invalid restored image falls back to default with reason', (await state()).config === null && (await state()).error.includes('恢复失败'))
    check('invalid stored image is not silently deleted', (await stored()).blobSize, 9)
    await upload('theme-av.mp4')
    await page.waitForFunction(() => document.querySelector('video') && !document.querySelector('video').paused)
    await page.setViewportSize({ width: 360, height: 640 })
    await page.screenshot({ path: stage + '/evidence/theme-background-360x640.png' })
    check('narrow screen has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    const beforeClear = await stored(), beforeClearUrl = (await state()).url
    await page.evaluate(() => { window.__failThemeDelete = true })
    await page.getByRole('button', { name: '恢复默认 / 清除背景', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '恢复默认', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.theme-background-settings').__vueParentComponent.setupState.themeBackgroundState.saving)
    check('failed clear keeps reactive original URL', (await state()).url, beforeClearUrl)
    check('failed clear keeps original stored Blob', await stored(), beforeClear)
    await page.evaluate(() => { window.__failThemeDelete = false })
    await page.getByRole('button', { name: '恢复默认 / 清除背景', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '恢复默认', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.theme-background-settings').__vueParentComponent.setupState.themeBackgroundState.config)
    check('clear reliably removes own stored key', await stored(), null)
    check('clear releases all live media URLs', await page.evaluate(() => window.__themeURLs.size), 0)
    check('clear removes video, returns default', await page.locator('.theme-background-layer').count(), 0)
    await upload('theme-av.mp4')
    const beforeDisposeStored = await stored()
    check('singleton owner has tracked lifecycle listeners', await page.evaluate(() => window.__themeListeners.length >= 4))
    await page.evaluate(() => { const read = Blob.prototype.arrayBuffer; Blob.prototype.arrayBuffer = async function () { await new Promise(resolve => setTimeout(resolve, 600)); return read.call(this) } })
    await page.locator('.theme-background-settings input[type=file]').setInputFiles(stage + '/evidence/theme-av.mp4')
    await page.waitForFunction(() => document.querySelector('.theme-background-settings').__vueParentComponent.setupState.themeBackgroundState.probing)
    const createdBeforeDispose = await page.evaluate(() => window.__themeCreated.length)
    await page.evaluate(() => document.querySelector('#app').__vue_app__.unmount())
    await page.waitForTimeout(800)
    check('app unmount releases every media URL', await page.evaluate(() => window.__themeURLs.size), 0)
    check('app unmount removes singleton lifecycle listeners', await page.evaluate(() => window.__themeListeners.length), 0)
    check('late header read cannot start a decoder after unmount', await page.evaluate(() => window.__themeCreated.length), createdBeforeDispose)
    check('cancelled late replacement leaves persisted original untouched', await stored(), beforeDisposeStored)
    check('app unmount has no remaining video element', await page.locator('video').count(), 0)
    check('page has no unhandled errors', errors, [])
  }
  finished = true
} finally {
  const hashes = {}
  for (const name of ['src/App.vue', 'src/views/Settings.vue', 'src/router/index.ts', ...(baseline ? [] : ['src/core/themeBackground.ts', 'src/components/ThemeBackground.vue', 'src/views/ThemeBackground.vue'])]) hashes[name] = createHash('sha256').update(await fs.readFile(product + '/' + name)).digest('hex')
  await page.screenshot({ path: stage + '/evidence/theme-background-' + (baseline ? 'baseline' : 'modified') + '-last.png' })
  await fs.writeFile(stage + '/evidence/theme-background-' + (baseline ? 'baseline' : 'modified') + '.json', JSON.stringify({ result: finished && !errors.length ? 'PASS' : 'FAIL', phase: baseline ? 'baseline' : 'modified', checks, errors, hashes, requests, scope: 'Mounted app; actual generated PNG/GIF/H264+AAC/VP9 Blob files. Visibility/native foreground flags and delayed reads are controlled simulations, not Android device tests. Music state/MediaSession verified; no physical AudioFocus or speaker recording.' }, null, 2))
  await browser.close()
}
