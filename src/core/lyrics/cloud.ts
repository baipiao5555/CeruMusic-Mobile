import { requestRemote } from '../plugin/network'
import type { Track } from '../track'
import type { LyricLine } from '../playback/player'

export type CloudLyricSource = 'LrcLib' | 'QQ音乐'

export interface CloudLyricsResult {
  source: CloudLyricSource
  lines: LyricLine[]
  score: number
  title?: string
  artist?: string
  album?: string
}

const USER_AGENT = 'CeruMusic-Mobile/2.3.1 (https://github.com/baipiao5555/CeruMusic-Mobile)'
const QQ_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const MIN_SCORE = 55
const lyricCache = new Map<string, CloudLyricsResult | null>()

interface ParsedLine {
  time: number
  text: string
}

interface Candidate {
  title?: string
  artist?: string
  album?: string
  durationMs?: number
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '')
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function cleanTitle(text: string): string {
  return stripHtml(text)
    .replace(/[（(][^）)]*(live|remix|伴奏|翻自|cover|版|现场)[^）)]*[）)]/gi, '')
    .replace(/\s*-\s*(live|remix).*$/i, '')
    .trim()
}

function normalize(text: string): string {
  return cleanTitle(text)
    .toLowerCase()
    .replace(/(feat\.?|ft\.?|featuring)\s+[^,;]+/gi, '')
    .replace(/[\s\-_/\\()[\]{}（）【】「」《》"'’“”·.,，。!！?？:：;；&+~`|]/g, '')
}

function similarity(a: string | undefined, b: string | undefined): number {
  if (!a || !b) return 0
  const x = normalize(a)
  const y = normalize(b)
  if (!x || !y) return 0
  if (x === y) return 1
  if (x.includes(y) || y.includes(x)) return 0.8

  const xTokens = new Set(x.split(/[^a-z0-9]+/).filter(Boolean))
  const yTokens = new Set(y.split(/[^a-z0-9]+/).filter(Boolean))
  if (xTokens.size && yTokens.size) {
    let shared = 0
    for (const token of xTokens) if (yTokens.has(token)) shared += 1
    const tokenScore = shared / Math.max(xTokens.size, yTokens.size)
    if (tokenScore > 0) return tokenScore * 0.7
  }

  const bigrams = (value: string) => {
    const set = new Set<string>()
    for (let i = 0; i < value.length - 1; i++) set.add(value.slice(i, i + 2))
    return set
  }
  const left = bigrams(x)
  const right = bigrams(y)
  if (!left.size || !right.size) return 0
  let shared = 0
  for (const gram of left) if (right.has(gram)) shared += 1
  return (shared / Math.max(left.size, right.size)) * 0.6
}

function parseLrc(raw: string): ParsedLine[] {
  if (!raw) return []
  const result: ParsedLine[] = []
  const pattern = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
  for (const rawLine of raw.split(/\r?\n/)) {
    for (const stamp of rawLine.matchAll(pattern)) {
      const minutes = Number(stamp[1])
      const seconds = Number(stamp[2])
      const fraction = stamp[3] ?? ''
      const milliseconds = fraction ? Number(fraction.padEnd(3, '0').slice(0, 3)) : 0
      const text = rawLine.replace(/\[[^\]]*\]/g, '').trim()
      if (!text) continue
      result.push({ time: minutes * 60_000 + seconds * 1000 + milliseconds, text })
    }
  }
  return result.sort((a, b) => a.time - b.time)
}

function findTranslation(translations: ParsedLine[], time: number): string | undefined {
  let best: ParsedLine | undefined
  let distance = Number.POSITIVE_INFINITY
  for (const item of translations) {
    if (item.text === '//') continue
    const diff = Math.abs(item.time - time)
    if (diff < distance) {
      distance = diff
      best = item
    }
  }
  return best && distance <= 120 ? best.text : undefined
}

function toLyricLines(parsed: ParsedLine[], translationText?: string): LyricLine[] {
  const translations = translationText ? parseLrc(decodeEntities(translationText)) : []
  return parsed.map((line, index) => {
    const next = parsed[index + 1]?.time
    const translation = findTranslation(translations, line.time)
    return {
      startTimeMs: line.time,
      endTimeMs: next && next > line.time ? next : line.time + 5000,
      text: line.text,
      translation: translation && translation !== line.text ? translation : undefined
    }
  })
}

function scoreCandidate(track: Track, candidate: Candidate, lines: LyricLine[]): number {
  const titleScore = similarity(track.title, candidate.title)
  const artistScore = similarity(track.artist, candidate.artist)
  if (titleScore < 0.35) return Number.NEGATIVE_INFINITY
  if (track.artist && candidate.artist && artistScore < 0.25) return Number.NEGATIVE_INFINITY

  let score = titleScore * 50 + artistScore * 30
  if (
    track.album &&
    candidate.album &&
    similarity(track.album, candidate.album) >= 0.6
  ) {
    score += 10
  }
  if (track.durationMs > 0 && candidate.durationMs && candidate.durationMs > 0) {
    const diff = Math.abs(track.durationMs - candidate.durationMs)
    if (diff <= 2000) score += 20
    else if (diff <= 5000) score += 10
    else if (diff > 15000) score -= 20
  }
  if (lines.length) score += 20
  if (lines.some((line) => line.translation)) score += 10
  return score
}

function parseLrcLibItems(track: Track, items: any[]): CloudLyricsResult[] {
  const results: CloudLyricsResult[] = []
  for (const item of items.slice(0, 30)) {
    if (!item || item.instrumental) continue
    const parsed = parseLrc(decodeEntities(String(item.syncedLyrics ?? '')))
    if (!parsed.length) continue
    const lines = toLyricLines(parsed)
    const candidate: Candidate = {
      title: item.trackName,
      artist: item.artistName,
      album: item.albumName,
      durationMs: Number(item.duration) * 1000
    }
    const score = scoreCandidate(track, candidate, lines)
    if (!Number.isFinite(score)) continue
    results.push({ source: 'LrcLib', lines, score, ...candidate })
  }
  return results
}

async function fetchLrcLib(track: Track): Promise<CloudLyricsResult[]> {
  const title = cleanTitle(track.title)
  const attempts: URLSearchParams[] = []
  const exact = new URLSearchParams({ track_name: title })
  if (track.artist) exact.set('artist_name', track.artist)
  attempts.push(exact)
  const query = [title, track.artist].filter(Boolean).join(' ')
  attempts.push(new URLSearchParams({ q: query }))
  if (track.artist) attempts.push(new URLSearchParams({ track_name: title }))

  const seen = new Set<string>()
  for (const params of attempts) {
    const key = params.toString()
    if (seen.has(key)) continue
    seen.add(key)
    try {
      const response = await requestRemote({
        url: `https://lrclib.net/api/search?${key}`,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json'
        },
        timeoutMs: 10_000
      })
      if (response.status < 200 || response.status >= 300 || !Array.isArray(response.body)) continue
      const results = parseLrcLibItems(track, response.body)
      if (results.length) return results
    } catch {
      // Try the next query shape.
    }
  }
  return []
}

async function fetchQQ(track: Track): Promise<CloudLyricsResult[]> {
  try {
    const query = [cleanTitle(track.title), track.artist].filter(Boolean).join(' ')
    if (!query) return []
    const search = await requestRemote({
      url: 'https://u.y.qq.com/cgi-bin/musicu.fcg',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/json, text/plain, */*',
        'User-Agent': QQ_USER_AGENT,
        Referer: 'https://y.qq.com/'
      },
      referrer: 'https://y.qq.com/',
      body: JSON.stringify({
        comm: { ct: '19', cv: '1859', uin: '0' },
        req: {
          method: 'DoSearchForQQMusicDesktop',
          module: 'music.search.SearchCgiService',
          param: {
            grp: 1,
            num_per_page: 8,
            page_num: 1,
            query,
            search_type: 0
          }
        }
      }),
      timeoutMs: 12_000
    })
    if (search.status < 200 || search.status >= 300) return []
    const list = search.body?.req?.data?.body?.song?.list
    if (!Array.isArray(list)) return []

    const candidates = list.slice(0, 4).filter((item: any) => item?.mid)
    const results = await Promise.all(
      candidates.map(async (item: any) => {
        try {
          const lyricUrl =
            'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=' +
            encodeURIComponent(String(item.mid)) +
            '&format=json&nobase64=1&g_tk=5381'
          const response = await requestRemote({
            url: lyricUrl,
            headers: {
              'User-Agent': QQ_USER_AGENT,
              Referer: 'https://y.qq.com/'
            },
            referrer: 'https://y.qq.com/',
            timeoutMs: 12_000
          })
          if (response.status < 200 || response.status >= 300) return null
          const parsed = parseLrc(decodeEntities(String(response.body?.lyric ?? '')))
          if (!parsed.length) return null
          const lines = toLyricLines(parsed, String(response.body?.trans ?? ''))
          const candidate: Candidate = {
            title: stripHtml(String(item.name ?? '')),
            artist: (item.singer ?? []).map((singer: any) => singer.name).filter(Boolean).join(' / '),
            album: stripHtml(String(item.album?.name ?? '')),
            durationMs: Number(item.interval) * 1000
          }
          const score = scoreCandidate(track, candidate, lines)
          return Number.isFinite(score)
            ? ({ source: 'QQ音乐', lines, score, ...candidate } as CloudLyricsResult)
            : null
        } catch {
          return null
        }
      })
    )
    return results.filter((item): item is CloudLyricsResult => Boolean(item))
  } catch {
    return []
  }
}

/** Search LrcLib and QQ Music, then return the best matching synced lyrics. */
export async function matchCloudLyrics(
  track: Track,
  force = false
): Promise<CloudLyricsResult | null> {
  const key = `${track.pluginId}:${track.providerId}:${track.id}:${track.title}:${track.artist}`
  if (!force && lyricCache.has(key)) return lyricCache.get(key) ?? null

  const hasCjk = /[\u3400-\u9fff]/.test(`${track.title} ${track.artist}`)
  const settled = await Promise.allSettled([fetchQQ(track), fetchLrcLib(track)])
  const results = settled.flatMap((item) => (item.status === 'fulfilled' ? item.value : []))
  const ranked = results
    .filter((item) => item.score >= MIN_SCORE)
    .map((item) => {
      const sourceBonus =
        (hasCjk && item.source === 'QQ音乐') || (!hasCjk && item.source === 'LrcLib') ? 5 : 0
      return { item, rank: item.score + sourceBonus }
    })
    .sort((a, b) => b.rank - a.rank)
  const best = ranked[0]?.item ?? null
  lyricCache.set(key, best)
  if (lyricCache.size > 200) {
    const oldest = lyricCache.keys().next().value
    if (oldest) lyricCache.delete(oldest)
  }
  return best
}
