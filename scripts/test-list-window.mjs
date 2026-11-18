import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = process.env.CERU_TEST_URL || 'http://127.0.0.1:5180'
const executablePath =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const favorites = Array.from({ length: 300 }, (_, index) => ({
  id: `long-${index}`,
  pluginId: 'test',
  providerId: 'test',
  providerName: 'Test',
  ref: { providerId: 'test', kind: 'track', id: `long-${index}` },
  title: `Long track ${index}`,
  artist: 'Long list',
  album: '',
  artwork: '/default-cover.png',
  durationMs: 180000,
  qualities: ['128k']
}))
const playlist = {
  id: 'long-playlist',
  name: 'Long playlist',
  createdAt: Date.now(),
  tracks: favorites
}

const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true
})
await context.route('**/*', (route) => {
  const hostname = new URL(route.request().url()).hostname
  return ['127.0.0.1', 'localhost'].includes(hostname)
    ? route.continue()
    : route.abort('blockedbyclient')
})
await context.addInitScript((data) => {
  try {
    localStorage.setItem('ceru.update.v1', JSON.stringify({ autoCheck: false }))
    localStorage.setItem('ceru.library.v1', JSON.stringify({ favorites: data.favorites, playlists: [data.playlist] }))
  } catch {
    // Sandboxed plugin frames do not have same-origin storage.
  }
}, { favorites, playlist })

const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('ERR_BLOCKED_BY_CLIENT')) {
    errors.push(message.text())
  }
})

try {
  await page.goto(`${base}/#/library?section=favorites`, { waitUntil: 'networkidle' })
  await page.locator('.song-list .songrow').first().waitFor({ state: 'visible' })
  assert.equal(await page.locator('.song-list .songrow').count(), 120)
  await page.locator('.list-more').click()
  await page.waitForFunction(() => document.querySelectorAll('.song-list .songrow').length === 240)
  await page.locator('.list-more').click()
  await page.waitForFunction(() => document.querySelectorAll('.song-list .songrow').length === 300)
  assert.equal(await page.locator('.list-more').count(), 0)

  await page.goto(`${base}/#/playlist/long-playlist`, { waitUntil: 'networkidle' })
  await page.locator('.rows .songrow').first().waitFor({ state: 'visible' })
  assert.equal(await page.locator('.rows .songrow').count(), 120)
  await page.locator('.rows .list-more').click()
  await page.waitForFunction(() => document.querySelectorAll('.rows .songrow').length === 240)
  assert.equal(errors.length, 0, `unexpected page errors: ${errors.join(' | ')}`)
  console.log('PASS list window: library 120 -> 300; playlist 120 -> 240')
} finally {
  await browser.close()
}
