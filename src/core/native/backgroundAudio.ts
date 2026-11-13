import { Capacitor, registerPlugin } from '@capacitor/core'
import type { Track } from '../playback/player'
import { settingsState } from '../settings'
import { logEvent } from '../logs'
import { toNativeLyricLines, type TimedLyricWord } from '../lyrics/timeline'

interface BackgroundAudioOptions {
  /** 曲目标识：原生侧靠它判断「换歌了」，换歌时允许进度倒退。 */
  id: string
  title: string
  artist: string
  artwork: string
  playing: boolean
  pauseOnNoisy: boolean
  /** 把当前歌词行写进媒体标题，给不读 Lyricon 的系统岛用。 */
  islandCompat: boolean
  position: number
  duration: number
}

interface BackgroundAudioPlugin {
  start(options: BackgroundAudioOptions): Promise<void>
  update(options: BackgroundAudioOptions): Promise<void>
  progress(options: {
    id: string
    position: number
    duration: number
    islandCompat?: boolean
  }): Promise<void>
  seek(options: { id: string; position: number; duration: number }): Promise<void>
  diagnostics(): Promise<{ entries: string[] }>
  lyrics(options: { payload: string }): Promise<void>
  stop(): Promise<void>
  addListener(
    eventName: 'mediaAction',
    listener: (data: { action: string }) => void
  ): Promise<{ remove: () => Promise<void> }>
}

const BackgroundAudio = registerPlugin<BackgroundAudioPlugin>('BackgroundAudio')
const isNativePlatform = Capacitor.isNativePlatform()

/** 最近一次同步给原生的曲目标识，进度/seek 都带着它，原生据此判断换歌。 */
let activeSongKey = ''

function trackKey(track: Track | undefined): string {
  if (!track) return ''
  return `${track.pluginId ?? ''}:${track.providerId ?? ''}:${track.id ?? ''}`
}

function optionsFor(
  track: Track,
  playing: boolean,
  positionMs: number,
  durationMs: number
): BackgroundAudioOptions {
  activeSongKey = trackKey(track)
  return {
    id: activeSongKey,
    title: track.title || '澜音',
    artist: track.artist || '',
    // Only remote images can be fetched by the native media service.
    artwork: /^https?:\/\//i.test(track.artwork || '') ? track.artwork : '',
    playing,
    pauseOnNoisy: settingsState.playOnHeadset,
    islandCompat: settingsState.islandCompat,
    position: Math.max(0, Math.round(positionMs)),
    duration: Math.max(0, Math.round(durationMs))
  }
}

export function syncBackgroundAudio(
  track: Track,
  playing: boolean,
  positionMs: number,
  durationMs: number
): void {
  if (!isNativePlatform) return
  void BackgroundAudio.update(optionsFor(track, playing, positionMs, durationMs)).catch(
    () => undefined
  )
}

export function startBackgroundAudio(
  track: Track,
  playing: boolean,
  positionMs: number,
  durationMs: number
): void {
  if (!isNativePlatform) return
  void BackgroundAudio.start(optionsFor(track, playing, positionMs, durationMs)).catch(
    () => undefined
  )
}

/** Keeps the lock-screen / notification progress in sync without rebuilding the notification. */
export function syncBackgroundProgress(positionMs: number, durationMs: number): void {
  if (!isNativePlatform) return
  void BackgroundAudio.progress({
    id: activeSongKey,
    position: Math.max(0, Math.round(positionMs)),
    duration: Math.max(0, Math.round(durationMs)),
    islandCompat: settingsState.islandCompat
  }).catch(() => undefined)
}

/** Explicit seek: tells the native service a backwards position is intentional. */
export function seekBackgroundAudio(positionMs: number, durationMs: number): void {
  if (!isNativePlatform) return
  void BackgroundAudio.seek({
    id: activeSongKey,
    position: Math.max(0, Math.round(positionMs)),
    duration: Math.max(0, Math.round(durationMs))
  }).catch(() => undefined)
}

/** Native lyric/playback breadcrumbs for the in-app log report. */
export async function readNativeDiagnostics(): Promise<string[]> {
  if (!isNativePlatform) return []
  try {
    const result = await BackgroundAudio.diagnostics()
    return Array.isArray(result?.entries) ? result.entries.map(String) : []
  } catch {
    return []
  }
}

export interface BackgroundLyricLine {
  startTimeMs: number
  endTimeMs?: number
  text: string
  translation?: string
  /** 逐字时间（绝对毫秒），没有就只能是整行进度。 */
  words?: TimedLyricWord[]
}

/**
 * Publishes the loaded lyric timeline to the native media service. SuperLyric
 * compatible ROMs, ColorOS lock screens and lyricon-style consumers read it
 * from there; the service also clears the old timeline when lines is empty.
 */
export function syncBackgroundLyrics(
  track: Track | undefined,
  lines: BackgroundLyricLine[]
): void {
  if (!isNativePlatform) return
  const prepared = toNativeLyricLines(lines, Number(settingsState.lyricOffsetMs) || 0)
  const duration =
    track?.durationMs && track.durationMs > 0
      ? track.durationMs
      : prepared.length
        ? prepared[prepared.length - 1].end
        : 0
  const payload = JSON.stringify({
    // 必须和 MediaSession 的 mediaId 完全一致，否则系统 UI 无法把歌词
    // 绑到正在播放的那张播放卡上（v2.6.7 改成 trackKey 后两边不一致）。
    id: trackKey(track),
    title: track?.title ?? '',
    artist: track?.artist ?? '',
    album: track?.album ?? '',
    duration,
    enabled: settingsState.systemLyrics,
    translation: settingsState.systemLyricsTranslation,
    lines: prepared.slice(0, 500)
  })
  const wordCount = prepared.reduce((sum, line) => sum + (line.words?.length ?? 0), 0)
  logEvent(
    'info',
    'LYRIC',
    `下发系统歌词：${prepared.length} 行 / ${wordCount} 字 · 共享${settingsState.systemLyrics ? '开' : '关'}`,
    `${track?.title ?? '无曲目'} · ${track?.artist ?? ''} · duration=${duration} · ${(
      payload.length / 1024
    ).toFixed(1)}KB`
  )
  void BackgroundAudio.lyrics({ payload })
    .then(() => logEvent('info', 'LYRIC', '系统已接收歌词负载'))
    .catch((error: unknown) =>
      logEvent(
        'warn',
        'LYRIC',
        '系统歌词下发失败',
        error instanceof Error ? error.message : String(error)
      )
    )
}

export function stopBackgroundAudio(): void {
  if (!isNativePlatform) return
  void BackgroundAudio.stop().catch(() => undefined)
}

export function onMediaAction(handler: (action: string) => void): void {
  if (!isNativePlatform) return
  void BackgroundAudio.addListener('mediaAction', (data) => {
    if (data?.action) handler(data.action)
  }).catch(() => undefined)
}
