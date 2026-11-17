import { reactive, watch } from 'vue'
import type { ResourceRef } from '@shiqianjiang/ceru-plugin-sdk'
import { authState, getAccessToken, getAuthSessionVersion, logout } from './auth'
import { errorMessage, httpRequest } from './net'
import { allProviders, notify, type ProviderHandle } from './plugin/manager'
import {
  cloudTrackKey,
  commitCloudPlaylist,
  libraryState,
  type LocalPlaylist
} from './library'
import type { Track } from './track'

const API_BASE = 'https://api.ceru.shiqianjiang.cn/api'

export interface CloudPlaylist {
  id: string
  name: string
  describe?: string
  cover?: string
  filePath?: string
  localId?: string
  updatedAt?: string
}

interface CloudSong {
  songmid: string | number
  hash?: string
  name?: string
  singer?: string
  albumName?: string
  albumId?: string | number
  source?: string
  interval?: string
  img?: string
  types?: Array<{ type?: string; size?: string } | string>
  pos?: number
  pluginResource?: {
    pluginId?: string
    providerId?: string
    connectionId?: string
    kind?: string
    id?: string
    scope?: string
  }
}

export const cloudState = reactive({
  loading: false,
  error: '',
  playlists: [] as CloudPlaylist[],
  importing: '' as string,
  importingLabel: ''
})

let directoryRequest = 0
watch([() => authState.authenticated, () => authState.user?.sub], ([loggedIn, subject], [, previousSubject]) => {
  if (!loggedIn || subject !== previousSubject) {
    directoryRequest++
    cloudState.playlists = []
    cloudState.error = ''
    cloudState.loading = false
  }
}, { flush: 'sync' })

function unwrap(data: any): any {
  if (data && typeof data === 'object' && 'data' in data && 'code' in data) {
    const code = Number(data.code)
    if (!['number', 'string'].includes(typeof data.code) || String(data.code).trim() === '' ||
        !(code === 0 || (code >= 200 && code < 300))) {
      throw new Error(errorMessage(data, '云端返回业务错误，本机歌单未更新'))
    }
    return data.data
  }
  return data
}

function assertSession(version: number): void {
  if (!authState.authenticated || getAuthSessionVersion() !== version) {
    throw new Error('登录状态已变化，已取消旧账号的同步')
  }
}

async function apiGet(path: string, version: number): Promise<any> {
  assertSession(version)
  const token = await getAccessToken()
  assertSession(version)
  const response = await httpRequest({
    url: API_BASE + path,
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token },
    responseType: 'json'
  })
  assertSession(version)
  if (response.status === 401 || response.status === 403) {
    logout()
    throw new Error('登录已过期，请重新登录')
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(errorMessage(response.data, `云端请求失败 (HTTP ${response.status})`))
  }
  return unwrap(response.data)
}

export async function fetchCloudPlaylists(): Promise<CloudPlaylist[]> {
  const request = ++directoryRequest
  const version = getAuthSessionVersion()
  if (!authState.authenticated) {
    cloudState.playlists = []
    return []
  }
  cloudState.loading = true
  cloudState.error = ''
  try {
    const data = await apiGet('/user-songlist', version)
    const list = Array.isArray(data) ? data : data?.items
    if (!Array.isArray(list) || list.some((item) => !item || item.id == null || String(item.id) === '')) {
      throw new Error('云歌单目录格式错误，请重试')
    }
    const playlists: CloudPlaylist[] = list.map((item) => ({
      id: String(item.id),
      name: item.name || '未命名歌单',
      describe: item.describe,
      cover: item.cover,
      filePath: item.filePath,
      localId: item.localId,
      updatedAt: item.updatedAt
    }))
    if (request !== directoryRequest) return cloudState.playlists
    cloudState.playlists = playlists
    return cloudState.playlists
  } catch (error: any) {
    if (request === directoryRequest && getAuthSessionVersion() === version) {
      cloudState.error = error?.message ?? '读取云歌单失败'
    }
    throw error
  } finally {
    if (request === directoryRequest) cloudState.loading = false
  }
}

function parseDuration(interval?: string): number {
  if (!interval) return 0
  const parts = interval.split(':').map((value) => Number(value) || 0)
  if (!parts.length) return 0
  return parts.reduce((total, value) => total * 60 + value, 0) * 1000
}

function providerForSong(song: CloudSong): ProviderHandle | undefined {
  const resource = song.pluginResource
  const providers = allProviders()
  if (resource) {
    return providers.find(
      (item) =>
        item.providerId === resource.providerId &&
        (!resource.pluginId || item.pluginId === resource.pluginId)
    )
  }
  return (
    providers.find((item) => item.providerId === song.source) ??
    providers.find((item) => item.pluginId === song.source)
  )
}

function cloudSongToTrack(song: CloudSong): { track: Track; matched: boolean } {
  const resource = song?.pluginResource
  const source = resource?.providerId ?? song?.source
  if (!song || typeof song !== 'object' ||
      !['string', 'number'].includes(typeof (resource?.id ?? song.songmid)) ||
      String(resource?.id ?? song.songmid).trim() === '' ||
      (typeof song.songmid === 'number' && !Number.isFinite(song.songmid)) ||
      typeof source !== 'string' || !source.trim()) {
    throw new Error('云端歌曲缺少有效来源或标识，本机歌单未更新')
  }
  if (resource?.scope === 'provider' && resource.connectionId !== undefined) {
    throw new Error('云端公共歌曲包含私有连接，本机歌单未更新')
  }
  if (resource?.kind && resource.kind !== 'track') throw new Error('云端歌曲引用类型错误，本机歌单未更新')
  const provider = providerForSong(song)
  const id = String(resource?.id ?? song.songmid)
  const providerId = String(resource?.providerId ?? song.source ?? '')
  const ref: ResourceRef = resource
    ? ({
        ...(resource as any),
        pluginId: resource.pluginId ?? provider?.pluginId ?? '',
        providerId,
        connectionId: resource.connectionId,
        kind: 'track',
        id,
        ...(resource.scope === 'provider' ? { scope: 'provider' } : {})
      } as ResourceRef)
    : ({
        pluginId: provider?.pluginId ?? '',
        providerId,
        kind: 'track',
        id,
        scope: 'provider'
      } as ResourceRef)
  const qualities = (song.types ?? [])
    .map((item) => (typeof item === 'string' ? item : item?.type))
    .filter((item): item is string => Boolean(item))
  return {
    matched: Boolean(provider),
    track: {
      id,
      providerId,
      pluginId: resource?.pluginId ?? provider?.pluginId ?? '',
      providerName: provider?.pluginName ?? (providerId || '未知音源'),
      ref,
      title: song.name || '未知歌曲',
      artist: song.singer || '未知歌手',
      album: song.albumName || '',
      durationMs: parseDuration(song.interval),
      artwork: song.img && song.img !== 'default-cover' ? song.img : '/default-cover.png',
      qualities: qualities.length ? qualities : provider?.qualities ?? []
    }
  }
}

async function fetchCloudTracks(id: string, version: number): Promise<CloudSong[]> {
  const limit = 200
  const songs: CloudSong[] = []
  const seen = new Set<string>()
  let pos: number | undefined
  let mode: 'position' | 'offset' | undefined
  let received = 0
  let expected: number | undefined
  let hasTotal: boolean | undefined
  // Bounded malformed-server protection: never silently commit a truncated list.
  for (let page = 0; page < 10_000; page++) {
    const query = new URLSearchParams({ id, sort: 'asc', limit: String(limit) })
    if (pos !== undefined) query.set('pos', String(pos))
    const data = await apiGet('/user-songlist/list?' + query, version)
    const list: CloudSong[] = Array.isArray(data) ? data : data?.list
    if (!Array.isArray(list)) throw new Error('云端歌曲列表格式错误，本机歌单未更新')
    if (hasTotal !== undefined && hasTotal !== !Array.isArray(data)) {
      throw new Error('云端分页响应格式变化，本机歌单未更新')
    }
    hasTotal = !Array.isArray(data)
    if (!Array.isArray(data)) {
      const total = Number(data.total)
      if (!['number', 'string'].includes(typeof data.total) || String(data.total).trim() === '' ||
          !Number.isSafeInteger(total) || total < 0) {
        throw new Error('云端歌曲总数无效，本机歌单未更新')
      }
      if (expected !== undefined && total !== expected) {
        throw new Error('云端歌单在读取期间发生变化，请重试；本机歌单未更新')
      }
      expected = total
    }
    if (!list.length) {
      if (expected !== undefined && received !== expected) {
        throw new Error('云端歌曲未读取完整，请重试；本机歌单未更新')
      }
      return songs
    }
    const last = list[list.length - 1]
    const nextMode = typeof last?.pos === 'number' && Number.isFinite(last.pos) ? 'position' : 'offset'
    if (mode !== undefined && mode !== nextMode) throw new Error('云端分页游标格式变化，本机歌单未更新')
    mode = nextMode
    if (mode === 'position') {
      let previous = pos
      for (const song of list) {
        if (typeof song?.pos !== 'number' || !Number.isFinite(song.pos) ||
            (previous !== undefined && song.pos <= previous)) {
          throw new Error('云端分页位置重复或未前进，本机歌单未更新')
        }
        previous = song.pos
      }
    }
    const before = songs.length
    const pageKeys = new Set<string>()
    for (const song of list) {
      const key = cloudTrackKey(cloudSongToTrack(song).track)
      if (seen.has(key) && !pageKeys.has(key)) {
        throw new Error('云端分页存在重叠或重复歌曲，本机歌单未更新')
      }
      if (!seen.has(key)) { seen.add(key); songs.push(song) }
      pageKeys.add(key)
    }
    if (songs.length === before) throw new Error('云端重复返回同一页，已停止同步；本机歌单未更新')
    received += list.length
    if (expected !== undefined && received >= expected) {
      if (received !== expected || songs.length !== expected) {
        throw new Error('云端歌曲存在重复或数量不一致，请重试；本机歌单未更新')
      }
      return songs
    }
    // Without a total, a server-capped short page is not EOF: probe until an explicit empty page.
    const next = mode === 'position' ? last.pos! : received
    if (pos !== undefined && next <= pos) throw new Error('云端分页游标未前进，本机歌单未更新')
    pos = next
  }
  throw new Error('云端分页超过安全上限，本机歌单未更新')
}

export interface ImportResult {
  playlist: LocalPlaylist
  total: number
  matched: number
  updated: boolean
  undo(): void
}

async function currentCloudPlaylist(cloud: CloudPlaylist, version: number): Promise<CloudPlaylist> {
  const data = await apiGet('/user-songlist', version)
  const list = Array.isArray(data) ? data : data?.items
  if (!Array.isArray(list)) throw new Error('云歌单目录格式错误，本机歌单未更新')
  const current = list.find(item => item && String(item.id) === cloud.id)
  if (!current) throw new Error('云端歌单已删除或不可访问，本机歌单未更新')
  if (typeof current.updatedAt !== 'string' || !Number.isFinite(Date.parse(current.updatedAt))) {
    throw new Error('云端歌单缺少有效版本，无法安全同步；本机歌单未更新')
  }
  return { ...cloud, ...current, id: cloud.id, name: current.name || cloud.name }
}

const imports = new Map<string, { cloud: CloudPlaylist; promise: Promise<ImportResult> }>()

function updateImportState(): void {
  const next = imports.values().next().value
  cloudState.importing = next?.cloud.id ?? ''
  cloudState.importingLabel = next?.cloud.name ?? ''
}

export function importCloudPlaylist(
  cloud: CloudPlaylist,
  options: { replaceLocalChanges?: boolean } = {}
): Promise<ImportResult> {
  const version = getAuthSessionVersion()
  const key = `${version}:${cloud.id}`
  const running = imports.get(key)
  if (running) return running.promise
  const promise = Promise.resolve().then(async () => {
    assertSession(version)
    const ownerId = authState.user?.sub
    if (typeof ownerId !== 'string' || !ownerId.trim()) {
      throw new Error('无法确认当前账号身份，原歌单未修改；请重新登录')
    }
    const current = await currentCloudPlaylist(cloud, version)
    const songs = await fetchCloudTracks(cloud.id, version)
    if ((await currentCloudPlaylist(cloud, version)).updatedAt !== current.updatedAt) {
      throw new Error('云端歌单在读取期间发生变化，请重试；本机歌单未更新')
    }
    const converted = songs.map(cloudSongToTrack)
    const tracks = converted.map((item) => item.track)
    assertSession(version)
    if (authState.user?.sub !== ownerId) throw new Error('当前账号身份已变化，本机歌单未更新')
    const { playlist, updated, undo } = commitCloudPlaylist(current, tracks, { ...options, ownerId })
    return { playlist, total: tracks.length, matched: converted.filter((item) => item.matched).length, updated, undo }
  }).finally(() => {
    imports.delete(key)
    updateImportState()
  })
  imports.set(key, { cloud, promise })
  updateImportState()
  return promise
}

export async function importAllCloudPlaylists(): Promise<{
  playlists: number; tracks: number; failed: Array<{ id: string; name: string; error: string }>
}> {
  const version = getAuthSessionVersion()
  const directory = await fetchCloudPlaylists()
  let playlists = 0
  let tracks = 0
  const failed: Array<{ id: string; name: string; error: string }> = []
  for (const cloud of directory) {
    assertSession(version)
    try {
      const result = await importCloudPlaylist(cloud)
      playlists += 1
      tracks += result.total
    } catch (error: any) {
      assertSession(version)
      failed.push({ id: cloud.id, name: cloud.name, error: error?.message ?? '导入失败' })
    }
  }
  return { playlists, tracks, failed }
}

export function isCloudPlaylistImported(cloudId: string): boolean {
  const ownerId = authState.user?.sub
  return libraryState.playlists.some((item) => item.cloudId === cloudId &&
    (!item.cloudOwnerId || item.cloudOwnerId === ownerId))
}

export function notifyImportResult(result: ImportResult): void {
  const action = result.updated ? '已更新' : '已导入'
  const suffix = result.matched < result.total ? `，${result.total - result.matched} 首未匹配音源` : ''
  notify(`${action}「${result.playlist.name}」${result.total} 首歌曲${suffix}`)
}
