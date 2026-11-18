import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(import.meta.dirname, '..')
const evidenceDir = process.env.CERU_EVIDENCE_DIR ||
  path.resolve(root, '..', 'CeruMusic-Mobile-酷狗酷我与新增平台-2026-11-17', 'evidence', 'platform-v2625')
const liveNeteaseId = process.env.CERU_NETEASE_PLAYLIST || '18587698000'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const KUWO_COOKIE = 'Hm_Iuvt_cdb524f42f23cer9b268564v7y735ewrq2324'
const checks = []
const errors = []
let module

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

  // 1. NetEase live public playlist: existing path must keep working.
  const rawResponse = await nodeRequest({
    url: `https://music.163.com/api/v6/playlist/detail?id=${liveNeteaseId}&n=1000&s=0`,
    headers: { Referer: 'https://music.163.com/', 'User-Agent': UA }
  })
  check('live NetEase playlist/detail HTTP 200', rawResponse.status === 200, 'HTTP ' + rawResponse.status)
  const rawNetease = rawResponse.data?.playlist
  check('live NetEase playlist has a public name and track IDs', Boolean(rawNetease?.name) && Array.isArray(rawNetease?.trackIds) && rawNetease.trackIds.length > 20)
  const neteaseDetail = await module.fetchNeteasePlaylistDetail(liveNeteaseId, {})
  const neteaseIds = rawNetease.trackIds.map((item) => String(item?.id ?? item))
  check('live NetEase playlist returns ordered tracks', neteaseDetail.tracks.length > 20, 'tracks=' + neteaseDetail.tracks.length)
  check('live NetEase playlist completes omitted tracks',
    neteaseDetail.tracks.length === neteaseIds.length && neteaseDetail.skipped === 0,
    `tracks=${neteaseDetail.tracks.length} ids=${neteaseIds.length}`)
  check('live NetEase playlist preserves platform order for first 10 tracks',
    JSON.stringify(neteaseDetail.tracks.slice(0, 10).map((track) => track.id)) === JSON.stringify(neteaseIds.slice(0, 10)))
  check('live NetEase first track metadata matches the platform response',
    neteaseDetail.tracks[0].title === rawNetease.tracks.find((song) => String(song.id) === neteaseIds[0])?.name)
  const liveNeteaseLists = await module.fetchNeteaseUserPlaylists('1', {})
  check('live NetEase user/playlist returns public playlists', liveNeteaseLists.length > 0)

  // 1b. NetEase detail-page omissions, hardening and anonymous identity.
  const neteaseFallbackRequests = []
  globalThis.__ceruPlatformRequest = async (options) => {
    neteaseFallbackRequests.push(options)
    if (options.url.includes('/api/v6/playlist/detail')) return { status: 200, data: neteaseFixtureDetail() }
    if (options.url.includes('/api/song/detail')) return { status: 200, data: neteaseFixtureSongDetail() }
    throw new Error('unexpected URL ' + options.url)
  }
  const merged = await module.fetchNeteasePlaylistDetail('99001', { cookies: '' })
  check('NetEase detail omissions are filled through song/detail in original order',
    merged.tracks.map((track) => track.id).join(',') === '101,102,103')
  check('NetEase fallback uses the fixed public song/detail endpoint',
    neteaseFallbackRequests.some((options) => options.url.startsWith('https://music.163.com/api/song/detail?ids=')))
  check('NetEase fallback reads legacy artists/album/duration fields',
    merged.tracks[1].artist === '丙' && merged.tracks[1].album === '专辑二' && merged.tracks[1].durationMs === 62000)
  check('NetEase HTTP artwork is upgraded to HTTPS', merged.tracks[0].artwork.startsWith('https://'))
  const anonymousAccount = await nodeRequest({
    url: 'https://music.163.com/api/nuser/account/get',
    headers: { Referer: 'https://music.163.com/', 'User-Agent': UA }
  })
  assert.throws(() => module.parseNeteaseAccount(anonymousAccount.data), /未确认登录身份/)
  await assert.rejects(module.fetchNeteaseUserPlaylists('1', { cookies: 'MUSIC_U=x\r\nInjected: y' }), /会话格式无效/)
  check('anonymous NetEase identity and CRLF cookies are rejected', true)
  globalThis.__ceruPlatformRequest = nodeRequest

  // 2. Kuwo live public playlist through the official /api/www Secret flow.
  const kuwoLanding = await fetch('https://www.kuwo.cn/', { headers: { 'User-Agent': UA } })
  const setCookies = typeof kuwoLanding.headers.getSetCookie === 'function'
    ? kuwoLanding.headers.getSetCookie()
    : [kuwoLanding.headers.get('set-cookie') || '']
  const kuwoToken = (setCookies.join('; ').match(new RegExp(KUWO_COOKIE + '=([^;]+)')) || [])[1]
  check('live Kuwo landing page issues the Hm_Iuvt signing cookie', Boolean(kuwoToken))
  const kuwoSecret = module.kuwoSecret(kuwoToken)
  check('Kuwo Secret is non-empty hex with the expected deterministic length',
    /^[0-9a-f]+$/.test(kuwoSecret) && kuwoSecret.length === kuwoToken.length * 2 + 8,
    `secret=${kuwoSecret.length} token=${kuwoToken.length}`)
  const kuwo = await module.fetchKuwoPlaylistDetail('3731398594', {
    cookies: `${KUWO_COOKIE}=${kuwoToken}`
  })
  check('live Kuwo public playlist returns all tracks', kuwo.tracks.length === 42, 'tracks=' + kuwo.tracks.length)
  check('live Kuwo playlist summary uses the real public name', kuwo.summary.name.includes('治愈纯音'))
  check('live Kuwo first track has the expected metadata',
    kuwo.tracks[0].title === 'Love Is Gone（治愈版）' && kuwo.tracks[0].artist === 'ALisa' && kuwo.tracks[0].durationMs === 173000)
  check('Kuwo tracks use providerId kw and provider-scoped refs',
    kuwo.tracks.every((track) => track.providerId === 'kw' && track.ref?.providerId === 'kw' && track.ref?.data?.lxMusicInfo?.source === 'kw'))
  check('Kuwo playlist preserves the API order and unique numeric IDs',
    new Set(kuwo.tracks.map((track) => track.id)).size === kuwo.tracks.length && /^\d+$/.test(kuwo.tracks[0].id))
  check('Kuwo link parser accepts playlist links and plain IDs',
    module.parseKuwoPlaylistLink('https://www.kuwo.cn/playlist_detail/3731398594') === '3731398594' &&
    module.parseKuwoPlaylistLink('3731398594') === '3731398594')
  await assert.rejects(module.fetchKuwoPlaylistDetail('3731398594', {}), /网页签名 Cookie/)
  check('Kuwo without the signing cookie fails before any import', true)

  // 3. QQ live directory + detail through public official endpoints.
  const qqLists = await module.fetchQQUserPlaylists('123456789', {})
  check('live QQ user-created playlist directory returns public playlists', qqLists.length >= 40, 'lists=' + qqLists.length)
  check('live QQ directory entries have real names and track counts',
    qqLists.every((item) => item.platform === 'tx' && /^\d+$/.test(item.id) && Boolean(item.name)))
  const qqTarget = qqLists.find((item) => item.id === '9792431566')
  check('live QQ directory contains the known public test playlist', Boolean(qqTarget), 'target=9792431566')
  const qq = await module.fetchQQPlaylistDetail(qqTarget.id, {})
  check('live QQ playlist detail returns all tracks', qq.tracks.length === 15, 'tracks=' + qq.tracks.length)
  check('live QQ playlist summary keeps the real name and creator',
    qq.summary.name === '通勤循环' && Boolean(qq.summary.creator))
  check('live QQ first track has mid/artist/album/duration',
    /^[0-9A-Za-z]+$/.test(qq.tracks[0].id) && Boolean(qq.tracks[0].artist) && qq.tracks[0].durationMs > 0)
  check('QQ tracks use providerId tx and lxMusicInfo',
    qq.tracks.every((track) => track.providerId === 'tx' && track.ref?.data?.lxMusicInfo?.source === 'tx'))
  check('QQ link parser accepts ryqq links and plain IDs',
    module.parseQQPlaylistLink('https://y.qq.com/n/ryqq_v2/playlist/9792431566') === '9792431566' &&
    module.parseQQPlaylistLink('9792431566') === '9792431566')

  // 4. Migu live public playlist through the official SDK endpoints.
  const migu = await module.fetchMiguPlaylistDetail('233754996')
  check('live Migu public playlist returns all 100 tracks', migu.tracks.length === 100, 'tracks=' + migu.tracks.length)
  check('live Migu playlist summary uses the real public name', migu.summary.name.includes('周杰伦精选100首'))
  check('live Migu first track matches the public song list',
    migu.tracks[0].title === '晴天' && migu.tracks[0].artist === '周杰伦' && migu.tracks[0].durationMs === 270000)
  check('Migu tracks keep songId/copyrightId in lxMusicInfo',
    migu.tracks.every((track) => track.providerId === 'mg' && track.ref?.data?.lxMusicInfo?.copyrightId))
  check('Migu link parser accepts playlist links and plain IDs',
    module.parseMiguPlaylistLink('https://music.migu.cn/v3/music/playlist/233754996') === '233754996' &&
    module.parseMiguPlaylistLink('233754996') === '233754996')

  // 5. Kugou: the public JSON is verified but cannot page past the first 10 tracks.
  check('Kugou link parser accepts plist links and short IDs',
    module.parseKugouPlaylistLink('https://m.kugou.com/plist/list/1e0i973/') === '1e0i973' &&
    module.parseKugouPlaylistLink('1e0i973') === '1e0i973')
  await assert.rejects(module.fetchKugouPlaylistDetail('1e0i973'), /只返回前 10 首/)
  check('Kugou incomplete public pagination is rejected instead of importing 10/69 tracks', true)

  // 6. Supported modes and explicit directory failures.
  check('NetEase and QQ expose account playlist directories',
    module.platformPlaylistSupport('wy').supported === true && module.platformPlaylistSupport('wy').directory === true &&
    module.platformPlaylistSupport('tx').supported === true && module.platformPlaylistSupport('tx').directory === true)
  check('Kuwo and Migu expose verified public-link import',
    module.platformPlaylistSupport('kw').supported === true && module.platformPlaylistSupport('kw').mode === 'link' &&
    module.platformPlaylistSupport('mg').supported === true && module.platformPlaylistSupport('mg').mode === 'link')
  check('Kugou and Qishui are explicitly unsupported with reasons',
    module.platformPlaylistSupport('kg').supported === false && module.platformPlaylistSupport('kg').reason.includes('只返回前 10 首') &&
    module.platformPlaylistSupport('qs').supported === false && Boolean(module.platformPlaylistSupport('qs').reason))
  await assert.rejects(module.loadPlatformPlaylists('kw'), /账号歌单目录/)
  await assert.rejects(module.loadPlatformPlaylists('mg'), /账号歌单目录/)
  await assert.rejects(module.loadPlatformPlaylists('kg'), /只返回前 10 首/)
  await assert.rejects(module.loadPlatformPlaylists('tx'), /请先在平台登录页完成QQ音乐登录/)
  await assert.rejects(module.previewPlatformPlaylistLink('kg', '1e0i973'), /只返回前 10 首/)
  check('directories that are not public fail with explicit reasons', true)

  // 7. Authenticated NetEase directory + QQ request headers with synthetic sessions.
  const neteaseSeen = []
  globalThis.__ceruPlatformSession = async (id) => {
    check('NetEase directory reads only the wy Keystore session', id === 'wy')
    return { cookies: 'MUSIC_U=test-session; __csrf=test-csrf', userId: '42', name: '测试账号' }
  }
  globalThis.__ceruPlatformRequest = async (options) => {
    neteaseSeen.push(options)
    if (options.url.includes('/api/nuser/account/get')) return { status: 200, data: neteaseFixtureAccount() }
    if (options.url.includes('/api/user/playlist')) return { status: 200, data: neteaseFixturePlaylistList() }
    throw new Error('unexpected URL ' + options.url)
  }
  const neteaseDirectory = await module.loadPlatformPlaylists('wy')
  check('authenticated NetEase directory uses account/get + user/playlist', neteaseDirectory.length === 1 && neteaseDirectory[0].id === '99001')
  check('NetEase directory sends Cookie/Referer through the fixed origin',
    neteaseSeen.length >= 2 && neteaseSeen.every((options) => options.headers?.Cookie === 'MUSIC_U=test-session; __csrf=test-csrf' && options.url.startsWith('https://music.163.com/')))

  const qqSeen = []
  globalThis.__ceruPlatformRequest = async (options) => {
    qqSeen.push(options)
    return {
      status: 200,
      data: {
        code: 0,
        data: {
          totoal: 1,
          hostname: '测试用户',
          disslist: [{ tid: 1234567, diss_name: 'QQ 测试歌单', song_cnt: 2, dirid: 1, diss_cover: '' }]
        }
      }
    }
  }
  const qqDirectory = await module.fetchQQUserPlaylists('42', { cookies: 'qqmusic_uin=42; qm_keyst=test-key', name: '测试用户' })
  check('QQ directory uses the verified user-created endpoint with UIN and g_tk',
    qqDirectory.length === 1 && qqSeen[0].url.startsWith('https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss?') &&
    qqSeen[0].url.includes('hostuin=42') && qqSeen[0].url.includes('g_tk=') && !qqSeen[0].url.includes('g_tk=5381'))
  check('QQ directory sends the Keystore Cookie and profile Referer',
    qqSeen[0].headers?.Cookie === 'qqmusic_uin=42; qm_keyst=test-key' && qqSeen[0].headers?.Referer === 'https://y.qq.com/portal/profile.html')

  // 8. Import commits ordered tracks to a new local playlist, never credentials.
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
  const kuwoPreview = { summary: kuwo.summary, tracks: kuwo.tracks, skipped: kuwo.skipped }
  const imported = module.importPlatformPlaylist('kw', kuwoPreview)
  check('Kuwo import creates one new local playlist',
    imported.playlistId === 'local-playlist-1' && committed?.options?.mode === 'new')
  check('Kuwo import preserves the complete public order',
    JSON.stringify(committed.drafts[0].tracks.map((track) => track.id)) === JSON.stringify(kuwo.tracks.map((track) => track.id)))
  check('Kuwo import records platform provenance without session data',
    committed.drafts[0].description.includes('来源：酷我音乐') && !JSON.stringify(committed.drafts[0]).includes(KUWO_COOKIE))
  const qqPreview = { summary: qq.summary, tracks: qq.tracks, skipped: qq.skipped }
  module.importPlatformPlaylist('tx', qqPreview)
  check('QQ import records QQ provenance and preserves order',
    committed.drafts[0].description.includes('来源：QQ音乐') &&
    JSON.stringify(committed.drafts[0].tracks.map((track) => track.id)) === JSON.stringify(qq.tracks.map((track) => track.id)))
  assert.throws(() => module.importPlatformPlaylist('qs', kuwoPreview), /汽水音乐/)
  assert.throws(() => module.importPlatformPlaylist('kg', kuwoPreview), /只返回前 10 首/)
  check('unsupported imports are rejected honestly', true)

  // 9. Static UI and native cookie capture checks.
  const loginSheet = await readFile(path.join(root, 'src/components/PlatformLoginSheet.vue'), 'utf8')
  const playlistSheet = await readFile(path.join(root, 'src/components/PlatformPlaylistSheet.vue'), 'utf8')
  const core = await readFile(path.join(root, 'src/core/platformPlaylists.ts'), 'utf8')
  const java = await readFile(path.join(root, 'android/app/src/main/java/com/ceru/music/mobile/PlatformLoginPlugin.java'), 'utf8')
  check('PlatformPlaylistSheet exposes both directory and public-link import',
    playlistSheet.includes('previewPlatformPlaylistLink') && playlistSheet.includes('歌单链接或 ID') &&
    playlistSheet.includes('读取歌单') && playlistSheet.includes('support.hint') && playlistSheet.includes('support.reason'))
  check('PlatformPlaylistSheet never renders or stores cookie strings',
    !playlistSheet.includes('cookies') && !playlistSheet.includes('localStorage'))
  check('PlatformLoginSheet no longer claims all other platforms are unverified',
    loginSheet.includes('酷我、咪咕可粘贴公开歌单链接') && !loginSheet.includes('尚未完成真实账号验证'))
  check('playlist core uses only fixed official hosts',
    core.includes("const KUWO_ORIGIN = 'https://www.kuwo.cn'") &&
    core.includes("const QQ_ORIGIN = 'https://c.y.qq.com'") &&
    core.includes("const MIGU_ORIGIN = 'https://c.musicapp.migu.cn'"))
  check('playlist core contains the verified endpoint paths',
    core.includes('/api/www/playlist/playListInfo') && core.includes('fcg_user_created_diss') &&
    core.includes('fcg_ucc_getcdinfo_byids_cp') && core.includes('resource/playlist/v2.0') &&
    core.includes('MIGUM3.0/resource/playlist/song/v2.0'))
  check('native login captures the evidenced Kuwo and Kugou cookies',
    java.includes('Hm_Iuvt_cdb524f42f23cer9b268564v7y735ewrq2324') && java.includes('"kg_mid"'))
  check('playlist core never writes credentials to localStorage or invokes plugins',
    !core.includes('localStorage') && !core.includes('plugin/manager') && !core.includes('invokeProvider'))

  const evidence = {
    generatedAt: new Date().toISOString(),
    scope: 'Live public requests through the actual platformPlaylists.ts module. QQ directory/detail and Kuwo/Migu public details are real public data. NetEase authenticated directory uses a synthetic Keystore session and fixture responses. No real account, Android device, or membership playback is claimed.',
    netease: {
      playlistId: liveNeteaseId,
      name: neteaseDetail.summary.name,
      tracks: neteaseDetail.tracks.length,
      first: neteaseDetail.tracks[0]?.title
    },
    kuwo: {
      playlistId: '3731398594',
      name: kuwo.summary.name,
      tracks: kuwo.tracks.length,
      first: kuwo.tracks[0]?.title,
      creator: kuwo.summary.creator,
      signingCookie: KUWO_COOKIE
    },
    qq: {
      publicUin: '123456789',
      directoryCount: qqLists.length,
      playlistId: qq.summary.id,
      name: qq.summary.name,
      tracks: qq.tracks.length,
      first: qq.tracks[0]?.title
    },
    migu: {
      playlistId: '233754996',
      name: migu.summary.name,
      tracks: migu.tracks.length,
      first: migu.tracks[0]?.title
    },
    kugou: {
      playlistId: '1e0i973',
      publicJsonTracks: 10,
      platformTotal: 69,
      supported: false,
      reason: module.platformPlaylistSupport('kg').reason
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
    scope: 'Live public platform playlist requests through the actual module plus static UI/native checks.',
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
