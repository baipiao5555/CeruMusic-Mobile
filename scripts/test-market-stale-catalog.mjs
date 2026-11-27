import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const out = path.resolve(root, '../evidence')
const base = 'http://127.0.0.1:5396'
const log = fs.createWriteStream(out + '/stale-catalog-vite.log')
const server = spawn(process.execPath, [root + '/node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5396', '--strictPort'], { cwd: root, windowsHide: true })
server.stdout.pipe(log)
server.stderr.pipe(log)

const cached = {
  generatedAt: '2026-11-27T00:00:00.000Z',
  count: 1,
  plugins: [{
    name: '酷狗音乐', version: '1.0.0', file: 'kugou.ceru.js', description: '缓存中的旧目录',
    author: 'QA', id: 'ceru.kugou'
  }]
}
const file = `exports.manifest = {
  manifestVersion: 2,
  id: 'ceru.kugou',
  name: '酷狗音乐',
  version: '1.1.0',
  description: '仓库中的新文件',
  author: 'QA',
  engines: { hostApi: '^2.0.0', logicRuntime: 'ceru-js@1' },
  modules: { logic: { entry: 'logic.main' } },
  permissions: [],
  contributes: { providers: [{ id: 'kugou', name: '酷狗音乐', protocols: ['https'], qualities: ['128k'] }] }
};
exports.activate = function() {};`

let browser
const checks = []
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(base)).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.addInitScript(({ cached }) => {
    if (window.top !== window) return
    localStorage.setItem('ceru.update.v1', JSON.stringify({ autoCheck: false }))
    localStorage.setItem('ceru.settings.v1', JSON.stringify({ pluginAutoUpdate: false }))
    localStorage.setItem('ceru.market.catalog.v1', JSON.stringify({ data: cached, time: Date.now(), line: 'github' }))
  }, { cached })
  await page.route('**/*', async route => {
    const url = route.request().url()
    if (url.startsWith(base)) return route.continue()
    if (url.includes('/ceru-list.json')) return route.fulfill({ json: cached })
    if (url.includes('/ceru-plugins/kugou.ceru.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: file })
    return route.abort()
  })
  await page.goto(base + '/#/plugins')
  await page.waitForFunction(() => window.__ceruDebug && !window.__ceruDebug.pluginState.loading)
  const card = page.locator('.catalog-card').filter({ hasText: '酷狗音乐' })
  await card.getByRole('button', { name: '获取', exact: true }).click()
  try {
    await page.getByRole('checkbox', { name: '确认插件来源与权限' }).waitFor({ timeout: 10_000 })
  } catch (error) {
    console.error('PANEL:', await page.locator('.market-panel').innerText().catch(() => '(no panel)'))
    await page.screenshot({ path: out + '/音源市场-旧目录自愈-失败.png' })
    throw error
  }
  assert.equal(await page.getByText('目录和文件 ID / 版本不一致，请刷新目录后重试', { exact: true }).count(), 0)
  assert.match(await page.locator('.market-panel').innerText(), /v1\.1\.0/)
  await page.screenshot({ path: out + '/音源市场-旧目录自愈.png' })
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ceru.market.catalog.v1')))
  assert.equal(saved.data.plugins[0].version, '1.1.0')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  assert.match(await card.innerText(), /v1\.1\.0/)
  checks.push('stale cached v1.0.0 directory accepts verified v1.1.0 file and persists the corrected version')
  const liveUrl = 'https://raw.githubusercontent.com/hebijunge/musicfree-plugins/master/ceru-plugins/kugou.ceru.js'
  const livePage = await browser.newPage()
  await livePage.goto(base + '/#/plugins')
  const liveCode = await livePage.evaluate(async url => {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) throw new Error('HTTP ' + response.status)
    return response.text()
  }, liveUrl)
  const liveManifest = await livePage.evaluate(async ({ code, url }) => {
    const manager = await import('/src/core/plugin/manager.ts')
    return manager.inspectPlugin(await manager.preparePluginCode(code, url))
  }, { code: liveCode, url: liveUrl })
  assert.equal(liveManifest.id, 'ceru.kugou')
  assert.match(liveManifest.version, /^\d+\.\d+\.\d+$/)
  checks.push(`live repository kugou file stays Ceru v2 ${liveManifest.version}`)
  fs.writeFileSync(out + '/market-stale-catalog-verification.json', JSON.stringify({ checks, scope: 'Real Vue page with controlled repository response; no Android device network' }, null, 2))
  checks.forEach(check => console.log('PASS ' + check))
} finally {
  await browser?.close()
  server.kill()
  log.end()
}
