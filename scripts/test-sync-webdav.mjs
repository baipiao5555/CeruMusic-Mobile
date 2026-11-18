import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import http from 'node:http'
import { createRequire } from 'node:module'
import { randomUUID, webcrypto } from 'node:crypto'
const root = path.resolve(import.meta.dirname, '..'), require = createRequire(root + '/package.json'), ts = require('typescript')
const out = process.env.CERU_QA_OUT || path.join(os.tmpdir(), 'ceru-sync-webdav-qa')
await fs.mkdir(out, { recursive: true })
const checks = [], requests = [], remote = new Map()
let tag = 0, mode = 'normal', port, closed = false
const authorization = 'Basic ' + Buffer.from('qa:synthetic-password').toString('base64')
const server = http.createServer(async (req, res) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,HEAD,PUT,DELETE,OPTIONS,PROPFIND,MKCOL', 'Access-Control-Allow-Headers': 'Authorization,Content-Type,Depth,If-Match,If-None-Match', 'Access-Control-Expose-Headers': 'ETag,DAV,Allow,Content-Length', DAV: '1', Allow: 'GET,HEAD,PUT,DELETE,OPTIONS,PROPFIND,MKCOL' }
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value)
  if (req.method === 'OPTIONS' && !req.headers.authorization) { res.writeHead(204); return res.end() }
  requests.push({ method: req.method, file: path.basename(new URL(req.url, 'http://fixture.invalid').pathname), ifMatch: Boolean(req.headers['if-match']), ifNone: Boolean(req.headers['if-none-match']) })
  if (req.headers.authorization !== authorization || mode === '401') { res.writeHead(401); return res.end() }
  if (mode === '403') { res.writeHead(403); return res.end() }
  if (mode === 'redirect') { res.writeHead(302, { Location: 'http://should-not-be-requested.invalid/' }); return res.end() }
  const file = req.url
  if (req.method === 'OPTIONS') { res.writeHead(200); return res.end() }
  if (req.method === 'PROPFIND') { res.writeHead(207, { 'Content-Type': 'application/xml' }); return res.end('<d:multistatus xmlns:d="DAV:">' + [...remote.keys()].map(name => `<d:response><d:href>${name}</d:href></d:response>`).join('') + '</d:multistatus>') }
  if (req.method === 'MKCOL') { res.writeHead(201); return res.end() }
  if (req.method === 'PUT') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const existing = remote.get(file)
    if (mode !== 'ignore-conditions' && ((req.headers['if-none-match'] === '*' && existing) || (req.headers['if-match'] && existing?.etag !== req.headers['if-match']))) { res.writeHead(412); return res.end() }
    const item = { body: Buffer.concat(chunks).toString('utf8'), etag: '"v' + (++tag) + '"' }; remote.set(file, item); res.writeHead(existing ? 204 : 201, { ETag: item.etag }); return res.end()
  }
  const existing = remote.get(file)
  if (!existing) { res.writeHead(404); return res.end() }
  if (req.method === 'DELETE') {
    if (mode !== 'ignore-conditions' && req.headers['if-match'] && req.headers['if-match'] !== existing.etag) { res.writeHead(412); return res.end() }
    remote.delete(file); res.writeHead(204); return res.end()
  }
  if (req.method === 'GET' || req.method === 'HEAD') { res.writeHead(200, { ETag: existing.etag, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(existing.body) }); return res.end(req.method === 'HEAD' ? '' : existing.body) }
  res.writeHead(405); res.end()
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); port = server.address().port
function environment(native = false) {
  const storage = new Map(), modules = new Map(), logs = []
  const manager = { pluginState: { plugins: [] }, registerHostHooks: () => {} }
  const nativeCalls = []
  const context = vm.createContext({ console: { log: value => logs.push(String(value)), warn: value => logs.push(String(value)), error: value => logs.push(String(value)) },
    URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, AbortController, setTimeout, clearTimeout, Date, crypto: webcrypto, btoa: value => Buffer.from(value, 'binary').toString('base64'), fetch,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) } })
  function load(file) {
    const name = path.resolve(root, file); if (modules.has(name)) return modules.get(name)
    const exports = {}; modules.set(name, exports)
    const source = require('node:fs').readFileSync(name, 'utf8')
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
    const localRequire = id => {
      if (id === 'vue') return { reactive: value => value }
      if (id === '@capacitor/core') return { Capacitor: { isNativePlatform: () => native, getPlatform: () => native ? 'android' : 'web' }, registerPlugin: name => new Proxy({}, { get: (_, method) => async args => { nativeCalls.push({ name, method, keys: Object.keys(args || {}) }); throw new Error('controlled native unavailable') } }) }
      if (id.endsWith('/plugin/manager') || id === './plugin/manager') return manager
      if (id.endsWith('/shims/crypto')) return { randomUUID }
      if (id.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(name), id + '.ts')))
      return require(id)
    }
    vm.runInContext('(function(exports,require){' + code + '\n})', context, { filename: name })(exports, localRequire); return exports
  }
  return { storage, logs, nativeCalls, load, library: load('src/core/library.ts').libraryState, webdav: load('src/core/sync/webdav.ts'), store: load('src/core/native/secureStore.ts').secureStore }
}
const redact = value => typeof value === 'string' ? value.replace(/synthetic-password|synthetic-source-token|second-secret/g, '[redacted]') : value
const check = (name, actual, expected = true) => { const pass = JSON.stringify(actual) === JSON.stringify(expected); checks.push({ name, actual: redact(actual), expected: redact(expected), pass }); console.log(JSON.stringify(checks.at(-1))); assert.equal(pass, true, name) }
const track = { id: '1', pluginId: 'fixture', providerId: 'kw', providerName: 'QA', title: 'QA曲目', artist: 'QA歌手', album: '', durationMs: 1000, artwork: '/default-cover.png', qualities: ['128k'], ref: { kind: 'track', id: '1', providerId: 'kw', pluginId: 'fixture', connectionId: 'synthetic-private-connection', data: { token: 'synthetic-source-token' } } }
let fatal
try {
  const a = environment(), b = environment()
  check('web credential store is explicitly memory only', await a.store.status(), { backend: 'session-memory', persistent: false, encryptedAtRest: false })
  await a.store.set('one', 'same', 'synthetic-password'); await a.store.set('two', 'same', 'second-secret'); check('namespace isolation', await a.store.get('one', 'same'), 'synthetic-password'); await a.store.clearNamespace('one'); check('namespace clear leaves other namespace', await a.store.get('two', 'same'), 'second-secret'); check('cleared namespace is empty', await a.store.get('one', 'same'), null)
  await assert.rejects(a.store.set('../escape', 'key', 'x')); check('invalid namespace rejected', true)
  await assert.rejects(a.store.set('one', undefined, 'x')); check('undefined credential key rejected', true)
  check('new browser session has no sensitive credential', await b.store.get('two', 'same'), null)
  const n = environment(true); await assert.rejects(n.store.set('host.auth', 'token', 'synthetic-password')); check('native failure never falls back to plaintext/session', n.storage.size, 0)
  const input = { name: 'QA DAV', address: `http://127.0.0.1:${port}/dav/`, username: 'qa', password: 'synthetic-password', confirmed: true, allowInsecureHttp: true }
  const ca = await a.webdav.saveConnection(input), cb = await b.webdav.saveConnection(input)
  check('persisted connection config contains no password', JSON.stringify([...a.storage.values()]).includes('synthetic-password'), false)
  check('private network approval is separate and explicit', ca.allowInsecureHttp && ca.confirmed)
  const beforeSourceRequest = requests.length
  assert.throws(() => a.load('src/core/plugin/network.ts').validateRemoteUrl(`http://127.0.0.1:${port}/dav/`))
  check('music-source network policy still rejects loopback/NAS channel', requests.length, beforeSourceRequest)
  const beforeChangedOrigin = requests.length
  await assert.rejects(a.webdav.webDavRequest({ ...ca, origin: 'https://should-not-be-requested.invalid' }, 'GET'), error => error.code === 'CREDENTIAL_SCOPE')
  check('encrypted credentials bound to confirmed origin/directory', requests.length, beforeChangedOrigin)
  await assert.rejects(a.webdav.webDavRequest(ca, 'GET', '', undefined, { Cookie: 'must-not-forward' }), error => error.code === 'HEADER')
  await assert.rejects(a.webdav.webDavRequest(ca, 'PROPFIND', '', undefined, { Depth: 'infinity' }), error => error.code === 'HEADER')
  check('unapproved headers/unbounded directory depth rejected before transport', requests.length, beforeChangedOrigin)
  for (const address of ['http://127.0.0.1/dav/../secret', 'https://user:password@example.test/dav/', 'https://example.test/dav/?token=x', 'https://example.test/dav/%252e/']) { assert.throws(() => a.webdav.normalizeEndpoint(address, true)); }
  check('endpoint traversal/userinfo/query/double encoding rejected', true)
  const proof = await a.webdav.testConnection(ca), proofB = await b.webdav.testConnection(cb)
  check('actual loopback DAV read/write/ETag test passes', proof.readWrite && proof.etagVerified && proof.cleanup)
  check('second client independent ETag proof passes', proofB.etagVerified)
  check('test cleanup touches probe files only', [...remote.keys()].filter(key => key.includes('.ceru-test-')).length, 0)
  a.library.favorites = [track]; a.library.playlists = [{ id: 'local', name: 'QA歌单', tracks: [track], createdAt: 1 }]
  b.library.favorites = [{ ...track, title: 'ClientB' }]; b.library.playlists = []
  const file = await a.webdav.createBackup(ca)
  check('independent backup never uses arbitrary remote filename', /^\.ceru-backup-[A-Za-z0-9_-]+\.json$/.test(file))
  const body = remote.get('/dav/' + file).body
  check('actual snapshot strips credentials and private refs', /synthetic-password|synthetic-source-token|connectionId|"data"/.test(body), false)
  const beforeRead = JSON.stringify(b.library)
  const preview = await b.webdav.readBackup(cb, file); check('read/preview does not modify local library', JSON.stringify(b.library), beforeRead)
  const restored = b.webdav.commitRestore(preview, 'replace'); check('root atomic restore API commits backup playlists', b.library.playlists.length, 1); check('private references remain pending after restore', restored.counts.pending > 0); restored.undo(); check('root atomic undo restores original local library', JSON.stringify(b.library), beforeRead)
  await a.webdav.publishCurrentBackup(ca)
  await b.webdav.readBackup(cb, a.webdav.currentBackupFile)
  a.library.favorites = [{ ...track, title: 'ClientA updated' }]; await a.webdav.publishCurrentBackup(ca)
  const latest = remote.get('/dav/' + a.webdav.currentBackupFile).body
  await assert.rejects(b.webdav.publishCurrentBackup(cb), error => error.code === 'CONFLICT'); check('two-client stale ETag yields412 and never overwrites', remote.get('/dav/' + a.webdav.currentBackupFile).body, latest)
  const canonicalPath = '/dav/' + a.webdav.currentBackupFile
  remote.set(canonicalPath, { body: '{broken', etag: '"damaged"' }); await assert.rejects(b.webdav.readBackup(cb, a.webdav.currentBackupFile), error => error.code === 'CORRUPT'); check('damaged backup never mutates local library', JSON.stringify(b.library), beforeRead)
  mode = '401'; await assert.rejects(a.webdav.testConnection(ca), error => error.code === 'AUTH'); check('401 is not a fake successful connection', true)
  mode = '403'; await assert.rejects(a.webdav.createBackup(ca), error => error.code === 'FORBIDDEN'); check('403 fails safely', true)
  mode = 'redirect'; await assert.rejects(a.webdav.createBackup(ca), error => error.code === 'REDIRECT'); check('redirect is not followed with credentials', true)
  mode = 'ignore-conditions'; const unverified = await b.webdav.testConnection(cb); check('server ignoring preconditions is not marked ETag-safe', unverified.etagVerified, false); await assert.rejects(b.webdav.publishCurrentBackup(cb), error => error.code === 'UNVERIFIED'); check('unverified server cannot conditionally overwrite current backup', true)
  await assert.rejects(a.webdav.webDavRequest(ca, 'DELETE', a.webdav.currentBackupFile), error => error.code === 'SCOPE'); check('backup directory/current file DELETE is forbidden', true)
  mode = 'normal'; await a.webdav.webDavRequest(ca, 'MKCOL'); check('DAV custom method really reaches server', requests.some(r => r.method === 'MKCOL'))
  remote.set(canonicalPath, { body: latest, etag: '"restored"' })
  check('sync status starts without a baseline', a.webdav.getSyncStatus(ca).hasBaseline, false)
  const coreSync = await a.webdav.syncNow(ca)
  check('syncNow establishes a per-connection baseline', a.webdav.getSyncStatus(ca).hasBaseline)
  check('syncNow returns a real sync state', ['up-to-date', 'pushed', 'pulled', 'merged'].includes(coreSync.status))
  const legacy = environment(), legacyConnection = await legacy.webdav.saveConnection(input)
  const legacyBody = { schema: 'ceru.library.sync', version: 1, createdAt: '2026-01-02T03:04:05.000Z',
    favorites: [{ id: 'legacy-fav', title: '旧收藏', artist: '', album: '', durationMs: 1000, artwork: '/default-cover.png', qualities: ['128k'], source: { manifestId: 'fixture', providerId: 'kw', kind: 'track', id: 'legacy-fav', requiresRebind: false } }],
    playlists: [{ id: 'legacy-playlist', name: '旧版歌单', description: '', cover: '', createdAt: 1, tracks: [{ id: 'legacy-track', title: '旧版曲目', artist: '', album: '', durationMs: 1000, artwork: '/default-cover.png', qualities: ['128k'], source: { manifestId: 'fixture', providerId: 'kw', kind: 'track', id: 'legacy-track', requiresRebind: false } }] }] }
  remote.set(canonicalPath, { body: JSON.stringify(legacyBody), etag: '"legacy-v1"' })
  const legacySync = await legacy.webdav.syncNow(legacyConnection)
  check('v1 remote snapshot migrates instead of failing', legacySync.pulled && legacy.library.playlists[0]?.id, 'legacy-playlist')
  const migratedRemote = JSON.parse(remote.get(canonicalPath).body)
  check('v1 remote snapshot is rewritten as v2 without data loss', migratedRemote.version === 2 && migratedRemote.playlists[0]?.tracks[0]?.id === 'legacy-track' && migratedRemote.favorites[0]?.id === 'legacy-fav')
  check('v1 migration starts with an empty tombstone ledger', migratedRemote.tombstones, [])
  check('legacy migration establishes a baseline without tombstones', legacy.webdav.getSyncStatus(legacyConnection).tombstones, 0)
  await a.webdav.setSyncSettings(ca, { enabled: true })
  const syncState = JSON.parse(a.storage.get('ceru.sync.webdav.state.v1'))
  check('sync settings persist per connection', syncState.connections[ca.id].enabled === true && syncState.connections[ca.id].autoSyncMinutes === 3)
  check('sync state never contains the password', JSON.stringify(syncState).includes('synthetic-password'), false)
  await a.webdav.removeConnection(ca); check('remove connection clears its secure credentials', await a.store.get('sync.webdav.' + ca.id, 'auth'), null); check('remove connection clears its baseline', JSON.parse(a.storage.get('ceru.sync.webdav.state.v1')).connections[ca.id] === undefined); check('remove connection never deletes remote backup', remote.has('/dav/' + file))
  check('credentials never enter module logs', a.logs.join('\n').includes('synthetic-password'), false)
  check('no credentials persisted by either client config', JSON.stringify([...b.storage.entries()]).includes('synthetic-password'), false)
  await new Promise(resolve => server.close(resolve)); closed = true
  await assert.rejects(b.webdav.createBackup(cb), error => error.code === 'NETWORK'); check('offline reports failure, not success', true)
} catch (error) { fatal = error.stack; console.error(fatal) }
finally { if (!closed) await new Promise(resolve => server.close(resolve)); await fs.writeFile(path.join(out, 'webdav-core-tests.json'), JSON.stringify({ command: 'node scripts/test-sync-webdav.mjs', exitCode: fatal ? 1 : 0, scope: 'Real loopback HTTP DAV server, actual TS core and root whitelist/atomic restore; browser credentials are isolated session memory; no Android device claim', checks, requests, fatal }, null, 2)); process.exitCode = fatal ? 1 : 0 }
