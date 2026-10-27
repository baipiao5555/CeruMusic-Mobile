import { chromium } from 'playwright-core'

// 音源插件自动更新：用 page.route 假装有一个公网插件地址，
// 先装 1.0.0，把服务器内容换成 2.0.0，验证「检查全部更新」与「启动时自动更新」。
const plugin = (version) => `exports.manifest = {
  manifestVersion: 2,
  id: 'ceru.test.autoupdate',
  name: '自动更新测试音源',
  version: '${version}',
  engines: { hostApi: '^2.0.0', logicRuntime: 'ceru-js@1' },
  modules: { logic: { entry: 'logic.main' } },
  permissions: [{ key: 'network', name: 'network.request', reason: '测试' }],
  contributes: {
    providers: [{ id: 'autoupdate', name: '自动更新音源', protocols: ['https'], qualities: ['128k'] }]
  }
}
exports.activate = function (core) {
  core.providers.register('autoupdate', {
    tracks: {
      search: async function () {
        return { items: [{
          ref: { providerId: 'autoupdate', kind: 'track', id: 'a1', scope: 'provider' },
          title: '自动更新测试歌曲 v${version}',
          capabilities: ['play'],
          metadata: { artists: ['测试歌手'], durationMs: 60000, qualities: ['128k'] }
        }] }
      }
    }
  })
}`

const SOURCE_URL = 'https://plugins.example.com/ceru/autoupdate.js'
let served = plugin('1.0.0')

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--mute-audio']
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (error) => errors.push('[pageerror] ' + error.message))

await page.route('https://plugins.example.com/**', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    headers: { 'access-control-allow-origin': '*' },
    body: served
  })
)

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok })
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''))
}

const installedVersion = () =>
  page.evaluate(() => {
    const plugin = window.__ceruDebug.pluginState.plugins.find(
      (item) => item.manifestId === 'ceru.test.autoupdate'
    )
    return plugin ? plugin.version : ''
  })

await page.goto('http://127.0.0.1:5180/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)

// 1) 以「从链接安装」的方式装 1.0.0（会记录 sourceUrl）
await page.evaluate(
  async ({ code, url }) => {
    const debug = window.__ceruDebug
    // 先关掉示例插件干扰：只留我们要测的这个
    await debug.installPlugin(code, { enable: true, grantDeclared: true, sourceUrl: url })
  },
  { code: plugin('1.0.0'), url: SOURCE_URL }
)
check('插件以链接方式安装并记录更新地址', (await installedVersion()) === '1.0.0', await installedVersion())

// 2) 服务器发布 2.0.0，手动「检查全部更新」
served = plugin('2.0.0')
const forced = await page.evaluate(async () => {
  const results = await window.__ceruDebug.checkAllPluginUpdates({ force: true, quiet: true })
  return results.map((item) => ({ ...item }))
})
check(
  '检查全部更新能发现并替换新版本',
  forced.some((item) => item.updated && item.version === '2.0.0'),
  JSON.stringify(forced)
)
check('插件版本已变成 2.0.0', (await installedVersion()) === '2.0.0', await installedVersion())

// 3) 节流：刚检查过，非 force 的调用应直接跳过
const throttled = await page.evaluate(async () => {
  const results = await window.__ceruDebug.checkAllPluginUpdates({ quiet: true })
  return results.length
})
check('6 小时内不会重复检查', throttled === 0, `返回 ${throttled} 条`)

// 4) 启动时自动更新：把服务器内容换成 3.0.0，清掉节流时间戳后重载页面
served = plugin('3.0.0')
await page.evaluate(() => localStorage.removeItem('ceru.pluginUpdate.lastChecked'))
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(6000)
check(
  '应用启动时自动检查并更新插件',
  (await installedVersion()) === '3.0.0',
  await installedVersion()
)
await page.screenshot({ path: 'scripts/plugin-autoupdate.png' })

// 5) 关掉开关后启动不再自动更新
served = plugin('4.0.0')
await page.evaluate(() => {
  localStorage.removeItem('ceru.pluginUpdate.lastChecked')
  const raw = localStorage.getItem('ceru.settings.v1')
  const settings = raw ? JSON.parse(raw) : {}
  settings.pluginAutoUpdate = false
  localStorage.setItem('ceru.settings.v1', JSON.stringify(settings))
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(6000)
check(
  '关闭「插件自动更新」后启动不再更新',
  (await installedVersion()) === '3.0.0',
  await installedVersion()
)

const fatal = errors.filter((line) => !line.includes('sandboxed and lacks the'))
check('无页面报错', fatal.length === 0, fatal.slice(0, 3).join(' | '))

const passed = checks.filter((item) => item.ok).length
console.log(`\n${passed}/${checks.length} passed`)
await browser.close()
process.exit(passed === checks.length ? 0 : 1)
