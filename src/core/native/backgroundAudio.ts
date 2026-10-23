import { Capacitor, registerPlugin } from '@capacitor/core'
import type { Track } from '../playback/player'
import { settingsState } from '../settings'

interface BackgroundAudioOptions {
  title: string
  artist: string
  artwork: string
  playing: boolean
  pauseOnNoisy: boolean
  position: number
  duration: number
}

interface BackgroundAudioPlugin {
  start(options: BackgroundAudioOptions): Promise<void>
  update(options: BackgroundAudioOptions): Promise<void>
  progress(options: { position: number; duration: number }): Promise<void>
  seek(options: { position: number; duration: number }): Promise<void>
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

function optionsFor(
  track: Track,
  playing: boolean,
  positionMs: number,
  durationMs: number
): BackgroundAudioOptions {
  return {
    title: track.title || '澜音',
    artist: track.artist || '',
    // Only remote images can be fetched by the native media service.
    artwork: /^https?:\/\//i.test(track.artwork || '') ? track.artwork : '',
    playing,
    pauseOnNoisy: settingsState.playOnHeadset,
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
    position: Math.max(0, Math.round(positionMs)),
    duration: Math.max(0, Math.round(durationMs))
  }).catch(() => undefined)
}

/** Explicit seek: tells the native service a backwards position is intentional. */
export function seekBackgroundAudio(positionMs: number, durationMs: number): void {
  if (!isNativePlatform) return
  void BackgroundAudio.seek({
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
  const ordered = lines
    .filter((line) => String(line.text ?? '').trim())
    .slice()
    .sort((left, right) => left.startTimeMs - right.startTimeMs)
  const prepared = ordered.map((line, index) => {
    const start = Math.max(0, Math.round(line.startTimeMs))
    const rawEnd = Number(line.endTimeMs)
    const nextStart = index + 1 < ordered.length
      ? Math.max(0, Math.round(ordered[index + 1].startTimeMs))
      : 0
    const end =
      Number.isFinite(rawEnd) && rawEnd > start
        ? Math.round(rawEnd)
        : nextStart > start
          ? nextStart
          : start + 5000
    return {
      start,
      end,
      text: line.text,
      translation: line.translation ?? ''
    }
  })
  const duration =
    track?.durationMs && track.durationMs > 0
      ? track.durationMs
      : prepared.length
        ? prepared[prepared.length - 1].end
        : 0
  const payload = JSON.stringify({
    id: track?.id ?? '',
    title: track?.title ?? '',
    artist: track?.artist ?? '',
    album: track?.album ?? '',
    duration,
    enabled: settingsState.systemLyrics,
    translation: settingsState.systemLyricsTranslation,
    lines: prepared.slice(0, 500)
  })
  void BackgroundAudio.lyrics({ payload }).catch(() => undefined)
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
