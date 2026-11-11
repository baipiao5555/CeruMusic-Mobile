import assert from 'node:assert/strict'
import { build } from 'esbuild'

const requests = []
let response
globalThis.__lxCatalogRequest = async (input) => {
  requests.push(input)
  return response
}
const bundled = await build({
  entryPoints: ['src/core/plugin/lx-catalog.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
  plugins: [{
    name: 'catalog-http-fixture',
    setup(builder) {
      builder.onResolve({ filter: /^\.\/network$/ }, () => ({ path: 'network', namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
        contents: 'export const requestRemote = (input) => globalThis.__lxCatalogRequest(input)'
      }))
    }
  }]
})
const { searchLxCatalog, lxMusicInfo, LX_SOURCE_NAMES } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
)
assert.equal(Object.keys(LX_SOURCE_NAMES).length, 5)

response = { status: 200, body: {
  TOTAL: '4',
  abslist: [
    { MUSICRID: 'MUSIC_123', SONGNAME: '\u6211', ARTIST: 'Singer', ALBUMID: 'album-kw', DURATION: '62', N_MINFO: 'level:h,bitrate:128,format:mp3,size:1Mb;level:p,bitrate:320,format:mp3,size:3Mb' },
    { MUSICRID: 'MUSIC_124', SONGNAME: '\u6211\u4eec', ARTIST: 'Singer', DURATION: '120', N_MINFO: 'level:z,bitrate:4000,format:flac,size:20Mb' }
  ]
} }
let result = await searchLxCatalog('kw', ' \u6211 ', 1, 2)
assert.equal(result.items.length, 2)
assert.equal(result.nextCursor, '2')
assert.equal(result.items[0].ref.id, '123')
assert.equal(result.items[0].metadata.durationMs, 62000)
assert.deepEqual(result.items[0].metadata.qualities, ['128k', '320k'])
assert.deepEqual(result.items[1].metadata.qualities, ['flac24bit'])
assert.equal(new URL(requests.at(-1).url).searchParams.get('pn'), '0')
assert.equal(new URL(requests.at(-1).url).searchParams.get('mobi'), '1')
assert.equal(lxMusicInfo(result.items[0].ref).albumId, 'album-kw')

const hash = 'abcdef0123456789abcdef0123456789'
const hqHash = '0123456789abcdef0123456789abcdef'
response = { status: 200, body: {
  error_code: 0, data: { total: 1, lists: [
    { FileHash: hash, HQFileHash: hqHash, ResFileHash: 'hires-hash', Audioid: 567, SongName: '<em>Song</em>', Singers: [{ name: 'Singer' }], AlbumID: 'album-kg', Duration: 30 },
    { FileHash: hash, Audioid: 567, SongName: 'Duplicate' }
  ] }
} }
result = await searchLxCatalog('kg', 'Song')
assert.equal(result.items.length, 1)
assert.equal(result.nextCursor, undefined)
assert.equal(result.items[0].ref.id, hash)
assert.equal(lxMusicInfo(result.items[0].ref).songmid, 567)
assert.equal(lxMusicInfo(result.items[0].ref)._types['320k'].hash, hqHash)
assert.equal(lxMusicInfo(result.items[0].ref)._types.flac24bit.hash, 'hires-hash')
assert.equal(lxMusicInfo({ providerId: 'kg', id: hash }).hash, hash)

response = { status: 200, body: { code: 0, data: { song: { totalnum: 10, list: [{
  songmid: 'track-mid', songid: 100, media_mid: 'media-mid', albumid: 200,
  albummid: 'album-mid', songname: 'Song &amp; Name', albumname: 'Album',
  singer: [{ name: 'Singer' }], size128: 1000, size320: 2000, file: { size_hires: 3000 }, interval: 42
}] } } } }
result = await searchLxCatalog('tx', 'Song', 2, 1)
const qq = lxMusicInfo(JSON.parse(JSON.stringify(result.items[0].ref)))
assert.equal(qq.songmid, 'track-mid')
assert.equal(qq.songId, 100)
assert.equal(qq.strMediaMid, 'media-mid')
assert.equal(qq.albumMid, 'album-mid')
assert.equal(qq.name, 'Song & Name')
assert.ok(qq._types.flac24bit)
assert.equal(new URL(requests.at(-1).url).searchParams.get('p'), '2')
assert.equal(requests.at(-1).headers.Referer, 'https://y.qq.com/')

response = { status: 200, body: { code: 200, result: { songCount: 60, songs: [{
  id: 777, name: 'Song', artists: [{ name: 'Singer' }],
  album: { id: 888, name: 'Album' }, duration: 125500
}] } } }
result = await searchLxCatalog('wy', 'Song', 3, 10)
assert.equal(new URL(requests.at(-1).url).searchParams.get('offset'), '20')
assert.equal(result.items[0].metadata.durationMs, 125500)
assert.equal(lxMusicInfo(result.items[0].ref).songmid, 777)
assert.equal(result.items[0].ref.id, '777')

response = { status: 200, body: { code: '000000', songResultData: { totalCount: '1', resultList: [[{
  songId: 'song-mg', copyrightId: 'copyright-mg', name: 'Song',
  singerList: [{ name: 'Singer' }], img3: '/cover.png', duration: 99,
  audioFormats: [{ formatType: 'HQ', asize: 3000 }, { formatType: 'SQ', asize: 8000 }, { formatType: 'ZQ24', asize: 12000 }]
}]] } } }
result = await searchLxCatalog('mg', 'Song')
assert.equal(lxMusicInfo(result.items[0].ref).copyrightId, 'copyright-mg')
assert.equal(result.items[0].metadata.artworkUrl, 'https://d.musicapp.migu.cn/cover.png')
assert.deepEqual(result.items[0].metadata.qualities, ['320k', 'flac', 'flac24bit'])
assert.match(requests.at(-1).headers.sign, /^[a-f0-9]{32}$/)

const before = requests.length
assert.deepEqual(await searchLxCatalog('wy', '  '), { items: [], total: 0 })
assert.equal(requests.length, before)
await assert.rejects(searchLxCatalog('invalid', 'Song'))
response = { status: 403, body: {} }
await assert.rejects(searchLxCatalog('wy', 'Song'), /HTTP 403/)
response = { status: 200, body: { code: 200, result: { songCount: 0 } } }
assert.deepEqual(await searchLxCatalog('wy', 'No match'), { items: [], total: 0, nextCursor: undefined })
response = { status: 200, body: 'not-json' }
await assert.rejects(searchLxCatalog('kw', 'Song'))
response = { status: 200, body: { code: 500, message: 'catalog down' } }
await assert.rejects(searchLxCatalog('wy', 'Song'), /catalog down/)
const legacy = lxMusicInfo({ providerId: 'tx', id: 'legacy-mid', data: { songId: 9, strMediaMid: 'media' } })
assert.equal(legacy.strMediaMid, 'media')
assert.equal(legacy.songmid, 'legacy-mid')
assert.equal(legacy.songId, 9)
delete globalThis.__lxCatalogRequest
console.log('PASS: LX catalog metadata, pagination, URL parameters, deduplication, and error handling')
