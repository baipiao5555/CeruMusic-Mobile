import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = process.env.CERU_TEST_URL || 'http://127.0.0.1:5180'
const executablePath =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
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

async function seedBackground() {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 1080
    canvas.height = 2376
    const context = canvas.getContext('2d')
    const gradient = context.createLinearGradient(0, 0, 1080, 2376)
    gradient.addColorStop(0, '#2d4b4b')
    gradient.addColorStop(1, '#b6cbd2')
    context.fillStyle = gradient
    context.fillRect(0, 0, 1080, 2376)
    context.fillStyle = '#fff'
    context.font = '72px sans-serif'
    context.fillText('Theme background', 120, 700)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('ceru-music-mobile', 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('kv')) request.result.createObjectStore('kv')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite')
      tx.objectStore('kv').put({
        version: 1,
        config: {
          assetId: 'tab-motion-fixture', kind: 'image', mime: 'image/png',
          name: 'tab-motion.png', size: blob.size, width: 1080, height: 2376,
          duration: 0, mask: 0.35, blur: 8, dark: false, fit: 'cover',
          scope: 'main', motion: 'auto'
        },
        blob,
        poster: null
      }, 'theme.background.v1')
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
  })
}

try {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__ceruDebug && !window.__ceruDebug.pluginState.loading)
  await seedBackground()
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.theme-background-layer').waitFor({ state: 'visible' })
  await page.locator('.tabbar .tab').nth(2).click()
  await page.waitForFunction(() => Boolean(document.querySelector('.screen.route-motion-tab')))
  const during = await page.evaluate(() => {
    const screens = [...document.querySelectorAll('.screen')].map((element) => ({
      className: element.className,
      visibility: getComputedStyle(element).visibility,
      ariaHidden: element.getAttribute('aria-hidden')
    }))
    return {
      screens,
      visible: screens.filter((item) => item.visibility !== 'hidden').length
    }
  })
  assert.equal(during.visible, 1, 'exactly one tab screen may be visible')
  assert.ok(
    during.screens.some((item) => item.className.includes('tab-screen-hidden')),
    'inactive tabs stay mounted but hidden'
  )
  assert.ok(
    during.screens.some((item) => item.className.includes('route-motion-tab') && item.visibility !== 'hidden'),
    'new tab uses the single-layer motion'
  )
  await page.waitForFunction(() => location.hash === '#/library')
  await page.waitForTimeout(260)
  await page.waitForFunction(() => document.querySelectorAll('.screen').length === 5)
  assert.equal(await page.locator('.screen').count(), 5)
  assert.equal(await page.locator('.screen:not(.tab-screen-hidden)').count(), 1)
  console.log('PASS tab motion: pre-mounted tabs, one visible screen, no blank flash')
} finally {
  await browser.close()
}
