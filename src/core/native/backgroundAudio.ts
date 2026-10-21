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
