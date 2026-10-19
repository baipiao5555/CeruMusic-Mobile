import fs from 'node:fs'
import { chromium } from 'playwright-core'

const outDir = 'D:/LX/CeruMusic-Mobile-screenshots'
fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']
})
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2
})
page.on('pageerror', (error) => console.log('[pageerror]', error.message))
await page.goto('http://127.0.0.1:5181/', { waitUntil: 'networkidle' })
await page.waitForTimeout(5000)
await page.screenshot({ path: outDir + '/01-discover.png' })

await page.goto('http://127.0.0.1:5181/#/search', { waitUntil: 'networkidle' })
await page.waitForSelector('.search-bar input')
await page.fill('.search-bar input', '演示')
await page.press('.search-bar input', 'Enter')
await page.waitForSelector('.song-row')
await page.waitForTimeout(800)
await page.screenshot({ path: outDir + '/02-search.png' })

await page.goto('http://127.0.0.1:5181/#/library', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await page.screenshot({ path: outDir + '/03-library.png' })

await page.goto('http://127.0.0.1:5181/#/search', { waitUntil: 'networkidle' })
await page.waitForSelector('.search-bar input')
await page.fill('.search-bar input', 'city')
await page.press('.search-bar input', 'Enter')
await page.waitForSelector('.song-row')
await page.locator('.song-row').first().click()
await page.waitForTimeout(2500)
await page.locator('.mini-player').click()
await page.waitForTimeout(1200)
await page.screenshot({ path: outDir + '/04-player.png' })

await page.goto('http://127.0.0.1:5181/#/plugins', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await page.screenshot({ path: outDir + '/05-plugins.png' })

console.log('screenshots written to', outDir)
await browser.close()
