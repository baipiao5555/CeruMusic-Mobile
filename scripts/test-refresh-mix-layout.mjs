import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const out = path.resolve(root, '../evidence')
const base = 'http://127.0.0.1:5397'
const server = spawn(process.execPath, [root + '/node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5397', '--strictPort'], { cwd: root, windowsHide: true })
const log = fs.createWriteStream(out + '/feature-vite.log')
server.stdout.pipe(log)
server.stderr.pipe(log)
let browser, page
let catalogRequests = 0

const plugin = `
exports.manifest={manifestVersion:2,id:'qa.refresh',name:'QQ音乐',version:'1.0.0',engines:{hostApi:'^2.0.0',logicRuntime:'ceru-js@1'},modules:{logic:{entry:'logic.main'}},contributes:{providers:[{id:'qq',name:'QQ音乐',qualities:['128k'],protocols:['music.charts@1']}]}}
let count = 0
exports.activate=function(core){core.providers.register('qq',{charts:{list:async()=>{count++;return {items:Array.from({length:20},(_,index)=>({ref:{providerId:'qq',id:'refresh-chart-'+index,kind:'chart',pluginId:core.plugin.id},title:'首页第'+count+'次-榜单'+index,subtitle:'刷新测试',capabilities:['play'],chart:{updateFrequency:'每日更新'},metadata:{artworkUrl:'/default-cover.png'}}))}}}})}`

async function pull(page) {
  const client = await page.context().newCDPSession(page)
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 190, y: 100 }] })
  for (let y = 120; y <= 280; y += 20) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 190, y }] })
    await page.waitForTimeout(25)
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await client.detach()
}

async function chartNumber(page, selector) {
  const text = await page.locator(selector).innerText()
  return Number(text.match(/首页第(\d+)次/)?.[1] || 0)
}

try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base)).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  page = await context.newPage()
  await page.addInitScript(() => {
    localStorage.setItem('ceru.update.v1', JSON.stringify({ autoCheck: false }))
    localStorage.setItem('ceru.settings.v1', JSON.stringify({ pluginAutoUpdate: false, playbackCache: false }))
  })
  await context.route('**/*', route => {
    const url = route.request().url()
    if (url.startsWith(base) || !/^https?:/.test(url)) return route.continue()
    if (url.includes('ceru-list.json')) {
      catalogRequests += 1
      return route.fulfill({ json: JSON.parse(fs.readFileSync(out + '/ceru-list.json', 'utf8')) })
    }
    return route.fulfill({ status: 503, json: { error: 'offline fixture' } })
  })
  await page.goto(base + '/#/')
  await page.waitForFunction(() => window.__ceruDebug && !window.__ceruDebug.pluginState.loading)
  await page.evaluate(async code => {
    const manager = await import('/src/core/plugin/manager.ts')
    const installed = await manager.installPlugin(code, { enable: true })
    manager.selectProvider('qq', installed.pluginId)
  }, plugin)
  await page.waitForFunction(() => document.querySelector('.discover-page')?.innerText.includes('首页第1次'))

  const homeBefore = await chartNumber(page, '.discover-page')
  await pull(page)
  await page.waitForFunction(before => Number(document.querySelector('.discover-page')?.innerText.match(/首页第(\d+)次/)?.[1] || 0) > before, homeBefore)
  await page.screenshot({ path: out + '/feature-home-refreshed.png' })
  console.log('PASS Discover pull gesture runs the real home loader')
  await page.locator('.discover-page .scroll').evaluate(element => { element.style.paddingBottom = '1200px'; element.scrollTop = 500 })
  assert((await page.locator('.discover-page .scroll').evaluate(element => element.scrollTop)) > 0)
  const scrolledBefore = await chartNumber(page, '.discover-page')
  await pull(page)
  await page.waitForTimeout(500)
  assert.equal(await chartNumber(page, '.discover-page'), scrolledBefore, 'a pull that does not start at the top must not refresh')
  console.log('PASS Discover does not refresh when the list is already scrolled')

  await page.evaluate(() => { location.hash = '#/browse' })
  await page.locator('.browse-page').waitFor({ state: 'visible' })
  await page.waitForTimeout(500)
  const browseBefore = await chartNumber(page, '.browse-page')
  await page.locator('.browse-page .scroll').evaluate(element => { element.scrollTop = 0 })
  await pull(page)
  await page.waitForFunction(before => Number(document.querySelector('.browse-page')?.innerText.match(/首页第(\d+)次/)?.[1] || 0) > before, browseBefore)
  console.log('PASS Browse pull gesture reloads the catalog')

  await page.evaluate(() => { location.hash = '#/plugins' })
  await page.locator('.market-page').waitFor({ state: 'visible' })
  await page.waitForTimeout(500)
  const marketBefore = catalogRequests
  await pull(page)
  await page.waitForFunction(before => document.querySelector('.pull-refresh') && before > 0, marketBefore + 1)
  assert(catalogRequests > marketBefore)
  console.log('PASS Plugin market pull gesture refreshes the remote catalog')

  await page.getByRole('button', { name: /^已安装/ }).first().click()
  for (const width of [360, 390, 600, 768]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(100)
    const metrics = await page.locator('.market-current').evaluate(card => {
      const button = card.querySelector('button')
      const outer = card.getBoundingClientRect()
      const inner = button.getBoundingClientRect()
      return {
        delta: Math.abs((inner.top + inner.height / 2) - (outer.top + outer.height / 2)),
        rightOverflow: inner.right > outer.right + 1,
        whiteSpace: getComputedStyle(button).whiteSpace,
        display: getComputedStyle(button).display
      }
    })
    assert(metrics.delta <= 1, `switch button vertical alignment at ${width}: ${metrics.delta}`)
    assert.equal(metrics.rightOverflow, false)
    assert.equal(metrics.whiteSpace, 'nowrap')
    assert(['flex', 'inline-flex'].includes(metrics.display))
  }
  await page.screenshot({ path: out + '/feature-market-layout.png' })
  console.log('PASS Market switch button stays centered and nowrap at 360/390/600/768 widths')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => { location.hash = '#/settings' })
  await page.locator('[data-section="playback"]').click()
  const mix = page.getByRole('switch', { name: '与其他应用同时播放', exact: true })
  await mix.scrollIntoViewIfNeeded()
  assert.equal(await mix.getAttribute('aria-checked'), 'false')
  await mix.click()
  assert.equal(await mix.getAttribute('aria-checked'), 'true')
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('ceru.settings.v1')).allowAudioMix)
  assert.equal(persisted, true)
  await page.waitForTimeout(250)
  await page.screenshot({ path: out + '/feature-audio-mix-setting.png' })
  console.log('PASS Audio-mix setting defaults off and persists when enabled')
} catch (error) {
  if (page) {
    await page.screenshot({ path: out + '/feature-refresh-failure.png' }).catch(() => {})
    fs.writeFileSync(out + '/feature-refresh-failure.json', JSON.stringify(await page.evaluate(() => ({ hash: location.hash, text: document.body.innerText, plugins: window.__ceruDebug?.pluginState.plugins.map(item => ({ id: item.manifestId, providers: item.providers.map(p => ({ id: p.id, methods: p.methods })) })) })), null, 2))
  }
  throw error
} finally {
  await browser?.close()
  server.kill()
  log.end()
}
