import { reactive } from 'vue'
import type { Track } from './track'

const HISTORY_KEY = 'ceru.search.history.v1'
const HISTORY_LIMIT = 12
const INDEX_LIMIT = 600

/** 搜索历史：最新在前，输入框为空时展示。 */
export const searchHistory = reactive({ items: [] as string[] })

function persistHistory(): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(searchHistory.items))
  } catch {}
}

export function restoreSearchHistory(): void {
  if (searchHistory.items.length) return
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const saved = raw ? JSON.parse(raw) : []
    if (!Array.isArray(saved)) return
    searchHistory.items = saved
      .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      .slice(0, HISTORY_LIMIT)
  } catch {}
}

/** 只记真正搜出结果的词，避免边打边搜把历史刷成拼音前缀。 */
export function rememberSearch(keyword: string): void {
  const value = keyword.trim()
  if (!value) return
  searchHistory.items = [value, ...searchHistory.items.filter((item) => item !== value)].slice(
    0,
    HISTORY_LIMIT
  )
  persistHistory()
}

export function clearSearchHistory(): void {
  searchHistory.items = []
  persistHistory()
}

/**
 * 本地歌曲索引：搜索结果、榜单、歌单里见过的歌都攒起来（先进先出），
 * 用于「只打一个字就联想出歌名」与音源零结果时的兜底。
 */
const index = new Map<string, Track>()

export function rememberTracks(tracks: Track[]): void {
  for (const track of tracks) {
    if (!track?.id) continue
    const key = `${track.providerId}:${track.id}`
    index.delete(key)
    index.set(key, track)
  }
  while (index.size > INDEX_LIMIT) {
    const oldest = index.keys().next().value
    if (!oldest) break
    index.delete(oldest)
  }
}

export function indexedTracks(): Track[] {
  return [...index.values()]
}

const NOISE_RE = /[\s\-_.·()[\]【】《》"'“”‘’,，。!！?？/\\|+~`]/g

/** 匹配用的归一化：小写、去空格与标点，`晴天 (Live)` 与 `晴天live` 视为同一个词。 */
export function normalizeText(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(NOISE_RE, '')
}

export function highlightParts(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const value = String(text ?? '')
  const needle = query.trim()
  if (!value) return []
  if (!needle) return [{ text: value, hit: false }]
  const lowerValue = value.toLowerCase()
  const lowerNeedle = needle.toLowerCase()
  const parts: Array<{ text: string; hit: boolean }> = []
  let cursor = 0
  for (;;) {
    const at = lowerValue.indexOf(lowerNeedle, cursor)
    if (at === -1) break
    if (at > cursor) parts.push({ text: value.slice(cursor, at), hit: false })
    parts.push({ text: value.slice(at, at + needle.length), hit: true })
    cursor = at + needle.length
  }
  if (!parts.length) return [{ text: value, hit: false }]
  if (cursor < value.length) parts.push({ text: value.slice(cursor), hit: false })
  return parts
}

/** -1 = 不相关；0..3 越小越靠前（歌名全等 > 歌名前缀 > 歌名包含 > 歌手/专辑包含）。 */
export function matchRank(track: Track, query: string): number {
  const needle = normalizeText(query)
  if (!needle) return 0
  const title = normalizeText(track.title)
  if (!title) return -1
  if (title === needle) return 0
  if (title.startsWith(needle)) return 1
  if (title.includes(needle)) return 2
  return normalizeText(`${track.artist} ${track.album}`).includes(needle) ? 3 : -1
}

/** 音源返回的顺序和输入无关，按相关度重排；全都不相关时保持原顺序。 */
export function rankTracks(tracks: Track[], query: string): Track[] {
  if (!query.trim() || !tracks.length) return tracks
  const scored = tracks.map((track, position) => ({
    track,
    position,
    rank: matchRank(track, query)
  }))
  if (!scored.some((item) => item.rank >= 0)) return tracks
  scored.sort((a, b) => {
    const left = a.rank < 0 ? 9 : a.rank
    const right = b.rank < 0 ? 9 : b.rank
    return left - right || a.position - b.position
  })
  return scored.map((item) => item.track)
}

/** 本地联想：从索引 + 收藏/歌单里挑出和输入相关的歌，按相关度取前 N 条。 */
export function suggestTracks(query: string, extra: Track[] = [], limit = 8): Track[] {
  if (!query.trim()) return []
  const pool = new Map<string, Track>()
  for (const track of [...extra, ...indexedTracks()]) {
    if (!track?.id) continue
    const key = `${track.providerId}:${track.id}`
    if (!pool.has(key)) pool.set(key, track)
  }
  const scored: Array<{ track: Track; rank: number; position: number }> = []
  let position = 0
  for (const track of pool.values()) {
    const rank = matchRank(track, query)
    if (rank >= 0) scored.push({ track, rank, position: position++ })
  }
  scored.sort((a, b) => a.rank - b.rank || a.position - b.position)
  return scored.slice(0, limit).map((item) => item.track)
}
