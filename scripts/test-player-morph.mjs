import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = process.env.CERU_TEST_URL || 'http://127.0.0.1:5180'
const executablePath =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const track = {
  id: 'morph-track',
  pluginId: 'test',
  providerId: 'test',
  providerName: 'Test',
  ref: { providerId: 'test', kind: 'track', id: 'morph-track' },
  title: 'Morph track',
  artist: 'Motion',
  album: '',
  artwork: '/default-cover.png',
  durationMs: 180000,
  qualities: ['128k']
}

const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  reducedMotion: 'no-preference'
})
await context.route('**/*', (route) => {
  const hostname = new URL(route.request().url()).hostname
  return ['127.0.0.1', 'localhost'].includes(hostname)
    ? route.continue()
    : route.abort('blockedbyclient')
})
await context.addInitScript((playerTrack) => {
  try {
    localStorage.setItem('ceru.player.v1', JSON.stringify({
      queue: [playerTrack],
      index: 0,
      volume: 1,
      mode: 'order',
      quality: '',
      currentTime: 0
    }))
  } catch {
    // Sandboxed plugin frames do not have same-origin storage.
  }
}, track)

const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('ERR_BLOCKED_BY_CLIENT')) {
    errors.push(message.text())
  }
})

try {
  await page.goto(`${base}/#/`, { waitUntil: 'networkidle' })
  await page.locator('.mini .cover img').waitFor({ state: 'visible' })
  await page.locator('.mini-track').click()
  await page.waitForFunction(() => location.hash === '#/player')
  await page.locator('.p-art').waitFor({ state: 'visible' })
  await page.locator('.player-morph-clone').waitFor({ state: 'visible', timeout: 1200 })
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.querySelector('.p-art')).opacity),
    '0',
    'the player cover should stay hidden while the clone travels'
  )
  await page.waitForFunction(() => !document.querySelector('.player-morph-clone'))
  assert.notEqual(
    await page.evaluate(() => getComputedStyle(document.querySelector('.p-art')).opacity),
    '0',
    'the player cover should be visible after the morph'
  )

  await page.locator('.p-top .iconbtn[aria-label="收起"]').click()
  await page.waitForFunction(() => location.hash === '#/')
  await page.locator('.mini .cover').waitFor({ state: 'visible' })
  await page.locator('.player-morph-clone').waitFor({ state: 'visible', timeout: 1200 })
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.querySelector('.mini .cover')).opacity),
    '0',
    'the mini cover should stay hidden while the clone travels back'
  )
  await page.waitForFunction(() => !document.querySelector('.player-morph-clone'))
  assert.notEqual(
    await page.evaluate(() => getComputedStyle(document.querySelector('.mini .cover')).opacity),
    '0',
    'the mini cover should be visible after the collapse'
  )

  const reduced = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: 'reduce'
  })
  await reduced.route('**/*', (route) => {
    const hostname = new URL(route.request().url()).hostname
    return ['127.0.0.1', 'localhost'].includes(hostname)
      ? route.continue()
      : route.abort('blockedbyclient')
  })
  await reduced.addInitScript((playerTrack) => {
    try {
      localStorage.setItem('ceru.player.v1', JSON.stringify({
        queue: [playerTrack],
        index: 0,
        volume: 1,
        mode: 'order',
        quality: '',
        currentTime: 0
      }))
    } catch {
      // Sandboxed plugin frames do not have same-origin storage.
    }
  }, track)
  const reducedPage = await reduced.newPage()
  await reducedPage.goto(`${base}/#/`, { waitUntil: 'networkidle' })
  await reducedPage.locator('.mini .cover img').waitFor({ state: 'visible' })
  await reducedPage.locator('.mini-track').click()
  await reducedPage.waitForFunction(() => location.hash === '#/player')
  await reducedPage.locator('.p-art').waitFor({ state: 'visible' })
  assert.equal(await reducedPage.locator('.player-morph-clone').count(), 0)
  await reducedPage.locator('.p-top .iconbtn[aria-label="收起"]').click()
  await reducedPage.waitForFunction(() => location.hash === '#/')
  await reducedPage.locator('.mini .cover').waitFor({ state: 'visible' })
  assert.equal(await reducedPage.locator('.player-morph-clone').count(), 0)

  assert.equal(errors.length, 0, `unexpected page errors: ${errors.join(' | ')}`)
  console.log('PASS player morph: expand, collapse, reduced-motion fallback')
} finally {
  await browser.close()
}
