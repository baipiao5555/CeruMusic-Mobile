import { reactive } from 'vue'
import type { Track } from './track'
import { httpRequest } from './net'

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

/** -1 = 不相关；分数越高越靠前（歌名全等 100 → 前缀 → 包含 → 歌手/专辑）。 */
export function matchScore(track: Track, query: string): number {
  const needle = normalizeText(query)
  if (!needle) return 0
  const title = normalizeText(track.title)
  if (!title) return -1
  const coverage = Math.min(1, needle.length / title.length)
  if (title === needle) return 100
  if (title.startsWith(needle)) return 84 + Math.round(coverage * 12)
  const at = title.indexOf(needle)
  if (at >= 0) {
    // 越靠前、覆盖率越高越像这首歌；单字查询命中长标题会被压下去
    return Math.round(58 + coverage * 18 - Math.min(at, 12) * 0.8)
  }
  const artist = normalizeText(track.artist)
  if (artist === needle) return 52
  if (artist.startsWith(needle)) return 46
  if (artist.includes(needle)) return 38 + Math.round(coverage * 6)
  const album = normalizeText(track.album)
  if (album.includes(needle)) return 28
  return -1
}

/** 兼容旧调用点：rank 越小越靠前，-1 表示不相关。 */
export function matchRank(track: Track, query: string): number {
  const score = matchScore(track, query)
  if (score < 0) return -1
  if (score >= 100) return 0
  if (score >= 84) return 1
  if (score >= 58) return 2
  return 3
}

/**
 * 音源返回的顺序和输入无关，按相关度重排。
 * 全名命中时只留全名 + 同名前缀的结果，不再把一堆「包含这个字」的歌堆在后面。
 */
export function rankTracks(tracks: Track[], query: string): Track[] {
  if (!query.trim() || !tracks.length) return tracks
  const scored = tracks.map((track, position) => ({
    track,
    position,
    score: matchScore(track, query)
  }))
  const relevant = scored.filter((item) => item.score >= 0)
  if (!relevant.length) return tracks
  relevant.sort((a, b) => b.score - a.score || a.position - b.position)
  const best = relevant[0].score
  let kept = relevant
  if (best >= 100) {
    // 输入的就是完整歌名：只要同名和同名开头的，别的都是噪声
    const exact = relevant.filter((item) => item.score >= 84)
    kept = exact.length ? exact : relevant.slice(0, 6)
  } else if (best >= 84) {
    kept = relevant.filter((item) => item.score >= 38).slice(0, 24)
  } else {
    kept = relevant.slice(0, 30)
  }
  return kept.map((item) => item.track)
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

/* ------------------------------------------------------------------ *
 * 按歌词找歌
 * ------------------------------------------------------------------ */

export interface LyricCandidate {
  title: string
  artist: string
  /** 这句歌词在该曲目里的原句，用于结果下方展示。 */
  line: string
}

const LYRIC_SEARCH_URL = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp'
const CREDIT_LINE = /^(作?词|作?曲|编曲|演唱|制作人?|监制|混音|母带|和声|吉他|贝斯|鼓|录音)\s*[:：]/

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

function pickLyricLine(content: string, needle: string): string {
  const rows = content
    .replace(/\\n/g, '\n')
    .split(/\r?\n/)
    .map(stripTags)
    .filter(Boolean)
  // 第 0 行是「歌名 - 歌手」头，别把它当成歌词
  const body = rows.filter(
    (row, index) => !CREDIT_LINE.test(row) && !(index === 0 && row.includes(' - '))
  )
  const plain = normalizeText(needle)
  const hit = body.find((row) => normalizeText(row).includes(plain))
  return hit ?? body[0] ?? ''
}

/**
 * 歌词搜索走 QQ 音乐的歌词检索（t=7），它直接返回「歌词里含这句话」的曲目，
 * 比把歌词当歌名去猜准得多。接口不可用时返回空数组，由调用方回落到关键词搜索。
 */
export async function searchLyricCatalog(snippet: string, limit = 10): Promise<LyricCandidate[]> {
  const word = snippet.trim()
  if (!word) return []
  const url = `${LYRIC_SEARCH_URL}?format=json&t=7&n=${limit}&p=1&w=${encodeURIComponent(word)}`
  try {
    const response = await Promise.race([
      httpRequest({ url, headers: { Referer: 'https://y.qq.com/' } }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 9000))
    ])
    if (!response || response.status !== 200) return []
    const list = response.data?.data?.lyric?.list
    if (!Array.isArray(list)) return []
    const out: LyricCandidate[] = []
    const seen = new Set<string>()
    for (const item of list) {
      const title = stripTags(String(item?.songname ?? ''))
      if (!title) continue
      const artist = (Array.isArray(item?.singer) ? item.singer : [])
        .map((singer: { name?: string }) => stripTags(String(singer?.name ?? '')))
        .filter(Boolean)
        .join(' / ')
      const key = `${title}|${artist}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ title, artist, line: pickLyricLine(String(item?.content ?? ''), word) })
    }
    return out
  } catch {
    return []
  }
}
