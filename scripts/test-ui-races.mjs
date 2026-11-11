import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = process.env.CERU_TEST_URL || 'http://127.0.0.1:5180'
const plugin = `
exports.manifest = {
  manifestVersion: 2, id: 'ceru.ui.regression', name: 'UI Regression', version: '1.0.0',
  engines: { hostApi: '^2.0.0', logicRuntime: 'ceru-js@1' },
  modules: { logic: { entry: 'logic.main' } },
  contributes: { providers: ${JSON.stringify(['slow', 'fast', 'browse'].map(id => ({
    id, name: id, protocols: ['https'], qualities: ['128k']
  })))} }
}
exports.activate = function(core) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  for (const id of ['slow', 'fast', 'browse']) {
    const entity = (kind, key) => ({
      ref: { providerId: id, kind, id: key, pluginId: core.plugin.id },
      title: id + '-' + key, capabilities: [],
      metadata: { artists: ['Regression'], artworkUrl: '/default-cover.png' }
    })
    const provider = {
      charts: { list: async () => {
        await sleep(id === 'slow' ? 900 : 20)
        return { items: [entity('chart', 'chart')] }
      } },
      playlists: {
        categories: async () => ({ items: ['initial', 'delayed', 'latest'].map(key => entity('category', key)) }),
        list: async ref => {
          await sleep(ref.id === 'delayed' ? 800 : 20)
          return { items: [entity('playlist', ref.id)] }
        }
      }
    }
    if (id !== 'browse') provider.tracks = { search: async request => {
      await sleep(650)
      return { items: [entity('track', request.query)] }
    } }
    core.providers.register(id, provider)
  }
}
`

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--mute-audio']
})
const failures = []
const pageErrors = []
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
page.on('pageerror', error => pageErrors.push(error.message))
async function check(name, run) {
  try {
    await run()
    console.log('PASS', name)
  } catch (error) {
    failures.push(name)
    console.error('FAIL', name, error.message)
  }
}
const choose = id => page.evaluate(id => window.__ceruDebug.selectProvider(id), id)
const titles = selector => page.locator(selector).allTextContents()

try {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__ceruDebug && !window.__ceruDebug.pluginState.loading)
  await page.evaluate(source => window.__ceruDebug.installPlugin(source, {
    enable: true, grantDeclared: true
  }), plugin)
  await choose('slow')
  await page.waitForTimeout(100)
  await choose('fast')
  await page.waitForTimeout(1400)
  await check('latest provider owns discovery content', async () => {
    assert.deepEqual(await titles('.rankcard .rt'), ['fast-chart'])
    assert.deepEqual(await titles('.mediacard .ct'), ['fast-initial'])
  })

  await choose('browse')
  await page.waitForTimeout(200)
  await choose('fast')
  await page.waitForTimeout(200)
  await check('provider cache remains isolated', async () => {
    assert.deepEqual(await titles('.rankcard .rt'), ['fast-chart'])
  })
  await page.getByRole('button', { name: 'fast-delayed', exact: true }).click()
  await page.waitForTimeout(80)
  await page.getByRole('button', { name: 'fast-latest', exact: true }).click()
  await page.waitForTimeout(1000)
  await check('latest category owns playlist results', async () => {
    assert.deepEqual(await titles('.mediacard .ct'), ['fast-latest'])
  })

  await page.locator('.tabbar button').nth(1).click()
  const input = page.locator('.searchfield input')
  await input.waitFor()
  await input.fill('pending')
  await input.press('Enter')
  await page.waitForTimeout(100)
  await input.fill('')
  await input.press('Enter')
  await page.waitForTimeout(900)
  await check('empty submission invalidates pending search', async () => {
    assert.equal(await page.locator('.search-page .songrow').count(), 0)
    assert.equal(await page.locator('.skelrow').count(), 0)
  })

  await input.fill('unsupported')
  await input.press('Enter')
  await page.waitForTimeout(100)
  await page.getByRole('button', { name: 'browse', exact: true }).click()
  await page.waitForTimeout(900)
  await check('unsupported provider cannot receive old search results', async () => {
    assert.equal(await page.locator('.search-page .songrow').count(), 0)
    assert.equal(await page.getByText('当前音源不支持搜索', { exact: true }).count(), 1)
  })

  await check('search mode supports keyboard activation', async () => {
    await input.fill('')
    const toggle = page.locator('.modetog')
    await toggle.focus()
    await toggle.press('Enter')
    assert.match(await input.getAttribute('placeholder'), /输入一句歌词/)
  })
  await check('clear search supports keyboard activation', async () => {
    await input.fill('clear me')
    const clear = page.getByRole('button', { name: '清空', exact: true }).first()
    await clear.focus()
    await clear.press('Enter')
    assert.equal(await input.inputValue(), '')
  })
  await check('no uncaught browser errors', async () => assert.deepEqual(pageErrors, []))
} finally {
  await browser.close()
}
assert.equal(failures.length, 0, `Failed checks: ${failures.join(', ')}`)
