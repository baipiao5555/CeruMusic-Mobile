import { chromium } from 'playwright-core'

const base = process.env.CERU_URL || 'http://127.0.0.1:5181'
const release = {
  tag_name: 'v2.3.1-mobile.17',
  name: '澜音 · CeruMusic 手机版 v2.3.1-mobile.17',
  body: '### 本次更新\n- 应用内检查更新\n- **下载并安装** APK\n\n第二段说明',
  html_url: 'https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.17',
  published_at: '2026-10-21T03:00:00Z',
  assets: [
    {
      name: 'CeruMusic-Mobile-v2.3.1-mobile.17.apk',
      size: 5356076,
      browser_download_url:
        'https://github.com/baipiao5555/CeruMusic-Mobile/releases/download/v2.3.1-mobile.17/CeruMusic-Mobile-v2.3.1-mobile.17.apk'
    }
  ]
}

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
await page.route(
  'https://api.github.com/repos/baipiao5555/CeruMusic-Mobile/releases/latest',
  (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(release) })
)

await page.goto(base + '/#/update', { waitUntil: 'networkidle' })
await page.waitForSelector('.release-card', { timeout: 15000 })
await page.waitForTimeout(400)
const updateText = await page.locator('.page').innerText()
console.log('has-update:', updateText.includes('v2.3.1-mobile.17'))
console.log('install-button:', updateText.includes('下载并安装'))
console.log('notes-clean:', !updateText.includes('###') && !updateText.includes('**'))
console.log('size-shown:', updateText.includes('5.11 MB'))
const state = await page.evaluate(() => {
  const s = window.__ceruDebug.updater.updateState
  return { hasUpdate: s.hasUpdate, tag: s.latest?.tag, autoCheck: s.autoCheck }
})
console.log('state:', JSON.stringify(state))
await page.screenshot({ path: '/d/tmp/shot-update.png' })

await page.goto(base + '/#/settings', { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const settingsText = await page.locator('.page').innerText()
console.log('settings-badge:', settingsText.includes('发现 v2.3.1-mobile.17'))
console.log('settings-dot:', (await page.locator('.list-item .dot').count()) > 0)

await page.goto(base + '/#/update', { waitUntil: 'networkidle' })
await page.waitForTimeout(300)
await page.locator('.ignore-btn').click()
await page.waitForTimeout(300)
const ignored = await page.evaluate(() => window.__ceruDebug.updater.updateState.hasUpdate)
console.log('ignored:', ignored === false)
await page.locator('.switch').click()
await page.waitForTimeout(200)
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ceru.update.v1') || '{}'))
console.log('auto-check-off-persisted:', stored.autoCheck === false)
console.log('console-errors:', JSON.stringify(errors.slice(0, 5)))
await browser.close()
