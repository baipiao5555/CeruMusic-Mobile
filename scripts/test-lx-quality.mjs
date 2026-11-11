import assert from 'node:assert/strict'
import { build } from 'esbuild'

const fixture = {
  calls: [],
  sources: { kw: { type: 'music', actions: ['musicUrl', 'lyric', 'pic'], qualitys: ['128k', '320k', 'flac'] } },
  response: { status: 200, body: { TOTAL: '1', abslist: [{
    MUSICRID: 'MUSIC_123', SONGNAME: 'Fixture', DURATION: '60',
    N_MINFO: 'level:a,bitrate:128,format:mp3,size:1Mb;level:b,bitrate:4000,format:flac,size:10Mb'
  }] } }
}
globalThis.__lxQualityFixture = fixture
const modules = {
  '@shiqianjiang/ceru-plugin-core': 'export const PluginCore = {}; export const readPluginArtifact = () => { throw new Error("Unexpected v2 load") }',
  './sandbox': `export class IframePluginSandbox {
    constructor(rpc, event) { this.event = event }
    async start() { this.event('lx-inited', { sources: globalThis.__lxQualityFixture.sources }) }
    async invoke(kind, target, method, [input]) {
      globalThis.__lxQualityFixture.calls.push(input)
      return input.action === 'lyric' ? '[00:01.00]Fixture lyric' : 'https://example.com/fixture.mp3'
    }
    dispose() {}
  }`,
  './network': 'export const requestRemote = async () => globalThis.__lxQualityFixture.response; export const validateRemoteUrl = (value) => new URL(value)',
  '../storage/idb': 'export const idb = {}',
  './plugin/manager': 'export const allProviders = () => []',
  './lx-runtime.js?raw': 'export default ""'
}
const bundled = await build({
  entryPoints: ['src/core/plugin/host.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
  plugins: [{
    name: 'lx-quality-fixture',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path }) => Object.hasOwn(modules, path)
        ? { path, namespace: 'fixture' }
        : undefined)
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: modules[path] }))
    }
  }]
})
const { PluginHost } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
)
const host = new PluginHost({
  pluginId: 'quality-fixture',
  code: '/*\n * @name Quality fixture\n */\nlx.on("request", () => {})',
  manifest: { format: 'lx' },
  grants: ['network:network.request:{}'],
  denied: [],
  saveGrants: async () => {},
  getConfig: async () => ({}),
  saveConfig: async () => {},
  hooks: {}
})
const ref = (qualities) => ({
  providerId: 'kw', kind: 'track', id: '123',
  data: { lxMusicInfo: { songmid: '123', types: qualities.map((type) => ({ type })) } }
})
try {
  const result = await host.invokeProvider('kw', 'tracks.search', [{ query: 'Fixture' }])
  assert.deepEqual(result.items[0].metadata.qualities, ['128k'])
  assert.deepEqual(result.items[0].ref.data.lxMusicInfo.types.map((item) => item.type), ['128k', 'flac24bit'])
  await host.invokeProvider('kw', 'tracks.resolve', [result.items[0].ref, 'flac'])
  assert.equal(fixture.calls.at(-1).info.type, '128k')

  await host.invokeProvider('kw', 'tracks.resolve', [ref(['320k', '128k'])])
  assert.equal(fixture.calls.at(-1).info.type, '320k', 'automatic quality follows the source order')
  await host.invokeProvider('kw', 'tracks.resolve', [ref(['128k', '320k']), 'flac'])
  assert.equal(fixture.calls.at(-1).info.type, '320k', 'unsupported higher quality falls back to the track intersection')
  await host.invokeProvider('kw', 'tracks.resolve', [ref(['128k', '320k']), '128k'])
  assert.equal(fixture.calls.at(-1).info.type, '128k')

  const before = fixture.calls.length
  await assert.rejects(
    host.invokeProvider('kw', 'tracks.resolve', [ref(['flac24bit']), 'flac24bit']),
    /\u6ca1\u6709\u5171\u540c\u652f\u6301\u7684\u97f3\u8d28/
  )
  assert.equal(fixture.calls.length, before, 'disjoint qualities must not invoke the source script')
  await host.invokeProvider('kw', 'tracks.resolve', [ref([])])
  assert.equal(fixture.calls.at(-1).info.type, 'flac', 'unknown track metadata keeps the source fallback')
  await host.invokeProvider('kw', 'tracks.resolve', [{ providerId: 'kw', id: 'legacy' }, '128k'])
  assert.equal(fixture.calls.at(-1).info.type, '128k')
  const lyrics = await host.invokeProvider('kw', 'tracks.lyrics', [ref(['flac24bit'])])
  assert.equal(lyrics.lines[0].text, 'Fixture lyric', 'lyrics do not require a playable quality')
  assert.equal(fixture.calls.at(-1).action, 'lyric')
  console.log('PASS: LX host quality intersection, fallback, disjoint rejection before script invocation, and lyric independence')
} finally {
  await host.dispose()
  delete globalThis.__lxQualityFixture
}
