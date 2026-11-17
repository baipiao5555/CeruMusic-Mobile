import { libraryState } from './library'
import { getHistory } from './playback/player'
import { randomUUID } from '../shims/crypto'
import type { Track } from './track'

export const DAILY_STORAGE_KEY = 'ceru.daily.local.v1'
const DEVICE_KEY = 'ceru.daily.device.v1'
const ALGORITHM = 1
const LIMIT = 30
export interface DailySnapshot {
  algorithm: number
  day: string
  zone: string
  entries: Track[]
  candidates: number
  excluded: number
}
export interface DailyResult { snapshot: DailySnapshot; warning: string }
let device = ''
let deviceWarning = ''
let current: DailyResult | undefined

export function localDay(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
export function localZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local' } catch { return 'local' }
}
export function nextLocalMidnight(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
}
export function dailyTrackKey(track: Track): string {
  return JSON.stringify([track?.pluginId || '', track?.providerId || '', track?.ref?.id || track?.id || ''])
}
function text(value: unknown, limit = 512): string {
  return typeof value === 'string' ? value.slice(0, limit) : ''
}
function artwork(value: unknown): string {
  if (typeof value !== 'string') return '/default-cover.png'
  if (/^\/(?:default-cover\.png|favicon\.png)$/.test(value)) return value
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '/default-cover.png'
    url.search = ''; url.hash = ''
    return url.href
  } catch { return '/default-cover.png' }
}
/** Persist metadata and resource identity only; resolve from the live local record on playback. */
export function dailyMetadata(track: Track): Track | undefined {
  const ref = track?.ref
  if (!track || !ref || !text(track.id) || !text(track.pluginId) || !text(track.providerId)) return
  if (ref.providerId && ref.providerId !== track.providerId) return
  if (track.providerId.startsWith('lx-pending:') || (ref.data as any)?.fileImport?.pending || (ref.data as any)?.syncImport?.pending || ref.connectionId) return
  if (ref.kind !== 'track' && !(track.pluginId === 'local' && ref.kind === 'local')) return
  const id = text(ref.id)
  if (!id || /[?#]|:\/\//.test(id)) return
  const safeRef: any = { id, kind: ref.kind, providerId: text(ref.providerId || track.providerId) }
  if (ref.pluginId) safeRef.pluginId = text(ref.pluginId)
  if (ref.scope === 'provider') safeRef.scope = 'provider'
  return {
    id: text(track.id), pluginId: text(track.pluginId), providerId: text(track.providerId), providerName: text(track.providerName, 128),
    ref: safeRef, title: text(track.title) || '未知歌曲', artist: text(track.artist) || '未知歌手', album: text(track.album),
    durationMs: Number.isFinite(track.durationMs) ? Math.max(0, Math.min(track.durationMs, 86400000)) : 0,
    artwork: artwork(track.artwork), qualities: Array.isArray(track.qualities) ? track.qualities.filter(q => typeof q === 'string').slice(0, 20).map(q => q.slice(0, 32)) : [],
    ...(/^#[\da-f]{3,8}$/i.test(track.color || '') ? { color: track.color } : {})
  }
}
function localTracks(): Track[] {
  const history = getHistory()
  return [...libraryState.favorites, ...libraryState.playlists.flatMap(p => Array.isArray(p?.tracks) ? p.tracks : []), ...(Array.isArray(history) ? history : [])]
}
export function dailyLiveTrack(entry: Track): Track | undefined {
  return localTracks().find(track => dailyTrackKey(track) === dailyTrackKey(entry) && Boolean(dailyMetadata(track)))
}
function hash(value: string): number {
  let result = 2166136261
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619)
  return result >>> 0
}
function deviceId(): string {
  if (device) return device
  try {
    const saved = localStorage.getItem(DEVICE_KEY)
    if (saved && /^[\da-f-]{32,36}$/i.test(saved)) device = saved
  } catch { deviceWarning = '无法读取本地缓存；今日内容可能无法在重开后保留。' }
  if (!device) {
    try { device = randomUUID() } catch { device = `session-${Date.now()}`; deviceWarning = '无法生成持久设备种子；今日内容仅本次会话保留。' }
    try { localStorage.setItem(DEVICE_KEY, device) } catch { deviceWarning = '无法保存本地缓存；今日内容仅本次会话保留。' }
  }
  return device
}
export function buildDailySnapshot(tracks: Track[], seed: string, now = new Date(), zone = localZone()): DailySnapshot {
  const unique = new Map<string, Track>()
  let excluded = 0
  for (const track of tracks) {
    const safe = dailyMetadata(track)
    if (!safe) { excluded++; continue }
    const key = dailyTrackKey(safe)
    if (!unique.has(key)) unique.set(key, safe)
  }
  const pool = [...unique.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map(item => item[1])
  let state = hash(`${ALGORITHM}|${seed}|${zone}`) || 1
  for (let i = pool.length - 1; i > 0; i--) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5
    const j = (state >>> 0) % (i + 1)
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const dayNumber = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000)
  const start = pool.length ? (dayNumber + hash(seed)) % pool.length : 0
  const entries = Array.from({ length: Math.min(LIMIT, pool.length) }, (_, i) => pool[(start + i) % pool.length])
  return { algorithm: ALGORITHM, day: localDay(now), zone, entries, candidates: pool.length, excluded }
}
export function getDailyRecommendations(now = new Date()): DailyResult {
  const day = localDay(now), zone = localZone(), seed = deviceId()
  if (current?.snapshot.day === day && current.snapshot.zone === zone) return current
  let warning = deviceWarning
  try {
    const raw = localStorage.getItem(DAILY_STORAGE_KEY)
    if (raw) {
      const saved = JSON.parse(raw)
      if (saved.algorithm === ALGORITHM && saved.day === day && saved.zone === zone && Array.isArray(saved.entries) && saved.entries.length <= LIMIT) {
        const entries = saved.entries.map(dailyMetadata)
        if (entries.every(Boolean) && Number.isInteger(saved.candidates) && saved.candidates >= entries.length && Number.isInteger(saved.excluded) && saved.excluded >= 0) {
          current = { snapshot: { algorithm: ALGORITHM, day, zone, entries, candidates: saved.candidates, excluded: saved.excluded }, warning }
          return current
        }
      }
    }
  } catch { warning = '本地每日缓存读取失败，已重新生成；若缓存不可用，重开可能变化。' }
  const snapshot = buildDailySnapshot(localTracks(), seed, now, zone)
  try { localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(snapshot)) }
  catch { warning = '无法保存今日名单；本次会话内保持不变，重开可能变化。' }
  current = { snapshot, warning }
  return current
}
