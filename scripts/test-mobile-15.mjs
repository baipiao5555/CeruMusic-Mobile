import { chromium } from 'playwright-core'

const base = 'http://127.0.0.1:5181'
const plugin = `exports.manifest = {
  manifestVersion: 2,
  id: 'ceru.mobile.featuretest15',
  name: '功能测试音源15',
  version: '1.0.0',
  engines: { hostApi: '^2.0.0', logicRuntime: 'ceru-js@1' },
  modules: { logic: { entry: 'logic.main' } },
  permissions: [{ key: 'network', name: 'network.request', reason: '测试' }],
  contributes: {
    providers: [{ id: 'featuretest15', name: '功能测试15', protocols: ['https'], qualities: ['128k', '320k', 'flac'] }]
  }
}
exports.activate = function (core) {
  core.providers.register('featuretest15', {
    tracks: {
      search: async function () {
        return { items: [{
          ref: { providerId: 'featuretest15', kind: 'track', id: 't15', scope: 'provider' },
          title: '下载测试歌曲',
          capabilities: ['play'],
          metadata: { artists: ['测试歌手'], durationMs: 60000, qualities: ['128k', '320k', 'flac'] }
        }] }
      },
      resolve: async function (resource, quality) {
        return { ok: true, url: '${base}/logo.png' }
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
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', (error) => errors.push(error.message))

await page.goto(base + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)

const providers = await page.evaluate(async (source) => {
  const d = window.__ceruDebug
  await d.installPlugin(source, { enable: true, grantDeclared: true })
  d.selectProvider('featuretest15')
  return d.allProviders().map((item) => item.providerId)
}, plugin)
console.log('providers:', JSON.stringify(providers))

// 1. Auth helpers
const authUrl = await page.evaluate(() => window.__ceruDebug.auth.buildAuthorizeUrl('CHALLENGE', 'STATE', 'NONCE'))
console.log('authorize-url-ok:', authUrl.includes('redirect_uri=cerumusic%3A%2F%2Foauth%2Fcallback') && authUrl.includes('code_challenge_method=S256') && authUrl.includes('resource=https%3A%2F%2Fapi.ceru.shiqianjiang.cn%2Fapi'))
const authError = await page.evaluate(async () => {
  try {
    await window.__ceruDebug.auth.handleAuthCallback('cerumusic://oauth/callback?error=access_denied&error_description=%E6%B5%8B%E8%AF%95%E6%8B%92%E7%BB%9D')
    return 'no-error'
  } catch (error) { return error.message }
})
console.log('callback-error:', authError)
const stateError = await page.evaluate(async () => {
  try {
    await window.__ceruDebug.auth.handleAuthCallback('cerumusic://oauth/callback?code=abc&state=xyz')
    return 'no-error'
  } catch (error) { return error.message }
})
console.log('state-check:', stateError)

// 2. Search and download
await page.goto(base + '/#/search', { waitUntil: 'networkidle' })
await page.waitForSelector('.search-bar input')
await page.fill('.search-bar input', 'test')
await page.press('.search-bar input', 'Enter')
await page.waitForSelector('.song-row')
const downloadButton = page.locator('.song-row .icon-action[aria-label="下载"]').first()
await downloadButton.click()
let status = ''
for (let i = 0; i < 40; i++) {
  status = await page.evaluate(() => window.__ceruDebug.downloads.downloadState.tasks[0]?.status ?? '')
  if (status === 'completed' || status === 'failed') break
  await page.waitForTimeout(500)
}
const task = await page.evaluate(() => {
  const t = window.__ceruDebug.downloads.downloadState.tasks[0]
  return t ? { status: t.status, size: t.size, hasBlob: Boolean(t.blobUrl), error: t.error } : null
})
console.log('download-task:', JSON.stringify(task))
const localUrl = await page.evaluate(() => {
  const d = window.__ceruDebug
  const t = d.downloads.downloadState.tasks[0]
  return t ? d.downloads.localUrlFor(t.track) : ''
})
console.log('local-url-prefix:', localUrl.slice(0, 12))

// 3. Downloads page
await page.goto(base + '/#/downloads', { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
const downloadsText = await page.locator('.page').innerText()
console.log('downloads-page:', downloadsText.replace(/\n+/g, ' | ').slice(0, 220))

// 4. Cloud page (logged out)
await page.goto(base + '/#/cloud', { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
const cloudText = await page.locator('.page').innerText()
console.log('cloud-page:', cloudText.replace(/\n+/g, ' | ').slice(0, 200))

// 5. Settings account card + entries
await page.goto(base + '/#/settings', { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
const settingsText = await page.locator('.page').innerText()
console.log('settings-account:', settingsText.includes('登录后把电脑上的歌单同步到手机'))
console.log('settings-entries:', settingsText.includes('云端歌单') && settingsText.includes('下载管理'))

// 6. Playlists page cloud entry
await page.goto(base + '/#/playlists', { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const playlistText = await page.locator('.page').innerText()
console.log('playlists-cloud-entry:', playlistText.includes('云端'))

await page.screenshot({ path: '/tmp/ceru-15-settings.png', fullPage: false })
console.log('console-errors:', JSON.stringify(errors.slice(0, 5)))
await browser.close()
