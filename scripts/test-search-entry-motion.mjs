import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = process.env.CERU_TEST_URL || 'http://127.0.0.1:5180'
const executablePath =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  reducedMotion: 'no-preference'
})
// Keep the check independent of user accounts and remote music services.
await context.route('**/*', (route) => {
  const hostname = new URL(route.request().url()).hostname
  return ['127.0.0.1', 'localhost'].includes(hostname)
    ? route.continue()
    : route.abort('blockedbyclient')
})

const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('ERR_BLOCKED_BY_CLIENT')) {
    errors.push(message.text())
  }
})

async function installProbe() {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ceru.update.v1', JSON.stringify({ autoCheck: false }))
    } catch {
      // Sandboxed plugin frames do not have same-origin storage.
    }
    window.__motionLog = []
    document.addEventListener(
      'focusin',
      (event) => {
        if (event.target instanceof HTMLInputElement && event.target.closest('.search-page')) {
          window.__motionLog.push({ type: 'focus', at: performance.now() })
        }
      },
      true
    )
    document.addEventListener(
      'animationend',
      (event) => {
        if (event.target instanceof Element && event.target.classList.contains('search-page')) {
          window.__motionLog.push({
            type: 'animationend',
            property: event.animationName,
            at: performance.now()
          })
        }
      },
      true
    )
  })
}

async function resetProbe() {
  await page.evaluate(() => {
    window.__motionLog = []
    window.__motionStartedAt = performance.now()
  })
}

async function waitForInputFocus() {
  await page.waitForFunction(() => {
    const input = document.querySelector('.search-page input[type=search]')
    return input && document.activeElement === input
  })
}

async function readProbe() {
  return page.evaluate(() => {
    const log = window.__motionLog
    const enterEnd = Math.max(
      -1,
      ...log.filter((entry) => entry.type === 'animationend').map((entry) => entry.at)
    )
    const focus = log.find((entry) => entry.type === 'focus')
    return { log, enterEnd, focusAt: focus?.at ?? null }
  })
}

try {
  await installProbe()
  await page.goto(`${base}/#/`, { waitUntil: 'networkidle' })
  await page.locator('.search-launch').waitFor({ state: 'visible' })
  await page.waitForTimeout(700)

  await resetProbe()
  await page.locator('.search-launch').tap()
  await page.waitForFunction(() => {
    const screen = document.querySelector('.search-page')
    return screen && getComputedStyle(screen).visibility !== 'hidden'
  })
  await waitForInputFocus()
  await page.waitForTimeout(500)
  const cold = await readProbe()
  assert.ok(cold.focusAt !== null, 'cold search entry should focus the input')
  assert.ok(
    cold.focusAt >= cold.enterEnd - 8,
    `cold focus must follow the enter transition (focus=${cold.focusAt}, enterEnd=${cold.enterEnd})`
  )

  await page.locator('.search-back').tap()
  await page.waitForFunction(() => location.hash === '#/')
  await page.waitForTimeout(300)

  await resetProbe()
  await page.locator('.search-launch').tap()
  await page.waitForFunction(() => {
    const screen = document.querySelector('.search-page')
    return screen && getComputedStyle(screen).visibility !== 'hidden'
  })
  await waitForInputFocus()
  await page.waitForTimeout(500)
  const warm = await readProbe()
  assert.ok(warm.focusAt !== null, 'cached search entry should focus the input')
  assert.ok(
    warm.focusAt >= warm.enterEnd - 8,
    `warm focus must follow the enter transition (focus=${warm.focusAt}, enterEnd=${warm.enterEnd})`
  )

  await page.locator('.search-back').tap()
  await page.waitForFunction(() => location.hash === '#/')
  await page.waitForTimeout(300)

  await page.evaluate(() => {
    window.__earlyBack = { clicked: false }
    const timer = setInterval(() => {
      const back = document.querySelector('.search-back')
      const screen = document.querySelector('.search-page')
      if (back && screen && getComputedStyle(screen).visibility !== 'hidden') {
        back.click()
        window.__earlyBack.clicked = true
        clearInterval(timer)
      }
    }, 5)
    setTimeout(() => clearInterval(timer), 800)
  })
  await resetProbe()
  await page.locator('.search-launch').tap()
  await page.waitForFunction(() => location.hash === '#/')
  await page.waitForTimeout(500)
  const earlyBack = await page.evaluate(() => window.__earlyBack)
  assert.equal(earlyBack.clicked, true, 'the test must click back while the entry is still in flight')
  const cancelled = await readProbe()
  assert.equal(cancelled.focusAt, null, 'a cancelled entry must not leave a ghost keyboard')

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
  const reducedPage = await reduced.newPage()
  await reducedPage.goto(`${base}/#/`, { waitUntil: 'networkidle' })
  await reducedPage.locator('.search-launch').waitFor({ state: 'visible' })
  await reducedPage.waitForTimeout(300)
  await reducedPage.locator('.search-launch').tap()
  await reducedPage.waitForFunction(() => {
    const screen = document.querySelector('.search-page')
    return screen && getComputedStyle(screen).visibility !== 'hidden'
  })
  await reducedPage.waitForFunction(() => {
    const input = document.querySelector('.search-page input[type=search]')
    return input && document.activeElement === input
  })

  assert.equal(errors.length, 0, `unexpected page errors: ${errors.join(' | ')}`)
  console.log('PASS search entry: cold, cached, cancelled, reduced-motion')
} finally {
  await browser.close()
}
