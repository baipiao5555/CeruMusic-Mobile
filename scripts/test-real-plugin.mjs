import fs from 'node:fs'
import { chromium } from 'playwright-core'

const url = process.env.CERU_PLUGIN_URL
const file = process.env.CERU_PLUGIN_FILE
if (!url && !file) {
  console.log('CERU_PLUGIN_URL / CERU_PLUGIN_FILE not set; skipping real-plugin test')
  process.exit(0)
}
const code = file ? fs.readFileSync(file, 'utf8') : undefined

const browserArgs = ['--autoplay-policy=no-user-gesture-required', '--mute-audio']
if (process.env.CERU_DISABLE_WEB_SECURITY === '1') {
  browserArgs.push('--disable-web-security')
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: browserArgs
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})
await page.goto('http://127.0.0.1:5180/', { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)

const info = await page.evaluate(async ({ pluginUrl, pluginCode }) => {
  const debug = window.__ceruDebug
  const source = pluginCode ?? (await debug.fetchPluginCode(pluginUrl))
  const descriptor = await debug.installPlugin(source, { enable: true, grantDeclared: true })
  return {
    plugin: descriptor.name,
    version: descriptor.version,
    providers: debug.allProviders().map((item) => ({ id: item.providerId, qualities: item.qualities })),
    importers: debug.allImporters().map((item) => item.title),
    sections: descriptor.homeSections.map((item) => `${item.title}:${item.kind}`)
  }
}, { pluginUrl: url, pluginCode: code })
console.log('plugin:', info.plugin, info.version)
console.log('providers:', JSON.stringify(info.providers))
console.log('importers:', info.importers.join(' | '))
console.log('sections:', info.sections.join(' | '))

const source = info.providers.find((item) => item.id === 'wy') ? 'wy' : info.providers[0]?.id
await page.evaluate((value) => window.__ceruDebug.selectProvider(value), source)

await page.goto('http://127.0.0.1:5180/#/search', { waitUntil: 'networkidle' })
await page.waitForSelector('.search-bar input')
await page.fill('.search-bar input', '晴天')
await page.press('.search-bar input', 'Enter')
await page.waitForTimeout(12000)
const rows = await page.locator('.song-row').count()
console.log('search rows:', rows)
if (rows) {
  const titles = await page.locator('.song-row .info h3').allInnerTexts()
  console.log('first results:', titles.slice(0, 3).join(' | '))
  await page.locator('.song-row').first().click()
  await page.waitForTimeout(5000)
  const state = await page.evaluate(() => ({
    quality: window.__ceruDebug.player.playerState.quality,
    resolvedQuality: window.__ceruDebug.player.playerState.resolvedQuality,
    error: window.__ceruDebug.player.playerState.error,
    playing: window.__ceruDebug.player.playerState.playing
  }))
  console.log('playback:', JSON.stringify(state))
}

if (process.env.CERU_TEST_IMPORT === '1') {
  const imported = await page.evaluate(async () => {
    const debug = window.__ceruDebug
    try {
      const provider = debug.allProviders().find((item) => item.providerId === 'wy')
      const categories = await debug.invokeProvider(provider, 'playlists.categories', [])
      const category = categories.items?.[0]
      if (!category) return { error: '没有歌单分类' }
      const page = await debug.invokeProvider(provider, 'playlists.list', [category.ref, undefined])
      const items = (page.items ?? []).filter((item) => item.ref?.kind === 'playlist')
      const playlist =
        items.find((item) => (item.playlist?.trackCount ?? 9999) < 200) ?? items[0]
      if (!playlist) return { error: '没有可导入歌单' }
      const importer = debug.allImporters().find((item) => item.title.includes('网易云'))
      const result = await debug.importPlaylist(importer, String(playlist.ref.id))
      return {
        playlistId: playlist.ref.id,
        name: result.name,
        count: result.tracks.length,
        first: result.tracks[0]?.title
      }
    } catch (error) {
      return { error: String((error && error.message) || error) }
    }
  })
  console.log('real import:', JSON.stringify(imported))
}

console.log('console errors:', errors.length)
for (const error of errors.slice(0, 8)) console.log('[error]', error)
await browser.close()
