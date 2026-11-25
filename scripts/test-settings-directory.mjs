import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const out = path.resolve(root, '../evidence')
const base = 'http://127.0.0.1:5394'
const server = spawn(process.execPath, [root + '/node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5394', '--strictPort'], { cwd: root, windowsHide: true })
const log = fs.createWriteStream(out + '/settings-directory-vite.log')
server.stdout.pipe(log)
server.stderr.pipe(log)
let browser

try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base)).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await context.route('**/*', route => {
    const hostname = new URL(route.request().url()).hostname
    return ['127.0.0.1', 'localhost'].includes(hostname) ? route.continue() : route.abort('blockedbyclient')
  })
  await page.addInitScript(() => {
    localStorage.setItem('ceru.update.v1', JSON.stringify({ autoCheck: false }))
    localStorage.setItem('ceru.settings.v1', JSON.stringify({ pluginAutoUpdate: false }))
  })
  await page.goto(base + '/#/settings', { waitUntil: 'networkidle' })
  await page.locator('.settings-directory').waitFor({ state: 'visible' })

  assert.equal(await page.locator('.directory-row').count(), 7)
  assert.equal(await page.locator('#settings-playback:visible').count(), 0)
  assert(!(await page.locator('body').innerText()).includes('默认音质'))
  await page.screenshot({ path: out + '/settings-directory-root.png' })
  console.log('PASS Settings root shows only seven categories')

  await page.locator('[data-section="playback"]').click()
  await page.waitForFunction(() => new URL(location.href).hash.includes('section=playback'))
  await page.locator('#settings-playback:visible').waitFor()
  assert.equal(await page.locator('.scroll > section:visible').count(), 1)
  const playbackText = await page.locator('body').innerText()
  assert.match(playbackText, /与其他应用同时播放/)
  assert.match(playbackText, /默认音质/)
  assert.doesNotMatch(playbackText, /澜音云歌单账号/)
  await page.screenshot({ path: out + '/settings-directory-playback.png' })
  console.log('PASS Playback detail shows only playback settings')

  const mix = page.getByRole('switch', { name: '与其他应用同时播放', exact: true })
  assert.equal(await mix.getAttribute('aria-checked'), 'false')
  await mix.click()
  assert.equal(await mix.getAttribute('aria-checked'), 'true')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ceru.settings.v1')).allowAudioMix), true)
  console.log('PASS The audio-mix setting remains usable in the detail page')

  await page.goBack()
  await page.locator('.settings-directory').waitFor({ state: 'visible' })
  assert.equal(await page.locator('#settings-playback:visible').count(), 0)
  console.log('PASS Browser/Android-style back returns from detail to the directory')

  await page.getByRole('button', { name: '搜索设置项', exact: true }).click()
  await page.getByRole('searchbox', { name: '搜索设置项' }).fill('日志')
  await page.locator('#settings-data:visible').waitFor()
  assert.match(await page.locator('body').innerText(), /运行日志/)
  assert.equal(await page.locator('.settings-directory:visible').count(), 0)
  console.log('PASS Search still reaches settings across categories')
  await page.getByRole('button', { name: '清除搜索', exact: true }).click()
  await page.locator('.settings-directory').waitFor({ state: 'visible' })

  await page.setViewportSize({ width: 768, height: 1024 })
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  const columns = await page.evaluate(() => getComputedStyle(document.querySelector('.directory-grid')).gridTemplateColumns.split(' ').length)
  assert.equal(columns, 2)
  await page.locator('[data-section="lyrics"]').click()
  await page.locator('#settings-lyrics:visible').waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  const detailWidth = await page.locator('#settings-lyrics').evaluate(element => element.getBoundingClientRect().width)
  assert(detailWidth <= 762)
  await page.screenshot({ path: out + '/settings-directory-tablet.png' })
  console.log('PASS Tablet directory uses two columns and detail stays bounded without overflow')

  assert.deepEqual(errors.filter(error => !error.includes('sandboxed and lacks the')), [])
  console.log('PASS settings directory regression complete')
} finally {
  await browser?.close()
  server.kill()
  log.end()
}
