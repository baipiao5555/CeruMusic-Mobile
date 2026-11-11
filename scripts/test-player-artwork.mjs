import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const base = process.env.CERU_TEST_URL || 'http://127.0.0.1:5181'
const output = resolve(
  process.env.CERU_TEST_OUTPUT || fileURLToPath(new URL('../../.vite/takeover-checks/', import.meta.url))
)
const audioUrl = 'https://audio.example.test/artwork.wav'
const sampleRate = 8000
const samples = sampleRate * 90
const wav = Buffer.alloc(44 + samples * 2)
wav.write('RIFF', 0)
wav.writeUInt32LE(wav.length - 8, 4)
wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20)
wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(sampleRate, 24)
wav.writeUInt32LE(sampleRate * 2, 28)
wav.writeUInt16LE(2, 32)
wav.writeUInt16LE(16, 34)
wav.write('data', 36)
wav.writeUInt32LE(samples * 2, 40)

const plugin = `
exports.manifest = {
  manifestVersion: 2, id: 'ceru.test.artwork', name: 'Artwork Test', version: '1.0.0',
  engines: { hostApi: '^2.0.0', logicRuntime: 'ceru-js@1' },
  modules: { logic: { entry: 'logic.main' } },
  contributes: { providers: [{ id: 'artwork', name: 'Artwork', protocols: ['https'], qualities: ['128k'] }] }
}
exports.activate = core => core.providers.register('artwork', {
  tracks: {
    search: async () => ({ items: [{
      ref: { providerId: 'artwork', kind: 'track', id: 'rotation', pluginId: core.plugin.id },
      title: 'Artwork rotation', capabilities: ['play'],
      metadata: { artists: ['Test Artist'], artworkUrl: '/default-cover.png', durationMs: 90000 }
    }] }),
    resolve: async () => ({ ok: true, url: ${JSON.stringify(audioUrl)} }),
    lyrics: async () => ({
      format: 'crlyric', version: 1, offsetMs: 0,
      lines: [{ startTimeMs: 0, endTimeMs: 90000, text: 'Playback artwork regression' }]
    })
  }
})
`
const lxPlugin = `/**
 * @name Artwork LX Test
 * @version 1.0.0
 */
const lx = globalThis.lx
lx.on(lx.EVENT_NAMES.request, async ({ action }) => action === 'lyric'
  ? { lyric: '[00:00.00]Playback artwork regression' }
  : ${JSON.stringify(audioUrl)})
lx.send(lx.EVENT_NAMES.inited, { sources: {
  kw: { type: 'music', actions: ['musicUrl', 'lyric'], qualitys: ['128k'] }
} })
`

await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']
})
const errors = []

try {
  for (const { viewport, useLx } of [
    { viewport: { width: 360, height: 640 } },
    { viewport: { width: 390, height: 844 } },
    { viewport: { width: 1440, height: 900 } },
    { viewport: { width: 390, height: 844 }, useLx: true }
  ]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'no-preference' })
    page.on('pageerror', error => errors.push(error.message))
    await page.route(audioUrl, route => route.fulfill({ contentType: 'audio/wav', body: wav }))
    await page.route('https://search.kuwo.cn/**', route => route.fulfill({
      json: { TOTAL: '1', abslist: [{
        MUSICRID: 'MUSIC_123', SONGNAME: 'Artwork rotation', ARTIST: 'Test Artist', DURATION: '90',
        N_MINFO: 'level:h,bitrate:128,format:mp3,size:1Mb'
      }] }
    }))
    await page.addInitScript(() => {
      if (window.top !== window) return
      localStorage.setItem('ceru.settings.v1', JSON.stringify({
        version: 2, cloudLyrics: false, keepScreenOn: false, pluginAutoUpdate: false
      }))
    })
    await page.goto(base, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => window.__ceruDebug && !window.__ceruDebug.pluginState.loading)
    await page.evaluate(async ({ source, useLx }) => {
      const debug = window.__ceruDebug
      const installed = await debug.installPlugin(source, { enable: true, grantDeclared: true })
      if (useLx) {
        debug.selectProvider('kw', installed.pluginId)
        location.hash = '/search'
        return
      }
      const provider = debug.allProviders().find(item => item.providerId === 'artwork')
      const result = await debug.invokeProvider(provider, 'tracks.search', [{ query: 'rotation' }])
      await debug.player.playTracks([debug.player.toTrack(result.items[0], provider)])
      location.hash = '/player'
    }, { source: useLx ? lxPlugin : plugin, useLx })
    if (useLx) {
      const input = page.locator('.searchfield input')
      await input.fill('A')
      const suggestion = page.locator('.srow:not(.direct)').first()
      await suggestion.waitFor({ state: 'visible' })
      assert.match(await suggestion.textContent(), /Artwork rotation/)
      await suggestion.click()
      await page.locator('.search-page .songrow').first().click()
      await page.waitForFunction(() => window.__ceruDebug.player.playerState.playing &&
        window.__ceruDebug.player.playerState.lyrics[0]?.text === 'Playback artwork regression')
      await page.locator('.mini').click()
    }
    const art = page.locator('.p-art img')
    await art.waitFor({ state: 'visible' })
    await page.waitForFunction(() => {
      const img = document.querySelector('.p-art img')
      return img?.complete && img.naturalWidth > 0 &&
        getComputedStyle(img).animationPlayState === 'running'
    })
    await page.waitForTimeout(400)
    assert.equal(await art.evaluate(img => getComputedStyle(img).borderRadius), '50%')
    const angle = await art.evaluate(img => getComputedStyle(img).transform)
    await page.waitForTimeout(250)
    assert.notEqual(await art.evaluate(img => getComputedStyle(img).transform), angle)
    const beforePause = await page.locator('.p-art').boundingBox()

    const layout = await page.evaluate(() => {
      const selectors = ['.p-top', '.p-art', '.p-meta', '.p-lyric', '.p-seek', '.p-ctrl', '.p-sub']
      return selectors.map(selector => {
        const rect = document.querySelector(selector).getBoundingClientRect()
        return { selector, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
      })
    })
    for (let index = 0; index < layout.length; index++) {
      const rect = layout[index]
      assert.ok(rect.top >= -1 && rect.bottom <= viewport.height + 1, `${rect.selector} vertical overflow`)
      assert.ok(rect.left >= -1 && rect.right <= viewport.width + 1, `${rect.selector} horizontal overflow`)
      if (index > 0) assert.ok(layout[index - 1].bottom <= rect.top + 1, `${rect.selector} overlaps`)
    }
    await page.evaluate(() => { window.__ceruDebug.player.playerState.loading = true })
    assert.equal(await art.evaluate(img => getComputedStyle(img).animationPlayState), 'paused')
    const buffered = await art.evaluate(img => img.getAnimations()[0].currentTime)
    await page.waitForTimeout(250)
    assert.equal(await art.evaluate(img => img.getAnimations()[0].currentTime), buffered)
    assert.deepEqual(await page.locator('.p-art').boundingBox(), beforePause)
    await page.evaluate(() => { window.__ceruDebug.player.playerState.loading = false })
    await page.waitForTimeout(180)
    assert.ok(await art.evaluate((img, time) => img.getAnimations()[0].currentTime > time, buffered))
    const label = `player-${viewport.width}${useLx ? '-lx' : ''}`
    await page.screenshot({ path: resolve(output, `${label}-playing.png`) })

    await page.locator('.p-ctrl .p-play').click()
    await page.waitForFunction(() => !window.__ceruDebug.player.playerState.playing)
    await page.waitForTimeout(100)
    assert.equal(await art.evaluate(img => getComputedStyle(img).animationPlayState), 'paused')
    const stopped = await art.evaluate(img => img.getAnimations()[0].currentTime)
    await page.waitForTimeout(300)
    assert.equal(await art.evaluate(img => img.getAnimations()[0].currentTime), stopped)
    assert.deepEqual(await page.locator('.p-art').boundingBox(), beforePause)
    await page.screenshot({ path: resolve(output, `${label}-paused.png`) })

    await page.locator('.p-ctrl .p-play').click()
    await page.waitForFunction(() => window.__ceruDebug.player.playerState.playing)
    await page.waitForTimeout(180)
    assert.ok(await art.evaluate((img, time) => img.getAnimations()[0].currentTime > time, stopped))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(await art.evaluate(img => getComputedStyle(img).animationName), 'none')
    console.log(`PASS circle, play/pause/buffering/resume, stable layout, reduced motion: ${viewport.width}x${viewport.height}${useLx ? ' LX search/playback flow' : ''}`)
    await page.close()
  }
  assert.deepEqual(errors, [])
  console.log('PASS no uncaught browser errors')
  console.log(`Screenshots: ${output}`)
} finally {
  await browser.close()
}
