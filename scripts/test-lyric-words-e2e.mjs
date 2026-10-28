import { chromium } from 'playwright-core'

// 端到端：插件给的逐字歌词要一路走到播放状态里（再交给原生发布给 Lyricon）。
const plugin = `exports.manifest = {
  manifestVersion: 2,
  id: 'ceru.test.wordlyric',
  name: '逐字歌词测试音源',
  version: '1.0.0',
  engines: { hostApi: '^2.0.0', logicRuntime: 'ceru-js@1' },
  modules: { logic: { entry: 'logic.main' } },
  permissions: [{ key: 'network', name: 'network.request', reason: '测试' }],
  contributes: {
    providers: [{ id: 'wordlyric', name: '逐字音源', protocols: ['https'], qualities: ['128k'] }]
  }
}
exports.activate = function (core) {
  core.providers.register('wordlyric', {
    tracks: {
      search: async function () {
        return { items: [{
          ref: { providerId: 'wordlyric', kind: 'track', id: 'w1', scope: 'provider' },
          title: '逐字歌词测试',
          capabilities: ['play'],
          metadata: { artists: ['测试歌手'], durationMs: 200000, qualities: ['128k'] }
        }] }
      },
      resolve: async function () {
        return { ok: true, url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' }
      },
      lyrics: async function (resource) {
        return {
          format: 'crlyric',
          version: 1,
          track: resource,
          offsetMs: 0,
          lines: [
            {
              startTimeMs: 1000,
              endTimeMs: 4000,
              text: '晴天忽然下雨',
              translation: 'sunny then rain',
              words: [
                { startTimeMs: 1000, endTimeMs: 1800, text: '晴天' },
                { startTimeMs: 1800, endTimeMs: 2600, text: '忽然' },
                { startTimeMs: 2600, endTimeMs: 4000, text: '下雨' }
              ]
            },
            {
              startTimeMs: 4000,
              endTimeMs: 7000,
              text: '没有逐字的一行'
            }
          ]
        }
      }
    }
  })
}`

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', (error) => errors.push('[pageerror] ' + error.message))

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok })
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''))
}

await page.goto('http://127.0.0.1:5180/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)

await page.evaluate(async (source) => {
  const debug = window.__ceruDebug
  await debug.installPlugin(source, { enable: true, grantDeclared: true })
  debug.selectProvider('wordlyric')
}, plugin)

await page.goto('http://127.0.0.1:5180/#/search', { waitUntil: 'networkidle' })
await page.waitForSelector('.search-bar input')
await page.fill('.search-bar input', '逐字')
await page.press('.search-bar input', 'Enter')
await page.waitForSelector('.song-row', { timeout: 15000 })
await page.locator('.song-row').first().click()
await page.waitForTimeout(5000)

const lyrics = await page.evaluate(() => {
  const lines = window.__ceruDebug.player.playerState.lyrics
  return lines.map((line) => ({
    text: line.text,
    translation: line.translation ?? '',
    words: line.words ? line.words.map((word) => [word.startTimeMs, word.endTimeMs, word.text]) : null
  }))
})

console.log('lyrics:', JSON.stringify(lyrics))
check('歌词行已加载', lyrics.length === 2, String(lyrics.length))
check(
  '逐字时间被保留',
  Array.isArray(lyrics[0]?.words) && lyrics[0].words.length === 3 && lyrics[0].words[1][0] === 1800,
  JSON.stringify(lyrics[0]?.words)
)
check(
  '逐字文字拼起来等于整行',
  (lyrics[0]?.words ?? []).map((word) => word[2]).join('') === '晴天忽然下雨',
  (lyrics[0]?.words ?? []).map((word) => word[2]).join('')
)
check('没有逐字的行不会伪造', lyrics[1]?.words === null, JSON.stringify(lyrics[1]))
check('翻译保留', lyrics[0]?.translation === 'sunny then rain', lyrics[0]?.translation ?? '')

const fatal = errors.filter((line) => !line.includes('sandboxed and lacks the'))
check('无页面报错', fatal.length === 0, fatal.slice(0, 3).join(' | '))

const passed = checks.filter((item) => item.ok).length
console.log(`\n${passed}/${checks.length} passed`)
await browser.close()
process.exit(passed === checks.length ? 0 : 1)
