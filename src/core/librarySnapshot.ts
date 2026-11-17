import { libraryState, commitLibraryReplacement, type LocalPlaylist } from './library'
import { pluginState } from './plugin/manager'
import { randomUUID } from '../shims/crypto'
import type { Track } from './track'

interface PortableTrack {
  id: string; title: string; artist: string; album: string; durationMs: number; artwork: string; qualities: string[]
  source: { manifestId: string; providerId: string; kind: string; id: string; requiresRebind: boolean }
}
interface PortablePlaylist { id: string; name: string; description: string; cover: string; createdAt: number; tracks: PortableTrack[] }
export interface LibrarySnapshot { schema: 'ceru.library.sync'; version: 1; createdAt: string; favorites: PortableTrack[]; playlists: PortablePlaylist[] }
const MAX_BYTES = 8 * 1024 * 1024
const MAX_TRACKS = 50000
function text(v: unknown, max = 512): string { return typeof v === 'string' ? v.slice(0, max) : '' }
function publicUrl(v: unknown): string {
  if (v === '/default-cover.png') return v
  try { const u = new URL(String(v)); if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return ''; u.search = ''; u.hash = ''; return u.href } catch { return '' }
}
function portable(track: Track): PortableTrack {
  const p = pluginState.plugins.find(item => item.pluginId === track.pluginId)
  const imported = (track.ref?.data as any)?.syncImport
  return { id: text(track.id), title: text(track.title), artist: text(track.artist), album: text(track.album), durationMs: Number.isFinite(track.durationMs) ? Math.max(0, track.durationMs) : 0,
    artwork: publicUrl(track.artwork), qualities: (track.qualities || []).filter(q => typeof q === 'string').slice(0, 20),
    source: { manifestId: text(p?.manifestId || imported?.manifestId || track.pluginId), providerId: text(imported?.providerId || track.providerId), kind: text(imported?.kind || track.ref?.kind || 'track', 32), id: text(track.ref?.id || track.id), requiresRebind: Boolean(track.ref?.data || track.ref?.connectionId || track.pluginId === 'local' || track.ref?.scope !== 'provider') } }
}
export function exportLibrarySnapshot(): LibrarySnapshot {
  return parseLibrarySnapshot(JSON.stringify({ schema: 'ceru.library.sync', version: 1, createdAt: new Date().toISOString(), favorites: libraryState.favorites.map(portable),
    playlists: libraryState.playlists.map(p => ({ id: p.id, name: p.name, description: p.description || '', cover: publicUrl(p.cover), createdAt: p.createdAt, tracks: p.tracks.map(portable) })) }))
}
/** Rebuild a whitelist, never accept raw ref.data, token fields, HTML or plugin code. */
export function parseLibrarySnapshot(raw: string): LibrarySnapshot {
  if (new TextEncoder().encode(raw).length > MAX_BYTES) throw new Error('同步快照超过 8MB，请分批备份')
  let v: any; try { v = JSON.parse(raw) } catch { throw new Error('同步快照不是有效 JSON') }
  if (v?.schema !== 'ceru.library.sync' || v.version !== 1 || !Array.isArray(v.favorites) || !Array.isArray(v.playlists) || v.playlists.length > 2000) throw new Error('不支持的同步快照格式')
  let count = 0
  const track = (t: any): PortableTrack => {
    if (++count > MAX_TRACKS || !t || !t.source || !text(t.id) || !text(t.source.id) || !text(t.source.providerId) || !text(t.source.manifestId) || /[\\/?#]|:\/\//.test(t.source.id) || /[\\/?#]|:\/\//.test(t.id)) throw new Error('同步快照含不可移植曲目标识或超过 50000 首')
    return { id: text(t.id), title: text(t.title) || '未知歌曲', artist: text(t.artist), album: text(t.album), durationMs: Number.isFinite(t.durationMs) ? Math.max(0, Math.min(t.durationMs, 86400000)) : 0,
      artwork: publicUrl(t.artwork), qualities: Array.isArray(t.qualities) ? t.qualities.filter((q: any) => typeof q === 'string').slice(0, 20).map((q: string) => q.slice(0, 32)) : [],
      source: { manifestId: text(t.source.manifestId), providerId: text(t.source.providerId), kind: ['track', 'local'].includes(t.source.kind) ? t.source.kind : 'track', id: text(t.source.id), requiresRebind: t.source.requiresRebind === true } }
  }
  const ids = new Set<string>()
  const playlists = v.playlists.map((p: any): PortablePlaylist => {
    if (!p || !text(p.id) || ids.has(p.id) || !Array.isArray(p.tracks)) throw new Error('同步快照歌单标识重复或格式错误')
    ids.add(p.id)
    return { id: text(p.id), name: text(p.name) || '恢复歌单', description: text(p.description, 4000), cover: publicUrl(p.cover), createdAt: Number.isFinite(p.createdAt) ? Math.max(0, p.createdAt) : 0, tracks: p.tracks.map(track) }
  })
  return { schema: 'ceru.library.sync', version: 1, createdAt: text(v.createdAt, 64), favorites: v.favorites.map(track), playlists }
}
const key = (t: PortableTrack) => JSON.stringify([t.source.manifestId, t.source.providerId, t.source.id])
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
    return { ...t, pluginId, providerId, providerName: owner?.providers.find(p => p.id === t.source.providerId)?.name || '待匹配音源', ref: { kind: 'track', id: t.source.id, providerId, ...(unavailable ? { data: { syncImport: { pending: true, manifestId: t.source.manifestId, providerId: t.source.providerId, kind: t.source.kind } } } : {scope:'provider'}) } } as Track
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
