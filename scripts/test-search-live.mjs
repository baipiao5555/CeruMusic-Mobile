import { chromium } from 'playwright-core'

// 模拟两个音源插件：
//  - 模糊音源：像真实音乐 API 一样按包含关系匹配（打一个字就能出结果）
//  - 严格音源：只认完整歌名（复现「必须打全名」的老问题），用来验证缩词兜底与本地联想
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
  ['晴雯', '花粥', '晴雯', 198000]
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
        await wait(450)
        if (!query) return { items: [] }
        const matched = []
        SONGS.forEach((song, index) => {
          if ((song[0] + ' ' + song[1] + ' ' + song[2]).toLowerCase().includes(query)) {
            matched.push(item('fuzzy', song, index))
          }
        })
        return { items: matched }
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
        await wait(450)
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
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (error) => errors.push('[pageerror] ' + error.message))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push('[console] ' + message.text())
})

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok })
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''))
}

const input = () => page.locator('.search-bar input')
const rows = () => page.locator('.song-row')
const titles = async () =>
  (await page.locator('.song-row .info h3').allInnerTexts()).map((text) => text.trim())

// 预置两首收藏，验证「联想词不只来自网络结果」。
const seedLibrary = {
  favorites: [
    {
      id: 'fuzzy-1',
      providerId: 'fuzzy',
      pluginId: 'ceru.test.searchlab',
      providerName: '搜索测试音源',
      ref: { providerId: 'fuzzy', kind: 'track', id: 'fuzzy-1', scope: 'provider' },
      title: '起风了',
      artist: '买辣椒也用券',
      album: '起风了',
      durationMs: 325000,
      artwork: '/default-cover.png',
      qualities: ['128k']
    },
    {
      id: 'fuzzy-5',
      providerId: 'fuzzy',
      pluginId: 'ceru.test.searchlab',
      providerName: '搜索测试音源',
      ref: { providerId: 'fuzzy', kind: 'track', id: 'fuzzy-5', scope: 'provider' },
      title: '海底',
      artist: '一支榴莲',
      album: '海底',
      durationMs: 254000,
      artwork: '/default-cover.png',
      qualities: ['128k']
    }
  ],
  playlists: []
}
await page.addInitScript((library) => {
  if (!localStorage.getItem('ceru.library.v1')) {
    localStorage.setItem('ceru.library.v1', JSON.stringify(library))
  }
}, seedLibrary)

await page.goto('http://127.0.0.1:5180/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)

const providers = await page.evaluate(async (source) => {
  const debug = window.__ceruDebug
  await debug.installPlugin(source, { enable: true, grantDeclared: true })
  debug.selectProvider('fuzzy')
  return debug.allProviders().map((item) => item.providerId)
}, plugin)
console.log('providers:', JSON.stringify(providers))

await page.goto('http://127.0.0.1:5180/#/search', { waitUntil: 'networkidle' })
await page.waitForSelector('.search-bar input')
await page.waitForTimeout(400)

// 1) 打一个字（不按回车）就出结果
await input().click()
await input().type('晴', { delay: 60 })
await page.waitForTimeout(1800)
const oneCharRows = await rows().count()
const oneCharTitles = await titles()
check('打一个字自动出结果（无需回车）', oneCharRows > 0, `${oneCharRows} 行: ${oneCharTitles.join(' / ')}`)
check(
  '单字结果都命中「晴」',
  oneCharTitles.length > 0 && oneCharTitles.every((title) => title.includes('晴')),
  oneCharTitles.join(' / ')
)
const highlightCount = await page.locator('.song-row h3 mark.hl').count()
check('结果里高亮匹配片段', highlightCount > 0, `mark x ${highlightCount}`)
await page.screenshot({ path: 'scripts/search-1-one-char.png' })

// 2) 继续输入，结果跟着变（仍然不用回车）
await input().type('天', { delay: 60 })
await page.waitForTimeout(1800)
const twoCharTitles = await titles()
check(
  '继续输入结果即时收窄',
  twoCharTitles.length > 0 && twoCharTitles.slice(0, 2).every((title) => title.includes('晴天')),
  twoCharTitles.join(' / ')
)

// 3) 相关度排序：歌手名也能搜
await page.fill('.search-bar input', '周杰伦')
await page.waitForTimeout(1800)
const artistHitTitles = await titles()
check('按歌手也能搜到', artistHitTitles.length >= 3, artistHitTitles.join(' / '))

// 4) 联想下拉：输入一个字立刻给出歌名建议（含收藏里的歌）
await page.fill('.search-bar input', '')
await page.waitForTimeout(200)
await input().click()
await input().type('起', { delay: 40 })
await page.waitForSelector('.suggest-panel', { timeout: 3000 })
const suggestRows = page.locator('.suggest-row')
const suggestCount = await suggestRows.count()
const suggestText = await suggestRows.allInnerTexts()
check(
  '输入一个字弹出歌名联想',
  suggestCount > 1 && suggestText.some((text) => text.includes('起风了')),
  suggestText.join(' | ').replace(/\n/g, ' ')
)
await page.screenshot({ path: 'scripts/search-2-suggest.png' })

// 5) 点联想项直接搜索
await suggestRows.filter({ hasText: '起风了' }).first().click()
await page.waitForTimeout(2200)
const pickedTitles = await titles()
check(
  '点联想项立即搜索',
  pickedTitles.length > 0 && pickedTitles[0].includes('起风了'),
  pickedTitles.join(' / ')
)
check('结果到达后联想面板自动收起', (await page.locator('.suggest-panel').count()) === 0, '')

// 6) 搜索历史：只记真正搜出结果的词，不记打了一半的拼音/前缀
const history = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('ceru.search.history.v1') || '[]')
)
check(
  '搜索历史不塞半成品关键词',
  history.includes('起风了') && !history.includes('起') && !history.includes('晴'),
  JSON.stringify(history)
)
await page.fill('.search-bar input', '')
await page.waitForTimeout(600)
const historyChips = await page.locator('.history-chips .chip').allInnerTexts()
check(
  '清空输入显示最近搜索',
  historyChips.some((text) => text.trim() === '起风了'),
  historyChips.join(' / ')
)
await page.screenshot({ path: 'scripts/search-3-history.png' })

// 7) 点历史词重新搜索
await page.locator('.history-chips .chip', { hasText: '起风了' }).first().click()
await page.waitForTimeout(1800)
check('点历史词重新搜索', (await rows().count()) > 0, (await titles()).join(' / '))

// 8) 严格音源 + 「歌名 歌手」→ 缩词兜底
await page.locator('.source-chips .chip', { hasText: '严格音源' }).click()
await page.waitForTimeout(800)
await page.fill('.search-bar input', '起风了 买辣椒也用券')
await page.press('.search-bar input', 'Enter')
await page.waitForTimeout(3500)
const relaxedNote = (await page.locator('.relaxed-note').first().innerText().catch(() => '')).trim()
const relaxedTitles = await titles()
check(
  '音源不认「歌名 歌手」时自动缩词重搜',
  relaxedTitles.length > 0 && relaxedNote.includes('起风了'),
  `${relaxedTitles.join(' / ')} || ${relaxedNote.replace(/\n/g, ' ')}`
)
await page.screenshot({ path: 'scripts/search-4-relaxed.png' })

// 9) 严格音源下单字 → 音源没结果，退回本地歌曲
await page.fill('.search-bar input', '晴')
await page.waitForTimeout(2500)
const localSection = await page.locator('.section-title h2', { hasText: '本地歌曲' }).count()
const localTitles = await titles()
check(
  '音源零结果时退回本地歌曲',
  localSection > 0 && localTitles.some((title) => title.includes('晴')),
  localTitles.join(' / ')
)
await page.screenshot({ path: 'scripts/search-5-local.png' })

// 10) 严格音源完整歌名仍然可用
await page.fill('.search-bar input', '稻香')
await page.waitForTimeout(2000)
check('完整歌名照常可搜', (await titles()).some((title) => title.includes('稻香')), (await titles()).join(' / '))

// 11) 快速连续输入时，过期响应不能盖住最新结果
await page.fill('.search-bar input', '')
await page.waitForTimeout(400)
await input().type('光年之外', { delay: 0 })
await page.waitForTimeout(3000)
const finalTitles = await titles()
check(
  '快速连续输入只保留最后一次结果',
  finalTitles.length === 1 && finalTitles[0].includes('光年之外'),
  finalTitles.join(' / ')
)

// 插件沙箱 iframe 没有 allow-same-origin，运行时自己读 localStorage 会报这条，和搜索无关。
const fatal = errors.filter(
  (line) => !line.includes('favicon') && !line.includes('sandboxed and lacks the')
)
check('无控制台/页面报错', fatal.length === 0, fatal.slice(0, 4).join(' | '))

const passed = checks.filter((item) => item.ok).length
console.log(`\n${passed}/${checks.length} passed`)
await browser.close()
process.exit(passed === checks.length ? 0 : 1)
