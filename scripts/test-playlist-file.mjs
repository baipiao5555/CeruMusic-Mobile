import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
const product = 'D:/LX/CeruMusic-Mobile'
const work = 'D:/LX/CeruMusic-Mobile-第一阶段与兼容修复-2026-11-16/work'
const evidence = 'D:/LX/CeruMusic-Mobile-第一阶段与兼容修复-2026-11-16/evidence'
const { build } = createRequire(product + '/package.json')('esbuild')
const source = process.argv.includes('--staged') ? work + '/src/core/playlistFile.ts' : product + '/src/core/playlistFile.ts'
const bundled = await build({ absWorkingDir: product, entryPoints: [source], bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent', nodePaths: [product + '/node_modules'] })
const { parsePlaylistFile, PLAYLIST_FILE_LIMITS } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))
const bytes = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value))
const kw = { id: 'LX-internal-999', source: 'kw', name: '同名歌', singer: '歌手', interval: '03:15', meta: { songId: '101', albumName: '专辑', picUrl: 'https://example.test/cover.jpg?token=secret', qualitys: [{ type: '128k', size: '3M' }], token: 'DO-NOT-IMPORT' } }
const kg = { id: 'LX-internal-kg', source: 'kg', name: '酷狗样本', singer: '歌手', interval: '00:30', meta: { songId: 808, hash: 'abcdef0123456789abcdef0123456789', qualitys: [{ type: '320k', hash: 'HQHASH', size: '4M' }, { type: 'flac32bit', hash: 'HIRESHASH' }] } }
const tx = { id: 'LX-internal-tx', source: 'tx', name: 'QQ样本', singer: '歌手', interval: '01:20', meta: { songId: 'MID101', id: 321, strMediaMid: 'MEDIA101', albumMid: 'ALBUM101', qualitys: [{ type: '320k' }] } }
const local = { id: 'C:\\Music\\private\\track.mp3', source: 'local', name: '本机样本', singer: '歌手', meta: { songId: 'C:\\Music\\private\\track.mp3', filePath: 'C:\\Music\\private\\track.mp3', ext: 'mp3' } }
const part = { type: 'playListPart_v2', data: { id: 'external-list-1', name: 'LX 单歌单样本', list: [kw, kw, { name: 'invalid' }, kg, tx, local, { id: 'INTERNAL-NOT-ID', source: 'wy', name: '缺平台ID', meta: {} }, { ...kw, id: 'different', meta: { ...kw.meta, songId: '102' } }] } }
const all = { type: 'playList_v2', data: [part.data, { id: 'empty', name: '空歌单', list: [] }] }
const legacy = { type: 'playListPart', data: { id: 'old', name: '旧版样本', list: [{ source: 'tx', id: 'internal', songmid: 'OLDMID', songId: 44, strMediaMid: 'OLDMEDIA', name: '旧版QQ', singer: '歌手', types: [{ type: '128k' }], _types: { '320k': { size: '4M' } } }] } }
const providers = ['kw', 'kg', 'tx'].map(providerId => ({ providerId, pluginId: 'test.lx', pluginName: 'LX 测试插件', format: 'lx' }))
const checks = []
function check(name, actual, expected = true) { assert.deepEqual(actual, expected, name); checks.push({ name, actual, expected, result: 'PASS' }); console.log(JSON.stringify(checks.at(-1))) }
async function reject(name, input, pattern) { await assert.rejects(parsePlaylistFile(input), pattern); check(name, true) }
let result = await parsePlaylistFile(bytes(part))
check('preview counts invalid/duplicate/pending', result.counts, { records: 8, tracks: 6, invalid: 1, duplicates: 1, pending: 6, invalidPlaylists: 0 })
check('v2 internal ID never becomes platform ID', result.drafts[0].tracks[0].id, '101')
check('unknown source not incorrectly bound', result.drafts[0].tracks[0].providerId, 'lx-pending:kw')
check('source identity and original order preserved', result.drafts[0].tracks.map(track => track.title), ['同名歌', '酷狗样本', 'QQ样本', '本机样本', '缺平台ID', '同名歌'])
check('same title distinct IDs preserved', result.drafts[0].tracks.at(-1).id, '102')
check('credentials stripped', /DO-NOT-IMPORT|token=secret|C:\\\\Music/.test(JSON.stringify(result)), false)
check('local files never use local plugin/MediaStore ID', result.drafts[0].tracks[3].pluginId === 'local' || result.drafts[0].tracks[3].id === local.id, false)
check('local basename metadata retained', result.drafts[0].tracks[3].ref.data.fileImport.fileName, 'track.mp3')
check('missing identity does not fallback to internal ID', result.drafts[0].tracks[4].id === 'INTERNAL-NOT-ID', false)
result = await parsePlaylistFile(bytes(part), providers)
check('only LX matching provider bound', result.drafts[0].tracks[0].pluginId, 'test.lx')
check('kg hash not internal/song ID', result.drafts[0].tracks[1].id, kg.meta.hash)
check('kg qualities/hashes normalized', result.drafts[0].tracks[1].ref.data.lxMusicInfo._types.flac24bit.hash, 'HIRESHASH')
check('tx meta restored for resolver', [result.drafts[0].tracks[2].ref.data.lxMusicInfo.songmid, result.drafts[0].tracks[2].ref.data.lxMusicInfo.songId, result.drafts[0].tracks[2].ref.data.lxMusicInfo.strMediaMid], ['MID101', 321, 'MEDIA101'])
check('LX resolver numeric song ID type retained', result.drafts[0].tracks[1].ref.data.lxMusicInfo.songmid, 808)
check('non LX plugin with same provider ID not bound', (await parsePlaylistFile(bytes(part), [{ ...providers[0], format: undefined }])).drafts[0].tracks[0].pluginId, '')
check('all playlists includes empty list', (await parsePlaylistFile(bytes(all))).drafts.map(item => item.name), ['LX 单歌单样本', '空歌单'])
result = await parsePlaylistFile(bytes(JSON.stringify(JSON.stringify(legacy))))
check('old double serialization supported', result.format.includes('二次序列化'))
check('legacy tx fields retained', result.drafts[0].tracks[0].ref.data.lxMusicInfo.strMediaMid, 'OLDMEDIA')
for (const type of ['allData', 'allData_v2']) {
  result = await parsePlaylistFile(bytes({ type, playList: type.endsWith('_v2') ? all.data : [legacy.data], setting: { cookie: 'DO-NOT-IMPORT' }, userApi: 'SCRIPT-NOT-IMPORTED', token: 'TOKEN-NOT-IMPORTED' }))
  check(type + ' extracts playlists only', /DO-NOT-IMPORT|SCRIPT-NOT-IMPORTED|TOKEN-NOT-IMPORTED/.test(JSON.stringify(result)), false)
}
const gzip = gzipSync(bytes(part))
check('native gzip JSON detected regardless extension', (await parsePlaylistFile(gzip)).drafts[0].name, part.data.name)
const nativeCorrupt = Uint8Array.from(gzip); nativeCorrupt[nativeCorrupt.length - 8] ^= 1
await reject('native gzip CRC rejects corruption', nativeCorrupt, /损坏|CRC|失败/)
const native = globalThis.DecompressionStream
globalThis.DecompressionStream = undefined
try {
  check('Chrome99 streaming fallback reads LX gzip', (await parsePlaylistFile(gzip)).counts.tracks, 6)
  const crcBroken = Uint8Array.from(gzip); crcBroken[crcBroken.length - 8] ^= 1
  await reject('fallback enforces CRC', crcBroken, /CRC/)
  await reject('truncated gzip rejected', gzip.subarray(0, gzip.length - 4), /损坏|失败|CRC|超限/)
  const bomb = Uint8Array.from(gzipSync(Buffer.alloc(PLAYLIST_FILE_LIMITS.decodedBytes + 1, 32)))
  await reject('declared inflated size bounded before decode', bomb, /解压大小超限/)
  new DataView(bomb.buffer).setUint32(bomb.length - 4, 0, true)
  await reject('fake trailer cannot bypass cumulative bound', bomb, /解压大小超限/)
} finally { globalThis.DecompressionStream = native }
await reject('invalid JSON', bytes('{broken'), /有效 JSON/)
await reject('unknown schema', bytes({ data: [] }), /未识别/)
await reject('unknown version', bytes({ ...part, version: 99 }), /版本/)
await reject('missing list structure', bytes({ type: 'playList_v2', data: {} }), /结构损坏/)
await reject('deep JSON rejected before parse', bytes('['.repeat(33) + '0' + ']'.repeat(33)), /嵌套超限/)
await reject('field count cannot overflow traversal stack', bytes(Array.from({ length: PLAYLIST_FILE_LIMITS.nodes }, () => 0)), /字段数量超限/)
await reject('invalid UTF8 rejected', new Uint8Array([0xff, 0xfe, 0xff]), /编码无效/)
await reject('playlist count limit', bytes({ type: 'playList_v2', data: Array.from({ length: 501 }, () => ({ list: [] })) }), /歌单数量超限/)
await reject('track count limit', bytes({ type: 'playListPart_v2', data: { list: Array.from({ length: 20001 }, () => ({ source: 'kw', name: 'a', meta: { songId: 1 } })) } }), /曲目数量超限/)
await reject('input size limit', new Uint8Array(PLAYLIST_FILE_LIMITS.inputBytes + 1), /文件大小超限/)
await reject('AES cpl honestly unsupported', bytes('U2FsdGVkX18abc'), /尚未支持/)
await reject('gzip AES cmpl honestly unsupported', gzipSync(bytes('U2FsdGVkX18abc')), /尚未支持/)
check('ancient default list supported', (await parsePlaylistFile(bytes({ type: 'defautlList', data: legacy.data }))).drafts[0].tracks[0].id, 'OLDMID')
check('legacy full playlist supported', (await parsePlaylistFile(bytes({ type: 'playList', data: [legacy.data] }))).drafts[0].tracks.length, 1)
const fixtures = { 'single-v2.lxmc': gzip, 'all-v2.lxmc': gzipSync(bytes(all)), 'single-v2.json': bytes(part), 'legacy-double.json': bytes(JSON.stringify(JSON.stringify(legacy))), 'invalid.json': bytes('{broken') }
await fs.mkdir(evidence + '/file-import-fixtures', { recursive: true })
const hashes = {}
for (const [name, content] of Object.entries(fixtures)) { await fs.writeFile(evidence + '/file-import-fixtures/' + name, content); hashes[name] = createHash('sha256').update(content).digest('hex') }
const report = { checks, result: 'PASS', source, sourceSHA256: createHash('sha256').update(await fs.readFile(source)).digest('hex'), fixtures: hashes, scope: 'Generated fixtures following actual LX exporter schemas; no original user-exported file was supplied. Gzip native and Chrome99 fallback both exercised.' }
await fs.writeFile(evidence + '/file-import-parser-tests.json', JSON.stringify(report, null, 2))
console.log('PASS ' + checks.length + ' parser checks')
