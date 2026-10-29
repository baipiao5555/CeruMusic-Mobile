/**
 * Timed lyric words shared with native consumers (Lyricon / 系统歌词).
 *
 * 逐字歌词的「变色」由使用者按字级时间自行推进；只给行级时间时，
 * 歌词只能整行切换，看起来就是「变色和动画没同步」。
 */
export interface TimedLyricWord {
  startTimeMs: number
  endTimeMs: number
  text: string
}

export interface TimedLyricLine {
  startTimeMs: number
  endTimeMs?: number
  text: string
  translation?: string
  words?: TimedLyricWord[]
}

const SPACE_RE = /\s+/g

function compact(value: string): string {
  return String(value ?? '').replace(SPACE_RE, '')
}

/**
 * Keeps word timings only when they actually describe this line:
 *  - every word needs a usable start
 *  - a missing end is closed by the next word's start (or the line end)
 *  - the concatenated text must match the line text, otherwise the karaoke
 *    fill would highlight the wrong glyphs and is better dropped
 */
export function normalizeTimedWords(
  raw: any,
  lineStart: number,
  lineEnd: number,
  lineText: string
): TimedLyricWord[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const words: TimedLyricWord[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const text = String(item.text ?? '')
    if (!text) continue
    const rawStart = Number(item.startTimeMs ?? item.begin)
    if (!Number.isFinite(rawStart)) continue
    const start = Math.max(lineStart, Math.round(rawStart))
    const rawEnd = Number(item.endTimeMs ?? item.end)
    const end = Number.isFinite(rawEnd) && rawEnd > start ? Math.round(rawEnd) : 0
    words.push({ startTimeMs: start, endTimeMs: end, text })
  }
  if (words.length < 2) return undefined
  words.sort((left, right) => left.startTimeMs - right.startTimeMs)
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]
    if (word.endTimeMs > word.startTimeMs) continue
    const next = words[index + 1]
    word.endTimeMs = next && next.startTimeMs > word.startTimeMs ? next.startTimeMs : lineEnd
  }
  const last = words[words.length - 1]
  if (last.endTimeMs <= last.startTimeMs) last.endTimeMs = Math.max(lineEnd, last.startTimeMs + 200)
  if (compact(words.map((word) => word.text).join('')) !== compact(lineText)) return undefined
  return words
}

/** Shifts a whole timeline (lines + words) so the shared lyric matches the in-app offset. */
export function shiftTimedLyrics<T extends TimedLyricLine>(lines: T[], offsetMs: number): T[] {
  if (!offsetMs) return lines
  return lines.map((line) => {
    const startTimeMs = Math.max(0, Math.round(line.startTimeMs + offsetMs))
    const endTimeMs = line.endTimeMs ? Math.max(startTimeMs, Math.round(line.endTimeMs + offsetMs)) : undefined
    const words = line.words?.map((word) => ({
      startTimeMs: Math.max(0, Math.round(word.startTimeMs + offsetMs)),
      endTimeMs: Math.max(0, Math.round(word.endTimeMs + offsetMs)),
      text: word.text
    }))
    return { ...line, startTimeMs, endTimeMs, words }
  })
}

/** 传给原生（Lyricon / 系统歌词）的行结构，键名要和 MediaPlaybackService 对齐。 */
export interface NativeLyricLine {
  start: number
  end: number
  text: string
  translation: string
  words?: Array<{ start: number; end: number; text: string }>
}

/**
 * 把歌词整理成原生需要的形状：按时间排序、补全行尾、附带逐字时间。
 * 行尾缺失时用下一行开头（最后一行 +5s），否则多行会同时命中。
 */
export function toNativeLyricLines(lines: TimedLyricLine[], offsetMs = 0): NativeLyricLine[] {
  const ordered = shiftTimedLyrics(
    lines
      .filter((line) => String(line.text ?? '').trim())
      .slice()
      .sort((left, right) => left.startTimeMs - right.startTimeMs),
    offsetMs
  )
  return ordered.map((line, index) => {
    const start = Math.max(0, Math.round(line.startTimeMs))
    const rawEnd = Number(line.endTimeMs)
    const nextStart =
      index + 1 < ordered.length ? Math.max(0, Math.round(ordered[index + 1].startTimeMs)) : 0
    const end =
      Number.isFinite(rawEnd) && rawEnd > start
        ? Math.round(rawEnd)
        : nextStart > start
          ? nextStart
          : start + 5000
    const words = line.words?.length
      ? line.words.map((word) => ({
          start: Math.max(0, Math.round(word.startTimeMs)),
          end: Math.max(Math.round(word.startTimeMs), Math.round(word.endTimeMs)),
          text: word.text
        }))
      : undefined
    return {
      start,
      end,
      text: line.text,
      translation: line.translation ?? '',
      words
    }
  })
}

/** 单个词在本行文字里占的字符区间（下标按 Array.from 计算）。 */
export interface WordCharRange {
  start: number
  end: number
  startTimeMs: number
  endTimeMs: number
}

/**
 * 把逐字时间映射到「第几个字」。行内空白不参与计数，
 * 逐字文字与整行文字的一致性已经在 normalizeTimedWords 校验过。
 */
export function wordCharRanges(line: TimedLyricLine): WordCharRange[] {
  const words = line.words ?? []
  if (!words.length) return []
  const chars = Array.from(String(line.text ?? ''))
  const ranges: WordCharRange[] = []
  let cursor = 0
  for (const word of words) {
    while (cursor < chars.length && /\s/.test(chars[cursor])) cursor += 1
    const start = cursor
    let remaining = Array.from(word.text).filter((char) => !/\s/.test(char)).length
    while (cursor < chars.length && remaining > 0) {
      if (!/\s/.test(chars[cursor])) remaining -= 1
      cursor += 1
    }
    ranges.push({
      start,
      end: cursor,
      startTimeMs: word.startTimeMs,
      endTimeMs: word.endTimeMs
    })
  }
  return ranges
}

/**
 * 当前应该变色的字数。
 * 有逐字时间就按词推进（每个词内部再按比例补间），没有就按整行线性推进。
 * 行的有效结束时间最长按 15 秒计算，避免缺失行尾时一行拖完整首歌。
 */
export function sungCharCount(line: TimedLyricLine, nowMs: number): number {
  const total = Array.from(String(line.text ?? '')).length
  if (!total) return 0
  const ranges = wordCharRanges(line)
  if (ranges.length) {
    for (const range of ranges) {
      if (nowMs < range.startTimeMs) return range.start
      if (nowMs < range.endTimeMs) {
        const span = Math.max(1, range.endTimeMs - range.startTimeMs)
        const width = Math.max(0, range.end - range.start)
        const filled = Math.floor(((nowMs - range.startTimeMs) / span) * width)
        return Math.min(range.end, range.start + Math.max(0, filled))
      }
    }
    return total
  }
  const start = line.startTimeMs
  const rawEnd = Number(line.endTimeMs)
  let end = Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : start + 5000
  end = Math.min(end, start + 15000)
  if (nowMs <= start) return 0
  if (nowMs >= end) return total
  return Math.min(total, Math.floor(((nowMs - start) / (end - start)) * total))
}
