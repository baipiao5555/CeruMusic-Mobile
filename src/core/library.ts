import { reactive } from 'vue'
import type { Track } from './playback/player'
import { registerHostHooks } from './plugin/manager'

export interface LocalPlaylist {
  id: string
  name: string
  createdAt: number
  tracks: Track[]
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
    id: crypto.randomUUID(),
    name: name.trim() || '新建歌单',
    createdAt: Date.now(),
    tracks: []
  }
  libraryState.playlists.unshift(playlist)
  persist()
  return playlist
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
