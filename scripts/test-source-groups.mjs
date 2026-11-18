import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = process.env.CERU_TEST_URL || 'http://127.0.0.1:5180'
const executablePath =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const plugin = String.raw`
exports.manifest = {
  manifestVersion: 2,
  id: 'qa.source.groups',
  name: 'UI Source Fixture',
  version: '1.0.0',
  engines: { hostApi: '^2.0.0', logicRuntime: 'ceru-js@1' },
  modules: { logic: { entry: 'logic.main' } },
  contributes: {
    providers: [
      { id: 'qq', name: 'QQ音乐', protocols: ['https'], qualities: ['128k'] },
      { id: 'kg', name: '酷狗音乐', protocols: ['https'], qualities: ['128k'] }
    ]
  }
}
exports.activate = function () {}
`

const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
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
  await page.evaluate((source) =>
    window.__ceruDebug.installPlugin(source, { enable: true, grantDeclared: true }), plugin)
  await page.evaluate(() => { location.hash = '#/plugins' })
  const group = page.locator('.source-group').filter({ hasText: 'UI Source Fixture' })
  await group.waitFor({ state: 'visible' })
  assert.equal(await group.locator('.source-tiles .tile').count(), 0, 'providers stay hidden by default')
  await group.locator('.source-summary').click()
  assert.equal(await group.locator('.source-tiles .tile').count(), 2)
  assert.deepEqual(await group.locator('.source-tiles .tname').allTextContents(), ['QQ音乐', '酷狗音乐'])
  await group.locator('.source-summary').click()
  assert.equal(await group.locator('.source-tiles .tile').count(), 0)
  console.log('PASS source groups: plugin name collapsed, providers expand on click')
} finally {
  await browser.close()
}
