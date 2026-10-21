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
  lyrics(options: { payload: string }): Promise<void>
  stop(): Promise<void>
  addListener(
    eventName: 'mediaAction',
    listener: (data: { action: string }) => void
  ): Promise<{ remove: () => Promise<void> }>
}

const BackgroundAudio = registerPlugin<BackgroundAudioPlugin>('BackgroundAudio')
export const isNativePlatform = Capacitor.isNativePlatform()

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
  const payload = JSON.stringify({
    id: track?.id ?? '',
    title: track?.title ?? '',
    artist: track?.artist ?? '',
    album: track?.album ?? '',
    duration: track?.durationMs ?? 0,
    enabled: settingsState.systemLyrics,
    translation: settingsState.systemLyricsTranslation,
    lines: lines.slice(0, 500).map((line) => ({
      start: Math.max(0, Math.round(line.startTimeMs)),
      end: Math.max(0, Math.round(line.endTimeMs ?? line.startTimeMs + 5000)),
      text: line.text,
      translation: line.translation ?? ''
    }))
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
