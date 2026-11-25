import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..'), out = path.resolve(root, '../evidence')
const base = process.env.CERU_TEST_URL || 'http://127.0.0.1:5434'
const observe = process.argv.includes('--observe'), rows = [], errors = []
const server = process.env.CERU_TEST_URL ? null : spawn(process.execPath, [root + '/node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5434', '--strictPort'], { cwd: root, windowsHide: true })
let browser, page, failCatalog = false
const fixture = `exports.manifest={manifestVersion:2,id:'qa.refresh.layout',name:'布局测试音源',version:'1.0.0',engines:{hostApi:'^2.0.0',logicRuntime:'ceru-js@1'},modules:{logic:{entry:'logic.main'}},contributes:{providers:[{id:'qa',name:'布局测试音源',qualities:['128k'],protocols:['https']}]}};
let count=0;exports.activate=core=>core.providers.register('qa',{charts:{list:async()=>{await new Promise(r=>setTimeout(r,900));if(++count%3===0)throw new Error('QA 网络失败');return {items:Array.from({length:20},(_,i)=>({ref:{providerId:'qa',id:'chart-'+i,kind:'chart',pluginId:core.plugin.id},title:'榜单'+i,capabilities:['play'],chart:{updateFrequency:'每日更新'}}))}}}});`

async function pull(selector, end = true) {
  const client = await page.context().newCDPSession(page)
  const box = await page.locator(selector).boundingBox(), x = Math.round(box.x + box.width / 2), y = Math.round(box.y + 100)
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  for (let d = 20; d <= 180; d += 20) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + d }] })
    await page.waitForTimeout(20)
  }
  if (end) await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  return client
}
async function geometry(selector, child) {
  return page.locator(selector).evaluate((el, child) => {
    const target = el.querySelector(child), r = target?.getBoundingClientRect(), indicator = el.querySelector('.pull-refresh')
    return { top: r?.top, height: r?.height, scrollTop: el.querySelector('.scroll')?.scrollTop, position: indicator && getComputedStyle(indicator).position }
  }, child)
}
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break } catch {} await new Promise(r => setTimeout(r, 100)) }
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(() => { if (window.top !== window) return; localStorage.setItem('ceru.update.v1', JSON.stringify({ autoCheck: false })); localStorage.setItem('ceru.settings.v1', JSON.stringify({ pluginAutoUpdate: false, playbackCache: false, cloudLyrics: false })) })
  await page.route('**/*', async r => {
    const url = r.request().url()
    if (url.startsWith(base)) return r.continue()
    if (url.includes('ceru-list.json')) { await new Promise(done => setTimeout(done, 900)); return r.fulfill(failCatalog ? { status: 503, json: { error: 'offline' } } : { json: JSON.parse(fs.readFileSync(out + '/ceru-list.json', 'utf8')) }) }
    return r.fulfill({ status: 503, json: { error: 'controlled offline' } })
  })
  await page.goto(base + '/#/')
  await page.waitForFunction(() => window.__ceruDebug && !window.__ceruDebug.pluginState.loading)
  await page.evaluate(async code => { const d = window.__ceruDebug, p = await d.installPlugin(code, { enable: true }); d.selectProvider('qa', p.pluginId) }, fixture)
  await page.getByText('榜单0', { exact: true }).first().waitFor()
  await page.waitForTimeout(300)
  for (const [route, screen, child] of [['/', '.discover-page', '.home-head'], ['/browse', '.browse-page', '.catalog-grid'], ['/plugins', '.market-page', '.market-hero']]) {
    await page.evaluate(route => { location.hash = '#' + route }, route)
    await page.locator(screen).waitFor({ state: 'visible' })
    await page.waitForTimeout(1300)
    if (route === '/plugins') await page.getByRole('button', { name: /^发现/ }).first().click()
    const target = await page.locator(screen + ' ' + child).count() ? child : 'header'
    const before = await geometry(screen, target)
    const client = await pull(screen + ' .scroll', false)
    const drag = await geometry(screen, target)
    await page.screenshot({ path: out + '/refresh-' + (observe ? 'before' : 'after') + '-' + route.replace(/\W/g, '') + '.png' })
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await client.detach()
    await page.waitForTimeout(100)
    const loading = await geometry(screen, target)
    await page.waitForTimeout(950)
    rows.push({ route, before, drag, loading, result: await page.locator(screen + ' .pull-refresh').innerText() })
    if (!observe) {
      assert.equal(drag.position, 'absolute'); assert.equal(drag.top, before.top, route + ' drag must not move content')
      assert.equal(loading.top, before.top, route + ' refresh must preserve content layout'); assert.equal(loading.height, before.height)
      assert.equal(loading.scrollTop, 0)
    }
  }
  if (observe) { console.log(JSON.stringify(rows, null, 2)); }
  else {
    // Home fixture's third list call fails. Failed reload retains existing lists, not a green success indicator.
    await page.evaluate(() => { location.hash = '#/' })
    await page.locator('.discover-page').waitFor({ state: 'visible' }); await page.waitForTimeout(800)
    await (await pull('.discover-page .scroll')).detach()
    await page.waitForTimeout(1000)
    assert.match(await page.locator('.discover-page .pull-refresh').innerText(), /失败/)
    assert(await page.getByText('榜单0', { exact: true }).first().isVisible())
    console.log('PASS floating ring: real gestures preserve layout, failed home refresh retains content and shows error')
    await page.evaluate(() => { location.hash = '#/plugins' }); await page.locator('.market-page').waitFor({ state: 'visible' })
    failCatalog = true; await page.waitForTimeout(800)
    await (await pull('.market-page .scroll')).detach()
    await page.locator('.market-page .pull-refresh').filter({ hasText: '失败' }).waitFor({ timeout: 20000 })
    console.log('PASS catalog network failure is not reported as refresh success')

    await page.evaluate(() => { location.hash = '#/local' }); await page.getByRole('button', { name: '扫描设置', exact: true }).click()
    for (const width of [360, 390, 600, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(150)
      const measure = await page.locator('.local-settings').evaluate(el => {
        const help = el.querySelector('.filter-help').getBoundingClientRect(), mode = el.querySelector('.filter-mode').getBoundingClientRect()
        return { gap: mode.top - help.bottom, overflow: el.scrollWidth > el.clientWidth, buttons: [...el.querySelectorAll('.filter-mode button')].map(b => ({ align: getComputedStyle(b).textAlign, height: b.getBoundingClientRect().height, line: getComputedStyle(b).lineHeight })) }
      })
      assert(measure.gap >= 12 && measure.gap <= 20, JSON.stringify(measure)); assert(!measure.overflow)
      assert(measure.buttons.every(b => b.align === 'center' && b.height >= 44))
      rows.push({ width, localSettings: measure })
      if ([390, 768].includes(width)) await page.screenshot({ path: out + '/scan-settings-' + width + '.png' })
    }
    await page.getByRole('button', { name: '关闭扫描设置' }).click(); await page.setViewportSize({ width: 390, height: 844 })
    console.log('PASS scan settings: centered segmented buttons and consistent help spacing at phone/tablet widths')

    await page.evaluate(async () => {
      const d = window.__ceruDebug, lib = await import('/src/core/library.ts')
      const tracks = ['first', 'second'].map(id => ({ id, providerId: 'qa', pluginId: 'qa', providerName: '测试音源', ref: { id, providerId: 'qa', pluginId: 'qa', kind: 'track' }, title: id === 'first' ? '当前第一首' : '下一首歌曲', artist: '测试歌手', album: '', durationMs: 300000, artwork: '/default-cover.png', qualities: ['128k'] }))
      lib.createPlaylist('已存在歌单'); d.player.playerState.queue = tracks; d.player.playerState.index = 0; d.player.playerState.playing = true
      location.hash = '#/player'
    })
    await page.getByRole('button', { name: '加入歌单', exact: true }).click()
    await page.getByRole('dialog', { name: '添加到歌单' }).waitFor()
    await page.waitForTimeout(300)
    assert(await page.getByRole('dialog', { name: '添加到歌单' }).evaluate(el => {
      const r = el.getBoundingClientRect()
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) && getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)'
    }), 'playlist sheet must cover the player and have an opaque readable surface')
    await page.screenshot({ path: out + '/player-add-playlist.png' })
    assert.equal(await page.evaluate(() => window.__ceruDebug.player.playerState.playing), true)
    await page.evaluate(() => { window.__ceruDebug.player.playerState.index = 1 })
    await page.locator('.sh-item', { hasText: '已存在歌单' }).click()
    let tracks = await page.evaluate(() => JSON.parse(localStorage.getItem('ceru.library.v1')).playlists[0].tracks)
    assert.equal(tracks.length, 1); assert.equal(tracks[0].id, 'first', 'sheet must retain song selected before auto-next')
    await page.evaluate(() => { window.__ceruDebug.player.playerState.index = 0 })
    await page.getByRole('button', { name: '加入歌单', exact: true }).click(); await page.locator('.sh-item', { hasText: '已存在歌单' }).click()
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ceru.library.v1')).playlists[0].tracks.length), 1)
    await page.getByRole('button', { name: '加入歌单', exact: true }).click()
    await page.locator('.newrow input').fill('播放页新歌单'); await page.locator('.newrow button').click()
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ceru.library.v1')).playlists.find(p => p.name === '播放页新歌单').tracks[0].id), 'first')
    await page.getByRole('button', { name: '加入歌单', exact: true }).click(); await page.keyboard.press('Escape')
    await page.getByRole('dialog', { name: '添加到歌单' }).waitFor({ state: 'hidden' })
    assert.equal(await page.getByRole('dialog', { name: '添加到歌单' }).count(), 0)
    assert.equal(await page.evaluate(() => window.__ceruDebug.player.playerState.playing), true)
    console.log('PASS player playlist actions: existing/new/duplicate, captured track across next-song, dismissal preserves playback state')
    assert.deepEqual(errors, [])
  }
  fs.writeFileSync(out + '/refresh-player-local-' + (observe ? 'before' : 'after') + '.json', JSON.stringify({ mode: observe ? 'original observation' : 'regression', sourceVersion: JSON.parse(fs.readFileSync(root + '/package.json')).version, command: process.argv, rows, errors }, null, 2))
} catch (e) {
  await page?.screenshot({ path: out + '/refresh-player-local-failure.png' }).catch(() => {})
  console.error(e); process.exitCode = 1
} finally { await browser?.close(); server?.kill() }
