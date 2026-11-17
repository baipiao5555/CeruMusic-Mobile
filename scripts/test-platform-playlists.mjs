import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(import.meta.dirname, '..')
const evidenceDir = process.env.CERU_EVIDENCE_DIR ||
  path.resolve(root, '..', 'CeruMusic-Mobile-酷狗酷我与新增平台-2026-11-17', 'evidence', 'platform-v2625')
const livePlaylistId = process.env.CERU_NETEASE_PLAYLIST || '18587698000'
const checks = []
const errors = []
let module
let rawPlaylist = null
let liveDetail = null

function check(name, condition, detail = '') {
  if (!condition) throw new Error(name + (detail ? ': ' + detail : ''))
  checks.push({ name, pass: true })
}

async function nodeRequest(options) {
  const response = await fetch(options.url, {
    method: options.method || 'GET',
    headers: options.headers || {}
  })
  const text = await response.text()
  let data = text
  try { data = JSON.parse(text) } catch {}
  return { status: response.status, data }
}

async function loadModule() {
  const stubSources = {
    './net': 'export const httpRequest = (options) => globalThis.__ceruPlatformRequest(options)\n',
    './platformAccounts': 'export const readPlatformSession = (id) => globalThis.__ceruPlatformSession(id)\n',
    './library': 'export const commitPlaylistImport = (drafts, options) => globalThis.__ceruPlatformCommit(drafts, options)\n',
    './track': 'export {}\n',
    './native/platformLogin': 'export {}\n',
    '@shiqianjiang/ceru-plugin-sdk': 'export {}\n'
  }
  const result = await build({
    entryPoints: [path.join(root, 'src/core/platformPlaylists.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
    plugins: [{
      name: 'ceru-platform-test-stubs',
      setup(builder) {
        builder.onResolve({ filter: /^(\.\/(net|platformAccounts|library|track)|\.\/native\/platformLogin|@shiqianjiang\/ceru-plugin-sdk)$/ }, (args) => ({
          path: args.path,
          namespace: 'ceru-platform-test-stub'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'ceru-platform-test-stub' }, (args) => ({
          contents: stubSources[args.path] || 'export {}\n',
          loader: 'js'
        }))
      }
    }]
  })
  const bundlePath = path.join(tmpdir(), `ceru-platform-playlists-${process.pid}.mjs`)
  await writeFile(bundlePath, result.outputFiles[0].text)
  module = await import(pathToFileURL(bundlePath).href + '?v=' + Date.now())
  await rm(bundlePath, { force: true })
}

function neteaseFixtureAccount() {
  return {
    code: 200,
    account: { id: 42, userId: 42 },
    profile: { userId: 42, nickname: '测试账号' }
  }
}

function neteaseFixturePlaylistList() {
  return {
    code: 200,
    more: false,
    playlist: [{
      id: 99001,
      name: '公开测试歌单',
      trackCount: 2,
      coverImgUrl: 'http://p1.music.126.net/test.jpg',
      creator: { nickname: '测试用户' },
      description: 'fixture'
    }]
  }
}

function neteaseFixtureDetail() {
  return {
    code: 200,
    playlist: {
      id: 99001,
      name: '公开测试歌单',
      trackCount: 3,
      coverImgUrl: 'http://p1.music.126.net/test.jpg',
      creator: { nickname: '测试用户' },
      trackIds: [{ id: 101 }, { id: 102 }, { id: 103 }],
      tracks: [{
        id: 101,
        name: '第一首',
        ar: [{ name: '甲' }, { name: '乙' }],
        al: { name: '专辑一', picUrl: 'http://p2.music.126.net/a.jpg' },
        dt: 61000
      }]
    }
  }
}

function neteaseFixtureSongDetail() {
  return {
    code: 200,
    songs: [
      { id: 102, name: '第二首', artists: [{ name: '丙' }], album: { name: '专辑二', picUrl: 'http://p2.music.126.net/b.jpg' }, duration: 62000 },
      { id: 103, name: '第三首', artists: [{ name: '丁' }], album: { name: '专辑三', picUrl: 'http://p2.music.126.net/c.jpg' }, duration: 63000 }
    ]
  }
}

async function run() {
  await mkdir(evidenceDir, { recursive: true })
  await loadModule()
  globalThis.__ceruPlatformRequest = nodeRequest
  globalThis.__ceruPlatformSession = async () => null
  globalThis.__ceruPlatformCommit = () => { throw new Error('unexpected commit') }

  // 1. Live public NetEase playlist: playlist/detail + ordered conversion.
  const rawResponse = await nodeRequest({
    url: `https://music.163.com/api/v6/playlist/detail?id=${livePlaylistId}&n=1000&s=0`,
    headers: { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0' }
  })
  check('live NetEase playlist/detail HTTP 200', rawResponse.status === 200, 'HTTP ' + rawResponse.status)
  rawPlaylist = rawResponse.data?.playlist
  check('live NetEase playlist has a public name and track IDs', Boolean(rawPlaylist?.name) && Array.isArray(rawPlaylist?.trackIds) && rawPlaylist.trackIds.length > 20)
  liveDetail = await module.fetchNeteasePlaylistDetail(livePlaylistId, {})
  const expectedIds = rawPlaylist.trackIds.map((item) => String(item?.id ?? item))
  check('live public playlist returned ordered tracks', liveDetail.tracks.length > 20, 'tracks=' + liveDetail.tracks.length)
  check('live public playlist completes omitted detail tracks through song/detail',
    liveDetail.tracks.length === expectedIds.length && liveDetail.skipped === 0,
    `tracks=${liveDetail.tracks.length} ids=${expectedIds.length} skipped=${liveDetail.skipped}`)
  check('live public playlist preserves platform order for first 10 tracks',
    JSON.stringify(liveDetail.tracks.slice(0, 10).map((track) => track.id)) === JSON.stringify(expectedIds.slice(0, 10)))
  check('live public playlist accounts for every track ID',
    liveDetail.tracks.length + liveDetail.missingIds.length + liveDetail.skipped === expectedIds.length,
    `tracks=${liveDetail.tracks.length} missing=${liveDetail.missingIds.length} skipped=${liveDetail.skipped} ids=${expectedIds.length}`)
  const first = liveDetail.tracks[0]
  const rawFirst = rawPlaylist.tracks.find((song) => String(song.id) === expectedIds[0])
  check('live first track uses providerId wy and stable numeric ID', first.providerId === 'wy' && /^\d+$/.test(first.id))
  check('live first track metadata matches platform response', first.title === rawFirst?.name && first.durationMs === rawFirst?.dt)
  check('live first track has artist, album and HTTPS artwork', Boolean(first.artist) && Boolean(first.album) && (first.artwork === '/default-cover.png' || first.artwork.startsWith('https://')))
  check('all imported tracks carry provider-scoped refs and wy provider',
    liveDetail.tracks.every((track) => track.providerId === 'wy' && track.ref?.providerId === 'wy' && track.ref?.kind === 'track' && track.ref?.scope === 'provider' && track.pluginId === ''))
  check('live public playlist reports the platform track count', liveDetail.summary.trackCount === rawPlaylist.trackCount, `summary=${liveDetail.summary.trackCount} raw=${rawPlaylist.trackCount}`)

  // 2. Live public user/playlist directory and song/detail endpoint.
  const liveLists = await module.fetchNeteaseUserPlaylists('1', {})
  check('live NetEase user/playlist returns public playlists', liveLists.length > 0)
  check('live user/playlist entries have summary metadata',
    liveLists.every((item) => item.platform === 'wy' && /^\d+$/.test(item.id) && Boolean(item.name) && item.trackCount >= 0))
  const liveSongs = await module.fetchNeteaseSongDetail([expectedIds[0]], {})
  check('live NetEase song/detail returns the requested public song', liveSongs.length === 1 && liveSongs[0].id === expectedIds[0] && liveSongs[0].providerId === 'wy')
  const anonymousAccount = await nodeRequest({
    url: 'https://music.163.com/api/nuser/account/get',
    headers: { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0' }
  })
  assert.throws(() => module.parseNeteaseAccount(anonymousAccount.data), /未确认登录身份/)
  check('anonymous account/get is never treated as a logged-in account', true)

  // 3. Missing-detail fallback: song/detail fills omitted tracks while preserving trackIds order.
  const requested = []
  globalThis.__ceruPlatformRequest = async (options) => {
    requested.push(options)
    if (options.url.includes('/api/v6/playlist/detail')) return { status: 200, data: neteaseFixtureDetail() }
    if (options.url.includes('/api/song/detail')) return { status: 200, data: neteaseFixtureSongDetail() }
    throw new Error('unexpected URL ' + options.url)
  }
  const merged = await module.fetchNeteasePlaylistDetail('99001', { cookies: '' })
  check('missing detail tracks are filled through song/detail in original order',
    merged.tracks.map((track) => track.id).join(',') === '101,102,103')
  check('song/detail fallback bulk request uses the fixed public endpoint',
    requested.some((options) => options.url.startsWith('https://music.163.com/api/song/detail?ids=')))
  check('fallback conversion reads legacy artists/album/duration fields',
    merged.tracks[1].artist === '丙' && merged.tracks[1].album === '专辑二' && merged.tracks[1].durationMs === 62000)
  check('http artwork is upgraded to HTTPS', merged.tracks[0].artwork.startsWith('https://'))

  // 4. Authenticated directory path uses the Keystore session only as an HTTP header.
  const seen = []
  globalThis.__ceruPlatformSession = async (id) => {
    check('playlist directory reads session only for the selected platform', id === 'wy')
    return { cookies: 'MUSIC_U=test-session; __csrf=test-csrf', userId: '42', name: '测试账号' }
  }
  globalThis.__ceruPlatformRequest = async (options) => {
    seen.push(options)
    if (options.url.includes('/api/nuser/account/get')) return { status: 200, data: neteaseFixtureAccount() }
    if (options.url.includes('/api/user/playlist')) return { status: 200, data: neteaseFixturePlaylistList() }
    throw new Error('unexpected URL ' + options.url)
  }
  const directory = await module.loadPlatformPlaylists('wy')
  check('authenticated NetEase directory is read through account/get + user/playlist', directory.length === 1 && directory[0].id === '99001')
  check('directory uid comes from the verified account response, not cached UI state',
    seen.some((options) => options.url.includes('/api/user/playlist?uid=42&limit=1000&offset=0')))
  check('every platform playlist request sends Cookie and Referer headers',
    seen.length >= 2 && seen.every((options) => options.headers?.Cookie === 'MUSIC_U=test-session; __csrf=test-csrf' && options.headers?.Referer === 'https://music.163.com/'))
  check('platform playlist request never targets a plugin or user-supplied host',
    seen.every((options) => options.url.startsWith('https://music.163.com/')))

  // 5. Session and input hardening.
  globalThis.__ceruPlatformRequest = async () => { throw new Error('request must not run') }
  await assert.rejects(module.fetchNeteaseUserPlaylists('1', { cookies: 'MUSIC_U=x\r\nInjected: y' }), /会话格式无效/)
  await assert.rejects(module.fetchNeteasePlaylistDetail('not-a-number', {}), /歌单 ID 无效/)
  await assert.rejects(module.loadPlatformPlaylists('tx'), /QQ 音乐歌单接口/)
  await assert.rejects(module.loadPlatformPlaylists('kg'), /酷狗歌单接口/)
  await assert.rejects(module.loadPlatformPlaylists('kw'), /酷我歌单接口/)
  await assert.rejects(module.loadPlatformPlaylists('mg'), /咪咕歌单接口/)
  check('malformed cookies, IDs and unsupported platforms fail before any request', true)
  check('unsupported platforms are explicitly labelled',
    ['tx', 'kg', 'kw', 'mg', 'qs'].every((id) => module.platformPlaylistSupport(id).supported === false && Boolean(module.platformPlaylistSupport(id).reason)))
  check('NetEase is the only platform with playlist support', module.platformPlaylistSupport('wy').supported === true && module.supportsPlatformPlaylists('wy') === true)

  // 6. Import commits ordered tracks to a new local playlist and never carries credentials.
  let committed = null
  globalThis.__ceruPlatformCommit = (drafts, options) => {
    committed = { drafts, options }
    return {
      createdIds: ['local-playlist-1'],
      playlistIds: ['local-playlist-1'],
      importedTracks: drafts[0].tracks.length,
      skippedTracks: 0,
      undo() {}
    }
  }
  const preview = { summary: liveDetail.summary, tracks: liveDetail.tracks, skipped: liveDetail.skipped }
  const imported = module.importPlatformPlaylist('wy', preview)
  check('import creates one new local playlist', imported.playlistId === 'local-playlist-1' && committed?.options?.mode === 'new')
  check('import preserves the complete platform order',
    JSON.stringify(committed.drafts[0].tracks.map((track) => track.id)) === JSON.stringify(liveDetail.tracks.map((track) => track.id)))
  check('imported tracks use providerId wy and stable IDs',
    committed.drafts[0].tracks.every((track) => track.providerId === 'wy' && /^\d+$/.test(track.id)))
  check('import description records platform provenance without session data',
    committed.drafts[0].description.includes('来源：网易云音乐') && !JSON.stringify(committed.drafts[0]).includes('MUSIC_U'))
  assert.throws(() => module.importPlatformPlaylist('kw', preview), /酷我歌单接口/)
  check('unsupported import is rejected honestly', true)

  // 7. Static UI and security checks.
  const loginSheet = await readFile(path.join(root, 'src/components/PlatformLoginSheet.vue'), 'utf8')
  const playlistSheet = await readFile(path.join(root, 'src/components/PlatformPlaylistSheet.vue'), 'utf8')
  const core = await readFile(path.join(root, 'src/core/platformPlaylists.ts'), 'utf8')
  const accounts = await readFile(path.join(root, 'src/core/platformAccounts.ts'), 'utf8')
  const cloudPage = await readFile(path.join(root, 'src/views/CloudPlaylists.vue'), 'utf8')
  const java = await readFile(path.join(root, 'android/app/src/main/java/com/ceru/music/mobile/PlatformLoginPlugin.java'), 'utf8')
  check('PlatformLoginSheet exposes a playlist import entry for logged-in supported platforms',
    loginSheet.includes('PlatformPlaylistSheet') && loginSheet.includes('读取平台歌单') && loginSheet.includes('supportsPlatformPlaylists'))
  check('PlatformPlaylistSheet shows playlist list, preview count and local import action',
    playlistSheet.includes('选择平台歌单') && playlistSheet.includes('preview.tracks.length') && playlistSheet.includes('导入到本机') && playlistSheet.includes('preview.summary.trackCount'))
  check('PlatformPlaylistSheet renders an explicit unsupported state',
    playlistSheet.includes('此平台歌单暂不支持读取') && playlistSheet.includes('support.reason'))
  check('PlatformPlaylistSheet never renders or stores cookie strings',
    !playlistSheet.includes('cookies') && !playlistSheet.includes('localStorage'))
  check('playlist core uses the fixed NetEase origin and required API paths',
    core.includes("const NETEASE_ORIGIN = 'https://music.163.com'") &&
    core.includes('/api/nuser/account/get') && core.includes('/api/user/playlist') &&
    core.includes('/api/v6/playlist/detail') && core.includes('/api/song/detail'))
  check('playlist core sends Cookie and Referer through httpRequest only',
    core.includes('headers.Cookie = cookie') && core.includes('Referer: NETEASE_REFERER') && core.includes("from './net'"))
  check('playlist core never imports plugin invocation or writes credentials to localStorage',
    !core.includes('plugin/manager') && !core.includes('invokeProvider') && !core.includes('localStorage'))
  check('platform accounts exposes a Keystore-backed session reader',
    accounts.includes('export async function readPlatformSession') && accounts.includes('secureStore.get(namespace(id), \'session\')'))
  check('CloudPlaylists stays LanYin-only and points platform imports to the local path',
    cloudPage.includes('此页只读取澜音账号的云端歌单') && cloudPage.includes('读取平台歌单'))
  check('v2.6.25 native login fixes are retained',
    java.includes('MUSIC_U') && java.includes('m.kugou.com') && java.includes('tmeLoginType') && java.includes('handler.cancel()'))

  const evidence = {
    generatedAt: new Date().toISOString(),
    scope: 'Real public NetEase API requests through the actual platformPlaylists.ts parser plus static Vue/native checks. The authenticated account/list path uses a synthetic session and fixture responses; no real NetEase account is available in this environment.',
    live: {
      playlistId: livePlaylistId,
      playlistName: liveDetail.summary.name,
      platformTrackCount: liveDetail.summary.trackCount,
      detailTracksBeforeCompletion: rawPlaylist.tracks.length,
      tracksRead: liveDetail.tracks.length,
      missingTracks: liveDetail.missingIds.length,
      skippedTracks: liveDetail.skipped,
      userPlaylistCount: liveLists.length,
      songDetailChecked: liveSongs[0]?.id,
      firstTrack: {
        id: first.id,
        title: first.title,
        artist: first.artist,
        album: first.album,
        durationMs: first.durationMs,
        artwork: first.artwork
      },
      orderSample: liveDetail.tracks.slice(0, 10).map((track) => track.id)
    },
    checks,
    errors
  }
  await writeFile(path.join(evidenceDir, 'test-platform-playlists.json'), JSON.stringify(evidence, null, 2))
}

try {
  await run()
} catch (error) {
  errors.push(error?.stack || String(error))
  await mkdir(evidenceDir, { recursive: true })
  await writeFile(path.join(evidenceDir, 'test-platform-playlists.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    scope: 'Real public NetEase API requests through the actual platformPlaylists.ts parser plus static Vue/native checks.',
    checks,
    errors
  }, null, 2))
  process.exitCode = 1
} finally {
  delete globalThis.__ceruPlatformRequest
  delete globalThis.__ceruPlatformSession
  delete globalThis.__ceruPlatformCommit
  console.log(JSON.stringify({ checks: checks.length, errors, pass: !errors.length }))
}
