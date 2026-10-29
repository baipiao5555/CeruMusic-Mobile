import { chromium } from 'playwright-core'

// 现场合成 40 秒 440Hz 测试音频（8kHz 单声道），不把音频文件塞进仓库或安装包。
function buildTestWav(seconds = 40, rate = 8000) {
  const samples = rate * seconds
  const buffer = Buffer.alloc(44 + samples)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + samples, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(rate, 24)
  buffer.writeUInt32LE(rate, 28)
  buffer.writeUInt16LE(1, 32)
  buffer.writeUInt16LE(8, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(samples, 40)
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(128 + 30 * Math.sin((2 * Math.PI * 440 * index) / rate))
    buffer[44 + index] = Math.max(0, Math.min(255, value))
  }
  return buffer
}

// 歌词跟唱同步：逐字变色要跟着声音平滑推进，不能一格一格跳。
// 用一个本地 40 秒测试音频 + 每行 2 秒的逐字歌词，采样播放状态和 DOM 里的已唱字数。
const plugin = `exports.manifest = {
  manifestVersion: 2,
  id: 'ceru.test.sync',
  name: '同步测试音源',
  version: '1.0.0',
  engines: { hostApi: '^2.0.0', logicRuntime: 'ceru-js@1' },
  modules: { logic: { entry: 'logic.main' } },
  permissions: [{ key: 'network', name: 'network.request', reason: '测试' }],
  contributes: { providers: [{ id: 'sync', name: '同步音源', protocols: ['https'], qualities: ['128k'] }] }
}
exports.activate = function (core) {
  core.providers.register('sync', {
    tracks: {
      search: async function () {
        return { items: [{ ref: { providerId: 'sync', kind: 'track', id: 's1', scope: 'provider' }, title: '同步测试', capabilities: ['play'], metadata: { artists: ['测试'], durationMs: 40000, qualities: ['128k'] } }] }
      },
      resolve: async function () { return { ok: true, url: 'http://127.0.0.1:5180/test-audio.wav' } },
      lyrics: async function (resource) {
        const lines = []
        for (let second = 1; second <= 18; second++) {
          const start = second * 1000
          lines.push({
            startTimeMs: start,
            endTimeMs: start + 1000,
            text: '晴天忽然下雨',
            words: [
              { startTimeMs: start, endTimeMs: start + 300, text: '晴天' },
              { startTimeMs: start + 300, endTimeMs: start + 600, text: '忽然' },
              { startTimeMs: start + 600, endTimeMs: start + 1000, text: '下雨' }
            ]
          })
        }
        return { format: 'crlyric', version: 1, track: resource, offsetMs: 0, lines }
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

const testAudio = buildTestWav()
await page.route('**/test-audio.wav', (route) =>
  route.fulfill({ status: 200, contentType: 'audio/wav', body: testAudio })
)

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
  debug.selectProvider('sync')
}, plugin)

await page.goto('http://127.0.0.1:5180/#/search', { waitUntil: 'networkidle' })
await page.waitForSelector('.search-bar input')
await page.fill('.search-bar input', '同步')
await page.press('.search-bar input', 'Enter')
await page.waitForSelector('.song-row', { timeout: 15000 })
await page.locator('.song-row').first().click()
await page.waitForTimeout(3000)

// 打开播放页，逐字歌词才会渲染成 .lyric-char
await page.locator('.mini-player').click()
await page.waitForTimeout(1500)

const sample = await page.evaluate(async () => {
  const debug = window.__ceruDebug
  const samples = []
  const startedAt = performance.now()
  let lastTime = -1
  let lastChangeAt = startedAt
  let maxStale = 0
  for (let index = 0; index < 90; index++) {
    await new Promise((resolve) => setTimeout(resolve, 60))
    const now = performance.now()
    const current = debug.player.playerState.currentTime
    if (current !== lastTime) {
      lastTime = current
      lastChangeAt = now
    }
    maxStale = Math.max(maxStale, now - lastChangeAt)
    const sung = document.querySelectorAll('.lyric-char.sung').length
    const active = debug.player.playerState.activeLyric
    const line = active >= 0 ? debug.player.playerState.lyrics[active] : null
    samples.push({
      at: Math.round(now - startedAt),
      time: Number(current.toFixed(2)),
      sung,
      lineStart: line ? line.startTimeMs : -1
    })
  }
  return { samples, maxStale: Math.round(maxStale) }
})

const sungValues = [...new Set(sample.samples.map((item) => item.sung))]
const clockGaps = []
for (let index = 1; index < sample.samples.length; index += 1) {
  if (sample.samples[index].time !== sample.samples[index - 1].time) {
    clockGaps.push(sample.samples[index].at - sample.samples[index - 1].at)
  }
}
console.log('samples:', JSON.stringify(sample.samples.slice(0, 12)))
console.log('distinct sung counts:', JSON.stringify(sungValues))
console.log('max clock stale (ms):', sample.maxStale)
console.log('clock update gaps (ms):', JSON.stringify(clockGaps.slice(0, 12)))

check('播放页渲染逐字歌词', sungValues.length > 0, JSON.stringify(sungValues))
check(
  '歌词时钟连续推进（不再 260ms 一跳）',
  sample.maxStale < 120 && clockGaps.every((gap) => gap < 150),
  `stale=${sample.maxStale} gaps=${clockGaps.slice(0, 6).join(',')}`
)
check(
  '已唱字数随播放平滑增加',
  sungValues.length >= 5,
  `不同取值 ${sungValues.length} 个：${JSON.stringify(sungValues)}`
)

// 抽查一次「字的位置 vs 声音时间」是否对得上：行内 300ms 两个字、400ms 两个字
const checkSample = sample.samples.find((item) => item.sung > 0 && item.sung < 6)
if (checkSample) {
  const inLine = checkSample.time * 1000 - checkSample.lineStart
  const expected =
    inLine < 300
      ? Math.floor((inLine / 300) * 2)
      : inLine < 600
        ? 2 + Math.floor(((inLine - 300) / 300) * 2)
        : 4 + Math.floor(((inLine - 600) / 400) * 2)
  check(
    '逐字位置与声音时间一致（±1 字）',
    Math.abs(checkSample.sung - expected) <= 1,
    `t=${checkSample.time}s 行内=${Math.round(inLine)}ms 已唱=${checkSample.sung} 期望≈${expected}`
  )
} else {
  check('逐字位置与声音时间一致（±1 字）', false, '没有取到行内采样')
}

const fatal = errors.filter((line) => !line.includes('sandboxed and lacks the'))
check('无页面报错', fatal.length === 0, fatal.slice(0, 3).join(' | '))

const passed = checks.filter((item) => item.ok).length
console.log(`\n${passed}/${checks.length} passed`)
await browser.close()
process.exit(passed === checks.length ? 0 : 1)
