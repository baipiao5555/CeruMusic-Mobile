import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const base = process.env.CERU_TEST_URL || 'http://127.0.0.1:5181'
const outputDir = resolve(process.env.CERU_TEST_OUTPUT || 'D:/LX/.vite/takeover-checks')
mkdirSync(outputDir, { recursive: true })

// 两个假音源：
//  - 模糊音源：像真实音乐 API 一样按包含关系匹配
//  - 严格音源：只认完整歌名（复现「必须打全名」的情况），验证缩词兜底与本地联想
// 输入联想另有专项回归；这里验证显式提交、排序、历史与搜索兜底。
const plugin = `exports.manifest = {
  manifestVersion: 2,
  id: 'ceru.test.searchlab',
  name: '搜索测试音源',
  version: '1.0.0',
  engines: { hostApi: '^2.0.0', logicRuntime: 'ceru-js@1' },
  modules: { logic: { entry: 'logic.main' } },
  permissions: [{ key: 'network', name: 'network.request', reason: '测试' }],
  contributes: {
    providers: [
      { id: 'fuzzy', name: '模糊音源', protocols: ['https'], qualities: ['128k', '320k'] },
      { id: 'strict', name: '严格音源', protocols: ['https'], qualities: ['128k'] }
    ]
  }
}

const SONGS = [
  ['晴天', '周杰伦', '叶惠美', 269000],
  ['起风了', '买辣椒也用券', '起风了', 325000],
  ['光年之外', '邓紫棋', '光年之外', 235000],
  ['夜曲', '周杰伦', '十一月的萧邦', 226000],
  ['稻香', '周杰伦', '魔杰座', 223000],
  ['海底', '一支榴莲', '海底', 254000],
  ['晴雯', '花粥', '晴雯', 198000],
  ['雨后的晴天', '测试歌手', '测试专辑', 180000]
]

function item(providerId, song, index) {
  return {
    ref: { providerId: providerId, kind: 'track', id: providerId + '-' + index, scope: 'provider' },
    title: song[0],
    subtitle: song[1],
    capabilities: ['play'],
    metadata: {
      artists: [song[1]],
      album: { title: song[2] },
      durationMs: song[3],
      artworkUrl: '/default-cover.png',
      qualities: ['128k', '320k']
    }
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

exports.activate = function (core) {
  core.providers.register('fuzzy', {
    tracks: {
      search: async function (request) {
        const query = String(request.query || '').trim().toLowerCase()
        console.log('search-call:fuzzy:' + query)
        await wait(300)
        if (!query) return { items: [] }
        const matched = []
        SONGS.forEach((song, index) => {
          if ((song[0] + ' ' + song[1] + ' ' + song[2]).toLowerCase().includes(query)) {
            matched.push(item('fuzzy', song, index))
          }
        })
        return { items: matched.reverse() }
      },
      resolve: async function () {
        return { ok: true, url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' }
      },
      lyrics: async function () {
        return { format: 'crlyric', version: 1, offsetMs: 0, lines: [{ startTimeMs: 0, endTimeMs: 3000, text: '测试歌词' }] }
      }
    }
  })

  core.providers.register('strict', {
    tracks: {
      search: async function (request) {
        const query = String(request.query || '').trim()
        console.log('search-call:strict:' + query)
        await wait(300)
        const matched = []
        SONGS.forEach((song, index) => {
          if (song[0] === query) matched.push(item('strict', song, index))
        })
        return { items: matched }
      },
      resolve: async function () {
        return { ok: true, url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' }
      },
      lyrics: async function () {
        return { format: 'crlyric', version: 1, offsetMs: 0, lines: [{ startTimeMs: 0, endTimeMs: 3000, text: '测试歌词' }] }
      }
    }
  })
}`

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const errors = []
const searchCalls = []
page.on('pageerror', (error) => errors.push('[pageerror] ' + error.message))
page.on('console', (message) => {
  const text = message.text()
  // 宿主会把插件 console 转贴一份（带「[插件 」前缀），这里只数插件自己那条。
  if (text.includes('[插件 ')) return
  const match = text.match(/search-call:([a-z]+):(.*)$/)
  if (match) searchCalls.push({ provider: match[1], query: match[2].trim() })
  if (message.type() === 'error') errors.push('[console] ' + text)
})

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok })
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  - ' + detail : ''))
}

const input = () => page.locator('.searchfield input')
const rows = () => page.locator('.search-page .songrow')
const titles = async () =>
  (await page.locator('.search-page .songrow .meta-wrap > .t').allInnerTexts()).map((text) => text.trim())

// 预置收藏，验证「联想词不只来自网络结果」。
const seedLibrary = {
  favorites: [
    {
      id: 'fuzzy-1',
      providerId: 'fuzzy',
      pluginId: createHash('sha256').update('ceru.test.searchlab').digest('hex').slice(0, 32),
      providerName: '搜索测试音源',
      ref: { providerId: 'fuzzy', kind: 'track', id: 'fuzzy-1', scope: 'provider' },
      title: '起风了',
      artist: '买辣椒也用券',
      album: '起风了',
      durationMs: 325000,
      artwork: '/default-cover.png',
      qualities: ['128k']
    }
  ],
  playlists: []
}
try {
  await page.addInitScript((library) => {
    if (window.parent !== window) return
    if (!localStorage.getItem('ceru.library.v1')) {
      localStorage.setItem('ceru.library.v1', JSON.stringify(library))
    }
  }, seedLibrary)

  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__ceruDebug && !window.__ceruDebug.pluginState.loading)

  const providers = await page.evaluate(async (source) => {
    const debug = window.__ceruDebug
    const installed = await debug.installPlugin(source, { enable: true, grantDeclared: true })
    debug.selectProvider('fuzzy', installed.pluginId)
    return debug.allProviders().map((item) => item.providerId)
  }, plugin)
  console.log('providers:', JSON.stringify(providers))

  await page.locator('.tabbar button').nth(1).click()
  await input().waitFor()

  // 联想不应提前提交正式搜索。
  await input().fill('晴')
  await page.waitForSelector('.srow:not(.direct)')
  check('输入时正式搜索结果保持空白', (await rows().count()) === 0)
  check('输入联想不写入搜索历史', await page.evaluate(() =>
    JSON.parse(localStorage.getItem('ceru.search.history.v1') || '[]').length === 0))
  await page.screenshot({ path: join(outputDir, 'search-live-1-typing.png') })

  // 音源故意反序返回结果，宿主仍应把前缀命中排在包含命中之前。
  await input().press('Enter')
  await rows().first().waitFor()
  const enterTitles = await titles()
  check(
    '回车提交后按关键词相关度排序',
    JSON.stringify(enterTitles) === JSON.stringify(['晴雯', '晴天', '雨后的晴天']),
    enterTitles.join(' / ')
  )
  check('结果里高亮匹配片段', (await page.locator('.songrow .t mark.hl').count()) > 0)
  await page.screenshot({ path: join(outputDir, 'search-live-2-result.png') })

  await input().fill('晴天')
  await page.waitForTimeout(800)
  check(
    '修改输入只更新联想，不替换正式结果',
    JSON.stringify(await titles()) === JSON.stringify(enterTitles)
  )

  await page.locator('.findgo').click()
  await page.waitForFunction(() =>
    document.querySelectorAll('.search-page .songrow').length === 1)
  const buttonTitles = await titles()
  check(
    '搜索按钮提交后优先精确歌名，不混入仅包含的歌',
    buttonTitles.length === 1 && buttonTitles[0] === '晴天',
    buttonTitles.join(' / ')
  )

  await input().fill('')
  await input().fill('起')
  const suggestRows = page.locator('.srow:not(.direct)')
  await suggestRows.filter({ hasText: '起风了' }).first().waitFor()
  await page.screenshot({ path: join(outputDir, 'search-live-3-suggest.png') })
  await suggestRows.filter({ hasText: '起风了' }).first().click()
  await rows().first().waitFor()
  const pickedTitles = await titles()
  check(
    '点联想项会提交所选歌名',
    pickedTitles.length === 1 && pickedTitles[0] === '起风了',
    pickedTitles.join(' / ')
  )

  const history = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('ceru.search.history.v1') || '[]'))
  check(
    '搜索历史只记成功提交过的关键词',
    JSON.stringify(history) === JSON.stringify(['起风了', '晴天', '晴']),
    JSON.stringify(history)
  )
  await input().fill('')
  const historyChips = await page.locator('section:has(.cap) .chip').allInnerTexts()
  check(
    '清空输入显示最近搜索',
    historyChips.some((text) => text.trim() === '起风了'),
    historyChips.join(' / ')
  )
  await page.screenshot({ path: join(outputDir, 'search-live-4-history.png') })

  await page.getByRole('button', { name: '严格音源', exact: true }).click()
  await input().fill('起风了 买辣椒也用券')
  await input().press('Enter')
  await page.locator('.search-page .note').waitFor()
  const relaxedNote = (await page.locator('.search-page .note').innerText()).trim()
  const relaxedTitles = await titles()
  check(
    '严格音源不认歌名加歌手时缩词重搜',
    relaxedTitles.length === 1 && relaxedTitles[0] === '起风了' &&
      relaxedNote.includes('已按「起风了」搜索'),
    `${relaxedTitles.join(' / ')} | ${relaxedNote.replace(/\n/g, ' ')}`
  )
  await page.screenshot({ path: join(outputDir, 'search-live-5-relaxed.png') })

  await input().fill('晴')
  await input().press('Enter')
  await page.locator('.group-title .cn', { hasText: '本地结果' }).waitFor()
  const localTitles = await titles()
  check(
    '音源零结果时退回本地歌曲',
    localTitles.length > 0 && localTitles.every((title) => title.includes('晴')),
    localTitles.join(' / ')
  )
  await page.screenshot({ path: join(outputDir, 'search-live-6-local.png') })

  await input().fill('')
  await input().pressSequentially('光年之外', { delay: 0 })
  await input().press('Enter')
  await rows().first().waitFor()
  const finalTitles = await titles()
  check(
    '快速输入后回车只留最后一次结果',
    finalTitles.length === 1 && finalTitles[0] === '光年之外',
    finalTitles.join(' / ')
  )

  const fatal = errors.filter((line) => !line.includes('favicon'))
  check('无控制台/页面报错', fatal.length === 0, fatal.slice(0, 4).join(' | '))
  const passed = checks.filter((item) => item.ok).length
  console.log(`\n${passed}/${checks.length} passed`)
  console.log('search calls:', JSON.stringify(searchCalls))
  process.exitCode = passed === checks.length ? 0 : 1
} finally {
  await browser.close()
}
