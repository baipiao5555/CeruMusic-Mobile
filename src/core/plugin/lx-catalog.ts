import { md5 } from '@noble/hashes/legacy'
import { bytesToHex } from '@noble/hashes/utils'
import { requestRemote } from './network'

export const LX_SOURCE_NAMES: Record<string, string> = {
  kw: '\u9177\u6211\u97f3\u4e50',
  kg: '\u9177\u72d7\u97f3\u4e50',
  tx: 'QQ\u97f3\u4e50',
  wy: '\u7f51\u6613\u4e91\u97f3\u4e50',
  mg: '\u54aa\u5495\u97f3\u4e50'
}

const QUALITY_ORDER = ['128k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'master']
const KW_QUALITIES: Record<string, string> = {
  '128': '128k', '320': '320k', '2000': 'flac', '4000': 'flac24bit', '20900': 'master'
}
const MG_QUALITIES: Record<string, string> = {
  PQ: '128k', HQ: '320k', SQ: 'flac', ZQ24: 'flac24bit'
}

function text(value: unknown): string {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (entity) => ({
      '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
      '&apos;': "'", '&#39;': "'", '&nbsp;': ' '
    })[entity] ?? entity)
    .trim()
}

function singers(list: any, fallback = ''): string {
  return Array.isArray(list)
    ? list.map((singer) => text(singer?.name ?? singer?.Name ?? singer)).filter(Boolean).join(' / ')
    : text(fallback)
}

function seconds(value: unknown): number {
  if (typeof value === 'string' && value.includes(':')) {
    return value.split(':').reduce((total, part) => total * 60 + (Number(part) || 0), 0)
  }
  const amount = Number(value)
  return Number.isFinite(amount) ? Math.max(0, amount) : 0
}

function interval(value: number): string {
  const duration = Math.floor(value)
  return `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`
}

function qualityInfo(entries: Array<[string, any]>): { types: any[]; _types: Record<string, any> } {
  const details = Object.fromEntries(entries.filter(([quality, value]) => quality && value))
  const names = Object.keys(details).sort(
    (left, right) => QUALITY_ORDER.indexOf(left) - QUALITY_ORDER.indexOf(right)
  )
  return {
    types: names.map((type) => ({ type, ...details[type] })),
    _types: details
  }
}

function entity(source: string, info: any, duration: number): any | null {
  const id = String((source === 'kg' ? info.hash : info.songmid) ?? '')
  if (!id || !info.name) return null
  const musicInfo = {
    ...info,
    id: info.songmid ?? id,
    source,
    interval: interval(duration),
    _interval: duration,
    types: info.types ?? [],
    _types: info._types ?? {},
    typeUrl: {}
  }
  return {
    ref: { providerId: source, kind: 'track', id, scope: 'provider', data: { lxMusicInfo: musicInfo } },
    title: musicInfo.name,
    subtitle: musicInfo.singer,
    capabilities: ['play', 'download', 'favorite'],
    metadata: {
      artists: musicInfo.singer ? [musicInfo.singer] : [],
      album: { id: String(musicInfo.albumId ?? ''), title: musicInfo.albumName ?? '' },
      durationMs: Math.round(duration * 1000),
      artworkUrl: musicInfo.img || undefined,
      qualities: musicInfo.types.map((item: any) => item.type)
    }
  }
}

function mapSong(source: string, item: any): any | null {
  if (!item || typeof item !== 'object') return null
  if (source === 'kw') {
    const qualities: Array<[string, any]> = []
    for (const entry of String(item.N_MINFO ?? item.MINFO ?? '').split(';')) {
      const match = /bitrate:(\d+),format:([^,;]+),size:([^;]+)/.exec(entry)
      if (match && KW_QUALITIES[match[1]]) {
        qualities.push([KW_QUALITIES[match[1]], { size: match[3] }])
      }
    }
    return entity(source, {
      songmid: String(item.MUSICRID ?? item.rid ?? '').replace(/^MUSIC_/, ''),
      name: text(item.SONGNAME ?? item.NAME ?? item.name),
      singer: text(item.ARTIST ?? item.artist).replace(/&/g, ' / '),
      albumName: text(item.ALBUM ?? item.album),
      albumId: item.ALBUMID ?? item.albumid ?? '',
      img: item.pic ?? item.albumpic ?? '',
      ...qualityInfo(qualities)
    }, seconds(item.DURATION ?? item.duration))
  }
  if (source === 'kg') {
    const qualities: Array<[string, any]> = []
    for (const [quality, prefix] of [['128k', ''], ['320k', 'HQ'], ['flac', 'SQ'], ['flac24bit', 'Res']]) {
      const hash = item[`${prefix}FileHash`]
      if (hash) qualities.push([quality, { hash, size: item[`${prefix}FileSize`] ?? 0 }])
    }
    return entity(source, {
      songmid: item.Audioid ?? item.audio_id ?? item.ID,
      hash: item.FileHash ?? item.hash,
      name: text(item.SongName ?? item.songname ?? item.OriSongName),
      singer: singers(item.Singers, item.SingerName ?? item.singername),
      albumName: text(item.AlbumName ?? item.album_name),
      albumId: item.AlbumID ?? item.album_id ?? '',
      img: item.Image ?? item.img ?? '',
      ...qualityInfo(qualities)
    }, seconds(item.Duration ?? item.duration))
  }
  if (source === 'tx') {
    const albumMid = item.albummid ?? item.album?.mid ?? ''
    const file = item.file ?? {}
    const qualities: Array<[string, any]> = []
    for (const [quality, size] of [
      ['128k', item.size128 ?? file.size_128mp3],
      ['320k', item.size320 ?? file.size_320mp3],
      ['flac', item.sizeflac ?? file.size_flac],
      ['flac24bit', file.size_hires]
    ] as Array<[string, any]>) {
      if (Number(size) > 0) qualities.push([quality, { size }])
    }
    return entity(source, {
      songmid: item.songmid ?? item.mid,
      songId: item.songid ?? item.id,
      strMediaMid: item.strMediaMid ?? item.media_mid ?? file.media_mid ?? '',
      name: text(item.songname ?? item.name ?? item.title),
      singer: singers(item.singer),
      albumName: text(item.albumname ?? item.album?.name),
      albumId: albumMid || item.albumid || item.album?.id || '',
      albumMid,
      img: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg` : '',
      ...qualityInfo(qualities)
    }, seconds(item.interval))
  }
  if (source === 'wy') {
    const album = item.al ?? item.album ?? {}
    const qualities: Array<[string, any]> = []
    for (const [quality, detail] of [
      ['128k', item.l ?? item.lMusic], ['320k', item.h ?? item.hMusic],
      ['flac', item.sq], ['flac24bit', item.hr]
    ] as Array<[string, any]>) {
      if (detail?.size) qualities.push([quality, { size: detail.size }])
    }
    return entity(source, {
      songmid: item.id,
      name: text(item.name),
      singer: singers(item.ar ?? item.artists),
      albumName: text(album.name),
      albumId: album.id ?? '',
      img: album.picUrl ?? '',
      ...qualityInfo(qualities)
    }, seconds(item.dt ?? item.duration) / 1000)
  }
  if (source === 'mg') {
    if (!item.songId || !item.copyrightId) return null
    const formats = Array.isArray(item.audioFormats) ? item.audioFormats : []
    const qualities = formats.map((format: any): [string, any] => [
      MG_QUALITIES[format.formatType],
      { size: format.asize ?? format.isize ?? 0 }
    ])
    const image = item.img3 || item.img2 || item.img1 || ''
    return entity(source, {
      songmid: item.songId,
      copyrightId: item.copyrightId,
      name: text(item.name ?? item.songName),
      singer: singers(item.singerList),
      albumName: text(item.album),
      albumId: item.albumId ?? '',
      img: image ? new URL(image, 'https://d.musicapp.migu.cn').href : '',
      lrcUrl: item.lrcUrl ?? item.lyricUrl,
      mrcUrl: item.mrcurl,
      trcUrl: item.trcUrl,
      ...qualityInfo(qualities)
    }, seconds(item.duration))
  }
  return null
}

async function catalogRequest(url: URL, headers?: Record<string, string>): Promise<any> {
  const response = await requestRemote({ url: url.href, headers, timeoutMs: 12_000 })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`\u6b4c\u66f2\u76ee\u5f55\u8bf7\u6c42\u5931\u8d25: HTTP ${response.status}`)
  }
  if (!response.body || typeof response.body !== 'object') {
    throw new Error('\u6b4c\u66f2\u76ee\u5f55\u8fd4\u56de\u4e86\u65e0\u6548\u6570\u636e')
  }
  return response.body
}

export async function searchLxCatalog(
  source: string,
  query: string,
  page = 1,
  limit = 30
): Promise<{ items: any[]; total?: number; nextCursor?: string }> {
  if (!Object.prototype.hasOwnProperty.call(LX_SOURCE_NAMES, source)) {
    throw new Error('\u4e0d\u652f\u6301\u7684\u97f3\u4e50\u5e73\u53f0')
  }
  const word = String(query ?? '').trim()
  if (!word) return { items: [], total: 0 }
  page = Number.isFinite(Number(page)) ? Math.max(1, Math.floor(Number(page))) : 1
  limit = Number.isFinite(Number(limit)) ? Math.min(50, Math.max(1, Math.floor(Number(limit)))) : 30
  let rows: any[]
  let total: number
  let data: any
  if (source === 'kw') {
    const url = new URL('https://search.kuwo.cn/r.s')
    url.search = new URLSearchParams({
      client: 'kt', all: word, pn: String(page - 1), rn: String(limit), uid: '794762570',
      ver: 'kwplayer_ar_9.2.2.1', vipver: '1', show_copyright_off: '1', newver: '1',
      ft: 'music', cluster: '0', strategy: '2012', encoding: 'utf8', rformat: 'json',
      vermerge: '1', mobi: '1', issubtitle: '1'
    }).toString()
    data = await catalogRequest(url)
    rows = data.abslist ?? (String(data.TOTAL) === '0' ? [] : undefined)
    total = Number(data.TOTAL)
  } else if (source === 'kg') {
    const url = new URL('https://songsearch.kugou.com/song_search_v2')
    url.search = new URLSearchParams({
      keyword: word, page: String(page), pagesize: String(limit), userid: '0', clientver: '',
      platform: 'WebFilter', filter: '2', iscorrection: '1', privilege_filter: '0', area_code: '1'
    }).toString()
    data = await catalogRequest(url)
    if (Number(data.error_code) !== 0) throw new Error(data.error_msg || '\u9177\u72d7\u641c\u7d22\u5931\u8d25')
    rows = data.data?.lists
    total = Number(data.data?.total)
  } else if (source === 'tx') {
    const url = new URL('https://c.y.qq.com/soso/fcgi-bin/client_search_cp')
    url.search = new URLSearchParams({
      format: 'json', t: '0', n: String(limit), p: String(page), w: word
    }).toString()
    data = await catalogRequest(url, { Referer: 'https://y.qq.com/' })
    if (Number(data.code) !== 0) throw new Error('QQ\u97f3\u4e50\u641c\u7d22\u5931\u8d25')
    rows = data.data?.song?.list
    total = Number(data.data?.song?.totalnum)
  } else if (source === 'wy') {
    const url = new URL('https://music.163.com/api/search/get')
    url.search = new URLSearchParams({
      s: word, type: '1', limit: String(limit), offset: String((page - 1) * limit)
    }).toString()
    data = await catalogRequest(url, { Referer: 'https://music.163.com/' })
    if (Number(data.code) !== 200) throw new Error(data.message || '\u7f51\u6613\u4e91\u641c\u7d22\u5931\u8d25')
    rows = data.result?.songs ?? (Number(data.result?.songCount) === 0 ? [] : undefined)
    total = Number(data.result?.songCount)
  } else {
    const url = new URL('https://jadeite.migu.cn/music_search/v3/search/searchAll')
    url.search = new URLSearchParams({
      isCorrect: '0', isCopyright: '1',
      searchSwitch: JSON.stringify({ song: 1, album: 0, singer: 0, tagSong: 1, mvSong: 0, bestShow: 1, songlist: 0, lyricSong: 0 }),
      pageSize: String(limit), text: word, pageNo: String(page), sort: '0', sid: 'USS'
    }).toString()
    const timestamp = String(Date.now())
    const deviceId = '963B7AA0D21511ED807EE5846EC87D20'
    const signature = `${word}6cdc72a439cef99a3418d2a78aa28c73yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${timestamp}`
    data = await catalogRequest(url, {
      uiVersion: 'A_music_3.6.1', deviceId, timestamp,
      sign: bytesToHex(md5(new TextEncoder().encode(signature))), channel: '0146921',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Mobile) AppleWebKit/537.36'
    })
    if (String(data.code) !== '000000') throw new Error(data.info || '\u54aa\u5495\u641c\u7d22\u5931\u8d25')
    rows = data.songResultData?.resultList?.flat()
    total = Number(data.songResultData?.totalCount)
  }
  if (!Array.isArray(rows)) throw new Error('\u6b4c\u66f2\u76ee\u5f55\u6570\u636e\u683c\u5f0f\u9519\u8bef')
  const seen = new Set<string>()
  const items = rows.map((item) => mapSong(source, item)).filter((item) => {
    if (!item || seen.has(item.ref.id)) return false
    seen.add(item.ref.id)
    return true
  }).slice(0, limit)
  const count = Number.isFinite(total) && total >= 0 ? total : undefined
  return {
    items,
    total: count,
    nextCursor: rows.length && (count === undefined ? rows.length >= limit : page * limit < count)
      ? String(page + 1)
      : undefined
  }
}

/** Keep provider IDs/hashes intact when a stored Track is sent back to its LX source. */
export function lxMusicInfo(ref: any, source = String(ref?.providerId ?? '')): any {
  const candidate = ref?.data?.lxMusicInfo ?? ref?.data?.musicInfo ?? ref?.data ?? {}
  const saved = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : {}
  const songmid = saved.songmid ?? saved.songMid ?? ref?.id ?? saved.songId ?? ''
  return {
    ...saved,
    id: saved.id ?? songmid,
    songmid,
    source,
    name: saved.name ?? saved.title ?? '',
    singer: saved.singer ?? saved.artist ?? '',
    albumName: saved.albumName ?? '',
    albumId: saved.albumId ?? '',
    interval: saved.interval ?? '0:00',
    types: Array.isArray(saved.types) ? saved.types : [],
    _types: saved._types ?? {},
    typeUrl: saved.typeUrl ?? {},
    ...(source === 'kg' && !saved.hash && /^[a-f\d]{32}$/i.test(String(ref?.id ?? ''))
      ? { hash: String(ref.id) }
      : {})
  }
}
