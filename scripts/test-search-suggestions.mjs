import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright-core'

const base = process.env.CERU_TEST_URL || 'http://127.0.0.1:5180'
const word = '\u6211'
const manifestId = 'ceru.test.suggestions'
const pluginId = createHash('sha256').update(manifestId).digest('hex').slice(0, 32)
const plugin = `
exports.manifest = {
  manifestVersion: 2, id: '${manifestId}', name: 'Suggestion Test', version: '1.0.0',
  engines: { hostApi: '^2.0.0', logicRuntime: 'ceru-js@1' },
  modules: { logic: { entry: 'logic.main' } },
  contributes: { providers: ${JSON.stringify(['one', 'two'].map(id => ({
    id, name: id, protocols: ['https'], qualities: ['128k']
  })))} }
}
exports.activate = function(core) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  for (const id of ['one', 'two']) {
    const track = (title, key = title, kind = 'track', artist = 'Test') => ({
      ref: { providerId: id, kind, id: key, pluginId: core.plugin.id },
      title, capabilities: [],
      metadata: { artists: [artist], artworkUrl: '/default-cover.png' }
    })
    core.providers.register(id, { tracks: { search: async request => {
      const query = request.query
      console.log('suggest-call:' + JSON.stringify({ id, query, limit: request.limit }))
      await sleep(query === 'slow' || query === 'leave' || query.startsWith('lyric-') ||
        (query === 'source' && id === 'one') ? 1000 : 20)
      if (query === 'local') throw new Error('Offline suggestion fixture')
      if (query === ${JSON.stringify(word)}) {
        const rows = [track(query), ...Array.from({ length: 14 }, (_, i) => track(query + '-song-' + i))]
        return { items: [
          track('Artist only', 'artist-only', 'track', query),
          track(query + '-artist', 'not-a-track', 'artist'),
          rows[0], track(query, 'duplicate-title'), ...rows
        ] }
      }
      if (query === 'contain') return {
        items: [track('contain'), track('contain-prefix'), track('please-contain-me')]
      }
      return { items: [track(query + '-' + id)] }
    } } })
  }
}
`

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--mute-audio']
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
const calls = []
const errors = []
const failures = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => {
  const text = message.text()
  if (text.startsWith('suggest-call:')) calls.push(JSON.parse(text.slice('suggest-call:'.length)))
})
const input = page.locator('.searchfield input')
const titles = () => page.locator('.srow:not(.direct) .sname').allTextContents()
const choose = id => page.evaluate(id => window.__ceruDebug.selectProvider(id), id)
const history = () => page.evaluate(() => JSON.parse(localStorage.getItem('ceru.search.history.v1') || '[]'))
async function waitTitle(title) {
  await page.waitForFunction(title =>
    [...document.querySelectorAll('.srow:not(.direct) .sname')].some(el => el.textContent.trim() === title),
  title)
}
async function check(name, run) {
  try {
    await run()
    console.log('PASS', name)
  } catch (error) {
    failures.push(name)
    console.error('FAIL', name, error.message)
  }
}

try {
  await page.addInitScript(({ pluginId }) => {
    if (window.parent !== window) return
    localStorage.setItem('ceru.search.mode.v1', 'name')
    localStorage.setItem('ceru.library.v1', JSON.stringify({
      favorites: [{
        id: 'local', pluginId, providerId: 'one', providerName: 'one',
        ref: { providerId: 'one', kind: 'track', id: 'local' },
        title: 'local-favorite', artist: 'Test', album: '', artwork: '/default-cover.png',
        durationMs: 0, qualities: ['128k']
      }],
      playlists: []
    }))
  }, { pluginId })
  await page.route('https://c.y.qq.com/**', route => route.fulfill({
    json: { data: { lyric: { list: [] } } }
  }))
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__ceruDebug && !window.__ceruDebug.pluginState.loading)
  await page.evaluate(source => window.__ceruDebug.installPlugin(source, {
    enable: true, grantDeclared: true
  }), plugin)
  await choose('one')
  await page.locator('.tabbar button').nth(1).click()
  await input.waitFor()

  await check('single-character typing fetches at most ten distinct matching song names', async () => {
    await input.fill(word)
    await page.waitForFunction(() => document.querySelectorAll('.srow:not(.direct)').length === 10)
    const names = (await titles()).map(title => title.trim())
    assert.equal(names.length, 10)
    assert.equal(new Set(names).size, 10)
    assert(names.every(title => title.includes(word)))
    assert(!names.includes(word + '-artist'))
    assert(calls.some(call => call.query === word))
    assert.equal(await page.locator('.search-page .songrow').count(), 0)
    assert.deepEqual(await history(), [])
  })
  if (process.env.CERU_SEARCH_SHOT) await page.screenshot({ path: process.env.CERU_SEARCH_SHOT })

  await check('exact title does not discard other containing song names', async () => {
    await input.fill('contain')
    await waitTitle('please-contain-me')
    assert.deepEqual((await titles()).map(title => title.trim()), [
      'contain', 'contain-prefix', 'please-contain-me'
    ])
  })

  await check('failed online request retains local title matches', async () => {
    await input.fill('local')
    await waitTitle('local-favorite')
    await page.waitForTimeout(500)
    assert.deepEqual((await titles()).map(title => title.trim()), ['local-favorite'])
    assert.deepEqual(await history(), [])
  })

  await check('fast typing debounces the online lookup', async () => {
    const before = calls.length
    await input.fill('d')
    await page.waitForTimeout(50)
    await input.fill('deb')
    await page.waitForTimeout(50)
    await input.fill('debounce')
    await waitTitle('debounce-one')
    assert.deepEqual(calls.slice(before).map(call => call.query), ['debounce'])
  })

  await check('late responses cannot replace suggestions for a newer query', async () => {
    await input.fill('slow')
    await page.waitForTimeout(450)
    await input.fill('fast')
    await waitTitle('fast-one')
    await page.waitForTimeout(1000)
    assert.deepEqual((await titles()).map(title => title.trim()), ['fast-one'])
  })

  await check('changing source invalidates pending suggestions without recording a search', async () => {
    await input.fill('source')
    await page.waitForTimeout(450)
    await choose('two')
    await waitTitle('source-two')
    await page.waitForTimeout(1000)
    assert.deepEqual((await titles()).map(title => title.trim()), ['source-two'])
    assert.deepEqual(await history(), [])
  })

  await check('clearing input discards pending suggestions and search results', async () => {
    await input.fill('slow')
    await page.waitForTimeout(450)
    await input.fill('')
    await page.waitForTimeout(1100)
    assert.equal(await page.locator('.suggest').count(), 0)
    assert.equal(await page.locator('.search-page .songrow').count(), 0)
    assert.equal(await page.locator('.skelrow').count(), 0)
  })

  await check('Chinese composition does not search partial text or submit on IME Enter', async () => {
    const before = calls.length
    await input.dispatchEvent('compositionstart')
    await input.evaluate(el => {
      el.value = 'wo'
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'wo', isComposing: true }))
      el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await page.waitForTimeout(500)
    assert.equal(calls.length, before)
    assert.equal(await page.locator('.suggest').count(), 0)
    await input.evaluate((el, word) => { el.value = word }, word)
    await input.dispatchEvent('compositionend', { data: word })
    await page.waitForFunction(() => document.querySelectorAll('.srow:not(.direct)').length === 10)
    assert.deepEqual(calls.slice(before).map(call => call.query), [word])
    assert.deepEqual(await history(), [])
  })

  await check('keyboard focus can enter suggestions and Enter commits the selected title', async () => {
    const choice = page.locator('.srow:not(.direct)').first()
    const title = (await choice.locator('.sname').textContent()).trim()
    await choice.focus()
    assert.equal(await choice.isVisible(), true)
    await choice.press('Enter')
    await page.waitForSelector('.search-page .songrow')
    assert.equal(await input.inputValue(), title)
    assert.equal(await page.locator('.suggest').count(), 0)
    assert.deepEqual(await history(), [title])
    assert.equal(calls.at(-1).limit, 30)
  })

  await check('completed results stay cached when returning to the same source', async () => {
    await choose('one')
    await input.fill('committed')
    await input.press('Enter')
    await page.waitForFunction(() =>
      document.querySelector('.search-page .songrow .t')?.textContent.trim() === 'committed-one')
    const before = calls.length
    await page.locator('.tabbar button').nth(0).click()
    await page.locator('.search-page').waitFor({ state: 'hidden' })
    await page.locator('.tabbar button').nth(1).click()
    await input.waitFor()
    await page.waitForTimeout(400)
    assert.equal(calls.length, before)
    assert.equal((await page.locator('.search-page .songrow .t').textContent()).trim(), 'committed-one')
  })

  await check('returning after another page changes source replaces committed results', async () => {
    await page.locator('.tabbar button').nth(0).click()
    await page.locator('.search-page').waitFor({ state: 'hidden' })
    const before = calls.length
    await choose('two')
    await page.waitForTimeout(400)
    assert.equal(calls.length, before)
    await page.locator('.tabbar button').nth(1).click()
    await page.waitForFunction(() =>
      document.querySelector('.search-page .songrow .t')?.textContent.trim() === 'committed-two')
    assert.equal(calls.length, before + 1)
    assert.deepEqual(calls.at(-1), { id: 'two', query: 'committed', limit: 30 })
  })

  await check('returning resumes an interrupted submitted search but not its stale response', async () => {
    const before = calls.filter(call => call.id === 'two' && call.query === 'slow').length
    await input.fill('slow')
    await input.press('Enter')
    await page.waitForTimeout(150)
    await page.locator('.tabbar button').nth(0).click()
    await page.locator('.search-page').waitFor({ state: 'hidden' })
    await page.waitForTimeout(1100)
    await page.locator('.tabbar button').nth(1).click()
    await page.waitForFunction(() =>
      document.querySelector('.search-page .songrow .t')?.textContent.trim() === 'slow-two')
    assert.equal(calls.filter(call => call.id === 'two' && call.query === 'slow').length, before + 2)
  })

  await check('leaving a kept-alive page invalidates pending work', async () => {
    await input.fill('')
    await input.fill('leave')
    await page.waitForTimeout(450)
    await page.locator('.tabbar button').nth(0).click()
    const before = calls.length
    await choose('one')
    await page.waitForTimeout(1100)
    assert.equal(calls.length, before)
    await page.locator('.tabbar button').nth(1).click()
    await input.waitFor()
    assert.equal(await page.locator('.suggest').count(), 0)
    assert(!(await history()).includes('leave'))
  })

  await check('lyric mode skips song suggestions and cancelled fallback cannot restore progress', async () => {
    await input.fill('')
    await page.locator('.modetog').click()
    const before = calls.length
    await input.fill('lyric-cancel')
    await page.waitForTimeout(500)
    assert.equal(await page.locator('.suggest').count(), 0)
    assert.equal(calls.length, before)
    await input.press('Enter')
    await page.waitForTimeout(450)
    assert(calls.slice(before).some(call => call.query === 'lyric-cancel' && call.limit === 8))
    await page.locator('.clearbtn').click()
    await page.waitForTimeout(1100)
    const progress = await page.locator('.search-page').evaluate(el =>
      el.__vueParentComponent.setupState.lyricProgress)
    assert.deepEqual(progress, { done: 0, total: 0 })
    assert.equal(await page.locator('.search-page .songrow').count(), 0)
    assert.equal(await input.inputValue(), '')
  })
  await check('no uncaught browser errors', async () => assert.deepEqual(errors, []))
} finally {
  await browser.close()
}
assert.equal(failures.length, 0, `Failed checks: ${failures.join(', ')}`)
