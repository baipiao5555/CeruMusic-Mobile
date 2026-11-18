import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = process.env.CERU_TEST_URL || 'http://127.0.0.1:5180'
const executablePath =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

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

const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('ERR_BLOCKED_BY_CLIENT')) {
    errors.push(message.text())
  }
})

try {
  await page.goto(`${base}/#/settings`, { waitUntil: 'networkidle' })
  const row = page.locator('.pickrow').first()
  await row.waitFor({ state: 'visible' })
  await row.focus()
  await row.click()
  await page.locator('.sheet-mask .sheet').waitFor({ state: 'visible' })
  await page.keyboard.press('Tab')
  assert.equal(
    await page.evaluate(() => Boolean(document.activeElement?.closest('.sheet-mask'))),
    true,
    'Tab should enter the open sheet'
  )

  await page.locator('.sheet-mask .sh-head .iconbtn').click()
  await page.waitForTimeout(40)
  const leaving = await page.locator('.sheet-mask').evaluate((element) => ({
    present: true,
    leaving: element.classList.contains('sheet-pop-leave-active'),
    sheetTransform: getComputedStyle(element.querySelector('.sheet')).transform
  }))
  assert.equal(leaving.present, true, 'the sheet should still be mounted while leaving')
  assert.equal(leaving.leaving, true, 'the sheet should keep its leave-active class during the exit')

  await page.waitForFunction(() => !document.querySelector('.sheet-mask'))
  assert.equal(
    await page.evaluate(() => document.activeElement?.classList.contains('pickrow')),
    true,
    'closing the sheet should restore focus to its trigger'
  )

  await row.click()
  await page.locator('.sheet-mask .sheet').waitFor({ state: 'visible' })
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('.sheet-mask'))

  await page.goto(`${base}/#/`, { waitUntil: 'networkidle' })
  const sourceButton = page.getByRole('button', { name: '切换音源' })
  await sourceButton.waitFor({ state: 'visible' })
  await sourceButton.click()
  await page.locator('.home-source-sheet').waitFor({ state: 'visible' })
  await page.locator('.home-source-sheet .sh-head .iconbtn').click()
  await page.waitForFunction(() => !document.querySelector('.sheet-mask'))
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
    '切换音源',
    'inline source picker should restore focus too'
  )
  assert.equal(errors.length, 0, `unexpected page errors: ${errors.join(' | ')}`)
  console.log('PASS sheet motion: open, animated close, Escape, focus restore, inline picker')
} finally {
  await browser.close()
}
