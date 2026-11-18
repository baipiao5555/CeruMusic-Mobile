import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import http from 'node:http'
import { createRequire } from 'node:module'
import { randomUUID, webcrypto } from 'node:crypto'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(root + '/package.json')
const ts = require('typescript')
const { DOMParser: XmlDOMParser } = require('@xmldom/xmldom')
const out = process.env.CERU_QA_OUT || path.join(os.tmpdir(), 'ceru-webdav-media-qa')
const fixture = path.join(out, 'fixture')
const checks = []
const requests = []
let fatal = ''
let mode = 'normal'
let server
let port
let closed = false

const USERNAME = 'qa'
const PASSWORD = 'synthetic-webdav-media-password'
const authorization = 'Basic ' + Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')

function check(name, actual, expected = true) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  const record = { name, actual, expected, pass }
  checks.push(record)
  console.log(JSON.stringify(record))
  assert.equal(pass, true, name)
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

async function write(rel, body) {
  const target = path.join(fixture, rel)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, body)
}

async function createFixture() {
  await fs.rm(out, { recursive: true, force: true })
  await fs.mkdir(fixture, { recursive: true })
  const wav = Buffer.alloc(44)
  wav.write('RIFF', 0, 'ascii')
  wav.writeUInt32LE(36, 4)
  wav.write('WAVEfmt ', 8, 'ascii')
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24)
  wav.writeUInt32LE(8000, 28)
  wav.writeUInt16LE(1, 32)
  wav.writeUInt16LE(8, 34)
  wav.write('data', 36, 'ascii')
  wav.writeUInt32LE(0, 40)
  const mp3 = Buffer.concat([Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00', 'binary'), Buffer.alloc(40, 0x11)])
  const flac = Buffer.concat([Buffer.from('fLaC', 'ascii'), Buffer.alloc(40, 0x22)])
  const ogg = Buffer.concat([Buffer.from('OggS', 'ascii'), Buffer.alloc(40, 0x33)])
  const opus = Buffer.concat([Buffer.from('OpusHead', 'ascii'), Buffer.alloc(40, 0x44)])
  const aac = Buffer.concat([Buffer.from([0xff, 0xf1, 0x50, 0x80]), Buffer.alloc(40, 0x55)])
  const wma = Buffer.concat([Buffer.from([0x30, 0x26, 0xb2, 0x75]), Buffer.alloc(40, 0x66)])
  const ape = Buffer.concat([Buffer.from('MAC ', 'ascii'), Buffer.alloc(40, 0x77)])
  const aiff = Buffer.concat([Buffer.from('FORM', 'ascii'), Buffer.alloc(40, 0x88)])
  const dsf = Buffer.concat([Buffer.from('DSD ', 'ascii'), Buffer.alloc(40, 0x99)])
  const m4a = Buffer.concat([Buffer.from('ftypM4A ', 'ascii'), Buffer.alloc(40, 0xaa)])

  await write('root.mp3', mp3)
  await write('readme.txt', 'not audio')
  await write('Music/01 - 夜曲.mp3', mp3)
  await write('Music/Upper.MP3', mp3)
  await write('Music/Hash #1.mp3', mp3)
  await write('Music/display.mp3', mp3)
  await write('Music/lossless.flac', flac)
  await write('Music/clip.m4a', m4a)
  await write('Music/loop.ogg', ogg)
  await write('Music/voice.opus', opus)
  await write('Music/take.wav', wav)
  await write('Music/sample.aac', aac)
  await write('Music/old.wma', wma)
  await write('Music/album.ape', ape)
  await write('Music/master.aiff', aiff)
  await write('Music/sacd.dsf', dsf)
  await write('Music/notes.txt', 'not audio')
  await write('Music/cover.jpg', 'not audio')
  await write('Music/list.m3u', '#EXTM3U')
  await write('Music/archive.zip', 'not audio')
  await write('Music/broken.mp3.part', 'not audio')
  await write('Music/fake.mp3/inside.wav', wav)
  await write('Music/Album/02 - Test.FLAC', flac)
  await write('Music/Album/03 - Test.m4a', m4a)
  await write('Music/Album/nested/deep.ogg', ogg)
  await write('Music/Music & More/ampersand.mp3', mp3)
  await write('Music/民乐/二泉映月.flac', flac)
  await write('Music/Unsafe/safe.mp3', mp3)
  await write('A/two.flac', flac)
  await write('A/B/three.ogg', ogg)
  await write('A/B/C/four.wav', wav)
  await write('A/B/C/D/five.opus', opus)
  await write('A/B/C/D/E/six.aac', aac)
}

function contentType(name) {
  const ext = path.extname(name).toLowerCase()
  return {
    '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
    '.ogg': 'audio/ogg', '.opus': 'audio/opus', '.wav': 'audio/wav', '.wma': 'audio/x-ms-wma',
    '.ape': 'audio/x-ape', '.aiff': 'audio/aiff', '.dsf': 'audio/dsf'
  }[ext] || 'application/octet-stream'
}

function hrefFor(rel, directory) {
  const encoded = rel.split('/').map(encodeURIComponent).join('/')
  return '/dav/' + encoded + (directory ? '/' : '')
}

function responseXml(href, displayName, directory, stat) {
  const properties = directory
    ? '<d:resourcetype><d:collection/></d:resourcetype>'
    : `<d:resourcetype/><d:getcontentlength>${stat.size}</d:getcontentlength>` +
      `<d:getlastmodified>${escapeXml(stat.mtime.toUTCString())}</d:getlastmodified>` +
      `<d:getcontenttype>${escapeXml(contentType(displayName))}</d:getcontenttype>`
  return '<d:response>' +
    `<d:href>${escapeXml(href)}</d:href>` +
    '<d:propstat><d:prop>' +
    `<d:displayname>${escapeXml(displayName)}</d:displayname>` +
    properties +
    '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>' +
    '</d:response>'
}

function maliciousResponses() {
  return [
    '<d:response><d:href>/dav/../outside.mp3</d:href><d:propstat><d:prop><d:displayname>outside</d:displayname><d:resourcetype/><d:getcontentlength>1</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>',
    '<d:response><d:href>/dav/Music/Unsafe/%2e%2e/escape.mp3</d:href><d:propstat><d:prop><d:displayname>escape</d:displayname><d:resourcetype/><d:getcontentlength>1</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>',
    '<d:response><d:href>http://evil.invalid/dav/Music/Unsafe/evil.mp3</d:href><d:propstat><d:prop><d:displayname>evil</d:displayname><d:resourcetype/><d:getcontentlength>1</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>',
    '<d:response><d:href>../../outside-relative.mp3</d:href><d:propstat><d:prop><d:displayname>relative</d:displayname><d:resourcetype/><d:getcontentlength>1</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>',
    '<d:response><d:href>/dav/Music/Unsafe/%252e%252e/encoded.mp3</d:href><d:propstat><d:prop><d:displayname>encoded</d:displayname><d:resourcetype/><d:getcontentlength>1</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>',
    '<d:response><d:href>/dav/Music/Unsafe/sub/other.mp3</d:href><d:propstat><d:prop><d:displayname>nested</d:displayname><d:resourcetype/><d:getcontentlength>1</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>'
  ].join('')
}

function safeTarget(urlPath) {
  if (!urlPath.startsWith('/dav/')) return undefined
  let relative
  try {
    relative = decodeURIComponent(urlPath.slice('/dav/'.length))
  } catch {
    return undefined
  }
  const target = path.resolve(fixture, relative)
  const scoped = path.relative(path.resolve(fixture), target)
  if (scoped.startsWith('..') || path.isAbsolute(scoped)) return undefined
  return { target, relative }
}

const serverHandler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PROPFIND,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,Depth,Accept')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length,Content-Type,Last-Modified')
  res.setHeader('DAV', '1')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }
  const url = new URL(req.url, 'http://127.0.0.1')
  requests.push({ method: req.method, path: req.url, depth: req.headers.depth || '', authenticated: req.headers.authorization === authorization })
  if (mode === '401' || req.headers.authorization !== authorization) {
    res.writeHead(401)
    return res.end()
  }
  if (mode === '403') {
    res.writeHead(403)
    return res.end()
  }
  if (mode === 'redirect') {
    res.writeHead(302, { Location: 'http://should-not-be-requested.invalid/' })
    return res.end()
  }
  const scoped = safeTarget(url.pathname)
  if (!scoped) {
    res.writeHead(400)
    return res.end()
  }
  let stat
  try {
    stat = await fs.stat(scoped.target)
  } catch {
    res.writeHead(404)
    return res.end()
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!stat.isFile()) {
      res.writeHead(405)
      return res.end()
    }
    res.writeHead(200, {
      'Content-Type': contentType(scoped.relative),
      'Content-Length': stat.size,
      'Last-Modified': stat.mtime.toUTCString()
    })
    if (req.method === 'HEAD') return res.end()
    return res.end(await fs.readFile(scoped.target))
  }
  if (req.method !== 'PROPFIND') {
    res.writeHead(405)
    return res.end()
  }
  if (req.headers.depth !== '1') {
    res.writeHead(400)
    return res.end()
  }
  if (!stat.isDirectory()) {
    res.writeHead(405)
    return res.end()
  }
  if (mode === 'corrupt') {
    res.writeHead(207, { 'Content-Type': 'application/xml' })
    return res.end('<d:multistatus xmlns:d="DAV:"><d:response><d:href>broken')
  }
  const relativeDir = scoped.relative ? scoped.relative.split(path.sep).join('/').replace(/\/+$/, '') : ''
  const displaySelf = relativeDir ? path.basename(scoped.target) : 'dav'
  let xml = '<d:multistatus xmlns:d="DAV:">' +
    responseXml(hrefFor(relativeDir, true), displaySelf, true, stat)
  const children = await fs.readdir(scoped.target, { withFileTypes: true })
  children.sort((left, right) => left.name.localeCompare(right.name))
  for (const child of children) {
    const childRel = relativeDir ? `${relativeDir}/${child.name}` : child.name
    const childStat = await fs.stat(path.join(scoped.target, child.name))
    const display = childRel === 'Music/display.mp3' ? '夜曲 & 演示' : child.name
    xml += responseXml(hrefFor(childRel, childStat.isDirectory()), display, childStat.isDirectory(), childStat)
  }
  if (relativeDir === 'Music/Unsafe') xml += maliciousResponses()
  xml += '</d:multistatus>'
  res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' })
  res.end(xml)
}

function environment() {
  const storage = new Map()
  const modules = new Map()
  const logs = []
  const manager = {
    pluginState: { plugins: [] },
    registerHostHooks: () => {},
    allProviders: () => [],
    invokeProvider: async () => {
      throw new Error('plugin invocation is not expected in this test')
    }
  }
  class BrowserDOMParser {
    parseFromString(value, type) {
      return new XmlDOMParser({ onError: () => {} }).parseFromString(value, type)
    }
  }
  const context = vm.createContext({
    console: {
      log: value => logs.push(String(value)),
      warn: value => logs.push(String(value)),
      error: value => logs.push(String(value))
    },
    URL,
    Blob,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    crypto: webcrypto,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    fetch,
    DOMParser: BrowserDOMParser,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    }
  })
  function load(file) {
    const name = path.resolve(root, file)
    if (modules.has(name)) return modules.get(name)
    const exports = {}
    modules.set(name, exports)
    const source = require('node:fs').readFileSync(name, 'utf8')
    const code = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
    }).outputText
    const localRequire = id => {
      if (id === 'vue') return { reactive: value => value }
      if (id === '@capacitor/core') {
        return {
          Capacitor: {
            isNativePlatform: () => false,
            getPlatform: () => 'web'
          },
          registerPlugin: () => new Proxy({}, {
            get: () => async () => {
              throw new Error('native plugin is not available in this fixture')
            }
          })
        }
      }
      if (id.endsWith('/plugin/manager') || id === './plugin/manager') return manager
      if (id.endsWith('/shims/crypto')) return { randomUUID }
      if (id.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(name), id + '.ts')))
      return require(id)
    }
    vm.runInContext('(function(exports,require){' + code + '\n})', context, { filename: name })(exports, localRequire)
    return exports
  }
  return {
    storage,
    logs,
    load,
    library: load('src/core/library.ts').libraryState,
    webdav: load('src/core/sync/webdav.ts'),
    media: load('src/core/sync/webdavMedia.ts'),
    source: load('src/core/playback/source.ts'),
    store: load('src/core/native/secureStore.ts').secureStore
  }
}

async function rejectsCode(promise, code, label) {
  try {
    await promise
    check(label, 'resolved', `reject:${code}`)
    return false
  } catch (error) {
    const actual = error?.code || error?.name || String(error)
    check(label, actual, code)
    return actual === code
  }
}

try {
  await createFixture()
  const [routerSource, syncServicesSource, pageSource] = await Promise.all([
    fs.readFile(path.join(root, 'src/router/index.ts'), 'utf8'),
    fs.readFile(path.join(root, 'src/views/SyncServices.vue'), 'utf8'),
    fs.readFile(path.join(root, 'src/views/WebDavMusic.vue'), 'utf8')
  ])
  check('WebDavMusic route is registered', /path:\s*'\/webdav-music'/.test(routerSource))
  check('SyncServices exposes the WebDAV music entry', /router\.push\('\/webdav-music'\)/.test(syncServicesSource))
  check('WebDAV music page has a tablet breakpoint', /@media \(min-width: 768px\)/.test(pageSource))
  server = http.createServer(serverHandler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  port = server.address().port

  const env = environment()
  check('browser credential store is session memory only', await env.store.status(), {
    backend: 'session-memory', persistent: false, encryptedAtRest: false
  })
  const connection = await env.webdav.saveConnection({
    name: 'QA DAV',
    address: `http://127.0.0.1:${port}/dav/`,
    username: USERNAME,
    password: PASSWORD,
    confirmed: true,
    allowInsecureHttp: true
  })
  check('connection config never stores the password', JSON.stringify([...env.storage.values()]).includes(PASSWORD), false)

  const first = await env.media.scanWebDavMusic(connection, { directory: 'Music', maxDepth: 1 })
  const expectedNames = [
    'Music/01 - 夜曲.mp3', 'Music/Hash #1.mp3', 'Music/Upper.MP3', 'Music/album.ape',
    'Music/clip.m4a', 'Music/display.mp3', 'Music/loop.ogg', 'Music/lossless.flac',
    'Music/master.aiff', 'Music/old.wma', 'Music/sacd.dsf', 'Music/sample.aac',
    'Music/take.wav', 'Music/voice.opus'
  ]
  check('Depth 1 returns only immediate audio files', first.files.map(file => file.path), expectedNames)
  check('common audio extensions are all recognized', [...new Set(first.files.map(file => file.extension))].sort(), [
    'aac', 'aiff', 'ape', 'dsf', 'flac', 'm4a', 'mp3', 'ogg', 'opus', 'wav', 'wma'
  ])
  check('non-audio files and audio-like directories are not imported as tracks', first.files.some(file =>
    /\.(txt|jpg|m3u|zip|part)$/.test(file.path) || file.path === 'Music/fake.mp3'
  ), false)
  const display = first.files.find(file => file.path === 'Music/display.mp3')
  check('displayname is parsed and XML entities decoded', display?.displayName, '夜曲 & 演示')
  check('content-length is parsed from PROPFIND', display?.size > 0)
  check('last-modified is parsed from PROPFIND', Number.isFinite(display?.lastModified))
  check('the directory self entry is not counted as an invalid item', first.skipped, 0)
  check('scanner performs one Depth 1 request for one directory', first.directories, 1)
  check('PROPFIND really used Depth 1', requests.filter(item => item.method === 'PROPFIND').every(item => item.depth === '1'))
  check('request URL is scoped to the approved directory', requests.find(item => item.method === 'PROPFIND')?.path, '/dav/Music/')

  const secondScan = await env.media.scanWebDavMusic(connection, { directory: 'Music', maxDepth: 1 })
  check('remote file identities are stable across scans', secondScan.files.map(file => file.id), first.files.map(file => file.id))
  check('identity contains connection and relative path only', first.files[0].id.startsWith(`webdav:${encodeURIComponent(connection.id)}:`))

  const levelTwo = await env.media.scanWebDavMusic(connection, { directory: 'Music', maxDepth: 2 })
  check('Depth 2 includes one nested album level', [
    'Music/Album/02 - Test.FLAC', 'Music/Album/03 - Test.m4a', 'Music/fake.mp3/inside.wav'
  ].every(name => levelTwo.files.some(file => file.path === name)))
  check('Depth 2 does not include the second nested level', levelTwo.files.some(file => file.path === 'Music/Album/nested/deep.ogg'), false)

  const levelFive = await env.media.scanWebDavMusic(connection, { directory: '', maxDepth: 5 })
  check('Depth 5 includes the fifth directory level', levelFive.files.some(file => file.path === 'A/B/C/D/five.opus'))
  check('Depth 5 does not descend to a sixth directory level', levelFive.files.some(file => file.path === 'A/B/C/D/E/six.aac'), false)
  const depthFiveRequests = requests.filter(item => item.method === 'PROPFIND').map(item => item.path)
  check('Depth 5 requests every directory up to the fifth level', [
    '/dav/A/', '/dav/A/B/', '/dav/A/B/C/', '/dav/A/B/C/D/'
  ].every(item => depthFiveRequests.includes(item)))
  check('Depth 5 never requests a sixth-level directory', depthFiveRequests.includes('/dav/A/B/C/D/E/'), false)

  const spaced = await env.media.scanWebDavMusic(connection, { directory: 'Music/Music & More', maxDepth: 1 })
  check('directory names with spaces and ampersands are encoded and scanned', spaced.files.map(file => file.path), ['Music/Music & More/ampersand.mp3'])
  check('encoded directory request reached the fixture', requests.some(item => item.path === '/dav/Music/Music%20%26%20More/'))
  const chinese = await env.media.scanWebDavMusic(connection, { directory: 'Music/民乐', maxDepth: 1 })
  check('Unicode directory names are preserved', chinese.files.map(file => file.displayName), ['二泉映月.flac'])

  const unsafe = await env.media.scanWebDavMusic(connection, { directory: 'Music/Unsafe', maxDepth: 1 })
  check('out-of-scope hrefs are rejected without becoming tracks', unsafe.files.map(file => file.path), ['Music/Unsafe/safe.mp3'])
  check('malformed or traversing hrefs are counted as skipped', unsafe.skipped >= 5)
  check('no request escaped the approved directory', requests.every(item => {
    const decoded = decodeURIComponent(item.path)
    return decoded.startsWith('/dav/') && !decoded.includes('/../') && !decoded.includes('/outside')
  }))

  await rejectsCode(env.media.scanWebDavMusic(connection, { directory: '../secret', maxDepth: 1 }), 'SCOPE', 'parent directory input rejected')
  await rejectsCode(env.media.scanWebDavMusic(connection, { directory: 'Music/../../secret', maxDepth: 1 }), 'SCOPE', 'embedded parent traversal rejected')
  await rejectsCode(env.media.scanWebDavMusic(connection, { directory: '%2e%2e/secret', maxDepth: 1 }), 'SCOPE', 'encoded traversal rejected')
  await rejectsCode(env.media.scanWebDavMusic(connection, { directory: '/etc', maxDepth: 1 }), 'SCOPE', 'absolute directory rejected')
  await rejectsCode(env.media.scanWebDavMusic(connection, { directory: 'Music', maxDepth: 6 }), 'DEPTH', 'scan depth above five rejected')
  await rejectsCode(env.media.scanWebDavMusic({ ...connection, id: 'not-saved' }, { directory: 'Music', maxDepth: 1 }), 'CONNECTION', 'unapproved connection rejected')

  const namespace = `sync.webdav.${connection.id}`
  const credentialValue = JSON.stringify({
    username: USERNAME, password: PASSWORD, origin: connection.origin, basePath: connection.basePath
  })
  await env.store.clearNamespace(namespace)
  await rejectsCode(env.media.scanWebDavMusic(connection, { directory: 'Music', maxDepth: 1 }), 'CREDENTIAL', 'missing secure credential rejected before transport')
  await env.store.set(namespace, 'auth', credentialValue)

  mode = '401'
  await rejectsCode(env.media.scanWebDavMusic(connection, { directory: 'Music', maxDepth: 1 }), 'AUTH', 'HTTP 401 is reported as authentication failure')
  mode = '403'
  await rejectsCode(env.media.scanWebDavMusic(connection, { directory: 'Music', maxDepth: 1 }), 'FORBIDDEN', 'HTTP 403 is reported as forbidden')
  mode = 'redirect'
  await rejectsCode(env.media.scanWebDavMusic(connection, { directory: 'Music', maxDepth: 1 }), 'REDIRECT', 'redirect is not followed')
  mode = 'corrupt'
  const libraryBeforeCorrupt = JSON.stringify(env.library)
  await rejectsCode(env.media.scanWebDavMusic(connection, { directory: 'Music', maxDepth: 1 }), 'XML', 'corrupt multistatus is rejected')
  check('corrupt directory never mutates the local library', JSON.stringify(env.library), libraryBeforeCorrupt)
  mode = 'normal'

  const scan = await env.media.scanWebDavMusic(connection, { directory: 'Music', maxDepth: 1 })
  const imported = env.media.importWebDavMusic(scan.files, {
    connectionName: connection.name, mode: 'new', name: 'WebDAV 测试歌单'
  })
  check('all scanned tracks are imported', imported.importedTracks, scan.files.length)
  const playlist = env.library.playlists.find(item => item.id === imported.playlistIds[0])
  check('playlist keeps PROPFIND order', playlist.tracks.map(track => track.ref.data.path), scan.files.map(file => file.path))
  check('playlist track IDs match stable remote identities', playlist.tracks.map(track => track.id), scan.files.map(file => file.id))
  check('tracks use the webdav pseudo-provider', playlist.tracks.every(track => track.providerId === 'webdav' && track.pluginId === 'webdav'))
  check('tracks preserve connectionId and path in ref.data', playlist.tracks.every(track =>
    track.ref.connectionId === connection.id && track.ref.data.connectionId === connection.id && typeof track.ref.data.path === 'string'
  ))
  check('no password is written into the library', JSON.stringify(env.library).includes(PASSWORD), false)
  check('no Authorization header is stored in the library', /authorization|basic\s/i.test(JSON.stringify(env.library)), false)
  const merged = env.media.importWebDavMusic(scan.files, {
    connectionName: connection.name, mode: 'merge', name: '', targetId: playlist.id
  })
  check('re-import into the same playlist skips every duplicate', merged.importedTracks, 0)
  check('duplicate count matches the selected remote files', merged.skippedTracks, scan.files.length)
  const mixed = { ...scan.files[0], connectionId: 'other-connection' }
  await rejectsCode(Promise.resolve().then(() => env.media.importWebDavMusic([mixed], {
    connectionName: connection.name, mode: 'new', name: 'bad'
  })), 'CONNECTION', 'unknown connection import rejected')
  await rejectsCode(Promise.resolve().then(() => env.media.importWebDavMusic([scan.files[0], mixed], {
    connectionName: connection.name, mode: 'new', name: 'bad'
  })), 'SCOPE', 'mixed-connection import rejected')

  const track = playlist.tracks[0]
  const trackFile = scan.files.find(file => file.id === track.id)
  const source = await env.source.resolveTrackSource(track)
  check('playback source resolves the remote file URL', source.url, trackFile.url)
  check('playback source attaches Basic Authorization from secureStore', source.headers?.Authorization, authorization)
  check('playback source has no other credential fields', Object.keys(source.headers || {}), ['Authorization'])
  const audio = await fetch(source.url, { headers: source.headers })
  check('remote audio bytes are available with the source headers', audio.status, 200)
  check('remote audio fixture is a small real HTTP response', (await audio.arrayBuffer()).byteLength > 0)
  const blobUrl = await env.source.playableUrl(track)
  check('header-based playback downloads the whole file before audio playback', blobUrl.startsWith('blob:'))

  await rejectsCode(env.source.resolveTrackSource({
    ...track, ref: { ...track.ref, data: { ...track.ref.data, path: '../secret.mp3' } }
  }), 'SCOPE', 'tampered playback path rejected')
  await rejectsCode(env.source.resolveTrackSource({
    ...track, ref: { ...track.ref, connectionId: 'other', data: { ...track.ref.data, connectionId: 'other' } }
  }), 'CONNECTION', 'playback with an unapproved connection rejected')
  await env.store.clearNamespace(namespace)
  await rejectsCode(env.source.resolveTrackSource(track), 'CREDENTIAL', 'playback without secure credentials fails clearly')
  await env.store.set(namespace, 'auth', credentialValue)

  check('library still contains no password after all operations', JSON.stringify(env.library).includes(PASSWORD), false)
  check('connection config still contains no password after all operations', JSON.stringify([...env.storage.values()]).includes(PASSWORD), false)

  await new Promise(resolve => server.close(resolve))
  closed = true
  await rejectsCode(env.media.scanWebDavMusic(connection, { directory: 'Music', maxDepth: 1 }), 'NETWORK', 'offline scan reports a network failure')
} catch (error) {
  fatal = error?.stack || String(error)
  console.error(fatal)
} finally {
  if (server && !closed) await new Promise(resolve => server.close(resolve))
  await fs.mkdir(out, { recursive: true })
  await fs.writeFile(path.join(out, 'webdav-media-tests.json'), JSON.stringify({
    command: 'node scripts/test-webdav-media.mjs',
    exitCode: fatal ? 1 : 0,
    scope: 'Real loopback HTTP WebDAV PROPFIND/GET server with physical tiny audio fixtures; actual TS core, secureStore, source resolver and library import; no real NAS or Android device claim',
    checks,
    requests,
    fatal
  }, null, 2))
  process.exitCode = fatal ? 1 : 0
}
