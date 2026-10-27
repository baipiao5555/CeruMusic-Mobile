import { chromium } from 'playwright-core'

// 回归：SongRow 加了高亮属性后，歌单详情/我的页面在没有搜索词时应当和以前一样。
const track = (index, title, artist) => ({
  id: 'demo-' + index,
  providerId: 'demo',
  pluginId: 'demo',
  providerName: '示例音源',
  ref: { providerId: 'demo', kind: 'track', id: 'demo-' + index, scope: 'provider' },
  title,
  artist,
  album: '示例专辑',
  durationMs: 200000,
  artwork: '/default-cover.png',
  qualities: ['320k']
})

const library = {
  favorites: [track(0, '晴天', '周杰伦')],
  playlists: [
    {
      id: 'pl-1',
      name: '回归检查歌单',
      createdAt: Date.now(),
      tracks: [track(1, '起风了', '买辣椒也用券'), track(2, '稻香', '周杰伦')]
    }
  ]
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--mute-audio']
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (error) => errors.push('[pageerror] ' + error.message))
await page.addInitScript((data) => {
  if (!localStorage.getItem('ceru.library.v1')) {
    localStorage.setItem('ceru.library.v1', JSON.stringify(data))
  }
}, library)

await page.goto('http://127.0.0.1:5180/#/playlist/pl-1', { waitUntil: 'networkidle' })
await page.waitForSelector('.song-row', { timeout: 15000 })
const rows = await page.locator('.song-row').count()
const titles = await page.locator('.song-row .info h3').allInnerTexts()
const marks = await page.locator('.song-row mark').count()
console.log('playlist rows:', rows, '|', titles.map((text) => text.trim()).join(' / '), '| marks:', marks)
await page.screenshot({ path: 'scripts/regression-playlist.png' })

await page.goto('http://127.0.0.1:5180/#/library', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
const body = await page.locator('.page').first().innerText()
console.log('library page:', body.replace(/\n+/g, ' | ').slice(0, 180))
const fatal = errors.filter((line) => !line.includes('sandboxed and lacks the'))
console.log('errors:', fatal.length, fatal.slice(0, 3).join(' | '))
await browser.close()
process.exit(rows > 0 && marks === 0 && fatal.length === 0 ? 0 : 1)
