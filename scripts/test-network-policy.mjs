import assert from 'node:assert/strict'
import { build } from 'esbuild'

const fixture = { native: false, calls: [], body: '{"ok":true}' }
globalThis.__networkPolicyFixture = fixture
const originalFetch = globalThis.fetch
const bundled = await build({
  entryPoints: ['src/core/plugin/network.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
  plugins: [{
    name: 'network-policy-fixture',
    setup(builder) {
      builder.onResolve({ filter: /^@capacitor\/core$/ }, () => ({ path: 'capacitor', namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
        contents: `
          export const Capacitor = { isNativePlatform: () => globalThis.__networkPolicyFixture.native }
          export const registerPlugin = () => ({
            request: async input => {
              globalThis.__networkPolicyFixture.calls.push(input)
              return { status: 200, headers: {}, body: globalThis.__networkPolicyFixture.body }
            }
          })
        `
      }))
    }
  }]
})
const { validateRemoteUrl, requestRemote } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
)

const publicUrls = [
  'https://example.com/music',
  'http://example.com./music',
  'https://sub.example.com:8443/',
  'http://8.8.8.8/',
  'http://0x08080808/',
  'http://1.1.1.1/',
  'http://172.15.0.1/',
  'http://172.32.0.1/',
  'http://100.63.0.1/',
  'http://100.128.0.1/',
  'https://[2606:4700:4700::1111]/',
  'http://[::ffff:8.8.8.8]/',
  'http://[0:0:0:0:0:ffff:808:808]/'
]
const blockedHosts = [
  'localhost', 'localhost.', 'LOCALHOST.', 'sub.localhost.', '%6cocalhost.',
  'local', 'router.local.', 'internal', 'router.internal.', 'home.arpa.', 'router.home.arpa.',
  '0.0.0.0', '127.0.0.1', '127.1', '127.0.0.1.', '2130706433', '0x7f000001', '0177.0.0.1',
  '10.0.0.1', '0x0a000001', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1',
  '100.64.0.1', '100.127.255.255', '192.0.2.1', '198.18.0.1', '198.19.0.1',
  '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255',
  '[::]', '[::1]', '[0:0:0:0:0:0:0:1]', '[fc00::1]', '[fd12::1]',
  '[fe80::1]', '[febf::1]', '[fec0::1]', '[feff::1]', '[ff02::1]',
  '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[0:0:0:0:0:ffff:7f00:1]',
  '[::ffff:0.0.0.0]', '[::ffff:10.0.0.1]', '[::ffff:169.254.169.254]',
  '[::ffff:172.16.0.1]', '[::ffff:192.168.1.1]', '[::ffff:100.64.0.1]',
  '[::ffff:198.18.0.1]', '[::ffff:224.0.0.1]'
]
const rejectedUrls = [
  ...blockedHosts.map(host => `http://${host}/private-probe`),
  'file:///private-probe', 'ftp://example.com/', 'ws://example.com/',
  'data:text/plain,probe', 'javascript:void(0)',
  'https://user@example.com/', 'https://user:password@example.com/',
  'example.com/no-protocol', 'http://[::ffff:999.0.0.1]/'
]

try {
  for (const raw of publicUrls) assert.equal(validateRemoteUrl(raw).href, new URL(raw).href)
  for (const raw of rejectedUrls) assert.throws(() => validateRemoteUrl(raw), Error, raw)
  console.log(`PASS public URLs (${publicUrls.length}) and rejected normalized URLs (${rejectedUrls.length})`)

  globalThis.fetch = async (url, options) => {
    fixture.calls.push({ url, ...options })
    return new Response('{"ok":true}', { status: 200 })
  }
  for (const native of [false, true]) {
    fixture.native = native
    fixture.calls.length = 0
    for (const url of rejectedUrls) await assert.rejects(requestRemote({ url }), Error, url)
    assert.equal(fixture.calls.length, 0, 'rejected URLs must not reach either transport')
    for (const url of publicUrls) {
      assert.deepEqual((await requestRemote({ url })).body, { ok: true })
      assert.equal(fixture.calls.at(-1).url, new URL(url).href)
    }
    console.log(`PASS validation precedes ${native ? 'native' : 'web'} transport without changing public URLs`)
  }

  const bytes = [0, 255, 128, 10, 65]
  fixture.native = false
  globalThis.fetch = async () => new Response(Uint8Array.from(bytes))
  const binaryRequest = { url: publicUrls[0], responseType: 'arraybuffer' }
  assert.deepEqual(Array.from((await requestRemote(binaryRequest)).body), bytes)
  fixture.native = true
  fixture.body = Buffer.from(bytes).toString('base64')
  assert.deepEqual(Array.from((await requestRemote(binaryRequest)).body), bytes)
  assert.equal(fixture.calls.at(-1).responseType, 'arraybuffer')
  console.log('PASS web binary response and native base64 bridge preserve every byte')

  fixture.native = false
  for (const host of blockedHosts) {
    fixture.calls.length = 0
    globalThis.fetch = async (url) => {
      fixture.calls.push(url)
      return new Response(null, { status: 302, headers: { Location: `http://${host}/private-probe` } })
    }
    await assert.rejects(requestRemote({ url: 'https://example.com/redirect' }))
    assert.equal(fixture.calls.length, 1, `redirect must stop before requesting ${host}`)
  }
  console.log('PASS redirects cannot reach blocked literal or hostname forms')
} finally {
  globalThis.fetch = originalFetch
  delete globalThis.__networkPolicyFixture
}
