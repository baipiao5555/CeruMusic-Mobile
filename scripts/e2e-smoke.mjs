import { chromium } from 'playwright-core'

const url = process.env.CERU_URL || 'http://127.0.0.1:5181/'
const executablePath =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']
})
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2
})
const page = await context.newPage()
const errors = []
page.on('console', (message) => {
  if (message.type() === 'error') errors.push('[console] ' + message.text())
  console.log('[browser:' + message.type() + '] ' + message.text().slice(0, 500))
})
page.on('pageerror', (error) => errors.push('[pageerror] ' + error.message))
page.on('response', (response) => {
  if (response.status() === 404) console.log('[404]', response.url())
})

async function main() {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForSelector('.brand-name', { timeout: 15000 })
  await page.waitForTimeout(5000)

  const title = await page.locator('.brand-name').first().textContent()
  console.log('brand:', title?.trim())

  const frames = page.frames().filter((frame) => frame !== page.mainFrame())
  console.log('child frames:', frames.length)

  await page.goto(url + '#/plugins', { waitUntil: 'networkidle' })
  await page.waitForSelector('.plugin-card, .empty', { timeout: 15000 })
  await page.waitForTimeout(1500)
  const pluginCards = await page.locator('.plugin-card').count()
  const pluginText = pluginCards ? await page.locator('.plugin-card').first().innerText() : ''
  console.log('plugin cards:', pluginCards)
  console.log('plugin text:', pluginText.replace(/\n+/g, ' | ').slice(0, 300))

  await page.goto(url + '#/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  const bodyText = await page.locator('.page').first().innerText()
  console.log('discover text:', bodyText.replace(/\n+/g, ' | ').slice(0, 400))

  const hasChart = bodyText.includes('示例热歌榜') || bodyText.includes('排行榜')
  console.log('has chart:', hasChart)

  await page.goto(url + '#/search', { waitUntil: 'networkidle' })
  await page.waitForSelector('.search-bar input', { timeout: 10000 })
  await page.fill('.search-bar input', 'city')
  await page.press('.search-bar input', 'Enter')
  await page.waitForSelector('.song-row', { timeout: 15000 })
  const rows = await page.locator('.song-row').count()
  const firstRow = await page.locator('.song-row').first().innerText()
  console.log('search rows:', rows)
  console.log('first row:', firstRow.replace(/\n+/g, ' | '))

  await page.locator('.song-row').first().click()
  await page.waitForTimeout(4000)
  const mini = await page.locator('.mini-player').count()
  const miniText = mini ? await page.locator('.mini-player').innerText() : ''
  console.log('mini player:', mini, miniText.replace(/\n+/g, ' | '))

  // Open the full player and check parsed track metadata.
  if (mini) {
    await page.locator('.mini-player').click()
    await page.waitForTimeout(1200)
    const playerText = await page.locator('.player-page').innerText()
    console.log('player text:', playerText.replace(/\n+/g, ' | ').slice(0, 400))
    const errorText = await page.locator('.player-error').count()
    console.log('player error blocks:', errorText)
  }

  console.log('errors:', errors.length)
  for (const error of errors.slice(0, 20)) console.log(error)
  await page.screenshot({ path: 'scripts/smoke.png', fullPage: false })
}

try {
  await main()
} finally {
  await browser.close()
}
