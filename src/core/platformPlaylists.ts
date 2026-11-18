import type { ResourceRef } from '@shiqianjiang/ceru-plugin-sdk'
import type { Track } from './track'
import type { PlatformId } from './native/platformLogin'
import type { HttpRequestOptions, HttpResponse } from './net'
import type { PlaylistImportResult } from './library'
import { httpRequest } from './net'
import { readPlatformSession, type PlatformSession } from './platformAccounts'
import { commitPlaylistImport } from './library'

export type PlatformPlaylistRequest = (options: HttpRequestOptions) => Promise<HttpResponse>

export interface PlatformPlaylistSummary {
  platform: PlatformId
  id: string
  name: string
  trackCount: number
  cover: string
  creator: string
  description: string
}

export interface PlatformPlaylistPreview {
  summary: PlatformPlaylistSummary
  tracks: Track[]
  skipped: number
}

export interface PlatformPlaylistImportResult extends PlaylistImportResult {
  playlistId: string
}

export type PlatformPlaylistMode = 'account' | 'link' | 'none'

export interface PlatformPlaylistSupport {
  supported: boolean
  directory: boolean
  mode: PlatformPlaylistMode
  reason: string
  hint: string
}

const NETEASE_ORIGIN = 'https://music.163.com'
const NETEASE_REFERER = 'https://music.163.com/'
const NETEASE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const DESKTOP_UA = NETEASE_UA
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'
const MAX_PLAYLISTS = 5000
const MAX_TRACKS = 10000
const SONG_DETAIL_BATCH = 200
const DEFAULT_COVER = '/default-cover.png'
const KUWO_ORIGIN = 'https://www.kuwo.cn'
const KUWO_REFERER = 'https://www.kuwo.cn/playlists'
/** Cookie + header pair used by the current kuwo.cn web bundle for /api/www signing. */
export const KUWO_TOKEN_COOKIE = 'Hm_Iuvt_cdb524f42f23cer9b268564v7y735ewrq2324'
const QQ_ORIGIN = 'https://c.y.qq.com'
const QQ_REFERER = 'https://y.qq.com/'
const QQ_PROFILE_REFERER = 'https://y.qq.com/portal/profile.html'
const KUGOU_ORIGIN = 'https://m.kugou.com'
const KUGOU_PAGE_SIZE = 10
const KUGOU_MAX_TRACKS = 1000
const MIGU_ORIGIN = 'https://c.musicapp.migu.cn'
const MIGU_IMAGE_ORIGIN = 'https://d.musicapp.migu.cn'
const MIGU_REFERER = 'https://music.migu.cn/v5/'
const MIGU_PAGE_SIZE = 50
const MIGU_MAX_PAGES = 50

const platformNames: Record<PlatformId, string> = {
  wy: '网易云音乐',
  tx: 'QQ音乐',
  kg: '酷狗音乐',
  kw: '酷我音乐',
  mg: '咪咕音乐',
  qs: '汽水音乐'
}

const playlistSupport: Record<PlatformId, PlatformPlaylistSupport> = {
  wy: {
    supported: true,
    directory: true,
    mode: 'account',
    reason: '',
    hint: '使用本机加密保存的网易云会话读取官方歌单目录，再预览并导入为新的本机歌单。凭据只通过官方接口发送，不交给音源插件。'
  },
  tx: {
    supported: true,
    directory: true,
    mode: 'account',
    reason: '',
    hint: '使用本机加密保存的 QQ 音乐会话和已确认的账号 UIN 读取“创建的歌单”目录，再预览并导入。QQ 账号歌单权限仍由平台决定。'
  },
  kw: {
    supported: true,
    directory: false,
    mode: 'link',
    reason: '酷我官网只公开歌单详情，没有提供网页版“账号歌单目录”接口；当前版本不伪造目录。登录后可粘贴公开歌单链接或数字 ID 导入。',
    hint: '酷我网页接口需要登录时取得的 Hm_Iuvt 网页签名 Cookie。登录酷我后粘贴 playlist_detail 链接或数字歌单 ID，可预览并导入公开歌单。'
  },
  kg: {
    supported: false,
    directory: false,
    mode: 'none',
    reason: '酷狗账号歌单目录依赖 App 私有签名接口；其官网公开歌单 JSON 只返回前 10 首，分页参数未生效，无法保证完整顺序，因此当前版本不导入，避免残缺歌单。',
    hint: ''
  },
  mg: {
    supported: true,
    directory: false,
    mode: 'link',
    reason: '咪咕账号歌单目录接口需要登录态，当前环境没有真实咪咕账号验证返回结构，因此不读取账号目录。',
    hint: '咪咕官网公开歌单详情可直接读取。粘贴咪咕歌单链接或数字歌单 ID，可预览并导入公开歌单，不需要登录。'
  },
  qs: {
    supported: false,
    directory: false,
    mode: 'none',
    reason: '汽水音乐普通用户网页会话尚未接入，不能读取歌单。',
    hint: ''
  }
}

export function platformPlaylistSupport(platform: PlatformId): PlatformPlaylistSupport {
  return playlistSupport[platform] ?? {
    supported: false,
    directory: false,
    mode: 'none',
    reason: '此平台歌单读取尚未接入。',
    hint: ''
  }
}

export function supportsPlatformPlaylists(platform: PlatformId): boolean {
  return platformPlaylistSupport(platform).supported
}

function text(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function numericId(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  if (typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value.trim())) return value.trim()
  return ''
}

function requiredId(value: unknown, message: string): string {
  const id = numericId(value)
  if (!id) throw new Error(message)
  return id
}

function count(value: unknown): number {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : 0
}

function image(value: unknown, base = ''): string {
  let raw = text(value, 2000)
  if (raw && base && raw.startsWith('/')) raw = base + raw
  if (!raw) return DEFAULT_COVER
  try {
    const url = new URL(raw)
    if (url.protocol === 'http:') url.protocol = 'https:'
    return url.protocol === 'https:' ? url.href : DEFAULT_COVER
  } catch {
    return DEFAULT_COVER
  }
}

function htmlText(value: unknown, maxLength: number): string {
  return text(value, Math.max(maxLength * 4, 400))
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (entity) => ({
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&apos;': "'",
      '&nbsp;': ' ',
      '&#39;': "'"
    })[entity] ?? entity)
    .trim()
    .slice(0, maxLength)
}

function mmss(seconds: number): string {
  const duration = Math.max(0, Math.round(seconds))
  return `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`
}

function trackRef(platform: PlatformId, id: string, lxMusicInfo: Record<string, unknown>): ResourceRef {
  return {
    providerId: platform,
    kind: 'track',
    id,
    scope: 'provider',
    data: { lxMusicInfo }
  } as ResourceRef
}

function cookieHeader(cookies: unknown): string | undefined {
  if (cookies === undefined || cookies === null || cookies === '') return undefined
  if (typeof cookies !== 'string' || cookies.length > 65536 || /[\r\n]/.test(cookies)) {
    throw new Error('平台会话格式无效，请重新登录')
  }
  return cookies
}

function cookieValue(cookies: string | undefined, name: string): string {
  if (!cookies) return ''
  for (const part of cookies.split(';')) {
    const index = part.indexOf('=')
    if (index < 1) continue
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim()
  }
  return ''
}

function responseCode(data: any, fallback: string): number {
  const code = Number(data?.code)
  if (data?.code === undefined || data?.code === null || data?.code === '' || !Number.isFinite(code)) {
    throw new Error(fallback)
  }
  return code
}

async function neteaseGet(
  path: string,
  session: { cookies?: string },
  request: PlatformPlaylistRequest
): Promise<any> {
  const headers: Record<string, string> = {
    Referer: NETEASE_REFERER,
    Origin: NETEASE_ORIGIN,
    Accept: 'application/json, text/plain, */*',
    'User-Agent': NETEASE_UA
  }
  const cookie = cookieHeader(session?.cookies)
  if (cookie) headers.Cookie = cookie
  const response = await request({
    url: NETEASE_ORIGIN + path,
    method: 'GET',
    headers,
    responseType: 'json'
  })
  if (response.status === 401 || response.status === 403) {
    throw new Error('网易云会话已失效，请重新登录')
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`网易云请求失败 (HTTP ${response.status})`)
  }
  if (!response.data || typeof response.data !== 'object') {
    throw new Error('网易云返回了无法识别的数据')
  }
  return response.data
}

async function platformGet(
  url: string,
  headers: Record<string, string>,
  request: PlatformPlaylistRequest,
  label: string
): Promise<any> {
  const response = await request({ url, method: 'GET', headers, responseType: 'json' })
  if (response.status === 401 || response.status === 403) {
    throw new Error(`${label}会话已失效，请重新登录`)
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${label}请求失败 (HTTP ${response.status})`)
  }
  if (!response.data || typeof response.data !== 'object') {
    throw new Error(`${label}返回了无法识别的数据`)
  }
  return response.data
}

function sessionLabel(platform: PlatformId): string {
  return platformNames[platform] || '音乐平台'
}

async function requireAccountSession(platform: PlatformId): Promise<PlatformSession> {
  const session = await readPlatformSession(platform)
  if (!session || !session.cookies) {
    throw new Error(`请先在平台登录页完成${sessionLabel(platform)}登录`)
  }
  return session
}

export function parseNeteaseAccount(data: any): { userId: string; name: string } {
  const code = responseCode(data, '网易云登录响应格式错误，请重新登录')
  if (code !== 200) throw new Error('网易云会话已失效，请重新登录')
  const accountId = numericId(data?.account?.id)
  const profileId = numericId(data?.profile?.userId)
  if (!accountId || !profileId || accountId !== profileId) {
    throw new Error('网易云未确认登录身份，请重新登录')
  }
  return { userId: accountId, name: text(data?.profile?.nickname, 80) || '网易云用户' }
}

export function parseNeteaseUserPlaylists(data: any): PlatformPlaylistSummary[] {
  const code = responseCode(data, '网易云歌单目录格式错误')
  if (code !== 200) throw new Error('网易云歌单目录读取失败，请稍后重试或重新登录')
  if (!Array.isArray(data?.playlist)) throw new Error('网易云歌单目录格式错误')
  const playlists: PlatformPlaylistSummary[] = []
  const seen = new Set<string>()
  for (const raw of data.playlist) {
    const id = numericId(raw?.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    playlists.push({
      platform: 'wy',
      id,
      name: text(raw?.name, 120) || '未命名歌单',
      trackCount: count(raw?.trackCount),
      cover: image(raw?.coverImgUrl),
      creator: text(raw?.creator?.nickname, 80),
      description: text(raw?.description, 300)
    })
    if (playlists.length >= MAX_PLAYLISTS) break
  }
  if (data.playlist.length && !playlists.length) throw new Error('网易云歌单目录缺少有效歌单标识')
  return playlists
}

function neteaseSongToTrack(raw: any): Track | null {
  const id = numericId(raw?.id)
  const title = text(raw?.name, 300)
  if (!id || !title) return null
  const artists = Array.isArray(raw?.ar) ? raw.ar : Array.isArray(raw?.artists) ? raw.artists : []
  const artist = artists
    .map((item: any) => text(item?.name, 120))
    .filter(Boolean)
    .join(' / ')
    .slice(0, 300) || '未知歌手'
  const album = raw?.al && typeof raw.al === 'object' ? raw.al : raw?.album && typeof raw.album === 'object' ? raw.album : {}
  const duration = Number(raw?.dt ?? raw?.duration)
  const ref: ResourceRef = { providerId: 'wy', kind: 'track', id, scope: 'provider' }
  return {
    id,
    providerId: 'wy',
    providerName: '网易云音乐',
    pluginId: '',
    ref,
    title,
    artist,
    album: text(album?.name, 300),
    durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0,
    artwork: image(album?.picUrl),
    qualities: []
  }
}

export interface NeteasePlaylistDetail {
  summary: PlatformPlaylistSummary
  tracks: Track[]
  missingIds: string[]
  skipped: number
}

export function parseNeteasePlaylistDetail(data: any): NeteasePlaylistDetail {
  const code = responseCode(data, '网易云歌单详情格式错误')
  if (code !== 200 || !data?.playlist || typeof data.playlist !== 'object') {
    throw new Error('网易云歌单不存在或不可访问')
  }
  const raw = data.playlist
  const id = requiredId(raw.id, '网易云歌单缺少有效标识')
  const rawTracks: any[] = Array.isArray(raw.tracks) ? raw.tracks : []
  const trackIds: string[] = []
  const seenIds = new Set<string>()
  if (Array.isArray(raw.trackIds)) {
    for (const entry of raw.trackIds) {
      const trackId = numericId(entry?.id ?? entry)
      if (!trackId || seenIds.has(trackId)) continue
      seenIds.add(trackId)
      trackIds.push(trackId)
    }
  }
  if (!trackIds.length) {
    for (const entry of rawTracks) {
      const trackId = numericId(entry?.id)
      if (!trackId || seenIds.has(trackId)) continue
      seenIds.add(trackId)
      trackIds.push(trackId)
    }
  }
  if (trackIds.length > MAX_TRACKS) {
    throw new Error(`网易云歌单超过 ${MAX_TRACKS} 首，当前版本不导入超大歌单`)
  }
  const byId = new Map<string, any>()
  for (const entry of rawTracks) {
    const trackId = numericId(entry?.id)
    if (trackId && !byId.has(trackId)) byId.set(trackId, entry)
  }
  const tracks: Track[] = []
  const missingIds: string[] = []
  let skipped = 0
  for (const trackId of trackIds) {
    const entry = byId.get(trackId)
    if (!entry) {
      missingIds.push(trackId)
      continue
    }
    const track = neteaseSongToTrack(entry)
    if (track) tracks.push(track)
    else skipped++
  }
  const rawCount = count(raw.trackCount)
  return {
    summary: {
      platform: 'wy',
      id,
      name: text(raw.name, 120) || '未命名歌单',
      trackCount: rawCount || trackIds.length,
      cover: image(raw.coverImgUrl),
      creator: text(raw.creator?.nickname, 80),
      description: text(raw.description, 300)
    },
    tracks,
    missingIds,
    skipped
  }
}

export function parseNeteaseSongDetail(data: any): Track[] {
  const code = responseCode(data, '网易云歌曲详情格式错误')
  if (code !== 200) throw new Error('网易云歌曲详情读取失败')
  if (!Array.isArray(data?.songs)) throw new Error('网易云歌曲详情格式错误')
  return data.songs
    .map((song: any) => neteaseSongToTrack(song))
    .filter((track: Track | null): track is Track => Boolean(track))
}

async function fetchNeteaseSongDetails(
  ids: string[],
  session: { cookies?: string },
  request: PlatformPlaylistRequest
): Promise<any[]> {
  const songs: any[] = []
  for (let index = 0; index < ids.length; index += SONG_DETAIL_BATCH) {
    const batch = ids.slice(index, index + SONG_DETAIL_BATCH)
      .map((id) => Number(id))
      .filter((id) => Number.isSafeInteger(id) && id > 0)
    if (!batch.length) continue
    const data = await neteaseGet(
      '/api/song/detail?ids=' + encodeURIComponent(JSON.stringify(batch)),
      session,
      request
    )
    const code = responseCode(data, '网易云歌曲详情格式错误')
    if (code !== 200 || !Array.isArray(data?.songs)) throw new Error('网易云歌曲详情读取失败')
    songs.push(...data.songs)
  }
  return songs
}

/** Explicit song/detail lookup used for playlists whose detail page omits full tracks. */
export async function fetchNeteaseSongDetail(
  ids: string[],
  session: { cookies?: string } = {},
  request: PlatformPlaylistRequest = httpRequest
): Promise<Track[]> {
  if (!Array.isArray(ids)) throw new Error('网易云歌曲 ID 列表格式错误')
  const valid = ids.map((id) => numericId(id)).filter(Boolean).slice(0, MAX_TRACKS)
  if (!valid.length) return []
  const songs = await fetchNeteaseSongDetails(valid, session, request)
  return songs
    .map((song) => neteaseSongToTrack(song))
    .filter((track): track is Track => Boolean(track))
}

export async function fetchNeteaseUserPlaylists(
  userId: string,
  session: { cookies?: string } = {},
  request: PlatformPlaylistRequest = httpRequest
): Promise<PlatformPlaylistSummary[]> {
  const uid = requiredId(userId, '网易云用户 ID 无效')
  const result: PlatformPlaylistSummary[] = []
  const seen = new Set<string>()
  let offset = 0
  for (let page = 0; page < 5 && result.length < MAX_PLAYLISTS; page++) {
    const data = await neteaseGet(
      `/api/user/playlist?uid=${uid}&limit=1000&offset=${offset}`,
      session,
      request
    )
    const items = parseNeteaseUserPlaylists(data)
    for (const item of items) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      result.push(item)
      if (result.length >= MAX_PLAYLISTS) break
    }
    const rawLength = Array.isArray(data.playlist) ? data.playlist.length : 0
    if (data.more !== true || rawLength === 0) break
    const nextOffset = offset + rawLength
    if (nextOffset <= offset) break
    offset = nextOffset
  }
  return result
}

export async function fetchNeteasePlaylistDetail(
  playlistId: string,
  session: { cookies?: string } = {},
  request: PlatformPlaylistRequest = httpRequest
): Promise<NeteasePlaylistDetail> {
  const id = requiredId(playlistId, '网易云歌单 ID 无效')
  const data = await neteaseGet(`/api/v6/playlist/detail?id=${id}&n=1000&s=0`, session, request)
  let detail = parseNeteasePlaylistDetail(data)
  if (detail.missingIds.length) {
    const songs = await fetchNeteaseSongDetails(detail.missingIds, session, request)
    if (songs.length) {
      const existing = Array.isArray(data?.playlist?.tracks) ? data.playlist.tracks : []
      detail = parseNeteasePlaylistDetail({
        ...data,
        playlist: { ...data.playlist, tracks: [...existing, ...songs] }
      })
    }
  }
  if (detail.missingIds.length) {
    detail = { ...detail, skipped: detail.skipped + detail.missingIds.length, missingIds: [] }
  }
  return detail
}

function requestId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/**
 * The current kuwo.cn web bundle signs /api/www requests with this exact
 * algorithm: `Secret = f(cookieValue, cookieName)`. Keeping the same
 * operations matters because the server validates the final decimal chain.
 */
export function kuwoSecret(token: string, cookieName = KUWO_TOKEN_COOKIE): string {
  const value = text(token, 4096)
  if (!value) throw new Error('酷我会话缺少网页签名 Cookie，请重新登录酷我')
  let digits = ''
  for (let index = 0; index < cookieName.length; index++) {
    digits += cookieName.charCodeAt(index).toString()
  }
  const offset = Math.floor(digits.length / 5)
  const radix = parseInt(
    digits.charAt(offset) +
    digits.charAt(2 * offset) +
    digits.charAt(3 * offset) +
    digits.charAt(4 * offset) +
    digits.charAt(5 * offset)
  )
  const step = Math.ceil(cookieName.length / 2)
  const modulus = Math.pow(2, 31) - 1
  if (!Number.isFinite(radix) || radix < 2) throw new Error('酷我网页签名参数无效')
  let salt = Math.round(1e9 * Math.random()) % 1e8
  digits += salt
  while (digits.length > 10) {
    digits = (parseInt(digits.substring(0, 10)) + parseInt(digits.substring(10))).toString()
  }
  let state = (radix * Number(digits) + step) % modulus
  let output = ''
  for (let index = 0; index < value.length; index++) {
    const byte = parseInt(
      String(value.charCodeAt(index) ^ Math.floor((state / modulus) * 255))
    )
    output += byte < 16 ? '0' + byte.toString(16) : byte.toString(16)
    state = (radix * state + step) % modulus
  }
  let suffix = salt.toString(16)
  while (suffix.length < 8) suffix = '0' + suffix
  return output + suffix
}

function kuwoHeaders(session: { cookies?: string }, referer = KUWO_REFERER): Record<string, string> {
  const cookie = cookieHeader(session?.cookies)
  const token = cookieValue(cookie, KUWO_TOKEN_COOKIE)
  if (!token) throw new Error('酷我会话缺少网页签名 Cookie，请重新登录酷我')
  const headers: Record<string, string> = {
    Referer: referer,
    Origin: KUWO_ORIGIN,
    Accept: 'application/json, text/plain, */*',
    'User-Agent': DESKTOP_UA,
    Secret: kuwoSecret(token)
  }
  if (cookie) headers.Cookie = cookie
  return headers
}

export function parseKuwoPlaylistLink(input: unknown): string {
  const raw = text(input, 2000)
  if (!raw) throw new Error('请填写酷我歌单链接或数字 ID')
  const plain = numericId(raw)
  if (plain) return plain
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('酷我歌单链接格式无效，请粘贴 playlist_detail 链接或数字 ID')
  }
  if (!/(^|\.)kuwo\.cn$/i.test(url.hostname)) {
    throw new Error('只支持酷我官方域名的歌单链接')
  }
  const queryId = numericId(url.searchParams.get('pid') ?? url.searchParams.get('id') ?? '')
  if (queryId) return queryId
  const match = /\/(?:playlist_detail|playlists?|playlist)\/([1-9]\d{0,19})/.exec(url.pathname)
  if (match) return match[1]
  throw new Error('酷我歌单链接中缺少有效歌单 ID')
}

function kuwoSongToTrack(raw: any): Track | null {
  const id = numericId(raw?.rid) || numericId(String(raw?.musicrid ?? '').replace(/^MUSIC_/, ''))
  const title = htmlText(raw?.name, 300)
  if (!id || !title) return null
  const artist = text(raw?.artist, 300).replace(/&/g, ' / ') || '未知歌手'
  const album = htmlText(raw?.album, 300)
  const duration = Number(raw?.duration)
  const artwork = image(raw?.albumpic || raw?.pic)
  return {
    id,
    providerId: 'kw',
    providerName: '酷我音乐',
    pluginId: '',
    ref: trackRef('kw', id, {
      source: 'kw',
      songmid: id,
      name: title,
      singer: artist,
      albumName: album,
      albumId: String(raw?.albumid ?? ''),
      img: artwork,
      interval: mmss(Number.isFinite(duration) ? duration : 0),
      types: []
    }),
    title,
    artist,
    album,
    durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : 0,
    artwork,
    qualities: []
  }
}

export function parseKuwoPlaylistDetail(data: any, fallbackId = ''): NeteasePlaylistDetail {
  if (data?.success === false) {
    throw new Error(text(data?.message, 120) || '酷我拒绝了请求，可能需要重新登录以刷新网页签名')
  }
  const code = responseCode(data, '酷我歌单详情格式错误')
  if (code !== 200) throw new Error(text(data?.message, 120) || '酷我歌单详情读取失败')
  const raw = data?.data
  if (!raw || typeof raw !== 'object') throw new Error('酷我歌单不存在或不可访问')
  const id = numericId(raw.id) || numericId(fallbackId)
  if (!id) throw new Error('酷我歌单缺少有效标识')
  const musicList = Array.isArray(raw.musicList) ? raw.musicList : []
  if (musicList.length > MAX_TRACKS) throw new Error(`酷我歌单超过 ${MAX_TRACKS} 首，当前版本不导入超大歌单`)
  const tracks: Track[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const entry of musicList) {
    const track = kuwoSongToTrack(entry)
    if (!track) {
      skipped++
      continue
    }
    if (seen.has(track.id)) {
      skipped++
      continue
    }
    seen.add(track.id)
    tracks.push(track)
  }
  return {
    summary: {
      platform: 'kw',
      id,
      name: htmlText(raw.name, 120) || '未命名歌单',
      trackCount: count(raw.total) || musicList.length,
      cover: image(raw.img500 || raw.img300 || raw.img),
      creator: htmlText(raw.userName || raw.uname, 80),
      description: htmlText(raw.info || raw.desc, 300)
    },
    tracks,
    missingIds: [],
    skipped
  }
}

export async function fetchKuwoPlaylistDetail(
  playlistId: string,
  session: { cookies?: string } = {},
  request: PlatformPlaylistRequest = httpRequest
): Promise<NeteasePlaylistDetail> {
  const id = parseKuwoPlaylistLink(playlistId)
  const url =
    `${KUWO_ORIGIN}/api/www/playlist/playListInfo?pid=${id}` +
    `&pn=1&rn=${MAX_TRACKS}&httpsStatus=1&reqId=${encodeURIComponent(requestId())}&plat=web_www&from=`
  const data = await platformGet(
    url,
    kuwoHeaders(session, `https://www.kuwo.cn/playlist_detail/${id}`),
    request,
    '酷我'
  )
  return parseKuwoPlaylistDetail(data, id)
}

function qqUin(session: { cookies?: string; userId?: string } | undefined): string {
  const direct = numericId(session?.userId)
  if (direct) return direct
  const cookies = cookieHeader(session?.cookies)
  for (const name of ['qqmusic_uin', 'uin', 'wxuin']) {
    const value = cookieValue(cookies, name).replace(/^o0*/, '')
    const id = numericId(value)
    if (id) return id
  }
  return ''
}

function qqGtk(session: { cookies?: string } | undefined): string {
  const cookies = cookieHeader(session?.cookies)
  const key =
    cookieValue(cookies, 'qm_keyst') ||
    cookieValue(cookies, 'qqmusic_key') ||
    cookieValue(cookies, 'wxmusic_key')
  if (!key) return '5381'
  let hash = 5381
  for (const char of key) hash += (hash << 5) + char.charCodeAt(0)
  return String(hash & 0x7fffffff)
}

export function parseQQPlaylistLink(input: unknown): string {
  const raw = text(input, 2000)
  if (!raw) throw new Error('请填写 QQ 音乐歌单链接或数字 ID')
  const plain = numericId(raw)
  if (plain) return plain
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('QQ 音乐歌单链接格式无效，请粘贴 /n/ryqq/playlist/… 链接或数字 ID')
  }
  if (!/(^|\.)qq\.com$/i.test(url.hostname)) {
    throw new Error('只支持 QQ 音乐官方域名的歌单链接')
  }
  const queryId = numericId(
    url.searchParams.get('disstid') ?? url.searchParams.get('tid') ?? url.searchParams.get('id') ?? ''
  )
  if (queryId) return queryId
  const match = /\/(?:ryqq|ryqq_v2)\/playlist\/([1-9]\d{5,19})/.exec(url.pathname)
  if (match) return match[1]
  throw new Error('QQ 音乐歌单链接中缺少有效歌单 ID')
}

export function parseQQUserPlaylists(data: any): PlatformPlaylistSummary[] {
  const code = responseCode(data, 'QQ 音乐歌单目录格式错误')
  if (code === 1000) throw new Error('QQ 音乐登录态已失效，请重新登录')
  if (code === 4000) throw new Error('QQ 音乐账号未公开歌单，或当前会话无权读取')
  if (code !== 0) throw new Error(text(data?.message, 120) || 'QQ 音乐歌单目录读取失败')
  if (!data?.data) return []
  if (data.data.disslist === undefined) return []
  if (!Array.isArray(data.data.disslist)) throw new Error('QQ 音乐歌单目录格式错误')
  const creator = htmlText(data.data.hostname, 80)
  const playlists: PlatformPlaylistSummary[] = []
  const seen = new Set<string>()
  for (const raw of data.data.disslist) {
    const id = numericId(raw?.tid)
    if (!id || seen.has(id) || Number(raw?.dirid) === 205) continue
    seen.add(id)
    playlists.push({
      platform: 'tx',
      id,
      name: htmlText(raw?.diss_name, 120) || '未命名歌单',
      trackCount: count(raw?.song_cnt),
      cover: image(raw?.diss_cover),
      creator,
      description: ''
    })
    if (playlists.length >= MAX_PLAYLISTS) break
  }
  return playlists
}

export async function fetchQQUserPlaylists(
  userId: string,
  session: { cookies?: string; name?: string } = {},
  request: PlatformPlaylistRequest = httpRequest
): Promise<PlatformPlaylistSummary[]> {
  const uid = numericId(userId) || qqUin(session)
  if (!uid) throw new Error('QQ 音乐会话缺少可确认的账号 UIN，请重新登录并完成身份核验')
  const cookie = cookieHeader(session.cookies)
  const headers: Record<string, string> = {
    Referer: QQ_PROFILE_REFERER,
    Accept: 'application/json, text/plain, */*',
    'User-Agent': DESKTOP_UA
  }
  if (cookie) headers.Cookie = cookie
  const result: PlatformPlaylistSummary[] = []
  const seen = new Set<string>()
  let offset = 0
  for (let page = 0; page < 10 && result.length < MAX_PLAYLISTS; page++) {
    const query = new URLSearchParams({
      hostUin: '0',
      hostuin: uid,
      sin: String(offset),
      size: '200',
      g_tk: qqGtk(session),
      loginUin: cookie ? uid : '0',
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: '0',
      platform: 'yqq.json',
      needNewCode: '0'
    })
    const data = await platformGet(
      `${QQ_ORIGIN}/rsc/fcgi-bin/fcg_user_created_diss?${query.toString()}`,
      headers,
      request,
      'QQ 音乐'
    )
    const pageItems = parseQQUserPlaylists(data)
    for (const item of pageItems) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      if (!item.creator && session.name) item.creator = text(session.name, 80)
      result.push(item)
      if (result.length >= MAX_PLAYLISTS) break
    }
    const rawLength = Array.isArray(data?.data?.disslist) ? data.data.disslist.length : 0
    const total = count(data?.data?.totoal ?? data?.data?.total)
    offset += rawLength
    if (!rawLength || rawLength < 200 || (total && result.length >= total)) break
  }
  return result
}

function qqSongToTrack(raw: any): Track | null {
  const mid = text(raw?.songmid, 64)
  const id = /^[0-9A-Za-z]{4,64}$/.test(mid) ? mid : numericId(raw?.songid)
  const title = htmlText(raw?.songname, 300)
  if (!id || !title) return null
  const singers = Array.isArray(raw?.singer)
    ? raw.singer.map((entry: any) => htmlText(entry?.name, 120)).filter(Boolean)
    : []
  const artist = singers.join(' / ').slice(0, 300) || '未知歌手'
  const album = htmlText(raw?.albumname, 300)
  const albumMid = text(raw?.albummid, 64)
  const duration = Number(raw?.interval)
  const artwork = albumMid
    ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg`
    : image(raw?.album?.picUrl)
  const qualities: string[] = []
  for (const [quality, size] of [
    ['128k', raw?.size128],
    ['320k', raw?.size320],
    ['flac', raw?.sizeflac],
    ['flac24bit', raw?.sizehires]
  ] as Array<[string, unknown]>) {
    if (Number(size) > 0) qualities.push(quality)
  }
  return {
    id,
    providerId: 'tx',
    providerName: 'QQ音乐',
    pluginId: '',
    ref: trackRef('tx', id, {
      source: 'tx',
      songmid: id,
      songId: String(raw?.songid ?? ''),
      strMediaMid: text(raw?.strMediaMid, 64),
      name: title,
      singer: artist,
      albumName: album,
      albumId: albumMid || String(raw?.albumid ?? ''),
      albumMid,
      img: artwork,
      interval: mmss(Number.isFinite(duration) ? duration : 0),
      types: qualities.map((quality) => ({ type: quality }))
    }),
    title,
    artist,
    album,
    durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : 0,
    artwork,
    qualities
  }
}

export function parseQQPlaylistDetail(data: any, fallbackId = ''): NeteasePlaylistDetail {
  const code = responseCode(data, 'QQ 音乐歌单详情格式错误')
  if (code !== 0) throw new Error(text(data?.message, 120) || 'QQ 音乐歌单不存在或不可访问')
  const raw = Array.isArray(data?.cdlist) ? data.cdlist[0] : undefined
  if (!raw || typeof raw !== 'object') throw new Error('QQ 音乐歌单不存在或不可访问')
  const id = numericId(raw.disstid) || numericId(fallbackId)
  if (!id) throw new Error('QQ 音乐歌单缺少有效标识')
  const songlist: any[] = Array.isArray(raw.songlist) ? raw.songlist : []
  if (songlist.length > MAX_TRACKS) throw new Error(`QQ 音乐歌单超过 ${MAX_TRACKS} 首，当前版本不导入超大歌单`)
  const tracks: Track[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const entry of songlist) {
    const track = qqSongToTrack(entry)
    if (!track) {
      skipped++
      continue
    }
    if (seen.has(track.id)) {
      skipped++
      continue
    }
    seen.add(track.id)
    tracks.push(track)
  }
  const firstArtwork = tracks[0]?.artwork || ''
  return {
    summary: {
      platform: 'tx',
      id,
      name: htmlText(raw.dissname, 120) || '未命名歌单',
      trackCount: count(raw.songnum) || songlist.length,
      cover: image(raw.logo || raw.picurl || firstArtwork),
      creator: htmlText(raw.nickname || raw.nick, 80),
      description: htmlText(raw.desc, 300)
    },
    tracks,
    missingIds: [],
    skipped
  }
}

export async function fetchQQPlaylistDetail(
  playlistId: string,
  session: { cookies?: string } = {},
  request: PlatformPlaylistRequest = httpRequest
): Promise<NeteasePlaylistDetail> {
  const id = parseQQPlaylistLink(playlistId)
  const cookie = cookieHeader(session.cookies)
  const headers: Record<string, string> = {
    Referer: QQ_REFERER,
    Accept: 'application/json, text/plain, */*',
    'User-Agent': DESKTOP_UA
  }
  if (cookie) headers.Cookie = cookie
  const query = new URLSearchParams({
    type: '1',
    json: '1',
    utf8: '1',
    onlysong: '0',
    disstid: id,
    format: 'json',
    g_tk: '5381',
    loginUin: '0',
    hostUin: '0',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: '0',
    platform: 'yqq.json',
    needNewCode: '0'
  })
  const data = await platformGet(
    `${QQ_ORIGIN}/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?${query.toString()}`,
    headers,
    request,
    'QQ 音乐'
  )
  return parseQQPlaylistDetail(data, id)
}

export function parseKugouPlaylistLink(input: unknown): string {
  const raw = text(input, 2000)
  if (!raw) throw new Error('请填写酷狗歌单链接或短 ID')
  if (/^[0-9A-Za-z]{5,40}$/.test(raw)) return raw
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('酷狗歌单链接格式无效，请粘贴 m.kugou.com/plist/list/… 链接或短 ID')
  }
  if (!/(^|\.)kugou\.com$/i.test(url.hostname)) {
    throw new Error('只支持酷狗官方域名的歌单链接')
  }
  const queryId = text(url.searchParams.get('specialid') ?? url.searchParams.get('id') ?? '', 40)
  if (/^[0-9A-Za-z]{5,40}$/.test(queryId)) return queryId
  const match = /\/plist\/list\/([0-9A-Za-z]{5,40})/.exec(url.pathname)
  if (match) return match[1]
  if (/\/songlist\/gcid_/i.test(url.pathname)) {
    throw new Error('暂不支持 gcid_ 分享链接；请打开酷狗网页歌单后复制地址中的 plist/list/… 短 ID')
  }
  throw new Error('酷狗歌单链接中缺少有效短 ID')
}

async function fetchKugouPage(
  id: string,
  page: number,
  request: PlatformPlaylistRequest
): Promise<{ pageData: any; meta: any }> {
  const data = await platformGet(
    `${KUGOU_ORIGIN}/plist/list/${encodeURIComponent(id)}/?json=1&page=${page}`,
    {
      Referer: `${KUGOU_ORIGIN}/plist/list/${encodeURIComponent(id)}/`,
      Accept: 'application/json, text/plain, */*',
      'User-Agent': MOBILE_UA
    },
    request,
    '酷狗'
  )
  const pageData = data?.list?.list
  if (!pageData || !Array.isArray(pageData.info)) {
    throw new Error('酷狗歌单不存在或已下架')
  }
  return { pageData, meta: data?.info?.list ?? {} }
}

function kugouSongToTrack(raw: any): Track | null {
  const hash = text(raw?.hash, 64).toUpperCase()
  if (!/^[0-9A-F]{32}$/.test(hash)) return null
  const filename = htmlText(raw?.filename, 300)
  if (!filename) return null
  const singer = htmlText(raw?.singername, 300)
  let artist = singer
  let title = filename
  const separator = filename.indexOf(' - ')
  if (separator > 0) {
    if (!artist) artist = filename.slice(0, separator).trim()
    const rest = filename.slice(separator + 3).trim()
    if (rest) title = rest
  }
  if (!artist) artist = '未知歌手'
  const album = htmlText(raw?.album_name, 300)
  const duration = Number(raw?.duration)
  const cover = text(raw?.trans_param?.union_cover, 2000).replace('{size}', '400')
  const artwork = image(cover)
  const qualities: string[] = []
  if (text(raw?.hash, 64)) qualities.push('128k')
  if (text(raw?.['320hash'], 64)) qualities.push('320k')
  if (text(raw?.sqhash, 64)) qualities.push('flac')
  return {
    id: hash,
    providerId: 'kg',
    providerName: '酷狗音乐',
    pluginId: '',
    ref: trackRef('kg', hash, {
      source: 'kg',
      hash,
      songmid: String(raw?.audio_id ?? ''),
      name: title,
      singer: artist,
      albumName: album,
      albumId: String(raw?.album_id ?? ''),
      img: artwork,
      interval: mmss(Number.isFinite(duration) ? duration : 0),
      types: qualities.map((quality) => ({ type: quality }))
    }),
    title,
    artist,
    album,
    durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : 0,
    artwork,
    qualities
  }
}

export async function fetchKugouPlaylistDetail(
  playlistId: string,
  request: PlatformPlaylistRequest = httpRequest
): Promise<NeteasePlaylistDetail> {
  const id = parseKugouPlaylistLink(playlistId)
  const first = await fetchKugouPage(id, 1, request)
  const total = count(first.pageData.total) || count(first.meta.songcount)
  if (total > KUGOU_MAX_TRACKS) {
    throw new Error(`酷狗歌单有 ${total} 首，超过当前版本 ${KUGOU_MAX_TRACKS} 首的导入上限`)
  }
  const estimatedPages = Math.max(1, Math.ceil(total / KUGOU_PAGE_SIZE))
  const rawSongs: any[] = [...first.pageData.info]
  const pageHashes = new Set<string>(rawSongs.map((entry: any) => text(entry?.hash, 64).toUpperCase()))
  for (let page = 2; page <= estimatedPages; page++) {
    const next = await fetchKugouPage(id, page, request)
    if (!next.pageData.info.length) break
    const hashes = next.pageData.info
      .map((entry: any) => text(entry?.hash, 64).toUpperCase())
      .filter(Boolean)
    if (hashes.length && hashes.every((hash: string) => pageHashes.has(hash))) {
      throw new Error('酷狗官网只返回前 10 首，分页未生效，无法完整读取该歌单')
    }
    for (const hash of hashes) pageHashes.add(hash)
    rawSongs.push(...next.pageData.info)
  }
  if (total && rawSongs.length < total) {
    throw new Error(`酷狗只返回了 ${rawSongs.length}/${total} 首，未导入不完整歌单`)
  }
  const tracks: Track[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const entry of rawSongs) {
    const track = kugouSongToTrack(entry)
    if (!track) {
      skipped++
      continue
    }
    if (seen.has(track.id)) {
      skipped++
      continue
    }
    seen.add(track.id)
    tracks.push(track)
  }
  const cover = text(first.meta.imgurl, 2000).replace('{size}', '400')
  return {
    summary: {
      platform: 'kg',
      id,
      name: htmlText(first.meta.specialname, 120) || `酷狗歌单 ${id}`,
      trackCount: count(first.meta.songcount) || total || rawSongs.length,
      cover: image(cover),
      creator: htmlText(first.meta.nickname, 80),
      description: htmlText(first.meta.intro, 300)
    },
    tracks,
    missingIds: [],
    skipped
  }
}

export function parseMiguPlaylistLink(input: unknown): string {
  const raw = text(input, 2000)
  if (!raw) throw new Error('请填写咪咕歌单链接或数字 ID')
  const plain = numericId(raw)
  if (plain) return plain
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('咪咕歌单链接格式无效，请粘贴咪咕歌单链接或数字 ID')
  }
  if (!/(^|\.)migu\.cn$/i.test(url.hostname)) {
    throw new Error('只支持咪咕官方域名的歌单链接')
  }
  const queryId = numericId(
    url.searchParams.get('musicListId') ??
    url.searchParams.get('playlistId') ??
    url.searchParams.get('id') ??
    ''
  )
  if (queryId) return queryId
  const match = /\/(?:playlist|playlists)\/([1-9]\d{0,19})/.exec(url.pathname)
  if (match) return match[1]
  throw new Error('咪咕歌单链接中缺少有效歌单 ID')
}

function miguImage(value: unknown): string {
  return image(value, MIGU_IMAGE_ORIGIN)
}

function miguSongToTrack(raw: any): Track | null {
  const id = numericId(raw?.songId) || numericId(raw?.contentId)
  const title = htmlText(raw?.songName, 300)
  if (!id || !title) return null
  const artists = Array.isArray(raw?.singerList)
    ? raw.singerList.map((entry: any) => htmlText(entry?.name, 120)).filter(Boolean)
    : []
  const artist = artists.join(' / ').slice(0, 300) || '未知歌手'
  const album = htmlText(raw?.album, 300)
  const duration = Number(raw?.duration)
  const artwork = miguImage(raw?.img3 || raw?.img2 || raw?.img1)
  const qualities: string[] = []
  const qualityMap: Record<string, string> = { PQ: '128k', HQ: '320k', SQ: 'flac', ZQ24: 'flac24bit' }
  if (Array.isArray(raw?.audioFormats)) {
    for (const format of raw.audioFormats) {
      const quality = qualityMap[String(format?.formatType ?? '')]
      if (quality && !qualities.includes(quality)) qualities.push(quality)
    }
  }
  return {
    id,
    providerId: 'mg',
    providerName: '咪咕音乐',
    pluginId: '',
    ref: trackRef('mg', id, {
      source: 'mg',
      songmid: id,
      copyrightId: text(raw?.copyrightId, 64),
      name: title,
      singer: artist,
      albumName: album,
      albumId: String(raw?.albumId ?? ''),
      img: artwork,
      lrcUrl: text(raw?.lrcUrl, 1000),
      mrcUrl: text(raw?.mrcUrl, 1000),
      interval: mmss(Number.isFinite(duration) ? duration : 0),
      types: qualities.map((quality) => ({ type: quality }))
    }),
    title,
    artist,
    album,
    durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : 0,
    artwork,
    qualities
  }
}

export async function fetchMiguPlaylistDetail(
  playlistId: string,
  request: PlatformPlaylistRequest = httpRequest
): Promise<NeteasePlaylistDetail> {
  const id = parseMiguPlaylistLink(playlistId)
  const headers: Record<string, string> = {
    Referer: MIGU_REFERER,
    Accept: 'application/json, text/plain, */*',
    'User-Agent': DESKTOP_UA
  }
  const detail = await platformGet(
    `${MIGU_ORIGIN}/resource/playlist/v2.0?playlistId=${id}`,
    headers,
    request,
    '咪咕'
  )
  if (String(detail?.code) !== '000000' || !detail?.data) {
    throw new Error(text(detail?.info, 120) || '咪咕歌单不存在或不可访问')
  }
  const raw = detail.data
  const summaryId = numericId(raw.musicListId) || id
  const total = count(raw.musicNum)
  if (total > MAX_TRACKS) throw new Error(`咪咕歌单超过 ${MAX_TRACKS} 首，当前版本不导入超大歌单`)
  const rawSongs: any[] = []
  let totalCount = 0
  for (let page = 1; page <= MIGU_MAX_PAGES; page++) {
    const songs = await platformGet(
      `${MIGU_ORIGIN}/MIGUM3.0/resource/playlist/song/v2.0?playlistId=${summaryId}` +
      `&pageNo=${page}&pageSize=${MIGU_PAGE_SIZE}`,
      headers,
      request,
      '咪咕'
    )
    if (String(songs?.code) !== '000000' || !songs?.data) {
      throw new Error(text(songs?.info, 120) || '咪咕歌单曲目读取失败')
    }
    totalCount = count(songs.data.totalCount) || totalCount
    const list = Array.isArray(songs.data.songList) ? songs.data.songList : []
    rawSongs.push(...list)
    if (!list.length) break
    if (totalCount && rawSongs.length >= totalCount) break
  }
  if (totalCount > MAX_TRACKS) throw new Error(`咪咕歌单超过 ${MAX_TRACKS} 首，当前版本不导入超大歌单`)
  if (totalCount && rawSongs.length < totalCount) {
    throw new Error(`咪咕只返回了 ${rawSongs.length}/${totalCount} 首，未导入不完整歌单`)
  }
  const tracks: Track[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const entry of rawSongs) {
    const track = miguSongToTrack(entry)
    if (!track) {
      skipped++
      continue
    }
    if (seen.has(track.id)) {
      skipped++
      continue
    }
    seen.add(track.id)
    tracks.push(track)
  }
  return {
    summary: {
      platform: 'mg',
      id: summaryId,
      name: htmlText(raw.title, 120) || '未命名歌单',
      trackCount: total || totalCount || rawSongs.length,
      cover: miguImage(raw.imgItem?.img || raw.originalImgUrl),
      creator: htmlText(raw.ownerName, 80),
      description: htmlText(raw.summary, 300)
    },
    tracks,
    missingIds: [],
    skipped
  }
}

/** Reads a verified account playlist directory. Only NetEase and QQ expose one. */
export async function loadPlatformPlaylists(platform: PlatformId): Promise<PlatformPlaylistSummary[]> {
  const support = platformPlaylistSupport(platform)
  if (!support.supported) throw new Error(support.reason)
  if (!support.directory) throw new Error(support.reason)
  if (platform === 'wy') {
    const session = await requireAccountSession('wy')
    const account = parseNeteaseAccount(await neteaseGet('/api/nuser/account/get', session, httpRequest))
    return fetchNeteaseUserPlaylists(account.userId, session)
  }
  if (platform === 'tx') {
    const session = await requireAccountSession('tx')
    const uid = qqUin(session)
    if (!uid) throw new Error('QQ 音乐会话缺少可确认的账号 UIN，请重新登录并完成身份核验')
    return fetchQQUserPlaylists(uid, session)
  }
  throw new Error(support.reason || `${sessionLabel(platform)}账号歌单目录未接入`)
}

/** Reads the full ordered track list for a selected directory entry. */
export async function previewPlatformPlaylist(
  platform: PlatformId,
  summary: PlatformPlaylistSummary
): Promise<PlatformPlaylistPreview> {
  const support = platformPlaylistSupport(platform)
  if (!support.supported) throw new Error(support.reason)
  if (!summary || typeof summary !== 'object') throw new Error('平台歌单数据格式错误')
  let detail: NeteasePlaylistDetail
  if (platform === 'wy') {
    const session = await requireAccountSession('wy')
    const id = requiredId(summary.id, '网易云歌单 ID 无效')
    detail = await fetchNeteasePlaylistDetail(id, session)
  } else if (platform === 'tx') {
    const session = await requireAccountSession('tx')
    detail = await fetchQQPlaylistDetail(summary.id, session)
  } else if (platform === 'kw') {
    const session = await requireAccountSession('kw')
    detail = await fetchKuwoPlaylistDetail(summary.id, session)
  } else if (platform === 'kg') {
    detail = await fetchKugouPlaylistDetail(summary.id)
  } else if (platform === 'mg') {
    detail = await fetchMiguPlaylistDetail(summary.id)
  } else {
    throw new Error(support.reason || '此平台歌单读取尚未接入')
  }
  return {
    summary: {
      ...detail.summary,
      name: detail.summary.name || summary.name,
      cover: detail.summary.cover || summary.cover
    },
    tracks: detail.tracks,
    skipped: detail.skipped
  }
}

/** Link/ID import used by platforms whose account directory is not public. */
export async function previewPlatformPlaylistLink(
  platform: PlatformId,
  link: string
): Promise<PlatformPlaylistPreview> {
  const support = platformPlaylistSupport(platform)
  if (!support.supported) throw new Error(support.reason)
  let detail: NeteasePlaylistDetail
  if (platform === 'kw') {
    const session = await requireAccountSession('kw')
    detail = await fetchKuwoPlaylistDetail(link, session)
  } else if (platform === 'kg') {
    detail = await fetchKugouPlaylistDetail(link)
  } else if (platform === 'mg') {
    detail = await fetchMiguPlaylistDetail(link)
  } else if (platform === 'tx') {
    detail = await fetchQQPlaylistDetail(link)
  } else if (platform === 'wy') {
    detail = await fetchNeteasePlaylistDetail(parseNeteasePlaylistLink(link), {})
  } else {
    throw new Error(support.reason || '此平台歌单读取尚未接入')
  }
  return { summary: detail.summary, tracks: detail.tracks, skipped: detail.skipped }
}

function parseNeteasePlaylistLink(input: unknown): string {
  const raw = text(input, 2000)
  const plain = numericId(raw)
  if (plain) return plain
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('网易云歌单链接格式无效')
  }
  if (!/(^|\.)163\.com$/i.test(url.hostname)) throw new Error('只支持网易云官方域名的歌单链接')
  const queryId = numericId(url.searchParams.get('id') ?? '')
  if (queryId) return queryId
  const match = /\/playlist\/([1-9]\d{0,19})/.exec(url.pathname)
  if (match) return match[1]
  throw new Error('网易云歌单链接中缺少有效歌单 ID')
}

function importId(platform: PlatformId, value: unknown): string {
  if (platform === 'kg') {
    const id = text(value, 40)
    if (!/^[0-9A-Za-z]{5,40}$/.test(id)) throw new Error('酷狗歌单 ID 无效')
    return id
  }
  return requiredId(value, `${sessionLabel(platform)}歌单 ID 无效`)
}

/** Commits the previewed tracks to a new local playlist, preserving platform order. */
export function importPlatformPlaylist(
  platform: PlatformId,
  preview: PlatformPlaylistPreview
): PlatformPlaylistImportResult {
  const support = platformPlaylistSupport(platform)
  if (!support.supported) throw new Error(support.reason)
  if (!preview?.summary || !Array.isArray(preview.tracks)) throw new Error('平台歌单数据格式错误')
  if (!preview.tracks.length) throw new Error('这个歌单没有可导入的歌曲')
  const id = importId(platform, preview.summary.id)
  const result = commitPlaylistImport([{
    name: text(preview.summary.name, 120) || '平台导入歌单',
    tracks: [...preview.tracks],
    cover: image(preview.summary.cover),
    description: `来源：${sessionLabel(platform)} · 歌单 ${id}${preview.summary.creator ? ' · ' + preview.summary.creator : ''}`
  }], { mode: 'new' })
  const playlistId = result.playlistIds[0]
  if (!playlistId) throw new Error('本机歌单未能创建，请重试')
  return { ...result, playlistId }
}
