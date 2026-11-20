import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright-core'

/**
 * Tablet / phone layout regression check.
 *
 * Requires a running dev server (Vite) because the fixture audio source is
 * installed through window.__ceruDebug, which only exists in DEV builds.
 *
 *   npx vite --port 5199 --strictPort
 *   $env:CERU_URL='http://127.0.0.1:5199'; node scripts/test-tablet-layout.mjs
 */
const base = process.env.CERU_URL || 'http://127.0.0.1:5180'
const chromePath =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const outDir =
  process.env.CERU_TABLET_OUT ||
  'D:/LX/CeruMusic-Mobile-酷狗酷我与新增平台-2026-11-17/evidence/tablet-v2625'

const sizes = [
  { name: 'phone-390x844', width: 390, height: 844, tablet: false },
  { name: 'tablet-768x1024', width: 768, height: 1024, tablet: true, landscape: false },
  { name: 'tablet-1024x768', width: 1024, height: 768, tablet: true, landscape: true },
  { name: 'tablet-1280x800', width: 1280, height: 800, tablet: true, landscape: true }
]

const checks = []
const failures = []
const screenshots = []
const consoleErrors = []
const pageErrors = []

function check(name, pass, detail) {
  checks.push({ name, pass, detail: detail ?? null })
  if (pass) console.log('PASS', name)
  else {
    console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail))
    failures.push({ name, detail: detail ?? null })
  }
}

function gitValue(args) {
  try {
    return execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

const fixturePlugin = String.raw`
exports.manifest = {
  manifestVersion: 2,
  id: 'qa.tablet.layout',
  name: '平板布局测试音源',
  version: '1.0.0',
  engines: { hostApi: '^2.0.0', logicRuntime: 'ceru-js@1' },
  modules: { logic: { entry: 'logic.main' } },
  permissions: [],
  contributes: {
    providers: [{
      id: 'tabletfixture',
      name: '平板测试音源',
      protocols: ['https'],
      qualities: ['128k', '320k']
    }]
  }
}
exports.activate = function (core) {
  var art = '/default-cover.png'
  var owner = core.plugin.id
  function chart(index) {
    return {
      ref: { providerId: 'tabletfixture', kind: 'chart', id: 'chart-' + index, pluginId: owner },
      title: '氛围榜单 ' + index,
      subtitle: '用于平板布局检查',
      capabilities: ['play'],
      chart: { updateFrequency: '每周更新', artworkUrl: art }
    }
  }
  function playlist(index) {
    return {
      ref: { providerId: 'tabletfixture', kind: 'playlist', id: 'playlist-' + index, pluginId: owner },
      title: '精选歌单 ' + index,
      subtitle: '用于平板布局检查',
      capabilities: ['play'],
      playlist: { trackCount: 12 + index, author: '平板测试音源', artworkUrl: art }
    }
  }
  function track(index) {
    return {
      ref: { providerId: 'tabletfixture', kind: 'track', id: 'track-' + index, scope: 'provider' },
      title: '城市晨雾 ' + index,
      capabilities: ['play'],
      metadata: {
        artists: ['测试歌手 ' + (index % 3 + 1)],
        album: '平板布局专辑',
        durationMs: 180000 + index * 1000,
        qualities: ['128k', '320k'],
        artworkUrl: art
      }
    }
  }
  core.providers.register('tabletfixture', {
    charts: {
      list: async function () {
        var items = []
        for (var i = 1; i <= 8; i += 1) items.push(chart(i))
        return { items: items }
      },
      getTracks: async function () {
        var items = []
        for (var i = 1; i <= 6; i += 1) items.push(track(i))
        return { items: items }
      }
    },
    playlists: {
      categories: async function () {
        return {
          items: [{
            title: '推荐',
            capabilities: [],
            ref: { providerId: 'tabletfixture', kind: 'playlist-category', id: 'all', pluginId: owner }
          }]
        }
      },
      list: async function () {
        var items = []
        for (var i = 1; i <= 12; i += 1) items.push(playlist(i))
        return { items: items }
      }
    },
    tracks: {
      search: async function () {
        var items = []
        for (var i = 1; i <= 10; i += 1) items.push(track(i))
        return { items: items }
      },
      resolve: async function () {
        return { ok: true, url: 'https://fixture.invalid/tablet-layout.wav' }
      }
    }
  })
}
`

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']
})

fs.mkdirSync(outDir, { recursive: true })

function safeName(value) {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '')
}

const report = {
  generatedAt: new Date().toISOString(),
  base,
  outDir,
  branch: gitValue(['branch', '--show-current']),
  head: gitValue(['rev-parse', '--short', 'HEAD']),
  sizes: sizes.map(({ name, width, height, tablet, landscape }) => ({
    name,
    width,
    height,
    tablet,
    landscape: Boolean(landscape)
  })),
  checks,
  failures,
  screenshots,
  consoleErrors,
  pageErrors
}

let page

async function screenshot(size, key) {
  const file = path.join(outDir, `${size.name}-${safeName(key)}.png`)
  await page.screenshot({ path: file })
  screenshots.push(file)
  return file
}

async function readMetrics() {
  return page.evaluate(() => {
    const rectOf = (element) => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      }
    }
    const styleOf = (selector) => {
      const element = document.querySelector(selector)
      return element ? getComputedStyle(element) : null
    }
    const gridColumns = (selector) => {
      const value = styleOf(selector)?.gridTemplateColumns
      if (!value || value === 'none') return null
      return value.split(' ').filter(Boolean).length
    }
    const shell = document.querySelector('.app-shell')
    const dock = document.querySelector('.dock')
    const tabbar = document.querySelector('.tabbar')
    const activeScreen = document.querySelector('.screen:not(.tab-screen-hidden)')
    const activeScroll = activeScreen?.querySelector('.scroll')
    const activeScrollStyle = activeScroll ? getComputedStyle(activeScroll) : null
    const activeGridColumns = activeScrollStyle?.gridTemplateColumns &&
      activeScrollStyle.gridTemplateColumns !== 'none'
      ? activeScrollStyle.gridTemplateColumns.split(' ').filter(Boolean).length
      : null
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      shell: rectOf(shell),
      shellRadius: shell ? getComputedStyle(shell).borderTopLeftRadius : null,
      shellMaxWidth: shell ? getComputedStyle(shell).maxWidth : null,
      dock: rectOf(dock),
      tabbar: rectOf(tabbar),
      tabCount: document.querySelectorAll('.tabbar .tab').length,
      tabDirection: styleOf('.tabbar .tab')?.flexDirection ?? null,
      navLabel: tabbar?.getAttribute('aria-label') ?? null,
      tabLabels: [...document.querySelectorAll('.tabbar .tab')].map((tab) => tab.textContent?.trim() ?? ''),
      settingsGridColumns: gridColumns('#settings-appearance')
        ?? (activeScrollStyle?.display === 'grid' ? activeGridColumns : null),
      settingsScrollDisplay: activeScrollStyle?.display ?? null,
      settingsJumpBottom: rectOf(activeScreen?.querySelector('.jump'))?.bottom ?? null,
      settingsFirstSectionTop: rectOf(activeScreen?.querySelector('.scroll > section'))?.top ?? null,
      playlistGridColumns: gridColumns('.p-grid'),
      catalogGridColumns: gridColumns('.catalog-grid'),
      cloudGridColumns: gridColumns('.p-list'),
      playerColumns: gridColumns('.p-core'),
      searchHeader: rectOf(document.querySelector('.search-header')),
      browseHeroCover: rectOf(document.querySelector('.browse-hero > img')),
      activeScreen: activeScreen?.className ?? null
    }
  })
}

function noOverflow(size, metrics, label) {
  check(
    `${size.name} ${label} document has no horizontal overflow`,
    metrics.docScrollWidth <= size.width + 1 && metrics.bodyScrollWidth <= size.width + 1,
    {
      docScrollWidth: metrics.docScrollWidth,
      bodyScrollWidth: metrics.bodyScrollWidth,
      viewport: size.width
    }
  )
  check(
    `${size.name} ${label} app shell stays inside viewport`,
    Boolean(metrics.shell) &&
      metrics.shell.left >= -0.5 &&
      metrics.shell.right <= size.width + 0.5,
    metrics.shell
  )
}

function dockChecks(size, metrics, label) {
  if (!metrics.dock) return
  if (size.tablet) {
    check(
      `${size.name} ${label} dock is a centered floating bar`,
      metrics.dock.width <= metrics.shell.width - 40 &&
        metrics.dock.left >= metrics.shell.left + 12 &&
        metrics.dock.right <= metrics.shell.right - 12,
      { dock: metrics.dock, shell: metrics.shell }
    )
    check(
      `${size.name} ${label} bottom tabs are compact horizontal items`,
      metrics.tabCount === 3 && metrics.tabDirection === 'row',
      { tabCount: metrics.tabCount, tabDirection: metrics.tabDirection }
    )
  } else {
    check(
      `${size.name} ${label} phone dock still spans the shell`,
      metrics.dock.width >= metrics.shell.width - 1 &&
        Math.abs(metrics.dock.left - metrics.shell.left) <= 1,
      { dock: metrics.dock, shell: metrics.shell }
    )
    check(
      `${size.name} ${label} phone bottom tabs keep the column layout`,
      metrics.tabCount === 3 && metrics.tabDirection === 'column',
      { tabCount: metrics.tabCount, tabDirection: metrics.tabDirection }
    )
  }
}

async function openSearchResults() {
  const input = page.locator('.search-header .searchfield input')
  await input.fill('城市')
  await input.press('Enter')
  await page.waitForSelector('.search-page:not(.tab-screen-hidden) .songrow', { timeout: 15000 })
  await page.waitForTimeout(400)
}

async function openPlayer(size) {
  const demo = await page.evaluate(() => {
    const provider = window.__ceruDebug
      .allProviders()
      .find((item) => item.providerId === 'demo')
    return provider ? { pluginId: provider.pluginId } : null
  })
  if (demo) {
    const query = new URLSearchParams({
      provider: 'demo',
      plugin: demo.pluginId,
      kind: 'chart',
      id: 'demo-top',
      title: '示例热歌榜'
    })
    await page.goto(`${base}/#/browse?${query.toString()}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.browse-page:not(.tab-screen-hidden) .songrow', { timeout: 15000 })
    await page.locator('.browse-page:not(.tab-screen-hidden) .songrow').first().click()
    await page.waitForTimeout(1200)
    if (await page.locator('.mini').count()) {
      await page.locator('.mini-track').click()
    } else {
      await page.goto(`${base}/#/player`, { waitUntil: 'networkidle' })
    }
  } else {
    await page.goto(`${base}/#/player`, { waitUntil: 'networkidle' })
  }
  await page.waitForTimeout(600)
  const playerVisible = await page.locator('.p-core').count()
  check(`${size.name} player page opened with a track`, playerVisible > 0, {
    demoProvider: Boolean(demo)
  })
}

async function seedFixture() {
  await page.evaluate(async (source) => {
    const debug = window.__ceruDebug
    if (!debug.allProviders().some((provider) => provider.providerId === 'tabletfixture')) {
      await debug.installPlugin(source, { enable: true, grantDeclared: true })
    }
  }, fixturePlugin)
  await page.waitForFunction(
    () => window.__ceruDebug?.allProviders().some((provider) => provider.providerId === 'tabletfixture'),
    null,
    { timeout: 20000 }
  )
  const seeded = await page.evaluate(async () => {
    const debug = window.__ceruDebug
    const provider = debug.allProviders().find((item) => item.providerId === 'tabletfixture')
    debug.selectProvider(provider.providerId, provider.pluginId)
    const result = await debug.invokeProvider(provider, 'tracks.search', ['城市'])
    const tracks = result.items.map((item) => debug.player.toTrack(item, provider))
    const library = await import('/src/core/library.ts')
    if (!library.libraryState.playlists.length) {
      for (let index = 1; index <= 4; index += 1) {
        library.createPlaylistWithTracks(`平板歌单 ${index}`, tracks.slice(index - 1, index + 2))
      }
    }
    for (const track of tracks.slice(0, 4)) {
      if (!library.isFavorite(track)) library.toggleFavorite(track)
    }
    return {
      tracks: tracks.length,
      playlists: library.libraryState.playlists.length,
      favorites: library.libraryState.favorites.length
    }
  })
  check('fixture library seeded (tracks/playlists/favorites)', seeded.playlists >= 4 && seeded.favorites >= 4, seeded)
}

async function runSize(size) {
  await page.setViewportSize({ width: size.width, height: size.height })

  // 1. Discover
  await page.goto(`${base}/#/`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__ceruDebug && !window.__ceruDebug.pluginState.loading)
  await page.waitForTimeout(1200)
  let metrics = await readMetrics()
  const discoverShot = await screenshot(size, '01-discover')
  noOverflow(size, metrics, 'discover')
  check(`${size.name} discover shortcut cards are all visible`, (await page.locator('.home-shortcuts button').count()) === 4, discoverShot)
  check(`${size.name} discover search launch is visible`, await page.locator('.home-search .search-launch').isVisible())
  check(
    `${size.name} bottom navigation keeps its accessibility labels`,
    metrics.navLabel === '主导航' && metrics.tabLabels.join(',') === '音乐,歌单,我的',
    { navLabel: metrics.navLabel, tabLabels: metrics.tabLabels }
  )
  dockChecks(size, metrics, 'discover')
  if (size.tablet) {
    check(`${size.name} discover content is not edge-to-edge`, metrics.shell.left >= 12 && size.width - metrics.shell.right >= 12, metrics.shell)
  } else {
    check(`${size.name} phone shell keeps the 390px full-bleed layout`, Math.abs(metrics.shell.width - size.width) <= 1 && Math.abs(metrics.shell.left) <= 1 && metrics.shellRadius === '0px', metrics.shell)
  }

  // 2. Search results
  await page.goto(`${base}/#/search`, { waitUntil: 'networkidle' })
  await openSearchResults()
  metrics = await readMetrics()
  await screenshot(size, '02-search-results')
  noOverflow(size, metrics, 'search')
  const searchRows = page.locator('.search-page:not(.tab-screen-hidden) .songrow')
  check(`${size.name} search result rows rendered`, (await searchRows.count()) >= 5, await searchRows.count())
  check(`${size.name} search input and submit button are visible`, await page.locator('.searchfield input').isVisible() && await page.locator('.findgo').isVisible())
  if (size.tablet) {
    check(`${size.name} search header is width-capped`, metrics.searchHeader.width <= 900, metrics.searchHeader)
  }
  dockChecks(size, metrics, 'search')

  // 3. Playlists
  await page.goto(`${base}/#/playlists`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  metrics = await readMetrics()
  await screenshot(size, '03-playlists')
  noOverflow(size, metrics, 'playlists')
  check(`${size.name} playlist collection tabs visible`, (await page.locator('.collection-tabs button').count()) === 3)
  check(
    `${size.name} playlist grid uses ${size.tablet ? (size.width >= 1000 ? '4' : '3') : '2'} columns`,
    metrics.playlistGridColumns === (size.tablet ? (size.width >= 1000 ? 4 : 3) : 2),
    { columns: metrics.playlistGridColumns }
  )
  dockChecks(size, metrics, 'playlists')

  // 4. Library
  await page.goto(`${base}/#/library`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  metrics = await readMetrics()
  await screenshot(size, '04-library')
  noOverflow(size, metrics, 'library')
  check(`${size.name} library shortcuts visible`, (await page.locator('.library-shortcuts button').count()) === 4)
  check(
    `${size.name} library shortcut group keeps its accessibility label`,
    (await page.locator('.library-shortcuts').getAttribute('aria-label')) === '我的音乐快捷入口'
  )
  check(`${size.name} library tools are kept`, (await page.locator('.tool-list button').count()) === 8, await page.locator('.tool-list button').count())
  check(`${size.name} library playlist rows visible`, (await page.locator('.asset-list .asset-row').count()) >= 4)
  dockChecks(size, metrics, 'library')

  // 5. Settings
  await page.goto(`${base}/#/settings`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  metrics = await readMetrics()
  await screenshot(size, '05-settings')
  noOverflow(size, metrics, 'settings')
  check(`${size.name} settings rows visible`, (await page.locator('.settingrow').count()) >= 20, await page.locator('.settingrow').count())
  check(
    `${size.name} settings uses ${size.tablet ? 'two columns' : 'one column'}`,
    size.tablet ? metrics.settingsGridColumns === 2 : metrics.settingsScrollDisplay !== 'grid',
    { columns: metrics.settingsGridColumns, display: metrics.settingsScrollDisplay }
  )
  if (size.tablet) {
    check(
      `${size.name} settings section nav does not overlap the first section`,
      metrics.settingsFirstSectionTop >= metrics.settingsJumpBottom - 1,
      { jumpBottom: metrics.settingsJumpBottom, firstSectionTop: metrics.settingsFirstSectionTop }
    )
  }
  dockChecks(size, metrics, 'settings')

  // 6. Browse catalog grid
  await page.goto(`${base}/#/browse`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  metrics = await readMetrics()
  await screenshot(size, '06-browse-catalog')
  noOverflow(size, metrics, 'browse')
  check(`${size.name} browse catalog cards rendered`, (await page.locator('.catalog-grid .mediacard').count()) >= 6)
  check(
    `${size.name} browse catalog uses ${size.tablet ? (size.width >= 1000 ? '4' : '3') : '2'} columns`,
    metrics.catalogGridColumns === (size.tablet ? (size.width >= 1000 ? 4 : 3) : 2),
    { columns: metrics.catalogGridColumns }
  )
  dockChecks(size, metrics, 'browse')

  const fixture = await page.evaluate(() => {
    const provider = window.__ceruDebug
      .allProviders()
      .find((item) => item.providerId === 'tabletfixture')
    return provider ? { pluginId: provider.pluginId } : null
  })
  if (fixture) {
    const query = new URLSearchParams({
      provider: 'tabletfixture',
      plugin: fixture.pluginId,
      kind: 'chart',
      id: 'chart-1',
      title: '氛围榜单 1'
    })
    await page.goto(`${base}/#/browse?${query.toString()}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.browse-hero', { timeout: 15000 })
    await page.waitForTimeout(500)
    metrics = await readMetrics()
    await screenshot(size, '06b-browse-detail')
    noOverflow(size, metrics, 'browse-detail')
    check(`${size.name} browse detail play-all control visible`, await page.locator('.browse-play-all').isVisible())
    check(
      `${size.name} browse detail cover uses the expected size`,
      metrics.browseHeroCover.width === (size.tablet ? 168 : 126),
      metrics.browseHeroCover
    )
    dockChecks(size, metrics, 'browse-detail')
  }

  // 7. Cloud playlists (logged-out state, then a synthetic populated state)
  await page.goto(`${base}/#/cloud`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  metrics = await readMetrics()
  await screenshot(size, '07-cloud-logged-out')
  noOverflow(size, metrics, 'cloud-logged-out')
  check(`${size.name} cloud login action is visible`, await page.locator('.empty.login .btn-primary').isVisible())

  await page.evaluate(async () => {
    const auth = await import('/src/core/auth.ts')
    const cloud = await import('/src/core/cloud.ts')
    auth.authState.authenticated = true
    auth.authState.user = {
      sub: 'tablet-fixture',
      name: '平板测试账号',
      email: 'tablet@example.invalid'
    }
    cloud.cloudState.playlists = Array.from({ length: 8 }, (_, index) => ({
      id: `fixture-${index + 1}`,
      name: `云端歌单 ${index + 1}`,
      describe: '用于平板布局检查的合成数据',
      cover: '/default-cover.png',
      updatedAt: '2026-11-17T10:00:00.000Z'
    }))
  })
  await page.waitForTimeout(700)
  await page.evaluate(() => {
    const setup = document.querySelector('.screen')?.__vueParentComponent?.setupState
    if (setup && 'error' in setup) {
      try {
        setup.error = ''
      } catch {}
    }
  })
  await page.waitForTimeout(150)
  check(`${size.name} synthetic cloud rows rendered`, (await page.locator('.p-item').count()) === 8, await page.locator('.p-item').count())
  metrics = await readMetrics()
  await screenshot(size, '08-cloud-populated')
  noOverflow(size, metrics, 'cloud-populated')
  check(
    `${size.name} cloud list uses ${size.tablet ? 'two' : 'one'} column(s)`,
    size.tablet ? metrics.cloudGridColumns === 2 : metrics.cloudGridColumns === null,
    { columns: metrics.cloudGridColumns }
  )

  await page.evaluate(async () => {
    const auth = await import('/src/core/auth.ts')
    const cloud = await import('/src/core/cloud.ts')
    auth.authState.authenticated = false
    auth.authState.user = null
    cloud.cloudState.playlists = []
  })
  await page.waitForTimeout(300)

  // 8. Player + lyrics
  await openPlayer(size)
  await page.waitForSelector('.p-core', { timeout: 15000 })
  metrics = await readMetrics()
  await screenshot(size, '09-player')
  noOverflow(size, metrics, 'player')
  check(`${size.name} player transport controls visible`, await page.locator('.p-ctrl .p-play').isVisible() && await page.locator('.p-art').isVisible())
  check(
    `${size.name} player transport keeps its accessibility label`,
    (await page.locator('.p-ctrl .p-play').getAttribute('aria-label')) === '播放或暂停'
  )
  check(`${size.name} player tool row kept`, (await page.locator('.p-tools .p-tool').count()) >= 4, await page.locator('.p-tools .p-tool').count())
  const expectedPlayerColumns = size.tablet && size.landscape ? 2 : 1
  check(
    `${size.name} player uses ${expectedPlayerColumns === 2 ? 'cover/lyrics side-by-side' : 'stacked'} layout`,
    metrics.playerColumns === expectedPlayerColumns,
    { columns: metrics.playerColumns }
  )

  const lyricButton = page.locator('.p-tabs button', { hasText: '歌词' })
  if (await lyricButton.count()) {
    await lyricButton.first().click()
    await page.waitForTimeout(700)
    await screenshot(size, '10-player-lyrics')
    const lyricLines = await page.locator('.ly-line').count()
    check(`${size.name} lyric view shows lines`, lyricLines > 0, lyricLines)
    check(`${size.name} lyric footer controls visible`, await page.locator('.ly-foot .ly-ctrl .p-play').isVisible())
    noOverflow(size, await readMetrics(), 'lyrics')
  }
}

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference'
  })
  await context.addInitScript(() => {
    if(window.top!==window)return
    try {
      localStorage.setItem('ceru.update.v1', JSON.stringify({ autoCheck: false }))
      localStorage.setItem(
        'ceru.settings.v1',
        JSON.stringify({ theme: 'light', version: 2, logsEnabled: false, pluginAutoUpdate: false })
      )
    } catch {}
  })
  page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('https://**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{}}' })
  )

  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__ceruDebug && !window.__ceruDebug.pluginState.loading, null, {
    timeout: 20000
  })
  await seedFixture()
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__ceruDebug && !window.__ceruDebug.pluginState.loading, null, {
    timeout: 20000
  })

  for (const size of sizes) {
    console.log(`\n=== ${size.name} ===`)
    await runSize(size)
  }

  const extraRoutes = [
    '/daily',
    '/downloads',
    '/logs',
    '/plugins',
    '/local',
    '/theme-background',
    '/update',
    '/sync-services'
  ]
  for (const size of sizes.filter((item) => item.tablet)) {
    await page.setViewportSize({ width: size.width, height: size.height })
    for (const route of extraRoutes) {
      try {
        await page.goto(`${base}/#${route}`, { waitUntil: 'networkidle' })
        await page.waitForTimeout(400)
        const metrics = await readMetrics()
        check(
          `${size.name} unadapted route ${route} has no horizontal overflow`,
          metrics.docScrollWidth <= size.width + 1 && metrics.bodyScrollWidth <= size.width + 1,
          { docScrollWidth: metrics.docScrollWidth, viewport: size.width }
        )
      } catch (error) {
        check(`${size.name} unadapted route ${route} loaded`, false, String(error))
      }
    }
  }
} catch (error) {
  pageErrors.push(error?.stack || String(error))
  console.error('FATAL', error)
  failures.push({ name: 'fatal', detail: String(error?.stack || error) })
} finally {
  report.checks = checks
  report.failures = failures
  report.screenshots = screenshots
  report.consoleErrors = [...new Set(consoleErrors)]
  report.pageErrors = [...new Set(pageErrors)]
  report.passed = checks.filter((item) => item.pass).length
  report.failed = failures.length
  try {
    report.browser = browser.version()
  } catch {
    report.browser = ''
  }
  fs.writeFileSync(path.join(outDir, 'tablet-layout-report.json'), JSON.stringify(report, null, 2))
  console.log(
    `\n${report.passed} checks passed, ${report.failed} failed. Report: ${path.join(outDir, 'tablet-layout-report.json')}`
  )
  await browser.close()
  process.exitCode = failures.length ? 1 : 0
}
