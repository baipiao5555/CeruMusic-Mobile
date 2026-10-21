import { reactive } from 'vue'
import type { ResourceRef } from '@shiqianjiang/ceru-plugin-sdk'
import { authState, getAccessToken, logout } from './auth'
import { errorMessage, httpRequest } from './net'
import { allProviders, notify, type ProviderHandle } from './plugin/manager'
import {
  createPlaylist,
  findPlaylistByCloudId,
  getPlaylist,
  libraryState,
  updatePlaylistFields,
  updatePlaylistTracks,
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

function unwrap(data: any): any {
  if (data && typeof data === 'object' && 'data' in data && 'code' in data) return data.data
  return data
}

async function apiGet(path: string): Promise<any> {
  const token = await getAccessToken()
  const response = await httpRequest({
    url: API_BASE + path,
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token },
    responseType: 'json'
  })
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
  if (!authState.authenticated) {
    cloudState.playlists = []
    return []
  }
  cloudState.loading = true
  cloudState.error = ''
  try {
    const data = await apiGet('/user-songlist')
    const list: CloudPlaylist[] = Array.isArray(data) ? data : data?.items ?? []
    cloudState.playlists = list.map((item) => ({
      id: String(item.id),
      name: item.name || '未命名歌单',
      describe: item.describe,
      cover: item.cover,
      filePath: item.filePath,
      localId: item.localId,
      updatedAt: item.updatedAt
    }))
    return cloudState.playlists
  } catch (error: any) {
    cloudState.error = error?.message ?? '读取云歌单失败'
    throw error
  } finally {
    cloudState.loading = false
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
    return (
      providers.find(
        (item) =>
          item.providerId === resource.providerId &&
          (!resource.pluginId || item.pluginId === resource.pluginId)
      ) ?? providers.find((item) => item.providerId === resource.providerId)
    )
  }
  return (
    providers.find((item) => item.providerId === song.source) ??
    providers.find((item) => item.pluginId === song.source)
  )
}

function cloudSongToTrack(song: CloudSong): { track: Track; matched: boolean } {
  const provider = providerForSong(song)
  const resource = song.pluginResource
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
        scope: 'provider'
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
      pluginId: provider?.pluginId ?? resource?.pluginId ?? '',
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

async function fetchCloudTracks(id: string): Promise<CloudSong[]> {
  const limit = 200
  const songs: CloudSong[] = []
  for (let page = 0; page < 50; page++) {
    const data = await apiGet(
      `/user-songlist/list?id=${encodeURIComponent(id)}&sort=asc&limit=${limit}&pos=${songs.length}`
    )
    const list: CloudSong[] = Array.isArray(data) ? data : data?.list ?? []
    songs.push(...list)
    const total = Number(data?.total)
    if (!list.length || list.length < limit) break
    if (Number.isFinite(total) && songs.length >= total) break
  }
  return songs
}

function upsertPlaylist(cloud: CloudPlaylist, tracks: Track[]): { playlist: LocalPlaylist; updated: boolean } {
  const existing = findPlaylistByCloudId(cloud.id)
  if (existing) {
    updatePlaylistTracks(existing.id, tracks)
    updatePlaylistFields(existing.id, {
      name: cloud.name,
      description: cloud.describe ?? '',
      cover: cloud.cover,
      cloudUpdatedAt: cloud.updatedAt
    })
    return { playlist: getPlaylist(existing.id)!, updated: true }
  }
  const playlist = createPlaylist(cloud.name)
  updatePlaylistTracks(playlist.id, tracks)
  updatePlaylistFields(playlist.id, {
    description: cloud.describe ?? '',
    cover: cloud.cover,
    cloudId: cloud.id,
    cloudUpdatedAt: cloud.updatedAt
  })
  return { playlist: getPlaylist(playlist.id)!, updated: false }
}

export interface ImportResult {
  playlist: LocalPlaylist
  total: number
  matched: number
  updated: boolean
}

export async function importCloudPlaylist(cloud: CloudPlaylist): Promise<ImportResult> {
  cloudState.importing = cloud.id
  cloudState.importingLabel = cloud.name
  try {
    const songs = await fetchCloudTracks(cloud.id)
    const converted = songs.map(cloudSongToTrack)
    const tracks = converted.map((item) => item.track)
    const { playlist, updated } = upsertPlaylist(cloud, tracks)
    return {
      playlist,
      total: tracks.length,
      matched: converted.filter((item) => item.matched).length,
      updated
    }
  } finally {
    cloudState.importing = ''
    cloudState.importingLabel = ''
  }
}

export async function importAllCloudPlaylists(): Promise<{ playlists: number; tracks: number }> {
  if (!cloudState.playlists.length) await fetchCloudPlaylists()
  let playlists = 0
  let tracks = 0
  for (const cloud of cloudState.playlists) {
    try {
      const result = await importCloudPlaylist(cloud)
      playlists += 1
      tracks += result.total
    } catch (error) {
      console.warn('导入云歌单失败:', cloud.name, error)
    }
  }
  return { playlists, tracks }
}

export function isCloudPlaylistImported(cloudId: string): boolean {
  return libraryState.playlists.some((item) => item.cloudId === cloudId)
}

export function notifyImportResult(result: ImportResult): void {
  const action = result.updated ? '已更新' : '已导入'
  const suffix = result.matched < result.total ? `，${result.total - result.matched} 首未匹配音源` : ''
  notify(`${action}「${result.playlist.name}」${result.total} 首歌曲${suffix}`)
}
