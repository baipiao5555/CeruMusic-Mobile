import assert from 'node:assert/strict'
import fs from 'node:fs'
import { chromium } from 'playwright-core'

const base = process.env.CERU_TEST_URL || 'http://127.0.0.1:5180'
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const currentParts = packageJson.version.split('-')[0].split('.').map(Number)
const latestTag = `v${currentParts[0]}.${currentParts[1]}.${currentParts[2] + 1}`
const release = {
  tag_name: latestTag,
  name: `澜音 · CeruMusic 手机版 ${latestTag}`,
  body: '### 本次更新\n- 更新提示回归测试\n- **下载并安装** APK',
  html_url: `https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/${latestTag}`,
  published_at: '2026-11-21T00:00:00Z',
  assets: [{
    name: 'CeruMusic-Mobile-v2.7.6.apk',
    size: 7621317,
    browser_download_url: 'https://github.com/baipiao5555/CeruMusic-Mobile/releases/download/v2.7.6/CeruMusic-Mobile-v2.7.6.apk'
  }]
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true
})
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
await context.route('**/*', route => {
  const url = new URL(route.request().url())
  if (url.hostname === 'api.github.com' || url.hostname === 'gh-proxy.com') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(release) })
  }
  return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort('blockedbyclient')
})
await context.addInitScript(() => {
  if (!sessionStorage.getItem('ceru-test-update-init')) {
    localStorage.removeItem('ceru.update.v1')
    localStorage.setItem('ceru.settings.v1', JSON.stringify({ pluginAutoUpdate: false }))
    sessionStorage.setItem('ceru-test-update-init', '1')
  }
})

const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.goto(base + '/#/', { waitUntil: 'networkidle' })
try {
  await page.waitForFunction(() => location.hash === '#/update', undefined, { timeout: 15000 })
} catch (error) {
  await page.screenshot({ path: '../evidence/app-update-prompt-failure.png' })
  const state = await page.evaluate(() => ({
    hash: location.hash,
    body: document.body.innerText,
    stored: localStorage.getItem('ceru.update.v1'),
    updater: window.__ceruDebug?.updater && {
      currentVersion: window.__ceruDebug.updater.updateState.currentVersion,
      autoCheck: window.__ceruDebug.updater.updateState.autoCheck,
      checking: window.__ceruDebug.updater.updateState.checking,
      hasUpdate: window.__ceruDebug.updater.updateState.hasUpdate,
      latest: window.__ceruDebug.updater.updateState.latest,
      error: window.__ceruDebug.updater.updateState.error
    }
  }))
  fs.writeFileSync('../evidence/app-update-prompt-failure.json', JSON.stringify({ state, errors }, null, 2))
  throw error
}
const text = await page.locator('body').innerText()
assert.match(text, new RegExp(`v${packageJson.version.replace(/\./g, '\\.')}`))
assert.match(text, new RegExp(latestTag.replace(/\./g, '\\.')))
assert.match(text, /下载并安装/)
assert.doesNotMatch(text, /###|\*\*/)
assert.equal(await page.evaluate(() => window.__ceruDebug.updater.updateState.hasUpdate), true)
await page.screenshot({ path: '../evidence/app-update-prompt.png' })

const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ceru.update.v1')))
assert.equal(stored.latest.tag, latestTag)
assert.equal(stored.lastAutoPromptDay.length, 10, 'the successful automatic prompt is rate-limited by local day')

await page.getByRole('button', { name: '忽略这个版本' }).click()
await page.waitForFunction(() => window.__ceruDebug.updater.updateState.hasUpdate === false)
await page.evaluate(() => { location.hash = '#/' })
await page.waitForFunction(() => location.hash === '#/')
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
assert.notEqual(await page.evaluate(() => location.hash), '#/update', 'ignored release must not auto-open again')

await page.evaluate(() => {
  const saved = JSON.parse(localStorage.getItem('ceru.update.v1'))
  saved.ignoredTag = ''
  localStorage.setItem('ceru.update.v1', JSON.stringify(saved))
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
assert.notEqual(await page.evaluate(() => location.hash), '#/update', 'same-day prompt remains rate-limited')

assert.deepEqual(errors.filter(error => !error.includes('sandboxed and lacks the')), [])
console.log('PASS app update prompt: auto-opens update page, renders notes, supports ignore and same-day rate limit')
await browser.close()
