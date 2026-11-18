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
    if (mode === 'delay-get' && req.method === 'GET') { mode = 'normal'; await new Promise(resolve => setTimeout(resolve, 120)) }
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
const hasPlaylist = (view, id) => view.playlists.some(item => item.id === id)
const favoriteTrackIds = view => view.favorites.map(track => track.id)
const remoteTombstones = () => remoteView()?.tombstones || []
const remoteTombstone = (kind, id, playlistId = '') => remoteTombstones().find(item => item.kind === kind && item.id === id && (item.playlistId || '') === playlistId)
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
  check('remote snapshot uses the v2 tombstone envelope', [remoteView().version, Array.isArray(remoteView().tombstones)], [2, true])
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

  const sharePlaylist = async (id, name, tracks = [makeTrack(`${id}-track`, `${name}曲`)]) => {
    a.library.playlists = [makePlaylist(id, name, tracks), ...a.library.playlists.filter(item => item.id !== id)]
    await a.webdav.syncNow(ca)
    await b.webdav.syncNow(cb)
  }

  await sharePlaylist('p-del-a', 'A删除歌单', [makeTrack('t-del-a', 'A删除曲')])
  a.library.playlists = a.library.playlists.filter(item => item.id !== 'p-del-a')
  const aDelete = await a.webdav.syncNow(ca)
  check('A playlist deletion is pushed only after baseline agreement', aDelete.pushed && aDelete.stats.deletedPlaylists === 1)
  check('A deletion removes the remote playlist', hasPlaylist(libraryView(a), 'p-del-a'), false)
  check('remote snapshot keeps a playlist tombstone', remoteTombstones().filter(item => item.kind === 'playlist' && item.id === 'p-del-a').length, 1)
  const aTombstone = remoteTombstone('playlist', 'p-del-a')
  check('playlist tombstone retains restore payload, timestamp and device', Boolean(aTombstone?.playlist?.tracks.some(track => track.id === 't-del-a')) && /^\d{4}-\d{2}-\d{2}T/.test(aTombstone?.deletedAt || '') && Boolean(aTombstone?.deviceId))
  const aAfterDelete = a.webdav.getSyncStatus(ca)
  check('A status exposes deletion counts', aAfterDelete.tombstonePlaylists === 1 && aAfterDelete.tombstones >= 1)
  const bDeletePull = await b.webdav.syncNow(cb)
  check('B applies A deletion when B was unchanged', bDeletePull.pulled && !hasPlaylist(libraryView(b), 'p-del-a'))
  check('B result counts the propagated deletion', bDeletePull.stats.deletedPlaylists === 1)
  check('B sync result exposes remote tombstones', bDeletePull.remoteTombstones.total >= 1 && bDeletePull.remoteTombstones.playlists === 1)
  const bTombstone = b.webdav.listSyncTombstones(cb).find(item => item.kind === 'playlist' && item.id === 'p-del-a')
  check('B can review the tombstone locally', Boolean(bTombstone?.restorable) && Boolean(bTombstone?.playlist?.tracks.length))
  const restoredPlaylist = b.webdav.restoreSyncTombstone(cb, bTombstone.key)
  check('local tombstone restore returns the full playlist', hasPlaylist(libraryView(b), 'p-del-a'))
  check('restored tombstone leaves the review list', b.webdav.listSyncTombstones(cb).some(item => item.key === bTombstone.key), false)
  restoredPlaylist.undo()
  check('tombstone restore can be undone', !hasPlaylist(libraryView(b), 'p-del-a') && b.webdav.listSyncTombstones(cb).some(item => item.key === bTombstone.key))

  await sharePlaylist('p-del-b', 'B删除歌单', [makeTrack('t-del-b', 'B删除曲')])
  b.library.playlists = b.library.playlists.filter(item => item.id !== 'p-del-b')
  const bDelete = await b.webdav.syncNow(cb)
  check('B playlist deletion is pushed', bDelete.pushed && bDelete.stats.deletedPlaylists === 1)
  check('B deletion removes the remote playlist', remoteView().playlists.some(item => item.id === 'p-del-b'), false)
  const aDeletePull = await a.webdav.syncNow(ca)
  check('A applies B deletion when A was unchanged', aDeletePull.pulled && !hasPlaylist(libraryView(a), 'p-del-b'))
  check('A records B deletion in status', a.webdav.getSyncStatus(ca).tombstonePlaylists >= 2)

  await sharePlaylist('p-del-both', '双方删除歌单', [makeTrack('t-del-both', '双方删除曲')])
  a.library.playlists = a.library.playlists.filter(item => item.id !== 'p-del-both')
  b.library.playlists = b.library.playlists.filter(item => item.id !== 'p-del-both')
  await a.webdav.syncNow(ca)
  const firstBothTombstone = remoteTombstone('playlist', 'p-del-both')
  const bothDelete = await b.webdav.syncNow(cb)
  check('both deleting the same playlist is detected', bothDelete.stats.bothDeletedPlaylists === 1)
  check('both deletion leaves one tombstone', remoteTombstones().filter(item => item.kind === 'playlist' && item.id === 'p-del-both').length, 1)
  check('both deletion preserves the first deletion attribution', remoteTombstone('playlist', 'p-del-both')?.deviceId, firstBothTombstone.deviceId)
  check('both deletion leaves neither library with the playlist', hasPlaylist(libraryView(a), 'p-del-both') || hasPlaylist(libraryView(b), 'p-del-both'), false)

  await sharePlaylist('p-del-edit', '删除撞编辑', [makeTrack('t-del-edit', '编辑保留曲')])
  a.library.playlists = a.library.playlists.filter(item => item.id !== 'p-del-edit')
  b.library.playlists.find(item => item.id === 'p-del-edit').name = 'B编辑后的歌单'
  const editDelete = await a.webdav.syncNow(ca)
  check('delete half of a delete-vs-edit race reaches remote once', editDelete.stats.deletedPlaylists === 1 && !remoteView().playlists.some(item => item.id === 'p-del-edit'))
  const editRestore = await b.webdav.syncNow(cb)
  check('edited side restores instead of being silently deleted', editRestore.deletionConflicts.length === 1 && hasPlaylist(libraryView(b), 'p-del-edit'))
  check('delete-vs-edit keeps the edited name', libraryView(b).playlists.find(item => item.id === 'p-del-edit').name, 'B编辑后的歌单')
  check('delete-vs-edit is pushed back to remote', remoteView().playlists.find(item => item.id === 'p-del-edit')?.name, 'B编辑后的歌单')
  check('delete-vs-edit clears the playlist tombstone remotely', Boolean(remoteTombstone('playlist', 'p-del-edit')), false)
  const aEditRestore = await a.webdav.syncNow(ca)
  check('the deleting client converges on the edited version', libraryView(a).playlists.find(item => item.id === 'p-del-edit')?.name, 'B编辑后的歌单')
  check('restored tombstone is counted once', aEditRestore.stats.restoredTombstones, 1)

  await sharePlaylist('p-del-track', '曲目删除歌单', [makeTrack('t-del-1', '删除曲目1'), makeTrack('t-del-2', '保留曲目2')])
  a.library.playlists.find(item => item.id === 'p-del-track').tracks = a.library.playlists.find(item => item.id === 'p-del-track').tracks.filter(track => track.id !== 't-del-1')
  const trackDelete = await a.webdav.syncNow(ca)
  check('track deletion is pushed', trackDelete.pushed && trackDelete.stats.deletedTracks === 1)
  check('track deletion removes only that track remotely', trackIds(remoteView(), 'p-del-track'), ['t-del-2'])
  const trackTombstone = remoteTombstones().find(item => item.kind === 'track' && item.playlistId === 'p-del-track' && item.track?.id === 't-del-1')
  check('track tombstone keeps its playlist identity and portable track', Boolean(trackTombstone?.track?.title) && /^\d{4}-\d{2}-\d{2}T/.test(trackTombstone?.deletedAt || '') && Boolean(trackTombstone?.deviceId))
  const trackPull = await b.webdav.syncNow(cb)
  check('B applies the track deletion and reports it', trackPull.pulled && trackPull.stats.deletedTracks === 1 && trackIds(libraryView(b), 'p-del-track'), ['t-del-2'])
  check('B exposes the remote track tombstone', trackPull.remoteTombstones.tracks >= 1)
  const bTrackTombstone = b.webdav.listSyncTombstones(cb).find(item => item.kind === 'track' && item.playlistId === 'p-del-track')
  const restoredTrack = b.webdav.restoreSyncTombstone(cb, bTrackTombstone.key)
  check('track tombstone restores into its playlist', trackIds(libraryView(b), 'p-del-track').includes('t-del-1'))
  const restoredTrackPush = await b.webdav.syncNow(cb)
  check('restored track is republished', restoredTrackPush.pushed && trackIds(remoteView(), 'p-del-track').includes('t-del-1'))
  check('restored track clears its remote tombstone', remoteTombstones().some(item => item.kind === 'track' && item.playlistId === 'p-del-track'), false)
  check('track restore result names the restored item', restoredTrack.name, '删除曲目1')

  await sharePlaylist('p-move-src', '移动源歌单', [makeTrack('t-move', '跨歌单移动曲')])
  await sharePlaylist('p-move-dst', '移动目标歌单', [])
  const movedTrack = a.library.playlists.find(item => item.id === 'p-move-src').tracks[0]
  a.library.playlists.find(item => item.id === 'p-move-src').tracks = []
  a.library.playlists.find(item => item.id === 'p-move-dst').tracks = [movedTrack]
  const moveSync = await a.webdav.syncNow(ca)
  check('moving a track between playlists is not a deletion', moveSync.stats.deletedTracks, 0)
  check('moved track remains in the destination remotely', trackIds(remoteView(), 'p-move-dst').includes('t-move') && !trackIds(remoteView(), 'p-move-src').includes('t-move'))
  check('moving a track creates no fake tombstone', remoteTombstones().some(item => item.kind === 'track' && item.track?.id === 't-move'), false)
  const movePull = await b.webdav.syncNow(cb)
  check('the other client applies a track move without restoring to the source', trackIds(libraryView(b), 'p-move-src').includes('t-move'), false)
  check('track move creates no deletion in the receiving result', movePull.stats.deletedTracks === 0 && movePull.stats.bothDeletedTracks === 0)

  await sharePlaylist('p-move2-src', '双端移动源歌单', [makeTrack('t-move2', '双端移动曲')])
  await sharePlaylist('p-move2-dst', '双端移动目标歌单', [])
  for (const env of [a, b]) {
    const source = env.library.playlists.find(item => item.id === 'p-move2-src')
    const moved = source.tracks[0]
    source.tracks = []
    env.library.playlists.find(item => item.id === 'p-move2-dst').tracks = [moved]
  }
  await a.webdav.syncNow(ca)
  const bothMove = await b.webdav.syncNow(cb)
  check('both clients moving the same track is not reported as both-deleted', bothMove.stats.bothDeletedTracks, 0)
  check('both-client track move leaves one destination copy and no tombstone', trackIds(libraryView(b), 'p-move2-dst').includes('t-move2') && !remoteTombstones().some(item => item.kind === 'track' && item.track?.id === 't-move2'))

  await sharePlaylist('p-track-edit', '曲目删除撞编辑', [makeTrack('t-edit-1', '编辑冲突曲1'), makeTrack('t-edit-2', '编辑冲突曲2')])
  a.library.playlists.find(item => item.id === 'p-track-edit').tracks = a.library.playlists.find(item => item.id === 'p-track-edit').tracks.filter(track => track.id !== 't-edit-1')
  b.library.playlists.find(item => item.id === 'p-track-edit').name = '本地改名保留曲目'
  await a.webdav.syncNow(ca)
  const trackEditConflict = await b.webdav.syncNow(cb)
  const trackConflict = trackEditConflict.deletionConflicts.find(item => item.kind === 'track' && item.playlistId === 'p-track-edit')
  check('track delete-vs-edit is reported', Boolean(trackConflict) && trackEditConflict.deletionConflicts.length >= 1)
  check('track delete-vs-edit restores the deleted track', trackIds(libraryView(b), 'p-track-edit').includes('t-edit-1'))
  check('track delete-vs-edit preserves the edited playlist name', libraryView(b).playlists.find(item => item.id === 'p-track-edit').name, '本地改名保留曲目')
  check('track delete-vs-edit keeps a conflict copy and reports copy conflict', trackEditConflict.conflicts.length >= 1)
  check('track delete-vs-edit removes the stale track tombstone', remoteTombstones().some(item => item.kind === 'track' && item.playlistId === 'p-track-edit'), false)
  await a.webdav.syncNow(ca)
  check('the deleting client converges on the restored track', trackIds(libraryView(a), 'p-track-edit').includes('t-edit-1'))

  const deletedFavorite = makeTrack('fa-del', 'A删除收藏')
  a.library.favorites = [deletedFavorite, ...a.library.favorites.filter(track => track.id !== 'fa-del')]
  await a.webdav.syncNow(ca)
  await b.webdav.syncNow(cb)
  a.library.favorites = a.library.favorites.filter(track => track.id !== 'fa-del')
  const favoriteDelete = await a.webdav.syncNow(ca)
  check('favorite deletion is pushed', favoriteDelete.pushed && favoriteDelete.stats.deletedFavorites === 1)
  check('remote keeps a favorite tombstone', remoteTombstones().some(item => item.kind === 'favorite' && item.track?.id === 'fa-del'))
  const favoritePull = await b.webdav.syncNow(cb)
  check('B applies favorite deletion', favoritePull.pulled && !favoriteTrackIds(libraryView(b)).includes('fa-del') && favoritePull.stats.deletedFavorites === 1)
  const favoriteTombstone = b.webdav.listSyncTombstones(cb).find(item => item.kind === 'favorite' && item.track?.id === 'fa-del')
  const restoredFavorite = b.webdav.restoreSyncTombstone(cb, favoriteTombstone.key)
  check('favorite tombstone restores the favorite', favoriteTrackIds(libraryView(b)).includes('fa-del'))
  await b.webdav.syncNow(cb)
  check('restored favorite is republished and its tombstone cleared', favoriteTrackIds(remoteView()).includes('fa-del') && !remoteTombstones().some(item => item.kind === 'favorite' && item.track?.id === 'fa-del'))
  check('favorite restore result names the track', restoredFavorite.name, 'A删除收藏')

  await sharePlaylist('p-del-undo', '恢复后同步测试', [makeTrack('t-del-undo', '恢复后同步曲')])
  a.library.playlists = a.library.playlists.filter(item => item.id !== 'p-del-undo')
  await a.webdav.syncNow(ca)
  await b.webdav.syncNow(cb)
  const staleTombstone = b.webdav.listSyncTombstones(cb).find(item => item.kind === 'playlist' && item.id === 'p-del-undo')
  const staleRestore = b.webdav.restoreSyncTombstone(cb, staleTombstone.key)
  await b.webdav.syncNow(cb)
  let staleUndoRejected = false
  try { staleRestore.undo() } catch (error) { staleUndoRejected = error?.code === 'STALE' }
  check('restore undo is rejected after an intervening sync', staleUndoRejected)
  check('stale undo leaves the restored item published', hasPlaylist(libraryView(b), 'p-del-undo') && hasPlaylist(remoteView(), 'p-del-undo'))

  await c.webdav.syncNow(cc)
  await sharePlaylist('p-del-c', '第三端删除歌单', [makeTrack('t-del-c', '第三端曲目')])
  await c.webdav.syncNow(cc)
  c.library.playlists = c.library.playlists.filter(item => item.id !== 'p-del-c')
  const cDelete = await c.webdav.syncNow(cc)
  const cDevice = c.snapshot.exportLibrarySnapshot().deviceId
  const cTombstone = remoteTombstones().find(item => item.kind === 'playlist' && item.id === 'p-del-c')
  check('another client deletion is pushed with its device id', cDelete.pushed && cTombstone?.deviceId === cDevice)
  const aRemoteDelete = await a.webdav.syncNow(ca)
  check('A applies a deletion made by another client', aRemoteDelete.pulled && !hasPlaylist(libraryView(a), 'p-del-c'))
  check('another client deletion is visible in A sync result', aRemoteDelete.remoteTombstones.playlists >= 1 && aRemoteDelete.stats.deletedPlaylists === 1)
  const historyBackup = await a.webdav.createBackup(ca)
  const historyBackupBody = JSON.parse(remote.get('/dav/' + historyBackup).body)
  check('manual backup retains the tombstone ledger', historyBackupBody.version === 2 && historyBackupBody.tombstones.length >= 1)
  check('manual backup history contains the other-client deletion', historyBackupBody.tombstones.some(item => item.kind === 'playlist' && item.id === 'p-del-c'))

  const legacyV1 = {
    schema: 'ceru.library.sync', version: 1, createdAt: '2026-01-02T03:04:05.000Z',
    favorites: [{ id: 'legacy-fav', title: '旧收藏', artist: '', album: '', durationMs: 1000, artwork: '/default-cover.png', qualities: ['128k'], source: { manifestId: 'fixture', providerId: 'kw', kind: 'track', id: 'legacy-fav', requiresRebind: false } }],
    playlists: [{ id: 'legacy-p', name: '旧歌单', description: '', cover: '', createdAt: 1, tracks: [{ id: 'legacy-t', title: '旧曲目', artist: '', album: '', durationMs: 1000, artwork: '/default-cover.png', qualities: ['128k'], source: { manifestId: 'fixture', providerId: 'kw', kind: 'track', id: 'legacy-t', requiresRebind: false } }] }]
  }
  const legacyParser = a.snapshot.parseLibrarySnapshot(JSON.stringify(legacyV1))
  check('legacy v1 snapshot is accepted and reported as v2', legacyParser.version, 2)
  check('legacy v1 migration keeps playlists, tracks and favorites', legacyParser.playlists[0]?.tracks[0]?.id === 'legacy-t' && legacyParser.favorites[0]?.id === 'legacy-fav')
  check('legacy v1 migration starts with an empty tombstone ledger', legacyParser.tombstones.length, 0)

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
  check('missing remote does not manufacture conflict copies', recreate.conflicts.length, 0)
  check('recreated remote preserves the deletion ledger', (remoteView().tombstones || []).length > 0)

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

  const u = environment()
  const cu = await u.webdav.saveConnection({ name: 'U', address, username: 'twoway', password: PASSWORD, confirmed: true, allowInsecureHttp: true })
  setLibrary(u, [makeTrack('fc', 'C收藏')], [makePlaylist('pc', 'C歌单', [makeTrack('tc', 'C曲')])])
  const beforeUnsigned = libraryText(u)
  mode = 'ignore-conditions'
  await assert.rejects(u.webdav.syncNow(cu), error => error.code === 'UNVERIFIED')
  mode = 'normal'
  check('server ignoring conditions cannot enable two-way sync', libraryText(u), beforeUnsigned)
  check('unverified server has no baseline', u.webdav.getSyncStatus(cu).hasBaseline, false)

  setLibrary(t, [], [makePlaylist('pt', '超时歌单', [makeTrack('tt', '超时曲')])])
  const beforeTimeout = libraryText(t)
  mode = 'hang'
  await assert.rejects(t.webdav.syncNow(ct), error => error.code === 'NETWORK')
  mode = 'normal'
  check('timeout blocks sync without local mutation', libraryText(t), beforeTimeout)

  const v = environment(), cv = await v.webdav.saveConnection({ name: 'V', address, username: 'twoway', password: PASSWORD, confirmed: true, allowInsecureHttp: true })
  setLibrary(v, [], [makePlaylist('p-bad-baseline', '损坏基线歌单', [makeTrack('t-bad-baseline', '损坏基线曲')])])
  v.storage.set('ceru.sync.webdav.state.v1', JSON.stringify({ version: 1, connections: { [cv.id]: {
    origin: cv.origin, basePath: cv.basePath, enabled: false, autoSyncMinutes: 3,
    baseline: { schema: 'ceru.library.sync', version: 2, createdAt: 'bad', favorites: [], playlists: [], tombstones: 'broken' },
    remoteEtag: '"bad"'
  } } }))
  const beforeBadBaseline = libraryText(v)
  await assert.rejects(v.webdav.syncNow(cv), error => error.code === 'BASELINE')
  check('corrupt local baseline blocks sync without local mutation', libraryText(v), beforeBadBaseline)
  const badState = JSON.parse(v.storage.get('ceru.sync.webdav.state.v1')).connections[cv.id]
  check('corrupt local baseline is not silently cleared', badState.baseline?.tombstones, 'broken')

  await a.webdav.setSyncSettings(ca, { enabled: true })
  mode = 'delay-get'
  const settingsRaceSync = a.webdav.syncNow(ca)
  for (let attempts = 0; mode === 'delay-get' && attempts < 100; attempts++) await new Promise(resolve => setTimeout(resolve, 5))
  await a.webdav.setSyncSettings(ca, { enabled: false })
  await settingsRaceSync
  check('sync does not overwrite settings changed during the network wait', a.webdav.getSyncStatus(ca).enabled, false)

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

  const allStorage = [a, b, c, t, u, v].flatMap(env => [...env.storage.values()]).join('\n')
  check('credentials never logged or persisted in plaintext', allStorage.includes(PASSWORD) || [a, b, c, t, u, v].some(env => env.logs.join('\n').includes(PASSWORD)), false)

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
