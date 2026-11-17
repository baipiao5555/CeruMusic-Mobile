import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import http from 'node:http'
import { createRequire } from 'node:module'
import { randomUUID, webcrypto } from 'node:crypto'

const root = path.resolve(import.meta.dirname, '..'), require = createRequire(root + '/package.json'), ts = require('typescript')
const out = process.env.CERU_QA_OUT || path.join(os.tmpdir(), 'ceru-sync-two-way-qa')
await fs.mkdir(out, { recursive: true })
const CURRENT = '/dav/.ceru-library-v1.json'
const PASSWORD = 'two-way-password'
const authorization = 'Basic ' + Buffer.from(`twoway:${PASSWORD}`).toString('base64')
const checks = [], requests = [], logs = []
const remote = new Map()
let mode = 'normal', tag = 0, race = null
const sockets = new Set()

function makeTrack(id, title = id) {
  return { id, providerId: 'kw', providerName: 'QA', pluginId: 'fixture', title, artist: 'QA歌手', album: '', durationMs: 1000,
    artwork: '/default-cover.png', qualities: ['128k'], ref: { kind: 'track', id, providerId: 'kw', pluginId: 'fixture', scope: 'provider' } }
}
function makePlaylist(id, name, tracks, createdAt = 1) {
  return { id, name, createdAt, description: '', cover: '', tracks }
}
function remoteItem() { return remote.get(CURRENT) }
function remoteView() { const item = remoteItem(); return item ? JSON.parse(item.body) : undefined }
function appendRemotePlaylist(id, name) {
  const item = remoteItem()
  if (!item) return
  const snapshot = JSON.parse(item.body)
  const trackId = `${id}-track`
  snapshot.playlists.push({ id, name, createdAt: Date.now(), description: '', cover: '',
    tracks: [{ id: trackId, title: '竞态曲目', artist: '', album: '', durationMs: 1000, artwork: '/default-cover.png', qualities: ['128k'],
      source: { manifestId: 'fixture', providerId: 'kw', kind: 'track', id: trackId, requiresRebind: false } }] })
  snapshot.createdAt = new Date().toISOString()
  item.body = JSON.stringify(snapshot)
  item.etag = '"v' + (++tag) + '"'
}

const server = http.createServer(async (req, res) => {
  for (const [key, value] of Object.entries({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,HEAD,PUT,DELETE,OPTIONS,PROPFIND,MKCOL', 'Access-Control-Allow-Headers': 'Authorization,Content-Type,Depth,If-Match,If-None-Match,Accept', 'Access-Control-Expose-Headers': 'ETag,DAV,Allow,Content-Length,Last-Modified', DAV: '1', Allow: 'GET,HEAD,PUT,DELETE,OPTIONS,PROPFIND,MKCOL' })) res.setHeader(key, value)
  if (req.method === 'OPTIONS' && !req.headers.authorization) { res.writeHead(204); return res.end() }
  const pathname = req.url || '/'
  requests.push({ method: req.method, path: pathname, ifMatch: Boolean(req.headers['if-match']), ifNoneMatch: Boolean(req.headers['if-none-match']) })
  if (mode === '401' || req.headers.authorization !== authorization) { res.writeHead(401); return res.end() }
  if (mode === '403') { res.writeHead(403); return res.end() }
  if (mode === 'redirect') { res.writeHead(302, { Location: 'http://should-not-be-requested.invalid/' }); return res.end() }
  if (mode === 'hang') { req.on('close', () => res.destroy()); return }
  if (!pathname.startsWith('/dav/')) { res.writeHead(404); return res.end() }
  if (req.method === 'OPTIONS') { res.writeHead(200); return res.end() }
  if (req.method === 'PROPFIND') {
    res.writeHead(207, { 'Content-Type': 'application/xml' })
    return res.end('<d:multistatus xmlns:d="DAV:">' + [...remote.keys()].map(name => `<d:response><d:href>${name}</d:href></d:response>`).join('') + '</d:multistatus>')
  }
  if (req.method === 'MKCOL') { res.writeHead(201); return res.end() }
  if (req.method === 'PUT') {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    let existing = remote.get(pathname)
    if (race && race.times > 0 && req.headers['if-match']) {
      const step = race.times--
      race.mutate(step)
      if (race.times <= 0) race = null
      existing = remote.get(pathname)
    }
    if (mode !== 'ignore-conditions') {
      if ((req.headers['if-none-match'] === '*' && existing) || (req.headers['if-match'] && (!existing || existing.etag !== req.headers['if-match']))) { res.writeHead(412); return res.end() }
    }
    const item = { body: Buffer.concat(chunks).toString('utf8'), etag: '"v' + (++tag) + '"' }
    remote.set(pathname, item)
    if (mode === 'no-etag') res.writeHead(existing ? 204 : 201)
    else res.writeHead(existing ? 204 : 201, { ETag: item.etag })
    return res.end()
  }
  const existing = remote.get(pathname)
  if (!existing) { res.writeHead(404); return res.end() }
  if (req.method === 'DELETE') {
    if (mode !== 'ignore-conditions' && req.headers['if-match'] && req.headers['if-match'] !== existing.etag) { res.writeHead(412); return res.end() }
    remote.delete(pathname); res.writeHead(204); return res.end()
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(existing.body) }
    if (mode !== 'no-etag') headers.ETag = existing.etag
    res.writeHead(200, headers)
    return res.end(req.method === 'HEAD' ? '' : existing.body)
  }
  res.writeHead(405); res.end()
})
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

function environment(options = {}) {
  const storage = new Map(), modules = new Map(), envLogs = []
  const manager = { pluginState: { plugins: [] }, registerHostHooks: () => {} }
  const fail = { stateWrites: false, libraryWrites: false }
  const fastTimers = options.fastTimers === true
  const contextSetTimeout = fastTimers ? (fn, ms, ...args) => setTimeout(fn, Math.min(Number(ms) || 0, 50), ...args) : setTimeout
  const context = vm.createContext({
    console: { log: value => envLogs.push(String(value)), warn: value => envLogs.push(String(value)), error: value => envLogs.push(String(value)) },
    URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, AbortController, setTimeout: contextSetTimeout, clearTimeout,
    Date, crypto: webcrypto, btoa: value => Buffer.from(value, 'binary').toString('base64'), fetch,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => {
        if (fail.stateWrites && key === 'ceru.sync.webdav.state.v1') throw new Error('simulated state storage failure')
        if (fail.libraryWrites && key === 'ceru.library.v1') throw new Error('simulated library storage failure')
        storage.set(key, String(value))
      },
      removeItem: key => storage.delete(key)
    }
  })
  function load(file) {
    const name = path.resolve(root, file)
    if (modules.has(name)) return modules.get(name)
    const exports = {}
    modules.set(name, exports)
    const source = require('node:fs').readFileSync(name, 'utf8')
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
    const localRequire = id => {
      if (id === 'vue') return { reactive: value => value }
      if (id === '@capacitor/core') return { Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' }, registerPlugin: name => new Proxy({}, { get: () => async () => { throw new Error(`controlled native unavailable: ${name}`) } }) }
      if (id.endsWith('/plugin/manager') || id === './plugin/manager') return manager
      if (id.endsWith('/shims/crypto')) return { randomUUID }
      if (id.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(name), id + '.ts')))
      return require(id)
    }
    vm.runInContext('(function(exports,require){' + code + '\n})', context, { filename: name })(exports, localRequire)
    return exports
  }
  return { storage, logs: envLogs, fail, load, library: load('src/core/library.ts').libraryState,
    snapshot: load('src/core/librarySnapshot.ts'), webdav: load('src/core/sync/webdav.ts') }
}

function setLibrary(env, favorites, playlists) { env.library.favorites = favorites; env.library.playlists = playlists }
function libraryView(env) {
  const snapshot = env.snapshot.exportLibrarySnapshot()
  return JSON.parse(JSON.stringify({ favorites: snapshot.favorites, playlists: snapshot.playlists }))
}
const libraryText = env => JSON.stringify(libraryView(env))
const trackIds = (view, playlistId) => (view.playlists.find(item => item.id === playlistId)?.tracks || []).map(track => track.id)
const redact = value => typeof value === 'string' ? value.replaceAll(PASSWORD, '[redacted]') : value
const short = value => typeof value === 'string' && value.length > 260 ? `${value.slice(0, 260)}…(${value.length} chars)` : value
const check = (name, actual, expected = true) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  const record = { name, actual: redact(short(actual)), expected: redact(short(expected)), pass }
  if (!pass) Object.assign(record, { fullActual: redact(actual), fullExpected: redact(expected) })
  checks.push(record)
  console.log(JSON.stringify(checks.at(-1)))
  assert.equal(pass, true, name)
}

let fatal
try {
  const a = environment(), b = environment(), c = environment(), t = environment({ fastTimers: true })
  const address = `http://127.0.0.1:${port}/dav/`
  const ca = await a.webdav.saveConnection({ name: 'A', address, username: 'twoway', password: PASSWORD, confirmed: true, allowInsecureHttp: true })
  const cb = await b.webdav.saveConnection({ name: 'B', address, username: 'twoway', password: PASSWORD, confirmed: true, allowInsecureHttp: true })
  const cc = await c.webdav.saveConnection({ name: 'C', address, username: 'twoway', password: PASSWORD, confirmed: true, allowInsecureHttp: true })
  const ct = await t.webdav.saveConnection({ name: 'T', address, username: 'twoway', password: PASSWORD, confirmed: true, allowInsecureHttp: true })
  check('credentials never enter public connection storage', [...a.storage.values()].some(value => String(value).includes(PASSWORD)), false)
  const proofA = await a.webdav.testConnection(ca), proofB = await b.webdav.testConnection(cb)
  check('A passes real ETag proof', proofA.readWrite && proofA.etagVerified && proofA.cleanup)
  check('B passes real ETag proof', proofB.etagVerified)

  setLibrary(a, [makeTrack('fa', 'A收藏')], [makePlaylist('p1', '共享歌单', [makeTrack('t1', '歌曲1')])])
  setLibrary(b, [], [])
  const first = await a.webdav.syncNow(ca)
  check('first sync creates remote snapshot', first.pushed && !first.pulled)
  check('remote snapshot starts with local playlist', remoteView().playlists.map(item => item.id), ['p1'])
  check('first remote upload uses If-None-Match', requests.some(item => item.method === 'PUT' && item.path === CURRENT && item.ifNoneMatch && !item.ifMatch))
  const statusA = a.webdav.getSyncStatus(ca)
  check('per-connection baseline is persisted', statusA.hasBaseline && statusA.remoteEtag === remoteItem().etag)
  const pullB = await b.webdav.syncNow(cb)
  check('B pulls the remote snapshot', pullB.pulled && !pullB.pushed)
  check('B now has the shared playlist', libraryView(b).playlists.map(item => item.id), ['p1'])

  a.library.playlists = [makePlaylist('p2', 'A新增', [makeTrack('t2', '歌曲2')]), ...a.library.playlists]
  const aOnly = await a.webdav.syncNow(ca)
  check('A-only change is pushed', aOnly.pushed && !aOnly.pulled)
  await b.webdav.syncNow(cb)
  check('B receives A-only playlist', libraryView(b).playlists.some(item => item.id === 'p2'))

  b.library.playlists = [makePlaylist('p3', 'B新增', [makeTrack('t3', '歌曲3')]), ...b.library.playlists]
  b.library.favorites = [makeTrack('fb', 'B收藏'), ...b.library.favorites]
  const bOnly = await b.webdav.syncNow(cb)
  check('B-only changes are pushed', bOnly.pushed)
  await a.webdav.syncNow(ca)
  const afterB = libraryView(a)
  check('A receives B-only playlist', afterB.playlists.some(item => item.id === 'p3'))
  check('A receives B-only favorite', afterB.favorites.some(item => item.id === 'fb'))

  a.library.playlists.find(item => item.id === 'p2').tracks.push(makeTrack('tA2', 'A加曲'))
  b.library.playlists.find(item => item.id === 'p3').tracks.push(makeTrack('tB3', 'B加曲'))
  await a.webdav.syncNow(ca)
  await b.webdav.syncNow(cb)
  await a.webdav.syncNow(ca)
  check('different playlists both survive on A', trackIds(libraryView(a), 'p2').includes('tA2') && trackIds(libraryView(a), 'p3').includes('tB3'))
  check('different playlists both survive on B', trackIds(libraryView(b), 'p2').includes('tA2') && trackIds(libraryView(b), 'p3').includes('tB3'))

  a.library.playlists.find(item => item.id === 'p1').tracks.push(makeTrack('tA', 'A冲突曲'))
  b.library.playlists.find(item => item.id === 'p1').tracks.push(makeTrack('tB', 'B冲突曲'))
  await a.webdav.syncNow(ca)
  const conflictResult = await b.webdav.syncNow(cb)
  check('same playlist changed both sides creates one conflict copy', conflictResult.conflicts.length, 1)
  const conflict = conflictResult.conflicts[0]
  check('conflict copy name is timestamped', /^共享歌单 \(冲突副本 \d{4}-\d{2}-\d{2} \d{4}\)$/.test(conflict.copyName))
  check('B keeps the local version at the original id', trackIds(libraryView(b), 'p1').includes('tB') && trackIds(libraryView(b), 'p1').includes('t1'))
  check('B conflict copy keeps the remote version', trackIds(libraryView(b), conflict.copyId).includes('tA'))
  await a.webdav.syncNow(ca)
  const unionTracks = new Set(libraryView(a).playlists.filter(item => item.id === 'p1' || item.id === conflict.copyId).flatMap(item => item.tracks.map(track => track.id)))
  check('A pulls both versions without losing a track', ['t1', 'tA', 'tB'].every(id => unionTracks.has(id)))
  check('remote keeps the conflict copy', remoteView().playlists.some(item => item.id === conflict.copyId))
  check('remote snapshot has no credentials or private refs', /two-way-password|connectionId|"data"/.test(remoteItem().body), false)

  a.library.favorites = [makeTrack('fa2', 'A新收藏'), ...a.library.favorites]
  b.library.favorites = [makeTrack('fb2', 'B新收藏'), ...b.library.favorites]
  await a.webdav.syncNow(ca)
  await b.webdav.syncNow(cb)
  await a.webdav.syncNow(ca)
  const favoriteIds = libraryView(a).favorites.map(track => track.id)
  check('favorites merge by stable key on A', favoriteIds.includes('fa2') && favoriteIds.includes('fb2'))
  check('favorites merge by stable key on B', libraryView(b).favorites.map(track => track.id).includes('fb2'))

  const remoteP1 = remoteView().playlists.find(item => item.id === 'p1')
  a.library.playlists = a.library.playlists.filter(item => item.id !== 'p1')
  const localDelete = await a.webdav.syncNow(ca)
  check('local playlist deletion is not pushed', remoteView().playlists.some(item => item.id === 'p1'))
  check('local playlist deletion is restored instead of losing data', localDelete.pulled && libraryView(a).playlists.some(item => item.id === 'p1'))
  check('remote playlist content stayed present', Boolean(remoteP1))
  a.library.favorites = a.library.favorites.filter(track => track.id !== 'fa')
  await a.webdav.syncNow(ca)
  check('local favorite deletion is not pushed', remoteView().favorites.some(track => track.id === 'fa'))
  check('local favorite deletion is restored from remote', libraryView(a).favorites.some(track => track.id === 'fa'))

  b.library.playlists = [makePlaylist('p-undo', '可撤销拉取', [makeTrack('t-undo', '撤销曲')]), ...b.library.playlists]
  await b.webdav.syncNow(cb)
  const beforeUndo = libraryText(a)
  const pullUndo = await a.webdav.syncNow(ca)
  check('pull-only sync exposes undo', pullUndo.pulled && !pullUndo.pushed && Boolean(pullUndo.undo))
  pullUndo.undo()
  check('undo restores the exact previous local library', libraryText(a), beforeUndo)
  await a.webdav.syncNow(ca)
  check('sync after undo reapplies the remote change', libraryView(a).playlists.some(item => item.id === 'p-undo'))

  a.library.playlists = [makePlaylist('p4', '竞态本地新增', [makeTrack('t4', '歌曲4')]), ...a.library.playlists]
  race = { times: 1, mutate: step => appendRemotePlaylist(`p-race-${step}`, `竞态远端${step}`) }
  const retry = await a.webdav.syncNow(ca)
  check('412 retry merges the intervening remote change', retry.pushed && retry.status === 'merged')
  check('retry keeps the local addition', libraryView(a).playlists.some(item => item.id === 'p4'))
  check('retry keeps the racing remote playlist', libraryView(a).playlists.some(item => item.id === 'p-race-1') && remoteView().playlists.some(item => item.id === 'p-race-1'))
  check('retry used a second conditional PUT', requests.filter(item => item.method === 'PUT' && item.path === CURRENT && item.ifMatch).length >= 2)

  a.library.playlists = [makePlaylist('p5', '连续竞态', [makeTrack('t5', '歌曲5')]), ...a.library.playlists]
  const beforeDouble = libraryText(a)
  race = { times: 2, mutate: step => appendRemotePlaylist(`p-race2-${step}`, `连续竞态${step}`) }
  await assert.rejects(a.webdav.syncNow(ca), error => error.code === 'CONFLICT')
  check('two 412 responses fail safely', true)
  check('double 412 leaves local library unchanged', libraryText(a), beforeDouble)
  check('double 412 never writes the local-only playlist', remoteView().playlists.some(item => item.id === 'p5'), false)
  await a.webdav.syncNow(ca)
  check('next normal sync converges after 412 failure', remoteView().playlists.some(item => item.id === 'p5'))

  remote.delete(CURRENT)
  a.library.playlists = [makePlaylist('p6', '远端缺失后', [makeTrack('t6', '歌曲6')]), ...a.library.playlists]
  const recreate = await a.webdav.syncNow(ca)
  check('missing remote snapshot is recreated from local', recreate.pushed && Boolean(remoteItem()))
  check('recreated remote has the local playlist', remoteView().playlists.some(item => item.id === 'p6'))

  const goodBody = remoteItem().body
  b.library.playlists = [makePlaylist('p-atomic', '存储失败拉取', [makeTrack('t-atomic', '存储失败曲')]), ...b.library.playlists]
  await b.webdav.syncNow(cb)
  const beforeAtomic = libraryText(a)
  const putsBeforeAtomic = requests.filter(item => item.method === 'PUT' && item.path === CURRENT).length
  a.fail.stateWrites = true
  await assert.rejects(a.webdav.syncNow(ca), error => error.code === 'STORAGE')
  a.fail.stateWrites = false
  check('baseline write failure rolls the local library back', libraryText(a), beforeAtomic)
  check('baseline write failure performs no remote PUT', requests.filter(item => item.method === 'PUT' && item.path === CURRENT).length, putsBeforeAtomic)
  await a.webdav.syncNow(ca)
  check('retry after storage failure pulls the remote addition', libraryView(a).playlists.some(item => item.id === 'p-atomic'))

  const beforeCorrupt = libraryText(a)
  const corruptPuts = requests.filter(item => item.method === 'PUT' && item.path === CURRENT).length
  remote.set(CURRENT, { body: '{broken', etag: '"corrupt"' })
  await assert.rejects(a.webdav.syncNow(ca), error => error.code === 'CORRUPT')
  check('corrupt remote never mutates the local library', libraryText(a), beforeCorrupt)
  check('corrupt remote is never overwritten', requests.filter(item => item.method === 'PUT' && item.path === CURRENT).length, corruptPuts)
  const corruptStatus = a.webdav.getSyncStatus(ca)
  check('corrupt remote error is visible in status', /损坏|快照/.test(corruptStatus.lastError || ''))
  check('last successful baseline survives a failed read', corruptStatus.hasBaseline)
  remote.set(CURRENT, { body: goodBody, etag: '"restored"' })
  await a.webdav.syncNow(ca)
  check('successful sync clears the previous error', Boolean(a.webdav.getSyncStatus(ca).lastError), false)

  const beforeNoEtag = libraryText(a)
  mode = 'no-etag'
  await assert.rejects(a.webdav.syncNow(ca), error => error.code === 'UNVERIFIED')
  mode = 'normal'
  check('missing ETag blocks sync without local mutation', libraryText(a), beforeNoEtag)

  const before401 = libraryText(a)
  mode = '401'
  await assert.rejects(a.webdav.syncNow(ca), error => error.code === 'AUTH')
  mode = 'normal'
  check('401 blocks sync without local mutation', libraryText(a), before401)
  const before403 = libraryText(a)
  mode = '403'
  await assert.rejects(a.webdav.syncNow(ca), error => error.code === 'FORBIDDEN')
  mode = 'normal'
  check('403 blocks sync without local mutation', libraryText(a), before403)
  const beforeRedirect = libraryText(a)
  mode = 'redirect'
  await assert.rejects(a.webdav.syncNow(ca), error => error.code === 'REDIRECT')
  mode = 'normal'
  check('redirect blocks sync without local mutation', libraryText(a), beforeRedirect)

  setLibrary(c, [makeTrack('fc', 'C收藏')], [makePlaylist('pc', 'C歌单', [makeTrack('tc', 'C曲')])])
  const beforeUnsigned = libraryText(c)
  mode = 'ignore-conditions'
  await assert.rejects(c.webdav.syncNow(cc), error => error.code === 'UNVERIFIED')
  mode = 'normal'
  check('server ignoring conditions cannot enable two-way sync', libraryText(c), beforeUnsigned)
  check('unverified server has no baseline', c.webdav.getSyncStatus(cc).hasBaseline, false)

  setLibrary(t, [], [makePlaylist('pt', '超时歌单', [makeTrack('tt', '超时曲')])])
  const beforeTimeout = libraryText(t)
  mode = 'hang'
  await assert.rejects(t.webdav.syncNow(ct), error => error.code === 'NETWORK')
  mode = 'normal'
  check('timeout blocks sync without local mutation', libraryText(t), beforeTimeout)

  const stateA = JSON.parse(a.storage.get('ceru.sync.webdav.state.v1'))
  const stateB = JSON.parse(b.storage.get('ceru.sync.webdav.state.v1'))
  check('state has one baseline per connection', Boolean(stateA.connections[ca.id]?.baseline) && Boolean(stateB.connections[cb.id]?.baseline))
  check('baseline records the current remote ETag', stateA.connections[ca.id].remoteEtag, remoteItem().etag)
  await a.webdav.setSyncSettings(ca, { enabled: true })
  const enabledA = a.webdav.getSyncStatus(ca)
  check('auto sync setting persists per connection', enabledA.enabled && enabledA.autoSyncMinutes === 3)
  const ca2 = await a.webdav.saveConnection({ name: 'A2', address, username: 'twoway', password: PASSWORD, confirmed: true, allowInsecureHttp: true })
  await a.webdav.setSyncSettings(ca2, { enabled: true })
  check('only one automatic target stays enabled on this device', a.webdav.getSyncStatus(ca).enabled, false)
  check('new automatic target is enabled', a.webdav.getSyncStatus(ca2).enabled)
  await a.webdav.setSyncSettings(ca2, { enabled: false })
  await b.webdav.setSyncSettings(cb, { enabled: true })
  check('auto sync persists on a second client', b.webdav.getSyncStatus(cb).enabled)
  await b.webdav.setSyncSettings(cb, { enabled: false })
  check('auto sync can be disabled', b.webdav.getSyncStatus(cb).enabled, false)

  const allStorage = [a, b, c, t].flatMap(env => [...env.storage.values()]).join('\n')
  check('credentials never logged or persisted in plaintext', allStorage.includes(PASSWORD) || [a, b, c, t].some(env => env.logs.join('\n').includes(PASSWORD)), false)

  const beforeOffline = libraryText(a)
  for (const socket of sockets) socket.destroy()
  await new Promise(resolve => server.close(resolve))
  await assert.rejects(a.webdav.syncNow(ca), error => error.code === 'NETWORK')
  check('offline blocks sync without local mutation', libraryText(a), beforeOffline)
} catch (error) {
  fatal = error.stack
  console.error(fatal)
} finally {
  for (const socket of sockets) socket.destroy()
  if (server.listening) await new Promise(resolve => server.close(() => resolve()))
  await fs.writeFile(path.join(out, 'two-way-tests.json'), JSON.stringify({
    command: 'node scripts/test-sync-two-way.mjs', exitCode: fatal ? 1 : 0,
    scope: 'Real loopback HTTP WebDAV fixture with actual TypeScript core; browser session-memory credentials; no Android device or user NAS claim',
    checks, requests, logs, fatal
  }, null, 2))
  process.exitCode = fatal ? 1 : 0
}
