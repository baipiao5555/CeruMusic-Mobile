import { chromium } from 'playwright-core'

const plugin = `exports.manifest = {
  manifestVersion: 2,
  id: 'ceru.mobile.nettest',
  name: '网络测试',
  version: '1.0.0',
  engines: { hostApi: '^2.0.0', logicRuntime: 'ceru-js@1' },
  modules: { logic: { entry: 'logic.main' } },
  permissions: [{ key: 'network', name: 'network.request', reason: '测试公网请求' }],
  contributes: { providers: [{ id: 'nettest', name: '网络测试', protocols: ['https'], qualities: ['128k'] }] }
}
exports.activate = async function (core) {
  const http = core.http.create({})
  core.providers.register('nettest', {
    tracks: {
      search: async function (request, operation) {
        if (request.query === 'private') {
          try {
            await http.get('http://127.0.0.1:5181/', { operation })
            return { items: [{ ref: { providerId: 'nettest', kind: 'track', id: 'p', scope: 'provider' }, title: 'BLOCKED_FAILED', capabilities: ['play'], metadata: { artists: ['test'] } }] }
          } catch (error) {
            return { items: [{ ref: { providerId: 'nettest', kind: 'track', id: 'p', scope: 'provider' }, title: 'blocked:' + String(error && error.message || error), capabilities: ['play'], metadata: { artists: ['test'] } }] }
          }
        }
        try {
          const data = await http.get('https://api.github.com/zen', { operation })
          return { items: [{ ref: { providerId: 'nettest', kind: 'track', id: 'pub', scope: 'provider' }, title: 'public:' + String(data).slice(0, 40), capabilities: ['play'], metadata: { artists: ['test'] } }] }
        } catch (error) {
          return { items: [{ ref: { providerId: 'nettest', kind: 'track', id: 'pub', scope: 'provider' }, title: 'error:' + String(error && error.message) + '|' + String(error && error.stack).slice(0, 500), capabilities: ['play'], metadata: { artists: ['test'] } }] }
        }
      }
    }
  })
}`

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true
})
const page = await browser.newPage()
page.on('console', (message) => console.log('[' + message.type() + ']', message.text().slice(0, 300)))
page.on('pageerror', (error) => console.log('[pageerror]', error.message))
await page.goto(process.env.CERU_URL || 'http://127.0.0.1:5181/', { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
const out = await page.evaluate(async (source) => {
  const debug = window.__ceruDebug
  try {
    await debug.installPlugin(source, { enable: true, grantDeclared: true })
    const provider = debug.allProviders().find((item) => item.providerId === 'nettest')
    const publicResult = await debug.invokeProvider(provider, 'tracks.search', [
      { query: 'public', kinds: ['track'], filters: {}, limit: 5 }
    ])
    const privateResult = await debug.invokeProvider(provider, 'tracks.search', [
      { query: 'private', kinds: ['track'], filters: {}, limit: 5 }
    ])
    return {
      publicTitle: publicResult.items[0].title,
      privateTitle: privateResult.items[0].title
    }
  } catch (error) {
    return { error: String((error && error.message) || error), stack: error && error.stack }
  }
}, plugin)
console.log(JSON.stringify(out, null, 2))
await browser.close()
