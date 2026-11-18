import { libraryState, commitLibraryReplacement, type LocalPlaylist } from './library'
import { pluginState } from './plugin/manager'
import { randomUUID } from '../shims/crypto'
import type { Track } from './track'

export interface PortableTrack {
  id: string; title: string; artist: string; album: string; durationMs: number; artwork: string; qualities: string[]
  source: { manifestId: string; providerId: string; kind: string; id: string; requiresRebind: boolean }
}
export interface PortablePlaylist { id: string; name: string; description: string; cover: string; createdAt: number; tracks: PortableTrack[] }
export type TombstoneKind = 'playlist' | 'track' | 'favorite'
/**
 * A deletion marker keeps the full portable item so a user can review and
 * restore it later. `id` is a playlist id or a stable track identity; track
 * tombstones additionally pin the playlist they were removed from.
 */
export interface SyncTombstone {
  kind: TombstoneKind
  id: string
  name: string
  deletedAt: string
  deviceId: string
  playlistId?: string
  playlist?: PortablePlaylist
  track?: PortableTrack
}
/**
 * Version 1 snapshots are still accepted. Version 2 adds deletion tombstones
 * and a client device id; `tombstones` is always present on parsed values.
 */
export interface LibrarySnapshot {
  schema: 'ceru.library.sync'
  version: 1 | 2
  createdAt: string
  deviceId?: string
  favorites: PortableTrack[]
  playlists: PortablePlaylist[]
  tombstones?: SyncTombstone[]
}
const MAX_BYTES = 8 * 1024 * 1024
const MAX_TRACKS = 50000
const MAX_TOMBSTONES = 50000
const DEVICE_KEY = 'ceru.sync.device.v1'
let fallbackDeviceId = ''
function text(v: unknown, max = 512): string { return typeof v === 'string' ? v.slice(0, max) : '' }
function publicUrl(v: unknown): string {
  if (v === '/default-cover.png') return v
  try { const u = new URL(String(v)); if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return ''; u.search = ''; u.hash = ''; return u.href } catch { return '' }
}
/** Stable installation id used only to attribute tombstones, never a credential. */
export function syncDeviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY)
    if (saved && /^[A-Za-z0-9_-]{8,80}$/.test(saved)) return saved
    const created = randomUUID()
    localStorage.setItem(DEVICE_KEY, created)
    return created
  } catch {
    if (!fallbackDeviceId) fallbackDeviceId = randomUUID()
    return fallbackDeviceId
  }
}
function portable(track: Track): PortableTrack {
  const p = pluginState.plugins.find(item => item.pluginId === track.pluginId)
  const imported = (track.ref?.data as any)?.syncImport
  const importedRequiresRebind = typeof imported?.requiresRebind === 'boolean' ? imported.requiresRebind : undefined
  return { id: text(track.id), title: text(track.title), artist: text(track.artist), album: text(track.album), durationMs: Number.isFinite(track.durationMs) ? Math.max(0, track.durationMs) : 0,
    artwork: publicUrl(track.artwork), qualities: (track.qualities || []).filter(q => typeof q === 'string').slice(0, 20),
    source: { manifestId: text(p?.manifestId || imported?.manifestId || track.pluginId), providerId: text(imported?.providerId || track.providerId), kind: text(imported?.kind || track.ref?.kind || 'track', 32), id: text(track.ref?.id || track.id), requiresRebind: importedRequiresRebind ?? Boolean(track.ref?.data || track.ref?.connectionId || track.pluginId === 'local' || track.ref?.scope !== 'provider') } }
}
export function exportLibrarySnapshot(): LibrarySnapshot {
  // Keep the long-standing local v1 shape for existing snapshot/restore
  // consumers; WebDAV writers add tombstones and serialize v2.
  return parseSnapshot(JSON.stringify({ schema: 'ceru.library.sync', version: 1, deviceId: syncDeviceId(), createdAt: new Date().toISOString(), favorites: libraryState.favorites.map(portable),
    playlists: libraryState.playlists.map(p => ({ id: p.id, name: p.name, description: p.description || '', cover: publicUrl(p.cover), createdAt: p.createdAt, tracks: p.tracks.map(portable) })) }), true)
}
/** Rebuild a whitelist, never accept raw ref.data, token fields, HTML or plugin code. */
export function parseLibrarySnapshot(raw: string): LibrarySnapshot {
  return parseSnapshot(raw, false)
}
function parseSnapshot(raw: string, preserveLegacyExport: boolean): LibrarySnapshot {
  if (new TextEncoder().encode(raw).length > MAX_BYTES) throw new Error('同步快照超过 8MB，请分批备份')
  let v: any; try { v = JSON.parse(raw) } catch { throw new Error('同步快照不是有效 JSON') }
  if (v?.schema !== 'ceru.library.sync' || ![1, 2].includes(v.version) || !Array.isArray(v.favorites) || !Array.isArray(v.playlists) || v.playlists.length > 2000) throw new Error('不支持的同步快照格式')
  if (v.version === 2 && !Array.isArray(v.tombstones)) throw new Error('不支持的同步快照格式')
  if (Array.isArray(v.tombstones) && v.tombstones.length > MAX_TOMBSTONES) throw new Error('同步快照删除记录过多')
  let count = 0
  const track = (t: any): PortableTrack => {
    if (++count > MAX_TRACKS || !t || !t.source || !text(t.id) || !text(t.source.id) || !text(t.source.providerId) || !text(t.source.manifestId) || /[\\/?#]|:\/\//.test(t.source.id) || /[\\/?#]|:\/\//.test(t.id)) throw new Error('同步快照含不可移植曲目标识或超过 50000 首')
    return { id: text(t.id), title: text(t.title) || '未知歌曲', artist: text(t.artist), album: text(t.album), durationMs: Number.isFinite(t.durationMs) ? Math.max(0, Math.min(t.durationMs, 86400000)) : 0,
      artwork: publicUrl(t.artwork), qualities: Array.isArray(t.qualities) ? t.qualities.filter((q: any) => typeof q === 'string').slice(0, 20).map((q: string) => q.slice(0, 32)) : [],
      source: { manifestId: text(t.source.manifestId), providerId: text(t.source.providerId), kind: ['track', 'local'].includes(t.source.kind) ? t.source.kind : 'track', id: text(t.source.id), requiresRebind: t.source.requiresRebind === true } }
  }
  const ids = new Set<string>()
  const playlist = (p: any, unique = true): PortablePlaylist => {
    if (!p || !text(p.id) || (unique && ids.has(p.id)) || !Array.isArray(p.tracks)) throw new Error('同步快照歌单标识重复或格式错误')
    if (unique) ids.add(p.id)
    return { id: text(p.id), name: text(p.name) || '恢复歌单', description: text(p.description, 4000), cover: publicUrl(p.cover), createdAt: Number.isFinite(p.createdAt) ? Math.max(0, p.createdAt) : 0, tracks: p.tracks.map(track) }
  }
  const playlists = v.playlists.map((p: any): PortablePlaylist => playlist(p))
  const favorites = v.favorites.map(track)
  const deletedAt = (value: unknown): string => {
    const raw = text(value, 64)
    const parsed = Date.parse(raw)
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(0).toISOString()
  }
  const tombstoneKey = (item: SyncTombstone): string => `${item.kind}\u0000${item.playlistId || ''}\u0000${item.id}`
  const tombstones: SyncTombstone[] = []
  const tombstoneKeys = new Set<string>()
  for (const input of Array.isArray(v.tombstones) ? v.tombstones.slice(0, MAX_TOMBSTONES) : []) {
    if (!input || !['playlist', 'track', 'favorite'].includes(input.kind)) continue
    let item: SyncTombstone
    try {
      if (input.kind === 'playlist') {
        const saved = playlist(input.playlist, false)
        if (saved.id !== text(input.id)) continue
        item = { kind: 'playlist', id: saved.id, name: text(input.name) || saved.name, deletedAt: deletedAt(input.deletedAt), deviceId: text(input.deviceId, 80), playlist: saved }
      } else {
        const saved = track(input.track)
        const identity = key(saved)
        const playlistId = text(input.playlistId)
        if (identity !== text(input.id) || (input.kind === 'track' && !playlistId)) continue
        item = { kind: input.kind, id: identity, name: text(input.name) || saved.title, deletedAt: deletedAt(input.deletedAt), deviceId: text(input.deviceId, 80), track: saved,
          ...(input.kind === 'track' ? { playlistId } : {}) }
      }
    } catch { continue }
    const identityKey = tombstoneKey(item)
    if (!tombstoneKeys.has(identityKey)) { tombstoneKeys.add(identityKey); tombstones.push(item) }
  }
  const version = preserveLegacyExport && v.version === 1 ? 1 : 2
  return { schema: 'ceru.library.sync', version, createdAt: text(v.createdAt, 64), ...(text(v.deviceId, 80) ? { deviceId: text(v.deviceId, 80) } : {}), favorites, playlists,
    ...(version === 2 ? { tombstones } : {}) }
}
const key = (t: PortableTrack) => JSON.stringify([t.source.manifestId, t.source.providerId, t.source.id])
/** Stable identity used to merge snapshots without trusting display names. */
export function snapshotTrackKey(t: PortableTrack): string { return key(t) }
export function snapshotCounts(snapshot: LibrarySnapshot): { playlists: number; tracks: number; favorites: number; tombstones: number } {
  return { playlists: snapshot.playlists.length, tracks: snapshot.playlists.reduce((n, p) => n + p.tracks.length, 0), favorites: snapshot.favorites.length, tombstones: snapshot.tombstones?.length || 0 }
}
export function commitLibrarySnapshot(input: LibrarySnapshot, options: { mode: 'merge' | 'replace' }): { undo(): void; counts: { playlists: number; tracks: number; favorites: number; pending: number } } {
  const snapshot = parseLibrarySnapshot(JSON.stringify(input))
  if (!['merge', 'replace'].includes(options.mode)) throw new Error('请选择合并或替换恢复方式')
  let pending = 0
  const live = [...libraryState.favorites, ...libraryState.playlists.flatMap(p => p.tracks)]
  const bind = (t: PortableTrack): Track => {
    const owner = pluginState.plugins.find(p => p.manifestId === t.source.manifestId && p.providers.some(s => s.id === t.source.providerId))
    const existing = !t.source.requiresRebind && t.source.kind !== 'local'
      ? live.find(item => !portable(item).source.requiresRebind && key(portable(item)) === key(t)) : undefined
    if (existing) return { ...existing, title: t.title, artist: t.artist, album: t.album }
    const unavailable = !owner || t.source.requiresRebind || t.source.kind === 'local'
    if (unavailable) pending++
    const providerId = unavailable ? 'sync-pending:' + t.source.providerId : t.source.providerId
    const pluginId = unavailable ? 'sync-pending' : owner!.pluginId
    return { ...t, pluginId, providerId, providerName: owner?.providers.find(p => p.id === t.source.providerId)?.name || '待匹配音源', ref: { kind: 'track', id: t.source.id, providerId, ...(unavailable ? { data: { syncImport: { pending: true, manifestId: t.source.manifestId, providerId: t.source.providerId, kind: t.source.kind, requiresRebind: t.source.requiresRebind } } } : {scope:'provider'}) } } as Track
  }
  const incoming = snapshot.playlists.map(p => ({ id: p.id, name: p.name, createdAt: p.createdAt, description: p.description, cover: p.cover, tracks: p.tracks.map(bind) }))
  let playlists: LocalPlaylist[] = options.mode === 'replace' ? incoming : JSON.parse(JSON.stringify(libraryState.playlists))
  if (options.mode === 'merge') for (const p of incoming) {
    const old = playlists.find(item => item.id === p.id)
    if (!old) { playlists.push(p); continue }
    const same = !p.tracks.some(t => portable(t).source.requiresRebind) && JSON.stringify(old.tracks.map(portable)) === JSON.stringify(p.tracks.map(portable)) && old.name === p.name && (old.description || '') === p.description && publicUrl(old.cover) === p.cover
    if (!same) playlists.push({ ...p, id: randomUUID(), name: p.name + '（恢复副本）' })
  }
  const restoredFavorites = snapshot.favorites.map(bind)
  const favorites = options.mode === 'replace' ? restoredFavorites : [...libraryState.favorites]
  if (options.mode === 'merge') { const seen = new Set(favorites.filter(t=>!portable(t).source.requiresRebind).map(t => key(portable(t)))); for (const t of restoredFavorites) if (portable(t).source.requiresRebind || !seen.has(key(portable(t)))) { if(!portable(t).source.requiresRebind) seen.add(key(portable(t))); favorites.push(t) } }
  const committed = commitLibraryReplacement({ favorites, playlists })
  return { ...committed, counts: { playlists: incoming.length, tracks: incoming.reduce((n, p) => n + p.tracks.length, 0), favorites: restoredFavorites.length, pending } }
}

/**
 * Apply a merged snapshot without discarding local-only playlist metadata.
 * Tracks that already exist locally keep their private refs; remote-only
 * tracks go through the same pending-binding path as a manual restore.
 */
export function applyLibrarySnapshot(input: LibrarySnapshot): { undo(): void; counts: { playlists: number; tracks: number; favorites: number; pending: number } } {
  const snapshot = parseLibrarySnapshot(JSON.stringify(input))
  const live = [...libraryState.favorites, ...libraryState.playlists.flatMap(p => p.tracks)]
  const existingByKey = new Map<string, Track>()
  for (const track of live) {
    const identity = key(portable(track))
    if (!existingByKey.has(identity)) existingByKey.set(identity, track)
  }
  let pending = 0
  const bind = (t: PortableTrack): Track => {
    const existing = existingByKey.get(key(t))
    if (existing) {
      return { ...existing, title: t.title, artist: t.artist, album: t.album, durationMs: t.durationMs, artwork: t.artwork, qualities: [...t.qualities] }
    }
    const owner = pluginState.plugins.find(p => p.manifestId === t.source.manifestId && p.providers.some(s => s.id === t.source.providerId))
    const unavailable = !owner || t.source.requiresRebind || t.source.kind === 'local'
    if (unavailable) pending++
    const providerId = unavailable ? 'sync-pending:' + t.source.providerId : t.source.providerId
    const pluginId = unavailable ? 'sync-pending' : owner!.pluginId
    return { ...t, pluginId, providerId, providerName: owner?.providers.find(p => p.id === t.source.providerId)?.name || '待匹配音源',
      ref: { kind: 'track', id: t.source.id, providerId, ...(unavailable ? { data: { syncImport: { pending: true, manifestId: t.source.manifestId, providerId: t.source.providerId, kind: t.source.kind, requiresRebind: t.source.requiresRebind } } } : {scope:'provider'}) } } as Track
  }
  const playlists = snapshot.playlists.map((p): LocalPlaylist => {
    const existing = libraryState.playlists.find(item => item.id === p.id)
    const tracks = p.tracks.map(bind)
    if (existing) return { ...existing, name: p.name, description: p.description, cover: p.cover, createdAt: p.createdAt, tracks }
    return { id: p.id, name: p.name, createdAt: p.createdAt, description: p.description, cover: p.cover, tracks }
  })
  const favorites = snapshot.favorites.map(bind)
  const committed = commitLibraryReplacement({ favorites, playlists })
  return { ...committed, counts: { playlists: playlists.length, tracks: playlists.reduce((n, p) => n + p.tracks.length, 0), favorites: favorites.length, pending } }
}
