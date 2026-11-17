import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { randomUUID, createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const sourceArg = process.argv.indexOf('--source')
const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(sourceArg >= 0 ? process.argv[sourceArg + 1] : runtimeRoot)
const require = createRequire(path.join(process.env.CERU_DEPENDENCY_ROOT || runtimeRoot, 'package.json')), ts = require('typescript')
const out = process.env.CERU_QA_OUT || path.join(root, '..', 'account-library-qa')
fs.mkdirSync(out, { recursive: true })
const sources = ['src/core/library.ts', 'src/core/cloud.ts', 'src/core/librarySnapshot.ts', 'src/views/CloudPlaylists.vue']
const hashes = () => Object.fromEntries(sources.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]))
const before = hashes(), checks = []

function environment() {
  const modules = new Map(), storage = new Map(), writes = []
  let failStorage = false, fallbackTracks = []
  const manager = { registerHostHooks() {}, allProviders: () => [], pluginState: { plugins: [] }, notify() {} }
  const context = vm.createContext({ console, URL, TextEncoder, Date, localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { writes.push(key); if (failStorage) throw new Error('fixture quota'); storage.set(key, String(value)) },
    removeItem: key => storage.delete(key)
  } })
  function load(file) {
    const filename = path.resolve(root, file)
    if (modules.has(filename)) return modules.get(filename)
    const exports = {}; modules.set(filename, exports)
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
    const localRequire = id => {
      if (id === 'vue') return { reactive: value => value }
      if (id.endsWith('/plugin/manager')) return manager
      if (id.endsWith('/shims/crypto')) return { randomUUID }
      if (id === './auth') return { authState: { authenticated: true, user: { sub: 'A' } }, getAccessToken: async () => 'synthetic-token', logout() {} }
      if (id === './net') return { errorMessage: (_, message) => message, httpRequest: async () => ({ status: 200, data: { code: 200, data: { list: fallbackTracks.map(t => ({ songmid: t.id, source: t.providerId, name: t.title, pluginResource: { ...t.ref, pluginId: t.pluginId } })), total: fallbackTracks.length } } }) }
      if (id.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), id + '.ts')))
      return require(id)
    }
    vm.runInContext('(function(exports,require){' + code + '\n})', context, { filename })(exports, localRequire)
    return exports
  }
  const library = load('src/core/library.ts')
  return { library, storage, writes, load, setQuota: value => { failStorage = value },
    apply: async (cloud, tracks, options = {}) => {
      options = { ownerId: 'A', ...options }
      if (library.commitCloudPlaylist) return library.commitCloudPlaylist(cloud, tracks, options)
      // Baseline uses the actual pre-fix cloud importer, not a reimplemented upsert.
      fallbackTracks = tracks
      return load('src/core/cloud.ts').importCloudPlaylist(cloud, options)
    } }
}
const cloud = { id: 'cloud-one', name: 'fixture playlist', updatedAt: '2026-11-16T10:00:00Z' }
const track = (id, providerId = 'qq', pluginId = 'fixture.plugin', connectionId) => ({
  id, providerId, pluginId, providerName: 'fixture', title: 'fixture-' + id, artist: 'fixture', album: '', durationMs: 0,
  artwork: '/default-cover.png', qualities: [],
  ref: { id, providerId, pluginId, kind: 'track', ...(connectionId ? { connectionId, scope: 'connection' } : { scope: 'provider' }) }
})
async function test(name, run) {
  try { await run(); checks.push({ name, result: 'PASS' }); console.log('PASS ' + name) }
  catch (error) { checks.push({ name, result: 'FAIL', error: error.message }); console.error('FAIL ' + name + ': ' + error.message) }
}
const unchanged = (e, value) => assert.equal(JSON.stringify(e.library.libraryState), value)

function uiEnvironment(options = {}) {
  const e = environment(), notices = [], pushed = [], imports = [], confirmations = [], watches = []
  const state = { loading: false, importing: '', playlists: [cloud] }, auth = { authenticated: true, user: { sub: 'A' } }
  let refreshCalls = 0
  const cloudModule = { cloudState: state, fetchCloudPlaylists: async () => { refreshCalls++; return [cloud] },
    importCloudPlaylist: async (item, opts) => { imports.push({ item, opts }); return options.importOne ? options.importOne(item, opts) : { playlist: { name: item.name }, total: 1, updated: true, matched: 1 } },
    importAllCloudPlaylists: async () => options.allResult || { playlists: 1, tracks: 1, failed: [] },
    isCloudPlaylistImported: id => Boolean(e.library.findPlaylistByCloudId(id, auth.user.sub)),
    notifyImportResult: result => notices.push({ level: 'success', message: result.playlist.name }) }
  const source = fs.readFileSync(path.join(root, 'src/views/CloudPlaylists.vue'), 'utf8')
  const script = source.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)[1] + '\nexport {importOne,importAll,refresh,localOf,importedCount,error}; export const testBusy = typeof busy === "undefined" ? undefined : busy;'
  const code = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}, context = vm.createContext({ console, Date })
  const localRequire = id => {
    if (id === 'vue') return { ref: value => ({ value }), computed: fn => ({ get value() { return fn() } }), onMounted() {}, watch: (getters, fn) => { watches.push({ getters, fn }) } }
    if (id === 'vue-router') return { useRouter: () => ({ push: value => pushed.push(value), back() {} }) }
    if (id === '@/core/cloud') return cloudModule
    if (id === '@/core/auth') return { authState: auth, displayName: () => 'fixture', login: async () => {}, logout: () => { auth.authenticated = false } }
    if (id === '@/core/library') return e.library
    if (id === '@/core/plugin/manager') return { notify: (message, level = 'info') => notices.push({ message, level }) }
    if (id === '@/core/confirm') return { confirmAction: async opts => { confirmations.push(opts); return options.confirm ? options.confirm(opts) : false } }
    if (id === '@/components/Icon.vue') return {}
    throw new Error('Unexpected UI import: ' + id)
  }
  vm.runInContext('(function(exports,require){' + code + '\n})', context, { filename: path.join(root, 'src/views/CloudPlaylists.vue') })(exports, localRequire)
  return { ...exports, library: e.library, state, auth, notices, pushed, imports, confirmations, watches, source, get refreshCalls() { return refreshCalls } }
}

await test('cloud commit is one durable write, preserves favorites and records owner/baseline', async () => {
  const e = environment(); e.library.libraryState.favorites = [track('fav')]
  const result = await e.apply(cloud, [track('1'), track('2')], { ownerId: 'A' })
  assert.equal(e.writes.length, 1)
  assert.equal(result.updated, false)
  assert.equal(result.playlist.cloudOwnerId, 'A')
  assert.equal(result.playlist.cloudBaselineKeys.length, 2)
  assert.equal(e.library.libraryState.favorites[0].id, 'fav')
})
await test('quota failure rejects new import without empty/partial playlist', async () => {
  const e = environment(), state = JSON.stringify(e.library.libraryState); e.setQuota(true)
  await assert.rejects(e.apply(cloud, [track('1')]), /保存失败/)
  unchanged(e, state); assert.equal(e.storage.size, 0)
})
await test('quota failure rejects update and leaves both in-memory and durable library unchanged', async () => {
  const e = environment(); await e.apply(cloud, [track('1')])
  const state = JSON.stringify(e.library.libraryState), disk = e.storage.get('ceru.library.v1'); e.setQuota(true)
  await assert.rejects(e.apply({ ...cloud, name: 'new' }, [track('2')]), /保存失败/)
  unchanged(e, state); assert.equal(e.storage.get('ceru.library.v1'), disk)
})
await test('phone additions require explicit replacement and do not silently vanish', async () => {
  const e = environment(); const result = await e.apply(cloud, [track('1')])
  e.library.addTrackToPlaylist(result.playlist.id, track('phone-only'))
  const state = JSON.stringify(e.library.libraryState)
  await assert.rejects(e.apply(cloud, [track('1')]), error => error.code === 'CLOUD_LOCAL_CHANGES')
  unchanged(e, state)
  const replaced = await e.apply(cloud, [track('1')], { replaceLocalChanges: true })
  assert.equal(replaced.playlist.tracks.length, 1)
})
await test('phone deletions require confirmation rather than resurrecting remote songs', async () => {
  const e = environment(); const result = await e.apply(cloud, [track('1'), track('2')])
  e.library.removeTrackFromPlaylist(result.playlist.id, track('2'))
  const state = JSON.stringify(e.library.libraryState)
  await assert.rejects(e.apply(cloud, [track('1'), track('2')]), error => error.code === 'CLOUD_LOCAL_CHANGES')
  unchanged(e, state)
})
await test('normal remote deletion updates an untouched baseline without confirmation', async () => {
  const e = environment(); await e.apply(cloud, [track('1'), track('2')])
  const result = await e.apply(cloud, [track('1')])
  assert.equal(result.updated, true); assert.equal(result.playlist.tracks.length, 1)
})
await test('legacy cloud playlist without baseline requires confirmation if incoming differs', async () => {
  const e = environment(); e.library.libraryState.playlists = [{ id: 'legacy', name: 'legacy', createdAt: 1, cloudId: cloud.id, tracks: [track('phone-only')] }]
  const state = JSON.stringify(e.library.libraryState)
  await assert.rejects(e.apply(cloud, [track('1')], { ownerId: 'A' }), error => error.code === 'CLOUD_LOCAL_CHANGES')
  unchanged(e, state)
  const result = await e.apply(cloud, [track('1')], { ownerId: 'A', replaceLocalChanges: true })
  assert.equal(result.playlist.id, 'legacy'); assert.equal(result.playlist.cloudOwnerId, 'A')
})
await test('identical legacy cloud playlist migrates its baseline without duplicate playlist', async () => {
  const e = environment(); e.library.libraryState.playlists = [{ id: 'legacy', name: 'legacy', createdAt: 1, cloudId: cloud.id, tracks: [track('1')] }]
  const result = await e.apply(cloud, [track('1')], { ownerId: 'A' })
  assert.equal(e.library.libraryState.playlists.length, 1); assert.equal(result.playlist.cloudBaselineKeys.length, 1)
})
await test('same cloud ID from different account does not overwrite account A playlist', async () => {
  const e = environment(); await e.apply(cloud, [track('A')], { ownerId: 'A' })
  const result = await e.apply(cloud, [track('B')], { ownerId: 'B' })
  assert.equal(result.updated, false); assert.equal(e.library.libraryState.playlists.length, 2)
  assert.equal(e.library.findPlaylistByCloudId(cloud.id, 'A').tracks[0].id, 'A')
  assert.equal(e.library.findPlaylistByCloudId(cloud.id, 'B').tracks[0].id, 'B')
})
await test('exact owner match takes priority over unrelated legacy unowned playlist', async () => {
  const e = environment(); await e.apply(cloud, [track('A')], { ownerId: 'A' })
  e.library.libraryState.playlists.unshift({ id: 'legacy', name: 'legacy', createdAt: 1, cloudId: cloud.id, tracks: [] })
  assert.equal(e.library.findPlaylistByCloudId(cloud.id, 'A').cloudOwnerId, 'A')
})
await test('public track identity ignores plugin instance changes, but separates providers', async () => {
  const e = environment(), key = e.library.cloudTrackKey
  assert.equal(typeof key, 'function')
  assert.equal(key(track('1', 'qq', 'old')), key(track('1', 'qq', 'new')))
  assert.notEqual(key(track('1', 'qq')), key(track('1', 'kw')))
  await e.apply(cloud, [track('1', 'qq', 'old')])
  const result = await e.apply(cloud, [track('1', 'qq', 'new'), track('2')])
  assert.equal(result.playlist.tracks.length, 2)
})
await test('private same ID differs by plugin and connection; multiplicity is tracked', async () => {
  const e = environment(), key = e.library.cloudTrackKey
  assert.equal(typeof key, 'function')
  const a = track('1', 'private', 'plugin-A', 'account-A'), b = track('1', 'private', 'plugin-A', 'account-B'), c = track('1', 'private', 'plugin-B', 'account-A')
  assert.equal(new Set([a, b, c].map(key)).size, 3)
  const result = await e.apply(cloud, [a, b, c])
  e.library.getPlaylist(result.playlist.id).tracks.pop()
  await assert.rejects(e.apply(cloud, [a, b, c]), error => error.code === 'CLOUD_LOCAL_CHANGES')
})
await test('undo restores exact prior library and refuses later edits', async () => {
  const e = environment(); await e.apply(cloud, [track('1')])
  const state = JSON.stringify(e.library.libraryState), result = await e.apply(cloud, [track('2')])
  assert.equal(typeof result.undo, 'function'); result.undo(); unchanged(e, state)
  const later = await e.apply(cloud, [track('2')]); e.library.createPlaylist('later local edit')
  assert.throws(later.undo, /其他改动/)
})
await test('file import still preserves cloud metadata and has atomic undo', async () => {
  const e = environment(); await e.apply(cloud, [track('1')], { ownerId: 'A' })
  const state = JSON.stringify(e.library.libraryState)
  const imported = e.library.commitPlaylistImport([{ name: 'file', tracks: [track('file')] }])
  assert.equal(e.library.libraryState.playlists.length, 2)
  assert.equal(e.library.findPlaylistByCloudId(cloud.id, 'A').cloudOwnerId, 'A')
  assert.equal(e.library.findPlaylistByCloudId(cloud.id, 'A').cloudBaselineKeys.length, 1)
  imported.undo(); unchanged(e, state)
})
await test('snapshot replace/undo compatibility preserves prior cloud metadata on undo', async () => {
  const e = environment(); await e.apply(cloud, [track('1')], { ownerId: 'A' })
  const snapshot = e.load('src/core/librarySnapshot.ts'), state = JSON.stringify(e.library.libraryState)
  const saved = snapshot.exportLibrarySnapshot(), committed = snapshot.commitLibrarySnapshot(saved, { mode: 'replace' })
  assert.equal(e.library.libraryState.playlists[0].tracks.length, 1)
  committed.undo(); unchanged(e, state)
})
await test('UI cancel on local changes never retries overwrite or announces success', async () => {
  const ui = uiEnvironment({ importOne: () => { throw Object.assign(new Error('fixture local changes'), { code: 'CLOUD_LOCAL_CHANGES' }) } })
  await ui.importOne(cloud)
  assert.equal(ui.confirmations.length, 1); assert.equal(ui.imports.length, 1)
  assert.equal(ui.notices.length, 0); assert.equal(ui.testBusy.value, false)
})
await test('UI explicit confirmation retries once with replaceLocalChanges and stays busy during confirmation', async () => {
  let ui
  ui = uiEnvironment({ importOne: (item, opts) => {
    if (!opts?.replaceLocalChanges) throw Object.assign(new Error('fixture local changes'), { code: 'CLOUD_LOCAL_CHANGES' })
    return { playlist: { name: item.name }, total: 1, updated: true, matched: 1 }
  }, confirm: () => { assert.equal(ui.testBusy.value, true); return true } })
  await ui.importOne(cloud)
  assert.equal(ui.imports.length, 2); assert.equal(ui.imports[1].opts.replaceLocalChanges, true)
  assert.equal(ui.notices[0].level, 'success'); assert.equal(ui.testBusy.value, false)
})
await test('UI batch failures retain visible error details and do not navigate away as success', async () => {
  const ui = uiEnvironment({ allResult: { playlists: 1, tracks: 1, failed: [{ id: 'bad', name: 'failed playlist', error: 'fixture save failure' }] } })
  await ui.importAll()
  assert.equal(ui.pushed.length, 0); assert.match(ui.error.value, /failed playlist.*fixture save failure/)
  assert.equal(ui.notices[0].level, 'error')
})
await test('UI account ownership filters local match and imported count', () => {
  const ui = uiEnvironment()
  ui.library.libraryState.playlists = [
    { id: 'B', cloudId: cloud.id, cloudOwnerId: 'B', name: 'B', createdAt: 1, tracks: [] },
    { id: 'A', cloudId: cloud.id, cloudOwnerId: 'A', name: 'A', createdAt: 1, tracks: [] }
  ]
  assert.equal(ui.localOf(cloud).id, 'A'); assert.equal(ui.importedCount.value, 1)
})
await test('UI busy state blocks reentry; every song update button is disabled while busy', async () => {
  const ui = uiEnvironment(); ui.state.importing = 'some-current-job'
  await ui.importOne(cloud); assert.equal(ui.imports.length, 0)
  const buttons = ui.source.match(/<button[^>]*@click="importOne\(cloud\)"[^>]*>/g)
  assert.equal(buttons.length, 3); assert.equal(buttons.every(button => button.includes(':disabled="busy"')), true)
})
await test('UI labels directory refresh accurately and retains account-change refresh watcher', async () => {
  const ui = uiEnvironment(); assert.equal(ui.source.includes('刷新目录'), true); assert.equal(ui.source.includes('上次刷新'), true)
  assert.equal(ui.source.includes('立即同步'), false); assert.equal(ui.watches.length, 1)
  await ui.refresh(); assert.equal(ui.refreshCalls, 1); assert.equal(ui.imports.length, 0)
  ui.error.value = 'prior account failure'; ui.watches[0].fn([false, undefined]); assert.equal(ui.error.value, '')
})
await test('unknown empty owner cannot directly commit or overwrite a known-owner cloud playlist', async () => {
  const e = environment(); await e.apply(cloud, [track('original')], { ownerId: 'A' })
  const state = JSON.stringify(e.library.libraryState), disk = e.storage.get('ceru.library.v1'), writes = e.writes.length
  for (const ownerId of [undefined, null, '', '   ']) {
    assert.throws(() => e.library.commitCloudPlaylist(cloud, [track('replacement')], { ownerId, replaceLocalChanges: true }), /身份/)
    unchanged(e, state); assert.equal(e.storage.get('ceru.library.v1'), disk); assert.equal(e.writes.length, writes)
  }
  assert.throws(() => e.library.commitCloudPlaylist(cloud, []), /身份/)
  unchanged(e, state); assert.equal(e.storage.get('ceru.library.v1'), disk)
})
await test('unknown owner lookup cannot adopt owned or legacy unowned cloud association', async () => {
  const e = environment(); await e.apply(cloud, [track('original')], { ownerId: 'A' })
  e.library.libraryState.playlists.unshift({ id: 'legacy', name: 'legacy', createdAt: 1, cloudId: cloud.id, tracks: [] })
  for (const ownerId of [undefined, null, '', '   ']) assert.equal(e.library.findPlaylistByCloudId(cloud.id, ownerId), undefined)
  assert.equal(e.library.findPlaylistByCloudId(cloud.id, 'A').cloudOwnerId, 'A')
  assert.equal(e.library.findPlaylistByCloudId(cloud.id, 'B').id, 'legacy')
})
await test('source SHA256 remains unchanged during test execution', () => assert.deepEqual(hashes(), before))
const failed = checks.filter(check => check.result === 'FAIL').length
const report = { sourceRoot: root, sourceSha256: before, checks, passed: checks.length - failed, failed, result: failed ? 'FAIL' : 'PASS', exitCode: failed ? 1 : 0, isolation: 'original TS modules in VM; synthetic localStorage/auth/plugin/transport fixtures; zero external network' }
fs.writeFileSync(path.join(out, 'account-library-tests.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ passed: report.passed, failed, result: report.result }))
process.exitCode = report.exitCode
