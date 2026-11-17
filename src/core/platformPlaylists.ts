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

export type PlatformPlaylistSupport = { supported: true } | { supported: false; reason: string }

const NETEASE_ORIGIN = 'https://music.163.com'
const NETEASE_REFERER = 'https://music.163.com/'
const NETEASE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const MAX_PLAYLISTS = 5000
const MAX_TRACKS = 10000
const SONG_DETAIL_BATCH = 200
const DEFAULT_COVER = '/default-cover.png'

const unsupportedReasons: Record<Exclude<PlatformId, 'wy'>, string> = {
  tx: 'QQ 音乐歌单接口需要另行验证 uin/authst 登录态与歌单权限，当前版本不读取，避免显示未经验证的成功结果。',
  kg: '酷狗歌单接口需要额外签名参数，当前版本尚未完成真实账号验证，因此不读取。',
  kw: '酷我歌单接口依赖 kw_token/csrf，当前版本尚未完成真实账号验证，因此不读取。',
  mg: '咪咕歌单接口尚未完成真实账号验证，当前版本不读取。',
  qs: '汽水音乐普通用户网页会话尚未接入，不能读取歌单。'
}

export function platformPlaylistSupport(platform: PlatformId): PlatformPlaylistSupport {
  if (platform === 'wy') return { supported: true }
  return { supported: false, reason: unsupportedReasons[platform] ?? '此平台歌单读取尚未接入。' }
}

export function supportsPlatformPlaylists(platform: PlatformId): platform is 'wy' {
  return platform === 'wy'
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

function image(value: unknown): string {
  const raw = text(value, 2000)
  if (!raw) return DEFAULT_COVER
  try {
    const url = new URL(raw)
    if (url.protocol === 'http:') url.protocol = 'https:'
    return url.protocol === 'https:' ? url.href : DEFAULT_COVER
  } catch {
    return DEFAULT_COVER
  }
}

function cookieHeader(cookies: unknown): string | undefined {
  if (cookies === undefined || cookies === null || cookies === '') return undefined
  if (typeof cookies !== 'string' || cookies.length > 65536 || /[\r\n]/.test(cookies)) {
    throw new Error('平台会话格式无效，请重新登录')
  }
  return cookies
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

function requireSession(platform: PlatformId): Promise<PlatformSession> {
  const support = platformPlaylistSupport(platform)
  if (!support.supported) throw new Error(support.reason)
  return readPlatformSession(platform).then((session) => {
    if (!session || !session.cookies) throw new Error('请先在平台登录页完成网易云登录')
    return session
  })
}

/** Reads the logged-in NetEase account's playlist directory through the Keystore session. */
export async function loadPlatformPlaylists(platform: PlatformId): Promise<PlatformPlaylistSummary[]> {
  const session = await requireSession(platform)
  const account = parseNeteaseAccount(await neteaseGet('/api/nuser/account/get', session, httpRequest))
  return fetchNeteaseUserPlaylists(account.userId, session)
}

/** Reads the full ordered track list for the selected playlist without importing it yet. */
export async function previewPlatformPlaylist(
  platform: PlatformId,
  summary: PlatformPlaylistSummary
): Promise<PlatformPlaylistPreview> {
  const session = await requireSession(platform)
  const id = requiredId(summary?.id, '网易云歌单 ID 无效')
  const detail = await fetchNeteasePlaylistDetail(id, session)
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

/** Commits the previewed tracks to a new local playlist, preserving the platform order. */
export function importPlatformPlaylist(
  platform: PlatformId,
  preview: PlatformPlaylistPreview
): PlatformPlaylistImportResult {
  const support = platformPlaylistSupport(platform)
  if (!support.supported) throw new Error(support.reason)
  if (!preview?.summary || !Array.isArray(preview.tracks)) throw new Error('平台歌单数据格式错误')
  if (!preview.tracks.length) throw new Error('这个歌单没有可导入的歌曲')
  const id = requiredId(preview.summary.id, '网易云歌单 ID 无效')
  const result = commitPlaylistImport([{
    name: text(preview.summary.name, 120) || '平台导入歌单',
    tracks: [...preview.tracks],
    cover: image(preview.summary.cover),
    description: `来源：网易云音乐 · 歌单 ${id}${preview.summary.creator ? ' · ' + preview.summary.creator : ''}`
  }], { mode: 'new' })
  const playlistId = result.playlistIds[0]
  if (!playlistId) throw new Error('本机歌单未能创建，请重试')
  return { ...result, playlistId }
}
