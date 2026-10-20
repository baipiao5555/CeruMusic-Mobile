import { chromium } from 'playwright-core'

const plugin = `exports.manifest = {
  manifestVersion: 2,
  id: 'ceru.mobile.cloudtest',
  name: '云歌词测试',
  version: '1.0.0',
  engines: { hostApi: '^2.0.0', logicRuntime: 'ceru-js@1' },
  modules: { logic: { entry: 'logic.main' } },
  permissions: [{ key: 'network', name: 'network.request', reason: '测试' }],
  contributes: {
    providers: [{ id: 'cloudtest', name: '云歌词测试', protocols: ['https'], qualities: ['128k'] }]
  }
}
exports.activate = function (core) {
  const songs = [
    { id: 'cn', title: '晴天', artist: '周杰伦', album: '叶惠美', durationMs: 269000 },
    { id: 'en', title: 'Shape of You', artist: 'Ed Sheeran', album: '÷ (Deluxe)', durationMs: 233000 }
  ]
  core.providers.register('cloudtest', {
    tracks: {
      search: async function (request) {
        const query = String(request.query || '').toLowerCase()
        const matched = songs.filter((song) => (song.title + ' ' + song.artist).toLowerCase().includes(query))
        const list = matched.length ? matched : songs
        return {
          items: list.map((song) => ({
            ref: { providerId: 'cloudtest', kind: 'track', id: song.id, scope: 'provider' },
            title: song.title,
            capabilities: ['play'],
            metadata: {
              artists: [song.artist],
              album: { title: song.album },
              durationMs: song.durationMs,
              qualities: ['128k']
            }
          }))
        }
      },
      resolve: async function () {
        return { ok: true, url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' }
      },
      lyrics: async function (resource) {
        return { format: 'crlyric', version: 1, track: resource, offsetMs: 0, lines: [] }
      }
    }
  })
}`

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: [
    '--disable-web-security',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio'
  ]
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})

await page.goto('http://127.0.0.1:5180/', { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
await page.evaluate(async (source) => {
  const debug = window.__ceruDebug
  await debug.installPlugin(source, { enable: true, grantDeclared: true })
  debug.selectProvider('cloudtest')
}, plugin)

async function searchAndPlay(query) {
  await page.goto('http://127.0.0.1:5180/#/search', { waitUntil: 'networkidle' })
  await page.waitForSelector('.search-bar input')
  await page.fill('.search-bar input', query)
  await page.press('.search-bar input', 'Enter')
  await page.waitForSelector('.song-row')
  await page.locator('.song-row').first().click()
  await page.waitForTimeout(20000)
  const state = await page.evaluate(() => {
    const player = window.__ceruDebug.player
    return {
      title: player.currentTrack()?.title,
      lyrics: player.playerState.lyrics.length,
      source: player.playerState.lyricSource,
      loading: player.playerState.lyricsLoading,
      first: player.playerState.lyrics[0]?.text,
      translation: player.playerState.lyrics.find((line) => line.translation)?.translation
    }
  })
  console.log(query, JSON.stringify(state))
  await page.goto('http://127.0.0.1:5180/#/player', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const sourceLabel = await page.locator('.lyrics-source').count()
    ? await page.locator('.lyrics-source').innerText()
    : ''
  console.log(query, 'player source label:', sourceLabel)
}

await searchAndPlay('晴天')
await searchAndPlay('Shape of You')

console.log('console errors:', errors.length)
for (const error of errors.slice(0, 10)) console.log('[error]', error)
await browser.close()
