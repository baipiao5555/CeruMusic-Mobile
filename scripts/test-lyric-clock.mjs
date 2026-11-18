import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = process.env.CERU_TEST_URL || 'http://127.0.0.1:5180'
const executablePath =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

function wavBuffer(seconds = 8, sampleRate = 8000) {
  const samples = seconds * sampleRate
  const buffer = Buffer.alloc(44 + samples * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + samples * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples * 2, 40)
  return buffer
}

const plugin = String.raw`
exports.manifest = {
  manifestVersion: 2,
  id: 'qa.lyric.clock',
  name: 'Lyric Clock Fixture',
  version: '1.0.0',
  engines: { hostApi: '^2.0.0', logicRuntime: 'ceru-js@1' },
  modules: { logic: { entry: 'logic.main' } },
  contributes: {
    providers: [{ id: 'tone', name: 'Tone', protocols: ['https'], qualities: ['128k'] }]
  }
}
exports.activate = function (core) {
  core.providers.register('tone', {
    tracks: {
      resolve: async function () { return { ok: true, url: 'https://fixture.invalid/test-tone.wav' } },
      lyrics: async function (resource) {
        return {
          format: 'crlyric',
          version: 1,
          track: resource,
          offsetMs: 0,
          lines: [
            { startTimeMs: 0, text: '第一行' },
            { startTimeMs: 1000, text: '第二行' },
            { startTimeMs: 2000, text: '第三行' },
            { startTimeMs: 3000, text: '第四行' },
            { startTimeMs: 4000, text: '第五行' }
          ]
        }
      }
    }
  })
}
`

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']
})
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
await context.addInitScript(() => {
  try {
    localStorage.setItem('ceru.update.v1', JSON.stringify({ autoCheck: false }))
    localStorage.setItem('ceru.settings.v1', JSON.stringify({
      version: 2,
      playbackRate: 2,
      showLyrics: true,
      playbackCache: false,
      autoSourceFallback: false
    }))
  } catch {
    // Sandboxed plugin frames do not have same-origin storage.
  }
})

const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('ERR_BLOCKED_BY_CLIENT')) {
    errors.push(message.text())
  }
})
await page.route('**/test-tone.wav', (route) =>
  route.fulfill({ status: 200, contentType: 'audio/wav', body: wavBuffer() })
)

try {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__ceruDebug && !window.__ceruDebug.pluginState.loading)
  const installed = await page.evaluate((source) =>
    window.__ceruDebug.installPlugin(source, { enable: true, grantDeclared: true }), plugin)
  const track = {
    id: 'tone-1',
    pluginId: installed.pluginId,
    providerId: 'tone',
    providerName: 'Tone',
    ref: { providerId: 'tone', kind: 'track', id: 'tone-1', scope: 'provider' },
    title: 'Tone',
    artist: 'Clock',
    album: '',
    artwork: '/default-cover.png',
    durationMs: 8000,
    qualities: ['128k']
  }
  await page.evaluate((item) => window.__ceruDebug.player.playTracks([item]), track)
  try {
    await page.waitForFunction(() => {
      const state = window.__ceruDebug.player.playerState
      return state.playing && state.currentTime > 0.2 && state.lyrics.length >= 3
    }, { timeout: 15000 })
  } catch (error) {
    console.log('DEBUG', await page.evaluate(() => ({
      state: window.__ceruDebug.player.playerState,
      providers: window.__ceruDebug.allProviders().map((item) => ({ id: item.providerId, methods: item.methods }))
    })))
    throw error
  }
  await page.evaluate(() => { location.hash = '#/player' })
  await page.locator('.p-lyric-stack').waitFor({ state: 'visible' })
  await page.evaluate(() => {
    window.__lyricStackRemovals = 0
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (node instanceof Element && node.classList?.contains('p-lyric-stack')) {
            window.__lyricStackRemovals += 1
          }
        }
      }
    })
    observer.observe(document.querySelector('.p-lyric') || document.body, { childList: true, subtree: true })
    window.__lyricObserver = observer
  })

  const samples = await page.evaluate(async () => {
    const state = window.__ceruDebug.player.playerState
    const started = performance.now()
    const values = []
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        values.push({ at: performance.now() - started, time: state.currentTime, line: state.activeLyric })
        if (performance.now() - started >= 2600) {
          clearInterval(timer)
          resolve()
        }
      }, 50)
    })
    return values
  })

  const moving = samples.filter((sample) => sample.time > 0.5)
  assert.ok(moving.length > 10, 'audio clock should have samples')
  for (let index = 1; index < moving.length; index += 1) {
    assert.ok(
      moving[index].time >= moving[index - 1].time - 0.05,
      `audio clock went backwards: ${moving[index - 1].time} -> ${moving[index].time}`
    )
  }
  const first = moving[0]
  const last = moving[moving.length - 1]
  const observedRate = (last.time - first.time) / ((last.at - first.at) / 1000)
  assert.ok(observedRate > 1.55 && observedRate < 2.45, `unexpected clock rate at 2x: ${observedRate}`)
  const lines = moving.map((sample) => sample.line)
  for (let index = 1; index < lines.length; index += 1) {
    assert.ok(lines[index] >= lines[index - 1], 'active lyric index went backwards')
  }
  assert.ok(new Set(lines).size >= 3, 'active lyric should advance under 2x playback')
  assert.equal(
    await page.evaluate(() => window.__lyricStackRemovals),
    0,
    'lyric preview stack must not be remounted on every line'
  )

  await page.locator('.p-art').click()
  await page.locator('.ly-line.cur').waitFor({ state: 'visible' })
  const lyricStyle = await page.evaluate(() => {
    const current = document.querySelector('.ly-line.cur')
    const other = [...document.querySelectorAll('.ly-line')].find((line) => line !== current)
    const rootStyle = getComputedStyle(document.documentElement)
    return {
      currentFilter: current ? getComputedStyle(current).filter : '',
      otherFilter: other ? getComputedStyle(other).filter : '',
      otherOpacity: other ? Number(getComputedStyle(other).opacity) : 1,
      lyricFont: rootStyle.getPropertyValue('--lyric-font').trim(),
      sansFont: rootStyle.getPropertyValue('--sans').trim()
    }
  })
  assert.equal(lyricStyle.currentFilter, 'none')
  assert.match(lyricStyle.otherFilter, /blur\(/)
  assert.ok(lyricStyle.otherOpacity < 0.5)
  assert.equal(lyricStyle.lyricFont, lyricStyle.sansFont, 'system font should also drive player lyrics')
  assert.equal(errors.length, 0, `unexpected page errors: ${errors.join(' | ')}`)
  console.log(`PASS lyric clock: rate=${observedRate.toFixed(2)}x, lines advance, preview stable, immersive blur`)
} finally {
  await browser.close()
}
