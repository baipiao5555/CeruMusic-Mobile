import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const base = process.env.CERU_TEST_URL || 'http://127.0.0.1:5193'
const out = resolve(process.env.CERU_SHEET_QA_OUT || 'D:/LX/CeruMusic-Mobile-弹层重复启动修复-2026-11-19/evidence')
const baseline = process.argv.includes('--baseline')
mkdirSync(out, { recursive: true })
const results = [], errors = []
const track = { id: 'sheet-qa-song', pluginId: 'sheet-qa', providerId: 'sheet-qa', providerName: 'QA',
  ref: { providerId: 'sheet-qa', kind: 'track', id: 'sheet-qa-song', scope: 'provider' },
  title: '弹层回归测试曲', artist: 'QA', album: '', artwork: '/default-cover.png',
  durationMs: 60000, qualities: ['128k', '320k'] }
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
await context.addInitScript(({ track }) => {
  if (window.top !== window) return
  localStorage.setItem('ceru.update.v1', JSON.stringify({ autoCheck: false }))
  localStorage.setItem('ceru.settings.v1', JSON.stringify({ version: 2, cloudLyrics: false, keepScreenOn: false, pluginAutoUpdate: false, verboseLogs: false }))
  localStorage.setItem('ceru.player.v1', JSON.stringify({ queue: [track], index: 0, volume: 1, mode: 'repeat-all', currentTime: 0 }))
  localStorage.setItem('ceru.library.v1', JSON.stringify({ favorites: [track], playlists: [{ id: 'qa-playlist', name: 'QA 歌单', createdAt: 1, tracks: [track] }] }))
  localStorage.setItem('ceru.downloads.v1', JSON.stringify([{ id: 'qa-download', track, quality: '128k', status: 'completed', progress: 1, size: 1000, received: 1000, total: 1000, fileName: '', path: '', createdAt: 1, error: '' }]))
}, { track })
const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))

async function navigate(path) {
  await page.evaluate(path => { location.hash = '#' + path }, path)
  await page.waitForFunction(path => location.hash === '#' + path, path)
  await page.waitForTimeout(300)
}

async function recordOpen(name, trigger, standalone = false, keyboard = false) {
  await page.evaluate(() => {
    window.__sheetQA?.stop?.()
    const start = performance.now()
    const events = [], samples = [], stats = { clicks: 0, inserts: 0 }
    let running = true
    const onClick = () => { stats.clicks++ }
    const onMotion = event => {
      if (!event.target.closest?.('.sheet-mask')) return
      events.push({ type: event.type, name: event.animationName || event.propertyName, time: performance.now() - start, target: event.target.className })
    }
    const observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue
        stats.inserts += Number(node.matches('.sheet-mask')) + node.querySelectorAll('.sheet-mask').length
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('click', onClick, true)
    const types = ['animationstart', 'animationend', 'transitionrun', 'transitionend']
    for (const type of types) document.addEventListener(type, onMotion, true)
    const sample = () => {
      if (!running) return
      const mask = document.querySelector('.sheet-mask'), sheet = mask?.querySelector('.sheet')
      if (sheet) {
        const style = getComputedStyle(sheet)
        samples.push({ time: performance.now() - start, y: style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42,
          opacity: Number(getComputedStyle(mask).opacity), animation: style.animationName, masks: document.querySelectorAll('.sheet-mask').length })
      }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
    window.__sheetQA = { stats, events, samples, stop: () => {
      running = false; observer.disconnect(); document.removeEventListener('click', onClick, true)
      for (const type of types) document.removeEventListener(type, onMotion, true)
    } }
  })
  if (keyboard) { await trigger.focus(); await trigger.press('Enter') } else await trigger.tap()
  await page.locator('.sheet-mask .sheet').first().waitFor({ state: 'visible' })
  await page.waitForTimeout(750)
  const result = await page.evaluate(() => {
    const { stats, events, samples, stop } = window.__sheetQA
    stop()
    let maxBackwardsJump = 0
    for (let i = 1; i < samples.length; i++) maxBackwardsJump = Math.max(maxBackwardsJump, samples[i].y - samples[i - 1].y)
    return { ...stats, events, samples, maxBackwardsJump }
  })
  const keyframes = result.events.filter(event => event.type === 'animationstart' && ['sheet-up', 'fade-in'].includes(event.name))
  const pass = result.inserts === 1 && result.maxBackwardsJump < 1 && (standalone ? keyframes.filter(event => event.name === 'sheet-up').length === 1 : keyframes.length === 0)
  results.push({ name, standalone, keyboard, pass, ...result })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: clicks=${result.clicks}, inserts=${result.inserts}, replayKeyframes=${keyframes.length}, maxBackwardsJump=${result.maxBackwardsJump.toFixed(2)}px`)
  if (!baseline) assert.equal(pass, true, name)
}

async function closeSheet() {
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('.sheet-mask'))
}

let fatal
try {
  await page.goto(base + '/#/player', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__ceruDebug && !window.__ceruDebug.pluginState.loading)
  await recordOpen('播放器音质', page.locator('.p-quality-button'))
  await closeSheet()
  await navigate('/playlists')
  await recordOpen('歌单页右上角加号', page.locator('.playlists-head button[aria-label="新建歌单"]'))
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ceru.library.v1')).playlists.length), 1, 'opening must not create a playlist')
  await closeSheet()
  await navigate('/downloads')
  await recordOpen('删除下载确认', page.getByRole('button', { name: '删除文件和记录', exact: true }))
  assert.equal(await page.evaluate(() => window.__ceruDebug.downloads.downloadState.tasks.length), 1, 'opening delete confirmation must not delete')
  await closeSheet()
  await navigate('/settings')
  await recordOpen('设置选项弹层', page.locator('.pickrow').first(), false, true)
  await closeSheet()
  await navigate('/playlists')
  await recordOpen('无 Vue 过渡的导入歌单', page.getByRole('button', { name: '从其他平台导入', exact: true }), true)
  await closeSheet()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await recordOpen('减少动态效果下的新建歌单', page.locator('.playlists-head button[aria-label="新建歌单"]'))
  await closeSheet()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => {
    window.__sheetWrites = []
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (['ceru.library.v1', 'ceru.downloads.v1', 'ceru.settings.v1'].includes(key)) window.__sheetWrites.push(key)
      return original.call(this, key, value)
    }
  })
  await page.locator('.playlists-head button[aria-label="新建歌单"]').tap()
  const create = page.getByRole('dialog', { name: '新建歌单', exact: true })
  await create.locator('input').fill('只创建一次的 QA 歌单')
  await create.getByRole('button', { name: '创建', exact: true }).tap()
  await page.waitForFunction(() => location.hash.startsWith('#/playlist/'))
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ceru.library.v1')).playlists.filter(p => p.name === '只创建一次的 QA 歌单').length), 1)
  assert.equal(await page.evaluate(() => window.__sheetWrites.filter(key => key === 'ceru.library.v1').length), 1)
  console.log('PASS 创建一次: one playlist and one library write')
  await navigate('/downloads')
  await page.getByRole('button', { name: '删除文件和记录', exact: true }).tap()
  const confirmation = page.getByRole('alertdialog', { name: '删除文件和下载记录？', exact: true })
  await confirmation.getByRole('button', { name: '删除', exact: true }).tap()
  await page.waitForFunction(() => window.__ceruDebug.downloads.downloadState.tasks.length === 0)
  assert.equal(await page.evaluate(() => window.__sheetWrites.filter(key => key === 'ceru.downloads.v1').length), 1)
  console.log('PASS 删除一次: one fixture download removed and one download write')
  await navigate('/player')
  await page.locator('.p-quality-button').tap()
  await page.getByRole('dialog', { name: '选择音质', exact: true }).getByRole('button', { name: '标准', exact: true }).tap()
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ceru.settings.v1')).quality), '128k')
  assert.equal(await page.evaluate(() => window.__sheetWrites.filter(key => key === 'ceru.settings.v1').length), 1)
  console.log('PASS 音质选择一次: one settings write')
  await closeSheet()
  assert.deepEqual(errors, [], 'unexpected page errors')
} catch (error) {
  fatal = error.stack || String(error)
  console.error(fatal)
} finally {
  writeFileSync(resolve(out, baseline ? 'sheet-buttons-baseline.json' : 'sheet-buttons-modified.json'), JSON.stringify({ command: `node scripts/test-sheet-buttons.mjs${baseline ? ' --baseline' : ''}`, source: base, baseline, results, errors, fatal, exitCode: fatal ? 1 : 0 }, null, 2))
  await browser.close()
}
process.exitCode = fatal ? 1 : 0
