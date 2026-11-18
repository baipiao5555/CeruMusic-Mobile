import { chromium } from 'playwright-core'

// 本地文件安装的音源：验证「手动绑定更新地址」「manifest 自带更新地址」
// 「检查全部更新」以及插件页详情里的地址编辑入口。
const plugin = (version, options = {}) => `exports.manifest = {
  manifestVersion: 2,
  id: '${options.id ?? 'ceru.test.localupdate'}',
  name: '${options.name ?? '本地更新测试音源'}',
  version: '${version}',
  ${options.homepage ? `homepage: '${options.homepage}',` : ''}
  engines: { hostApi: '^2.0.0', logicRuntime: 'ceru-js@1' },
  modules: { logic: { entry: 'logic.main' } },
  permissions: [{ key: 'network', name: 'network.request', reason: '测试' }],
  contributes: {
    providers: [{ id: 'localupdate', name: '本地更新音源', protocols: ['https'], qualities: ['128k'] }]
  }
}
exports.activate = function (core) {
  core.providers.register('localupdate', {
    tracks: {
      search: async function () {
        return { items: [{
          ref: { providerId: 'localupdate', kind: 'track', id: 'a1', scope: 'provider' },
          title: '本地更新测试歌曲 v${version}',
          capabilities: ['play'],
          metadata: { artists: ['测试歌手'], durationMs: 60000, qualities: ['128k'] }
        }] }
      }
    }
  })
}`

const SOURCE_URL = 'https://plugins.example.com/ceru/local.js'
const META_URL = 'https://plugins.example.com/ceru/meta.js'
const OTHER_URL = 'https://plugins.example.com/ceru/other.js'
const APP_URL = process.env.CERU_TEST_URL ?? 'http://127.0.0.1:5185'
const served = new Map([
  [SOURCE_URL, plugin('1.0.0')],
  [META_URL, plugin('1.0.0', { id: 'ceru.test.metaupdate', name: '本地元数据更新音源', homepage: META_URL })],
  [OTHER_URL, plugin('9.0.0', { id: 'ceru.test.other', name: '其它音源' })]
])

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--mute-audio']
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (error) => errors.push('[pageerror] ' + error.message))

await page.route('https://plugins.example.com/**', (route) => {
  const body = served.get(route.request().url())
  return route.fulfill({
    status: body ? 200 : 404,
    contentType: 'application/javascript',
    headers: { 'access-control-allow-origin': '*' },
    body: body ?? 'not found'
  })
})

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok })
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''))
}

const descriptor = (manifestId) =>
  page.evaluate((id) => {
    const item = window.__ceruDebug.pluginState.plugins.find((plugin) => plugin.manifestId === id)
    return item
      ? {
          pluginId: item.pluginId,
          version: item.version,
          updateUrl: item.updateUrl ?? '',
          sourceUrl: item.sourceUrl ?? ''
        }
      : null
  }, manifestId)

await page.goto(APP_URL + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

// 1) 模拟「从文件安装」：没有 sourceUrl，也没有 manifest 更新地址。
await page.evaluate(async (code) => {
  await window.__ceruDebug.installPlugin(code, { enable: true, grantDeclared: true })
}, plugin('1.0.0'))
let local = await descriptor('ceru.test.localupdate')
check('本地文件安装后没有更新地址', local?.version === '1.0.0' && local.updateUrl === '', JSON.stringify(local))

// 2) 手动绑定与已安装音源一致的 .js 地址。
local = await descriptor('ceru.test.localupdate')
await page.evaluate(
  async ({ id, url }) => window.__ceruDebug.setPluginUpdateUrl(id, url),
  { id: local.pluginId, url: SOURCE_URL }
)
local = await descriptor('ceru.test.localupdate')
check('手动绑定更新地址成功', local?.updateUrl === SOURCE_URL && local.sourceUrl === '', JSON.stringify(local))

// 3) 服务器发布 2.0.0，自动更新应替换本地文件插件。
served.set(SOURCE_URL, plugin('2.0.0'))
const forced = await page.evaluate(async () => {
  const results = await window.__ceruDebug.checkAllPluginUpdates({ force: true, quiet: true })
  return results.map((item) => ({ ...item }))
})
check(
  '本地文件插件能被自动更新',
  forced.some((item) => item.pluginId === local.pluginId && item.updated && item.version === '2.0.0'),
  JSON.stringify(forced)
)
local = await descriptor('ceru.test.localupdate')
check(
  '更新后版本为 2.0.0 且仍保留更新地址',
  local?.version === '2.0.0' && local.updateUrl === SOURCE_URL && local.sourceUrl === '',
  JSON.stringify(local)
)

// 4) 地址返回不同音源时必须拒绝绑定，原地址不被覆盖。
const mismatch = await page.evaluate(async ({ id, url }) => {
  try {
    await window.__ceruDebug.setPluginUpdateUrl(id, url)
    return ''
  } catch (error) {
    return error?.message ?? String(error)
  }
}, { id: local.pluginId, url: OTHER_URL })
local = await descriptor('ceru.test.localupdate')
check('不同音源的更新地址会被拒绝', /不一致/.test(mismatch), mismatch)
check('拒绝后原更新地址保持不变', local?.updateUrl === SOURCE_URL, JSON.stringify(local))

// 5) manifest 的 homepage 直接指向 .js 时，本地文件安装后应具备自动更新能力。
await page.evaluate(async (code) => {
  await window.__ceruDebug.installPlugin(code, { enable: true, grantDeclared: true })
}, plugin('1.0.0', { id: 'ceru.test.metaupdate', name: '本地元数据更新音源', homepage: META_URL }))
const meta = await descriptor('ceru.test.metaupdate')
check('manifest 的 .js homepage 会被识别为更新地址', meta?.updateUrl === META_URL && meta.sourceUrl === '', JSON.stringify(meta))

served.set(META_URL, plugin('1.1.0', { id: 'ceru.test.metaupdate', name: '本地元数据更新音源', homepage: META_URL }))
await page.evaluate(async () => window.__ceruDebug.checkAllPluginUpdates({ force: true, quiet: true }))
const metaUpdated = await descriptor('ceru.test.metaupdate')
check('manifest 更新地址可完成自动更新', metaUpdated?.version === '1.1.0', JSON.stringify(metaUpdated))

// 6) 刷新后更新地址仍保存在本地，且插件页能显示并进入修改状态。
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
local = await descriptor('ceru.test.localupdate')
check('刷新后更新地址仍然保留', local?.updateUrl === SOURCE_URL, JSON.stringify(local))

await page.goto(APP_URL + '/#/plugins', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
console.log('plugins page:', page.url(), JSON.stringify(await page.locator('.pitem').allInnerTexts()))
await page.screenshot({ path: 'scripts/plugin-autoupdate-local-page.png' })
const item = page.locator('.pitem', { hasText: '本地更新测试音源' }).first()
await item.locator('.pchev').click()
await page.waitForTimeout(200)
check('插件详情显示自动更新地址', (await item.locator('.update-url-note').count()) === 1)
await item.locator('.update-url-edit').click()
const input = item.locator('.update-url-row input')
check(
  '点击修改后显示带原地址的输入框',
  (await input.count()) === 1 && (await input.inputValue()) === SOURCE_URL,
  await input.count() ? await input.inputValue() : '缺少输入框'
)
await page.screenshot({ path: 'scripts/plugin-autoupdate-local.png' })

const fatal = errors.filter((line) => !line.includes('sandboxed and lacks the'))
check('无页面报错', fatal.length === 0, fatal.slice(0, 3).join(' | '))

const passed = checks.filter((checkItem) => checkItem.ok).length
console.log(`\n${passed}/${checks.length} passed`)
await browser.close()
process.exit(passed === checks.length ? 0 : 1)
