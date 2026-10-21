import { reactive } from 'vue'
import {
  allProviders,
  invokeProvider,
  registerHostHooks,
  type ProviderHandle
} from '../plugin/manager'
import { settingsState, updateSettings } from '../settings'
import {
  startBackgroundAudio,
  stopBackgroundAudio,
  syncBackgroundAudio,
  syncBackgroundProgress
} from '../native/backgroundAudio'
import { toTrack, type Track } from '../track'
import { matchCloudLyrics } from '../lyrics/cloud'
import { playableUrl, providerForTrack } from './source'
import { localUrlFor } from '../downloads'

export type { Track } from '../track'
export { toTrack }

export type PlayMode = 'order' | 'repeat-all' | 'repeat-one' | 'shuffle'

export interface LyricLine {
  startTimeMs: number
  endTimeMs?: number
  text: string
  translation?: string
}

export const playerState = reactive({
  ready: false,
  queue: [] as Track[],
  index: -1,
  playing: false,
  loading: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  mode: 'repeat-all' as PlayMode,
  quality: '',
  resolvedQuality: '',
  lyrics: [] as LyricLine[],
  lyricsLoading: false,
  lyricSource: '',
  activeLyric: -1,
  error: ''
})

let audio: HTMLAudioElement | null = null
let resolveToken = 0
let blobUrl: string | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let wakeLock: any = null
let lastProgressSync = 0
let loadTimer: ReturnType<typeof setTimeout> | null = null

function clearLoadTimer(): void {
  if (loadTimer) {
    clearTimeout(loadTimer)
    loadTimer = null
  }
}

async function syncWakeLock(): Promise<void> {
  try {
    const wanted = settingsState.keepScreenOn && playerState.playing
    if (wanted && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await (navigator as any).wakeLock.request('screen')
      wakeLock.addEventListener?.('release', () => {
        wakeLock = null
      })
    } else if (!wanted && wakeLock) {
      await wakeLock.release()
      wakeLock = null
    }
  } catch {}
}

document.addEventListener?.('visibilitychange', () => {
  if (document.visibilityState === 'visible' && playerState.playing) void syncWakeLock()
})

const STORAGE_KEY = 'ceru.player.v1'

export function currentTrack(): Track | undefined {
  return playerState.queue[playerState.index]
}

function persist(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          queue: playerState.queue,
          index: playerState.index,
          volume: playerState.volume,
          mode: playerState.mode,
          quality: playerState.quality,
          currentTime: playerState.currentTime
        })
      )
    } catch {}
  }, 300)
}

export function restorePlayer(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (Array.isArray(saved.queue)) playerState.queue = saved.queue
    if (Number.isInteger(saved.index)) playerState.index = saved.index
    if (Number.isFinite(saved.volume)) playerState.volume = saved.volume
    if (saved.mode) playerState.mode = saved.mode
    playerState.quality = settingsState.quality
    if (Number.isFinite(saved.currentTime)) playerState.currentTime = saved.currentTime
    playerState.loading = false
    playerState.playing = false
    playerState.error = ''
    audio!.volume = playerState.volume
    // The previous audio source does not survive a restart; make sure an old
    // play() cannot leave the UI spinning on an empty element.
    audio!.pause()
    audio!.removeAttribute('src')
    audio!.load()
    if (currentTrack()) {
      attachMediaSession(currentTrack()!)
      void loadLyrics(currentTrack()!)
    }
  } catch {}
}

export function initPlayer(): void {
  if (audio) return
  audio = new Audio()
  audio.preload = 'auto'
  audio.volume = playerState.volume
  audio.addEventListener('play', () => {
    playerState.playing = true
    void syncWakeLock()
    const track = currentTrack()
    if (track) syncBackgroundAudio(track, true, playerState.currentTime * 1000, playerState.duration * 1000)
  })
  audio.addEventListener('pause', () => {
    playerState.playing = false
    void syncWakeLock()
    const track = currentTrack()
    if (track) syncBackgroundAudio(track, false, playerState.currentTime * 1000, playerState.duration * 1000)
  })
  audio.addEventListener('timeupdate', () => {
    if (!audio) return
    playerState.currentTime = audio.currentTime
    updateActiveLyric()
    updatePositionState()
    const now = Date.now()
    if (playerState.playing && now - lastProgressSync > 5000) {
      lastProgressSync = now
      syncBackgroundProgress(playerState.currentTime * 1000, playerState.duration * 1000)
    }
  })
  audio.addEventListener('durationchange', () => {
    if (!audio) return
    playerState.duration = Number.isFinite(audio.duration) ? audio.duration : playerState.duration
  })
  audio.addEventListener('loadedmetadata', () => {
    if (!audio) return
    playerState.duration = Number.isFinite(audio.duration)
      ? audio.duration
      : currentTrack()?.durationMs
        ? currentTrack()!.durationMs / 1000
        : 0
    if (playerState.currentTime > 0.5) {
      try {
        audio.currentTime = playerState.currentTime
      } catch {}
    }
  })
  audio.addEventListener('waiting', () => {
    playerState.loading = true
  })
  audio.addEventListener('playing', () => {
    clearLoadTimer()
    playerState.loading = false
    playerState.error = ''
  })
  audio.addEventListener('canplay', () => {
    clearLoadTimer()
    playerState.loading = false
  })
  audio.addEventListener('ended', () => {
    void handleEnded()
  })
  audio.addEventListener('error', () => {
    playerState.loading = false
    if (!audio?.src) return
    playerState.error = '音频加载失败，请尝试切换音质或音源'
    playerState.playing = false
  })
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => void resume())
    navigator.mediaSession.setActionHandler('pause', () => pause())
    navigator.mediaSession.setActionHandler('nexttrack', () => void next())
    navigator.mediaSession.setActionHandler('previoustrack', () => void previous())
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number') seek(details.seekTime)
    })
  }
  playerState.ready = true
}

function updatePositionState(): void {
  if (!('mediaSession' in navigator) || !audio) return
  try {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0
    if (duration > 0) {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: audio.playbackRate,
        position: Math.min(audio.currentTime, duration)
      })
    }
  } catch {}
}

function attachMediaSession(track: Track): void {
  if (!('mediaSession' in navigator)) return
  try {
    const artworkUrl = absoluteArtwork(track.artwork)
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: artworkUrl
        ? [
            { src: artworkUrl, sizes: '512x512', type: 'image/png' },
            { src: artworkUrl, sizes: '256x256', type: 'image/png' }
          ]
        : []
    })
    navigator.mediaSession.playbackState = playerState.playing ? 'playing' : 'paused'
  } catch {}
}

function absoluteArtwork(url: string): string {
  if (!url) return ''
  if (/^https?:|^data:|^blob:/.test(url)) return url
  return new URL(url, location.href).href
}

async function resolvePlaybackUrl(track: Track): Promise<string> {
  const local = localUrlFor(track)
  if (local) {
    playerState.resolvedQuality = 'local'
    return local
  }
  return playableUrl(track, playerState.quality)
}

function releaseBlob(): void {
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl)
    blobUrl = null
  }
}

async function startPlayback(track: Track, seekTo = 0): Promise<void> {
  if (!audio) initPlayer()
  const token = ++resolveToken
  playerState.loading = true
  playerState.error = ''
  playerState.currentTime = seekTo
  clearLoadTimer()
  loadTimer = setTimeout(() => {
    if (token !== resolveToken || !playerState.loading) return
    playerState.loading = false
    playerState.playing = false
    playerState.error = '加载超时，请重试或切换音源'
  }, 25_000)
  playerState.duration = track.durationMs ? track.durationMs / 1000 : 0
  playerState.lyrics = []
  playerState.lyricSource = ''
  playerState.activeLyric = -1
  attachMediaSession(track)
  void loadLyrics(track)
  try {
    const url = await resolvePlaybackUrl(track)
    if (token !== resolveToken) return
    releaseBlob()
    if (url.startsWith('blob:')) blobUrl = url
    audio!.src = url
    if (seekTo > 0) {
      audio!.addEventListener(
        'loadedmetadata',
        () => {
          try {
            audio!.currentTime = seekTo
          } catch {}
        },
        { once: true }
      )
    }
    await audio!.play()
    clearLoadTimer()
    playerState.playing = true
    playerState.loading = false
    startBackgroundAudio(
      track,
      true,
      (audio!.currentTime || 0) * 1000,
      (playerState.duration || 0) * 1000
    )
    addHistory(track)
    persist()
  } catch (error: any) {
    if (token !== resolveToken) return
    clearLoadTimer()
    playerState.loading = false
    playerState.playing = false
    playerState.error = error?.message ?? '播放失败'
    throw error
  }
}

export async function playTracks(tracks: Track[], index = 0): Promise<void> {
  playerState.queue = [...tracks]
  playerState.index = Math.max(0, Math.min(index, tracks.length - 1))
  playerState.currentTime = 0
  persist()
  if (playerState.queue.length) await startPlayback(playerState.queue[playerState.index])
}

export async function playTrack(track: Track, queue?: Track[]): Promise<void> {
  if (queue) {
    const index = queue.findIndex(
      (item) => item.id === track.id && item.providerId === track.providerId
    )
    return playTracks(queue, index < 0 ? 0 : index)
  }
  const existing = playerState.queue.findIndex(
    (item) => item.id === track.id && item.providerId === track.providerId
  )
  if (existing >= 0) {
    playerState.index = existing
    return startPlayback(track)
  }
  playerState.queue.splice(playerState.index + 1, 0, track)
  playerState.index += 1
  persist()
  return startPlayback(track)
}

export async function togglePlay(): Promise<void> {
  const track = currentTrack()
  if (!audio || !track) return
  // After an app restart the restored queue has no audio source. Start the
  // track instead of calling play() on an empty element forever.
  if (!audio.getAttribute('src')) {
    await startPlayback(track, playerState.currentTime || 0)
    return
  }
  if (audio.paused) {
    try {
      await audio.play()
    } catch (error: any) {
      playerState.error = error?.message ?? '播放失败'
    }
  } else {
    audio.pause()
  }
  updatePositionState()
}

export async function resume(): Promise<void> {
  const track = currentTrack()
  if (audio && track && !audio.getAttribute('src')) {
    await startPlayback(track, playerState.currentTime || 0)
    return
  }
  if (audio && audio.paused) {
    try {
      await audio.play()
    } catch {}
  }
}

export function pause(): void {
  audio?.pause()
}

export function seek(time: number): void {
  if (!audio) return
  const duration = Number.isFinite(audio.duration) ? audio.duration : playerState.duration
  const value = Math.max(0, Math.min(Number(time) || 0, duration || 0))
  try {
    audio.currentTime = value
    playerState.currentTime = value
    updateActiveLyric()
    updatePositionState()
    const track = currentTrack()
    if (track) {
      syncBackgroundAudio(track, playerState.playing, value * 1000, (duration || 0) * 1000)
    }
  } catch {}
}

export function setVolume(value: number): void {
  const volume = Math.max(0, Math.min(1, Number(value) || 0))
  playerState.volume = volume
  if (audio) audio.volume = volume
  persist()
}

export function setMode(mode: PlayMode): void {
  playerState.mode = mode
  persist()
}

export function cycleMode(): void {
  const modes: PlayMode[] = ['order', 'repeat-all', 'repeat-one', 'shuffle']
  setMode(modes[(modes.indexOf(playerState.mode) + 1) % modes.length])
}

export function setQuality(quality: string): void {
  playerState.quality = quality
  updateSettings({ quality })
  persist()
  const track = currentTrack()
  if (track && playerState.playing) void startPlayback(track, playerState.currentTime)
}

function randomIndex(total: number): number {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return values[0] % total
}

function nextIndex(step: number): number {
  const total = playerState.queue.length
  if (!total) return -1
  if (playerState.mode === 'shuffle' && total > 1) {
    let index = playerState.index
    while (index === playerState.index) index = randomIndex(total)
    return index
  }
  const index = playerState.index + step
  if (index < 0) return playerState.mode === 'order' ? 0 : total - 1
  if (index >= total) return playerState.mode === 'order' ? total - 1 : 0
  return index
}

export async function next(): Promise<void> {
  const index = nextIndex(1)
  if (index < 0) return
  if (index === playerState.index && playerState.mode === 'order') return
  playerState.index = index
  persist()
  await startPlayback(playerState.queue[index])
}

export async function previous(): Promise<void> {
  if (playerState.currentTime > 4) {
    seek(0)
    return
  }
  const index = nextIndex(-1)
  if (index < 0) return
  playerState.index = index
  persist()
  await startPlayback(playerState.queue[index])
}

async function handleEnded(): Promise<void> {
  if (playerState.mode === 'repeat-one') {
    seek(0)
    await resume()
    return
  }
  if (playerState.mode === 'order' && playerState.index >= playerState.queue.length - 1) {
    playerState.playing = false
    const track = currentTrack()
    if (track) syncBackgroundAudio(track, false, playerState.currentTime * 1000, playerState.duration * 1000)
    return
  }
  await next()
}

export function removeFromQueue(index: number): void {
  if (index < 0 || index >= playerState.queue.length) return
  const wasCurrent = index === playerState.index
  playerState.queue.splice(index, 1)
  if (index < playerState.index) playerState.index -= 1
  if (wasCurrent) {
    if (!playerState.queue.length) {
      playerState.index = -1
      audio?.pause()
      if (audio) {
        audio.removeAttribute('src')
        audio.load()
      }
      playerState.playing = false
      playerState.currentTime = 0
      playerState.duration = 0
      stopBackgroundAudio()
    } else {
      playerState.index = Math.min(playerState.index, playerState.queue.length - 1)
      void startPlayback(playerState.queue[playerState.index])
    }
  }
  persist()
}

export function clearQueue(): void {
  playerState.queue = []
  playerState.index = -1
  audio?.pause()
  if (audio) {
    audio.removeAttribute('src')
    audio.load()
  }
  playerState.playing = false
  playerState.currentTime = 0
  playerState.duration = 0
  releaseBlob()
  stopBackgroundAudio()
  persist()
}

export function addToQueue(track: Track, playNext = false): void {
  if (playNext && playerState.index >= 0) {
    playerState.queue.splice(playerState.index + 1, 0, track)
  } else {
    playerState.queue.push(track)
  }
  persist()
}

export async function loadLyrics(track: Track): Promise<void> {
  const provider = providerForTrack(track)
  playerState.lyricsLoading = true
  playerState.lyrics = []
  playerState.lyricSource = ''
  try {
    if (provider) {
      try {
        const document = await invokeProvider(provider, 'tracks.lyrics', [track.ref])
        if (currentTrack()?.id !== track.id) return
        const lines = (document?.lines ?? [])
          .map((line: any) => ({
            startTimeMs: Number(line.startTimeMs) || 0,
            endTimeMs: line.endTimeMs,
            text: String(line.text ?? ''),
            translation: line.translation
          }))
          .filter((line: LyricLine) => line.text.trim())
        if (lines.length) {
          playerState.lyrics = lines
          playerState.lyricSource = 'plugin'
          updateActiveLyric()
          return
        }
      } catch {
        // Fall through to the cloud lyric sources.
      }
    }

    if (settingsState.cloudLyrics) {
      const cloud = await matchCloudLyrics(track)
      if (currentTrack()?.id !== track.id) return
      if (cloud?.lines.length) {
        playerState.lyrics = cloud.lines
        playerState.lyricSource = cloud.source
        updateActiveLyric()
      }
    }
  } finally {
    if (currentTrack()?.id === track.id) playerState.lyricsLoading = false
  }
}

/** Manually search LrcLib / QQ Music for the current track's lyrics. */
export async function matchLyricsOnline(target: Track | undefined = currentTrack()): Promise<void> {
  if (!target) return
  playerState.lyricsLoading = true
  playerState.lyrics = []
  playerState.lyricSource = ''
  try {
    const cloud = await matchCloudLyrics(target, true)
    if (currentTrack()?.id !== target.id) return
    if (cloud?.lines.length) {
      playerState.lyrics = cloud.lines
      playerState.lyricSource = cloud.source
      updateActiveLyric()
    }
  } finally {
    if (currentTrack()?.id === target.id) playerState.lyricsLoading = false
  }
}

export function updateActiveLyric(): void {
  const lines = playerState.lyrics
  if (!lines.length) {
    playerState.activeLyric = -1
    return
  }
  const time = playerState.currentTime * 1000
  let index = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startTimeMs <= time) index = i
    else break
  }
  playerState.activeLyric = index
}

const HISTORY_KEY = 'ceru.history.v1'

export function addHistory(track: Track): void {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const list: Track[] = raw ? JSON.parse(raw) : []
    const filtered = list.filter(
      (item) => !(item.id === track.id && item.providerId === track.providerId)
    )
    filtered.unshift(track)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered.slice(0, 100)))
  } catch {}
}

export function getHistory(): Track[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function providerForCurrent(): ProviderHandle | undefined {
  const track = currentTrack()
  return track ? providerForTrack(track) : undefined
}

export function syncMediaSessionState(): void {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.playbackState = playerState.playing ? 'playing' : 'paused'
}

export function registerPlayerHostHooks(): void {
  registerHostHooks({
    player: {
      getState: () => ({
        playing: playerState.playing,
        positionMs: Math.round(playerState.currentTime * 1000),
        volume: playerState.volume,
        mode: playerState.mode,
        track: currentTrack()
          ? {
              providerId: currentTrack()!.providerId,
              id: currentTrack()!.id,
              kind: 'track'
            }
          : null
      }),
      play: () => void resume(),
      pause: () => pause(),
      next: () => void next(),
      previous: () => void previous(),
      seek: (args: any[]) => seek(Number(args?.[0]) || 0),
      setVolume: (args: any[]) => setVolume(Number(args?.[0]) || 0),
      setMode: (args: any[]) => {
        const mode = String(args?.[0] ?? '')
        if (['order', 'repeat-all', 'repeat-one', 'shuffle'].includes(mode)) setMode(mode as PlayMode)
      }
    },
    queue: {
      get: () => ({
        items: playerState.queue.map((track) => ({
          ref: track.ref,
          title: track.title,
          subtitle: track.artist,
          capabilities: ['play'],
          metadata: {
            artists: [track.artist],
            album: track.album ? { title: track.album } : undefined,
            durationMs: track.durationMs,
            artworkUrl: track.artwork,
            qualities: track.qualities
          }
        })),
        currentIndex: playerState.index,
        revision: 'mobile'
      }),
      append: (args: any[]) => {
        const provider = providerForCurrent() ?? allProviders()[0]
        if (!provider) return
        for (const item of args?.[0] ?? []) {
          if (item?.ref?.kind === 'track' && item.metadata?.artists) {
            playerState.queue.push(toTrack(item, provider))
          }
        }
        persist()
      },
      replace: (args: any[]) => {
        const provider = providerForCurrent() ?? allProviders()[0]
        if (!provider) return
        playerState.queue = (args?.[0] ?? [])
          .filter((item: any) => item?.ref?.kind === 'track' && item.metadata?.artists)
          .map((item: any) => toTrack(item, provider))
        playerState.index = 0
        persist()
      },
      remove: () => undefined,
      reorder: () => undefined
    },
    history: () => getHistory()
  })
}
