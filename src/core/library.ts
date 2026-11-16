import { reactive } from 'vue'
import type { Track } from './playback/player'
import { registerHostHooks } from './plugin/manager'
import { randomUUID } from '../shims/crypto'

export interface LocalPlaylist {
  id: string
  name: string
  createdAt: number
  tracks: Track[]
  description?: string
  cover?: string
  /** 云端歌单 id（来自澜音账号的云歌单） */
  cloudId?: string
  cloudUpdatedAt?: string
  origin?: { type: 'file'; format: string; externalId?: string }
}

export interface PlaylistImportDraft {
  name: string
  tracks: Track[]
  description?: string
  cover?: string
  origin?: LocalPlaylist['origin']
}

export interface PlaylistImportResult {
  createdIds: string[]
  playlistIds: string[]
  importedTracks: number
  skippedTracks: number
  undo(): void
}

const KEY = 'ceru.library.v1'

export const libraryState = reactive({
  favorites: [] as Track[],
  playlists: [] as LocalPlaylist[]
})

function persist(): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ favorites: libraryState.favorites, playlists: libraryState.playlists })
    )
  } catch {}
}

export function restoreLibrary(): void {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (Array.isArray(saved.favorites)) libraryState.favorites = saved.favorites
    if (Array.isArray(saved.playlists)) libraryState.playlists = saved.playlists
  } catch {}
}

function sameTrack(a: Track, b: Track): boolean {
  return a.id === b.id && a.providerId === b.providerId
}

export function isFavorite(track: Track): boolean {
  return libraryState.favorites.some((item) => sameTrack(item, track))
}

export function toggleFavorite(track: Track): boolean {
  if (isFavorite(track)) {
    libraryState.favorites = libraryState.favorites.filter((item) => !sameTrack(item, track))
    persist()
    return false
  }
  libraryState.favorites.unshift(track)
  persist()
  return true
}

export function createPlaylist(name: string): LocalPlaylist {
  const playlist: LocalPlaylist = {
    id: randomUUID(),
    name: name.trim() || '新建歌单',
    createdAt: Date.now(),
    tracks: []
  }
  libraryState.playlists.unshift(playlist)
  persist()
  return playlist
}

/** 批量导入先准备快照，持久化成功后才提交到界面；不留下半个导入批次。 */
export function commitPlaylistImport(
  drafts: PlaylistImportDraft[],
  options: { mode: 'new' | 'merge' | 'replace'; targetId?: string } = { mode: 'new' }
): PlaylistImportResult {
  if (!drafts.length) throw new Error('请选择要导入的歌单')
  if (!['new', 'merge', 'replace'].includes(options.mode)) throw new Error('不支持的导入方式')
  for (const draft of drafts) {
    if (!draft || typeof draft.name !== 'string' || !Array.isArray(draft.tracks)) throw new Error('歌单数据格式错误')
    if (draft.tracks.some(t => !t || typeof t.id !== 'string' || !t.id || typeof t.providerId !== 'string' || !t.providerId)) throw new Error('歌单中有缺少来源或标识的歌曲')
  }
  const beforeText = JSON.stringify({ favorites: libraryState.favorites, playlists: libraryState.playlists })
  const next = JSON.parse(beforeText) as { favorites: Track[]; playlists: LocalPlaylist[] }
  const createdIds: string[] = []
  const playlistIds: string[] = []
  let importedTracks = 0
  let skippedTracks = 0
  const key = (t: Track): string => JSON.stringify([t.pluginId || '', t.providerId, t.id, (t.ref as any)?.connectionId || ''])
  const unique = (tracks: Track[], existing: Track[] = []): Track[] => {
    const seen = new Set(existing.map(key))
    return tracks.filter(track => {
      const id = key(track)
      if (seen.has(id)) { skippedTracks++; return false }
      seen.add(id)
      importedTracks++
      return true
    })
  }
  if (options.mode === 'new') {
    const additions = drafts.map(draft => {
      const id = randomUUID()
      createdIds.push(id)
      playlistIds.push(id)
      return { id, name: draft.name.trim() || '导入歌单', createdAt: Date.now(), tracks: unique(draft.tracks),
        ...(draft.description ? { description: draft.description } : {}),
        ...(draft.cover ? { cover: draft.cover } : {}), ...(draft.origin ? { origin: draft.origin } : {}) }
    })
    next.playlists.unshift(...additions)
  } else {
    const target = next.playlists.find(p => p.id === options.targetId)
    if (!target) throw new Error('目标歌单不存在，请重新选择')
    const incoming = drafts.flatMap(draft => draft.tracks)
    target.tracks = options.mode === 'merge'
      ? [...target.tracks, ...unique(incoming, target.tracks)] : unique(incoming)
    playlistIds.push(target.id)
  }
  const afterText = JSON.stringify(next)
  const save = (text: string): void => {
    try { localStorage.setItem(KEY, text) }
    catch { throw new Error('歌单保存失败，原歌单库未修改；请检查存储空间或分批导入') }
    const value = JSON.parse(text) as typeof next
    libraryState.favorites = value.favorites
    libraryState.playlists = value.playlists
  }
  save(afterText)
  return { createdIds, playlistIds, importedTracks, skippedTracks, undo: () => {
    if (JSON.stringify({ favorites: libraryState.favorites, playlists: libraryState.playlists }) !== afterText) {
      throw new Error('导入后歌单库已有其他改动，不能一键撤销；请手动管理导入歌单')
    }
    save(beforeText)
  } }
}

export function createPlaylistWithTracks(name: string, tracks: Track[]): LocalPlaylist {
  const playlist = createPlaylist(name)
  playlist.tracks = [...tracks]
  persist()
  return playlist
}

export function renamePlaylist(id: string, name: string): void {
  const playlist = libraryState.playlists.find((item) => item.id === id)
  if (!playlist) return
  playlist.name = name.trim() || playlist.name
  persist()
}

export function deletePlaylist(id: string): void {
  libraryState.playlists = libraryState.playlists.filter((item) => item.id !== id)
  persist()
}

export function addTrackToPlaylist(id: string, track: Track): boolean {
  const playlist = libraryState.playlists.find((item) => item.id === id)
  if (!playlist) return false
  if (playlist.tracks.some((item) => sameTrack(item, track))) return false
  playlist.tracks.push(track)
  persist()
  return true
}

export function removeTrackFromPlaylist(id: string, track: Track): void {
  const playlist = libraryState.playlists.find((item) => item.id === id)
  if (!playlist) return
  playlist.tracks = playlist.tracks.filter((item) => !sameTrack(item, track))
  persist()
}

export function getPlaylist(id: string): LocalPlaylist | undefined {
  return libraryState.playlists.find((item) => item.id === id)
}

export function findPlaylistByCloudId(cloudId: string): LocalPlaylist | undefined {
  return libraryState.playlists.find((item) => item.cloudId === cloudId)
}

export function updatePlaylistTracks(id: string, tracks: Track[]): void {
  const playlist = getPlaylist(id)
  if (!playlist) return
  playlist.tracks = [...tracks]
  persist()
}

export function updatePlaylistFields(
  id: string,
  patch: Partial<Pick<LocalPlaylist, 'name' | 'description' | 'cover' | 'cloudId' | 'cloudUpdatedAt'>>
): void {
  const playlist = getPlaylist(id)
  if (!playlist) return
  Object.assign(playlist, patch)
  persist()
}

export function registerLibraryHostHooks(): void {
  registerHostHooks({
    favorites: {
      contains: (args: any[]) => {
        const ref = args?.[0]
        return isFavorite({
          id: ref?.id,
          providerId: ref?.providerId
        } as Track)
      },
      add: (args: any[]) => {
        const ref = args?.[0]
        if (!ref) return { added: 0 }
        if (!isFavorite({ id: ref.id, providerId: ref.providerId } as Track)) {
          libraryState.favorites.push({
            id: ref.id,
            providerId: ref.providerId,
            pluginId: ref.pluginId ?? '',
            providerName: '',
            ref,
            title: ref.data?.title ?? ref.id,
            artist: ref.data?.artist ?? '',
            album: '',
            durationMs: 0,
            artwork: '/default-cover.png',
            qualities: []
          })
          persist()
        }
        return { added: 1 }
      },
      remove: (args: any[]) => {
        const ref = args?.[0]
        if (!ref) return { removed: 0 }
        libraryState.favorites = libraryState.favorites.filter(
          (item) => !(item.id === ref.id && item.providerId === ref.providerId)
        )
        persist()
        return { removed: 1 }
      }
    },
    library: {
      list: () =>
        libraryState.playlists.map((playlist) => ({
          ref: { providerId: 'local', kind: 'playlist', id: playlist.id, pluginId: 'local' },
          title: playlist.name,
          capabilities: ['play'],
          playlist: { trackCount: playlist.tracks.length }
        })),
      getTracks: (id) =>
        (getPlaylist(id)?.tracks ?? []).map((track) => ({
          ref: track.ref,
          title: track.title,
          subtitle: track.artist,
          capabilities: ['play'],
          metadata: {
            artists: [track.artist],
            album: track.album ? { title: track.album } : undefined,
            durationMs: track.durationMs,
            artworkUrl: track.artwork,
            qualities: track.qualities
          }
        }))
    }
  })
}
