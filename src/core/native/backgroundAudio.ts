import { Capacitor, registerPlugin } from '@capacitor/core'
import type { Track } from '../playback/player'

interface BackgroundAudioOptions {
  title: string
  artist: string
  playing: boolean
  position: number
  duration: number
}

interface BackgroundAudioPlugin {
  start(options: BackgroundAudioOptions): Promise<void>
  update(options: BackgroundAudioOptions): Promise<void>
  stop(): Promise<void>
  addListener(
    eventName: 'mediaAction',
    listener: (data: { action: string }) => void
  ): Promise<{ remove: () => Promise<void> }>
}

const BackgroundAudio = registerPlugin<BackgroundAudioPlugin>('BackgroundAudio')
export const isNativePlatform = Capacitor.isNativePlatform()

export function syncBackgroundAudio(
  track: Track,
  playing: boolean,
  positionMs: number,
  durationMs: number
): void {
  if (!isNativePlatform) return
  const options: BackgroundAudioOptions = {
    title: track.title || '澜音',
    artist: track.artist || '',
    playing,
    position: Math.max(0, Math.round(positionMs)),
    duration: Math.max(0, Math.round(durationMs))
  }
  void BackgroundAudio.update(options).catch(() => undefined)
}

export function startBackgroundAudio(
  track: Track,
  playing: boolean,
  positionMs: number,
  durationMs: number
): void {
  if (!isNativePlatform) return
  void BackgroundAudio.start({
    title: track.title || '澜音',
    artist: track.artist || '',
    playing,
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
