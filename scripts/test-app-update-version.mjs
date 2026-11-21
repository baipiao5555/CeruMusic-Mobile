import assert from 'node:assert/strict'
import { build } from 'esbuild'

const release = (tag) => ({
  tag_name: tag,
  name: `Test ${tag}`,
  body: 'release notes',
  html_url: `https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/${tag}`,
  published_at: '2026-11-21T00:00:00Z',
  assets: [{
    name: 'test.apk',
    size: 100,
    browser_download_url: 'https://github.com/baipiao5555/CeruMusic-Mobile/releases/download/test/test.apk'
  }]
})

async function loadUpdater(currentVersion, latestTag) {
  globalThis.localStorage = {
    data: new Map(),
    getItem(key) { return this.data.has(key) ? this.data.get(key) : null },
    setItem(key, value) { this.data.set(key, String(value)) },
    removeItem(key) { this.data.delete(key) },
    clear() { this.data.clear() }
  }
  globalThis.__updateMock = async () => ({ status: 200, data: release(latestTag) })
  const mocks = {
    '@capacitor/core': 'export const Capacitor={isNativePlatform:()=>false};',
    './net': 'export const httpRequest=(input)=>globalThis.__updateMock(input);',
    './native/plugins': 'export const Downloader={addListener:async()=>{},download:async()=>({}),delete:async()=>({})};export const External={notifyUpdate:async()=>({}),installApk:async()=>({}),open:async()=>({})};',
    './plugin/manager': 'export const notify=()=>{};',
    './update-mirror': 'export const DEFAULT_PRIMARY="a",DEFAULT_BACKUP="b",MIRRORS=[{id:"a",label:"A",hint:"",prefix:""},{id:"b",label:"B",hint:"",prefix:""}],PROBE_TARGET="",buildAttemptOrder=()=>[],findMirror=(id)=>({id,label:id}),mirrorUrl=(p,u)=>u,probeAllMirrors=async()=>({});'
  }
  const result = await build({
    entryPoints: ['src/core/updater.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
    define: { __APP_VERSION__: JSON.stringify(currentVersion) },
    plugins: [{
      name: 'update-mocks',
      setup(buildApi) {
        buildApi.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined
        )
        buildApi.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path]
        }))
      }
    }]
  })
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
}

let updater = await loadUpdater('2.7.5-playlist.2', 'v2.7.5')
await updater.checkForUpdate({ force: true, silent: true })
assert.equal(updater.updateState.hasUpdate, true, '2.7.5-playlist.2 must update to formal 2.7.5')
assert.equal(updater.canAutoPromptUpdate(), true, 'the formal release should trigger the automatic update page')
updater.ignoreVersion('v2.7.5')
assert.equal(updater.updateState.hasUpdate, false)

updater = await loadUpdater('2.7.4', 'v2.7.5')
await updater.checkForUpdate({ force: true, silent: true })
assert.equal(updater.updateState.hasUpdate, true)

updater = await loadUpdater('2.7.5', 'v2.7.5')
await updater.checkForUpdate({ force: true, silent: true })
assert.equal(updater.updateState.hasUpdate, false)
assert.equal(updater.canAutoPromptUpdate(), false)

updater = await loadUpdater('2.3.1-mobile.16', 'v2.3.1-mobile.17')
await updater.checkForUpdate({ force: true, silent: true })
assert.equal(updater.updateState.hasUpdate, true, 'legacy mobile prerelease ordering must remain valid')

console.log('PASS app update version comparison: formal beats prerelease, same formal stays quiet, legacy mobile ordering preserved')
