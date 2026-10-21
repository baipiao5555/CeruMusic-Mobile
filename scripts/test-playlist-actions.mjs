import { chromium } from 'playwright-core'

const base = 'http://127.0.0.1:5181'
const plugin = `exports.manifest = {
  manifestVersion: 2,
  id: 'ceru.mobile.playlisttest',
  name: '歌单操作测试',
  version: '1.0.0',
  engines: { hostApi: '^2.0.0', logicRuntime: 'ceru-js@1' },
  modules: { logic: { entry: 'logic.main' } },
  contributes: {
    providers: [{ id: 'playlisttest', name: '歌单测试', protocols: ['https'], qualities: ['128k'] }]
  }
}
exports.activate = function (core) {
  core.providers.register('playlisttest', {
    tracks: {
      search: async function () {
        return { items: [{
          ref: { providerId: 'playlisttest', kind: 'track', id: 'p1', scope: 'provider' },
          title: '歌单测试歌曲', capabilities: ['play'],
          metadata: { artists: ['测试歌手'], album: { title: '测试专辑' }, durationMs: 60000, qualities: ['128k'] }
        }] }
      },
      resolve: async function () { return { ok: true, url: '${base}/logo.png' } }
    }
  })
}`

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})

await page.goto(base + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)
await page.evaluate(async (source) => {
  const d = window.__ceruDebug
  await d.installPlugin(source, { enable: true, grantDeclared: true })
  d.selectProvider('playlisttest')
}, plugin)

await page.goto(base + '/#/search', { waitUntil: 'networkidle' })
await page.waitForSelector('.search-bar input')
await page.fill('.search-bar input', 'test')
await page.press('.search-bar input', 'Enter')
await page.waitForSelector('.song-row')
console.log('more-button:', (await page.locator('.song-row .icon-action[aria-label="更多操作"]').count()) > 0)
console.log('queue-button-removed:', (await page.locator('.song-row .icon-action[aria-label="加入播放队列"]').count()) === 0)

await page.locator('.song-row .icon-action[aria-label="更多操作"]').first().click()
await page.waitForSelector('.actions-sheet')
const menuText = await page.locator('.actions-sheet').innerText()
console.log('menu-actions:', ['下一首播放', '添加到播放队列', '添加到歌单', '下载'].every((t) => menuText.includes(t)))
await page.screenshot({ path: '/d/tmp/shot-song-actions.png' })

await page.locator('.action-row', { hasText: '添加到歌单' }).click()
await page.waitForTimeout(300)
console.log('empty-picker:', await page.locator('.picker-hint').isVisible())
await page.fill('.new-playlist input', '我的测试歌单')
await page.locator('.new-playlist .btn').click()
await page.waitForTimeout(500)

let library = await page.evaluate(() => JSON.parse(localStorage.getItem('ceru.library.v1') || '{}'))
console.log('created-playlist:', library.playlists?.[0]?.name, library.playlists?.[0]?.tracks?.length)
const playlistId = library.playlists[0].id

await page.goto(base + '/#/playlist/' + playlistId, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.locator('.song-row .icon-action[aria-label="更多操作"]').first().click()
await page.waitForSelector('.actions-sheet')
console.log('remove-action:', await page.locator('.action-row', { hasText: '从当前歌单移除' }).isVisible())
await page.locator('.action-row', { hasText: '从当前歌单移除' }).click()
await page.waitForTimeout(400)
library = await page.evaluate(() => JSON.parse(localStorage.getItem('ceru.library.v1') || '{}'))
console.log('after-remove:', library.playlists?.[0]?.tracks?.length)
console.log('empty-state:', await page.locator('.empty').isVisible())

await page.goto(base + '/#/search', { waitUntil: 'networkidle' })
await page.fill('.search-bar input', 'test')
await page.press('.search-bar input', 'Enter')
await page.waitForSelector('.song-row')
await page.locator('.song-row .icon-action[aria-label="更多操作"]').first().click()
await page.locator('.action-row', { hasText: '添加到歌单' }).click()
await page.waitForTimeout(300)
await page.locator('.action-row', { hasText: '我的测试歌单' }).click()
await page.waitForTimeout(400)
library = await page.evaluate(() => JSON.parse(localStorage.getItem('ceru.library.v1') || '{}'))
console.log('re-added:', library.playlists?.[0]?.tracks?.length)
console.log('console-errors:', JSON.stringify(errors.slice(0, 4)))
await browser.close()
