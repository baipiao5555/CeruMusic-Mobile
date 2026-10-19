import { chromium } from 'playwright-core'

const plugin = `exports.manifest = {
  manifestVersion: 2,
  id: 'ceru.mobile.featuretest',
  name: '功能测试音源',
  version: '1.0.0',
  engines: { hostApi: '^2.0.0', logicRuntime: 'ceru-js@1' },
  modules: { logic: { entry: 'logic.main' } },
  permissions: [{ key: 'network', name: 'network.request', reason: '测试' }],
  contributes: {
    providers: [{ id: 'featuretest', name: '功能测试', protocols: ['https'], qualities: ['128k', '320k', 'flac', 'master'] }],
    playlistImporters: [{
      id: 'test-import',
      title: '测试导入',
      providerId: 'featuretest',
      description: '用于验证手机版歌单导入链路',
      placeholder: '粘贴测试歌单链接',
      instructions: ['复制歌单分享链接', '粘贴到下方输入框'],
      examples: [{ label: '示例链接', value: 'https://example.com/playlist/1' }]
    }]
  }
}
exports.activate = function (core) {
  core.providers.register('featuretest', {
    tracks: {
      search: async function () {
        return { items: [{
          ref: { providerId: 'featuretest', kind: 'track', id: 't1', scope: 'provider' },
          title: '母带测试歌曲',
          capabilities: ['play'],
          metadata: { artists: ['测试歌手'], durationMs: 60000, qualities: ['128k', '320k', 'flac', 'master'] }
        }] }
      },
      resolve: async function (resource, quality) {
        console.log('resolved-quality:' + quality)
        return { ok: true, url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' }
      },
      lyrics: async function (resource) {
        return { format: 'crlyric', version: 1, track: resource, offsetMs: 0, lines: [{ startTimeMs: 0, endTimeMs: 3000, text: '测试歌词' }] }
      }
    }
  })
  core.playlistImporters.register('test-import', {
    getTracks: async function (input) {
      console.log('import-value:' + input.value)
      return {
        name: '测试导入歌单',
        items: [
          { ref: { providerId: 'featuretest', kind: 'track', id: 'i1', scope: 'provider' }, title: '导入歌曲一', capabilities: ['play'], metadata: { artists: ['导入歌手'], durationMs: 120000, qualities: ['master'] } },
          { ref: { providerId: 'featuretest', kind: 'track', id: 'i2', scope: 'provider' }, title: '导入歌曲二', capabilities: ['play'], metadata: { artists: ['导入歌手'], durationMs: 130000 } }
        ]
      }
    }
  })
}`

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const errors = []
page.on('console', (message) => {
  if (message.text().includes('resolved-quality') || message.text().includes('import-value')) {
    console.log('[plugin]', message.text())
  }
  if (message.type() === 'error') errors.push(message.text())
})
page.on('pageerror', (error) => errors.push(error.message))

const debug = () => page.evaluate(() => window.__ceruDebug)
await page.goto('http://127.0.0.1:5180/', { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)

const installed = await page.evaluate(async (source) => {
  const d = window.__ceruDebug
  await d.installPlugin(source, { enable: true, grantDeclared: true })
  d.selectProvider('featuretest')
  return d.allProviders().map((item) => ({ id: item.providerId, qualities: item.qualities }))
}, plugin)
console.log('providers:', JSON.stringify(installed))

// Search and play a track with master quality available.
await page.goto('http://127.0.0.1:5180/#/search', { waitUntil: 'networkidle' })
await page.waitForSelector('.search-bar input')
await page.fill('.search-bar input', 'test')
await page.press('.search-bar input', 'Enter')
await page.waitForSelector('.song-row')
await page.locator('.song-row').first().click()
await page.waitForTimeout(3000)
const qualityState = await page.evaluate(() => ({
  quality: window.__ceruDebug.player.playerState.quality,
  resolvedQuality: window.__ceruDebug.player.playerState.resolvedQuality
}))
console.log('quality state:', JSON.stringify(qualityState))

// Player quality chips.
await page.locator('.mini-player').click()
await page.waitForTimeout(800)
const playerQuality = await page.locator('.quality-row').innerText()
console.log('player quality chips:', playerQuality.replace(/\n+/g, ' | '))

// Settings quality chips.
await page.goto('http://127.0.0.1:5180/#/settings', { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const settingsQuality = await page.locator('.panel', { hasText: '默认音质' }).locator('.chips').innerText()
console.log('settings quality chips:', settingsQuality.replace(/\n+/g, ' | '))

// Dedicated playlists tab.
await page.goto('http://127.0.0.1:5180/#/', { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const navCount = await page.locator('.nav-item').count()
await page.locator('.nav-item', { hasText: '歌单' }).click()
await page.waitForURL(/#\/playlists/)
await page.waitForTimeout(500)
const playlistsTitle = await page.locator('.summary-info h2').innerText()
console.log('bottom tabs:', navCount, 'playlists page:', playlistsTitle)

// Playlist import flow.
await page.goto('http://127.0.0.1:5180/#/library', { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.locator('.list-group .list-item', { hasText: '导入歌单' }).first().click()
await page.waitForSelector('.import-input')
const importChips = await page.locator('.sheet .chips').innerText()
console.log('import chips:', importChips.replace(/\n+/g, ' | '))
await page.fill('.import-input', 'https://example.com/playlist/1')
await page.locator('.sheet .btn', { hasText: '开始导入' }).click()
await page.waitForURL(/#\/playlist\//, { timeout: 30000 })
await page.waitForSelector('.song-row')
const playlistTitle = await page.locator('.playlist-hero h1').innerText()
const importedRows = await page.locator('.song-row').count()
console.log('imported playlist:', playlistTitle, 'rows:', importedRows)

// The private URL must still be rejected.
const privateCheck = await page.evaluate(async () => {
  try {
    await window.__ceruDebug.fetchPluginCode('http://127.0.0.1:5180/')
    return 'NOT_BLOCKED'
  } catch (error) {
    return String(error && error.message || error)
  }
})
console.log('private url guard:', privateCheck)
console.log('console errors:', errors.length)
for (const error of errors.slice(0, 10)) console.log('[error]', error)

await browser.close()
