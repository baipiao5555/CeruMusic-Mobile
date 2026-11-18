import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = process.env.CERU_TEST_URL || 'http://127.0.0.1:5180'
const executablePath =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sample = `/**
 * @name 青听音源
 * @author 元力菌
 */
{
  "lines": [
    { "id": "kw", "name": "小窝源", "searchApi": "fetchSearchMusic", "detailApi": "fetchMusicDetail" }
  ]
}`

const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
await context.route('**/*', (route) => {
  const hostname = new URL(route.request().url()).hostname
  return ['127.0.0.1', 'localhost'].includes(hostname)
    ? route.continue()
    : route.abort('blockedbyclient')
})
await context.addInitScript(() => {
  try {
    localStorage.setItem('ceru.update.v1', JSON.stringify({ autoCheck: false }))
  } catch {}
})
const page = await context.newPage()

try {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__ceruDebug && !window.__ceruDebug.pluginState.loading)
  const message = await page.evaluate((code) => {
    try {
      window.__ceruDebug.inspectPlugin(code)
      return ''
    } catch (error) {
      return error?.message || String(error)
    }
  }, sample)
  assert.match(message, /第三方音源配置/)
  assert.match(message, /不是澜音 v2 插件或洛雪 LX 脚本/)
  console.log('PASS plugin import: third-party JSON source gets a clear rejection')
} finally {
  await browser.close()
}
