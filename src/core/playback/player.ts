import { reactive, ref, watch } from 'vue'
import {
  allProviders,
  searchProviders,
  invokeProvider,
  notify,
  registerHostHooks,
  type ProviderHandle
} from '../plugin/manager'
import { settingsState, updateSettings } from '../settings'
import {
  seekBackgroundAudio,
  startBackgroundAudio,
  stopBackgroundAudio,
  syncBackgroundAudio,
  syncBackgroundLyrics,
  syncBackgroundProgress
} from '../native/backgroundAudio'
import { toTrack, type Track } from '../track'
import { matchCloudLyrics } from '../lyrics/cloud'
import { normalizeTimedWords, type TimedLyricWord } from '../lyrics/timeline'
import { playableSource, providerForTrack, trackQualityCandidates } from './source'
import { localUrlFor } from '../downloads'
import { cachedAudioUrl } from '../cache/audioCache'
import { logEvent } from '../logs'
import { isWebDavTrack } from '../sync/webdavMedia'
import { qualityLabel } from '../quality'
import { sourcesOf, sameRecording, sourceKey, sourceLabel, withSources } from '../trackGrouping'

export type { Track } from '../track'
export { toTrack }

type PlayMode = 'order' | 'repeat-all' | 'repeat-one' | 'shuffle'

export interface LyricLine {
  startTimeMs: number
  endTimeMs?: number
  text: string
  translation?: string
  /** 逐字时间：有它歌词才能按字变色，没有就只能整行切换。 */
  words?: TimedLyricWord[]
}

export const playerState = reactive({
  ready: false,
  sleepEndAt: 0,
  sleepAtTrackEnd: false,
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
let playbackController: AbortController | null = null
let startPending = false
/**
 * 新音源已经设进 <audio>、但它的 metadata 还没到时为 true。
 *
 * 这段时间里 audio.currentTime 还停在上一首的位置（Chrome 在 metadata 到达前
 * 不会把时间轴切过去），谁读它谁就拿到旧进度：时钟会把旧位置写回 playerState，
 * 随后的 loadedmetadata 又拿这个旧位置去 seek，于是新歌一开口就从旧歌的进度开始。
 * 所以加载期间一律不读也不写进度，只认 startPlayback 给的目标位置。
 */
let awaitingLoad = false
let pendingStartSeek = 0
let reloadRequired = false
let intentionalPause = false
let autoResumeAttempts = 0
let autoResumeTimer: ReturnType<typeof setTimeout> | null = null
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

/** Stops the shared audio element and drops its current source. */
function detachAudioSource(): void {
  if (!audio) return
  intentionalPause = true
  awaitingLoad = false
  audio.pause()
  audio.removeAttribute('src')
  audio.load()
}

/** Cancels an in-flight start when the user presses pause before it begins. */
function scheduleMixResume(): void {
  if (!settingsState.allowAudioMix || autoResumeAttempts >= 2 || !audio) return
  if (autoResumeTimer) clearTimeout(autoResumeTimer)
  autoResumeAttempts += 1
  autoResumeTimer = setTimeout(() => {
    autoResumeTimer = null
    if (!settingsState.allowAudioMix || intentionalPause || !audio || audio.ended || !audio.paused) return
    logEvent('warn', 'PLAYER', '混音模式：系统暂停了音频，尝试恢复', `第 ${autoResumeAttempts} 次`)
    void audio.play().catch(() => undefined)
  }, 350)
}

function cancelPendingStart(): boolean {
  if (!startPending) return false
  intentionalPause = true
  startPending = false
  resolveToken += 1
  playbackController?.abort(); playbackController = null
  clearLoadTimer()
  playerState.loading = false
  playerState.playing = false
  // Drop the previous track's source as well: otherwise pressing play again
  // would resume the old song while the UI already shows the new one.
  detachAudioSource()
  releaseBlob()
  playerState.currentTime = pendingStartSeek
  const track = currentTrack()
  playerState.duration = track?.durationMs ? track.durationMs / 1000 : 0
  return true
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
  if (document.visibilityState === 'hidden') {
    savePlaybackState()
  } else if (playerState.playing) {
    // 后台时 rAF 停摆，回到前台重新校准时基再把歌词接上。
    startClock()
    void syncWakeLock()
  }
})
window.addEventListener?.('pagehide', savePlaybackState)

const STORAGE_KEY = 'ceru.player.v1'

export function currentTrack(): Track | undefined {
  return playerState.queue[playerState.index]
}

/**
 * 设置里切换「岛歌词兼容」后，让原生按新开关重算媒体标题。
 * 播放中靠进度同步就能生效，这里补的是暂停状态下的那一次。
 */
export function refreshBackgroundMetadata(): void {
  const track = currentTrack()
  if (!track) return
  syncBackgroundAudio(
    track,
    playerState.playing,
    playerState.currentTime * 1000,
    playerState.duration * 1000
  )
}

function writePlayerState(): void {
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
}

function persist(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(writePlayerState, 300)
}

/** Writes the current position immediately, e.g. before backgrounding or exiting. */
export function savePlaybackState(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  // timeupdate can be throttled in the background; read the element directly.
  if (
    audio &&
    !startPending &&
    !awaitingLoad &&
    audio.getAttribute('src') &&
    Number.isFinite(audio.currentTime)
  ) {
    playerState.currentTime = audio.currentTime
  }
  writePlayerState()
}

export function restorePlayer(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (Array.isArray(saved.queue)) playerState.queue = saved.queue
    if (Number.isInteger(saved.index)) playerState.index = saved.index
    playerState.index = playerState.queue.length
      ? Math.max(0, Math.min(playerState.index, playerState.queue.length - 1))
      : -1
    if (Number.isFinite(saved.volume)) playerState.volume = saved.volume
    if (saved.mode) playerState.mode = saved.mode
    playerState.quality = settingsState.quality
    if (Number.isFinite(saved.currentTime)) playerState.currentTime = saved.currentTime
    playerState.loading = false
    playerState.playing = false
    playerState.error = ''
    intentionalPause = true
    audio!.volume = playerState.volume
    // The previous audio source does not survive a restart; make sure an old
    // play() cannot leave the UI spinning on an empty element.
    audio!.pause()
    audio!.removeAttribute('src')
    audio!.load()
    awaitingLoad = false
    if (currentTrack()) {
      attachMediaSession(currentTrack()!)
      void loadLyrics(currentTrack()!)
    }
  } catch {}
}

let clockRaf: number | null = null
let clockBaseMedia = 0
let clockBaseAt = 0

function clockRate(): number {
  const rate = Number(audio?.playbackRate)
  return Number.isFinite(rate) && rate > 0 ? rate : 1
}

function clampMediaTime(value: number): number {
  const duration = playerState.duration
  return Math.max(0, duration > 0 ? Math.min(value, duration) : value)
}

/**
 * 用本地单调时钟推进播放位置，只在真实漂移/拖动时回到 audio.currentTime。
 * 不能用 timeupdate 直接覆盖 currentTime：WebView 的该事件约 250ms 一次，
 * 每次都回写会让歌词出现“跳一下、停一下”的锯齿，倍速时更明显。
 */
function smoothMediaTime(media: number, now: number): number {
  if (!clockBaseAt) {
    clockBaseMedia = media
    clockBaseAt = now
    return media
  }
  const predicted = clockBaseMedia + ((now - clockBaseAt) / 1000) * clockRate()
  const drift = media - predicted
  // 4Hz 的 currentTime 步进本身约 250ms；只修正真正的 seek/卡顿。
  if (drift > 0.12 || drift < -0.45) {
    clockBaseMedia = media
    clockBaseAt = now
    return media
  }
  return predicted
}

function applyMediaClock(media: number): void {
  playerState.currentTime = clampMediaTime(smoothMediaTime(media, performance.now()))
}

/**
 * 逐帧推进歌词时钟。
 *
 * `timeupdate` 只有约 4Hz，直接拿它画逐字变色会一格一格跳、最多落后 250ms；
 * 这里改成每帧读 audio.currentTime，并在两次变化之间按 playbackRate 补间
 * （部分 WebView 把 currentTime 也按 250ms 步进）。
 */
function tickClock(): void {
  clockRaf = null
  if (!audio || !playerState.playing) return
  const now = performance.now()
  if (awaitingLoad) {
    // 新音源还没就位：audio.currentTime 仍是上一首的位置，别写回界面。
    updateActiveLyric()
    clockRaf = requestAnimationFrame(tickClock)
    return
  }
  const media = Number.isFinite(audio.currentTime) ? audio.currentTime : clockBaseMedia
  playerState.currentTime = clampMediaTime(smoothMediaTime(media, now))
  updateActiveLyric()
  clockRaf = requestAnimationFrame(tickClock)
}

function startClock(): void {
  resetClock()
  if (clockRaf !== null) return
  clockRaf = requestAnimationFrame(tickClock)
}

function stopClock(): void {
  if (clockRaf !== null) cancelAnimationFrame(clockRaf)
  clockRaf = null
  resetClock()
}

function resetClock(): void {
  clockBaseMedia = Number.isFinite(audio?.currentTime) ? audio!.currentTime : playerState.currentTime
  clockBaseAt = performance.now()
}

export function initPlayer(): void {
  if (audio) return
  audio = new Audio()
  audio.preload = 'auto'
  audio.volume = playerState.volume
  applyPlaybackRate()
  audio.addEventListener('play', () => {
    playerState.playing = true
    startClock()
    void syncWakeLock()
    const track = currentTrack()
    if (track) {
      const position = Number.isFinite(audio!.currentTime) ? audio!.currentTime : playerState.currentTime
      syncBackgroundAudio(track, true, position * 1000, playerState.duration * 1000)
    }
  })
  audio.addEventListener('pause', () => {
    const wasPlaying = playerState.playing
    playerState.playing = false
    if (Number.isFinite(audio!.currentTime)) playerState.currentTime = audio!.currentTime
    stopClock()
    persist()
    void syncWakeLock()
    const track = currentTrack()
    if (track) {
      const position = Number.isFinite(audio!.currentTime) ? audio!.currentTime : playerState.currentTime
      syncBackgroundAudio(track, false, position * 1000, playerState.duration * 1000)
    }
    if (wasPlaying && !intentionalPause && settingsState.allowAudioMix && !audio!.ended &&
        !startPending && !awaitingLoad && audio!.getAttribute('src')) scheduleMixResume()
  })
  audio.addEventListener('timeupdate', () => {
    // Ignore progress from the previous track while a new source is loading.
    if (!audio || startPending || awaitingLoad || !audio.getAttribute('src')) return
    if (playerState.playing) applyMediaClock(audio.currentTime)
    else playerState.currentTime = audio.currentTime
    // 暂停/后台时 rAF 时钟不跑，这里补一次高亮，保证 seek 后歌词立刻跟上。
    updateActiveLyric()
    updatePositionState()
    const now = Date.now()
    if (playerState.playing && now - lastProgressSync > 3000) {
      lastProgressSync = now
      syncBackgroundProgress(playerState.currentTime * 1000, playerState.duration * 1000)
      // Remember the position so an app restart can resume near where it stopped.
      persist()
    }
  })
  audio.addEventListener('seeking', resetClock)
  audio.addEventListener('seeked', resetClock)
  audio.addEventListener('ratechange', resetClock)
  // 缓冲时冻结歌词时钟，恢复播放后再校准，避免歌词跑到声音前面。
  audio.addEventListener('waiting', () => {
    stopClock()
    resetClock()
  })
  audio.addEventListener('playing', startClock)
  audio.addEventListener('ended', stopClock)
  audio.addEventListener('error', () => {
    awaitingLoad = false
  })
  audio.addEventListener('durationchange', () => {
    if (!audio || awaitingLoad) return
    playerState.duration = Number.isFinite(audio.duration) ? audio.duration : playerState.duration
  })
  audio.addEventListener('loadedmetadata', () => {
    if (!audio) return
    playerState.duration = Number.isFinite(audio.duration)
      ? audio.duration
      : currentTrack()?.durationMs
        ? currentTrack()!.durationMs / 1000
        : 0
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
    if (!audio?.src || startPending) return
    const track = currentTrack()
    if (track && !playerState.quality && track.pluginId !== 'local' && !isWebDavTrack(track)) {
      try {
        const choices = trackQualityCandidates(track)
        const used = choices.indexOf(playerState.resolvedQuality || undefined)
        const lower = used >= 0 ? choices.slice(used + 1) : []
        if (lower.length) {
          void startPlayback(track, playerState.currentTime, true, lower).catch(() => {})
          return
        }
      } catch { /* The owning source may have been disabled meanwhile. */ }
    }
    playerState.error = '音频加载失败，请尝试切换音质或音源'
    playerState.playing = false
    logEvent(
      'error',
      'PLAYER',
      playerState.error,
      audio?.error ? `MediaError code=${audio.error.code} ${audio.error.message || ''}` : ''
    )
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

/** Applies the configured playback speed to the shared audio element. */
export function applyPlaybackRate(): void {
  if (!audio) return
  const rate = Math.max(0.5, Math.min(2, Number(settingsState.playbackRate) || 1))
  try {
    audio.playbackRate = rate
    ;(audio as any).preservesPitch = true
  } catch {}
  resetClock()
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

watch(() => currentTrack()?.artwork, () => {
  const track = currentTrack()
  if (track) { attachMediaSession(track); syncBackgroundAudio(track, playerState.playing, playerState.currentTime * 1000, playerState.duration * 1000) }
})

watch(() => settingsState.allowAudioMix, refreshBackgroundMetadata)

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

async function resolvePlaybackUrls(track: Track, quality = playerState.quality, signal?: AbortSignal): Promise<{ url: string; fallbackUrl: string }> {
  const local = localUrlFor(track)
  if (local) {
    playerState.resolvedQuality = 'local'
    return { url: local, fallbackUrl: '' }
  }
  const source = await playableSource(track, quality, signal)
  signal?.throwIfAborted()
  const remote = source.url
  playerState.resolvedQuality = source.quality || quality || ''
  // 本机音乐已经是 127.0.0.1 直出，再套一层缓存代理没有意义，还会白占磁盘。
  if (track.pluginId === 'local' || !settingsState.playbackCache) {
    return { url: remote, fallbackUrl: '' }
  }
  const cached = await cachedAudioUrl(remote)
  return { url: cached, fallbackUrl: cached === remote ? '' : remote }
}

function releaseBlob(): void {
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl)
    blobUrl = null
  }
}

/** Only selected/running sources; exact recording checks prevent unrelated covers being substituted. */
async function findFallbackTrack(track: Track, attempted: Set<string>, searched: Set<string>): Promise<Track | null> {
  if (!settingsState.autoSourceFallback) return null
  const eligible = searchProviders().filter(p => !attempted.has(sourceKey(p)) && p.methods.includes('tracks.search') && p.methods.includes('tracks.resolve'))
  const known = sourcesOf(track)
  for (const source of known) if (eligible.some(p=>p.pluginId===source.pluginId&&p.providerId===source.providerId) && sameRecording(track,source)) return withSources(source,known)
  for (const provider of eligible) {
    if (searched.has(sourceKey(provider))) continue
    searched.add(sourceKey(provider))
    const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),12_000)
    try {
      const page = await invokeProvider(provider,'tracks.search',[{query:`${track.title} ${track.artist}`.trim(),kinds:['track'],filters:{},limit:10}],controller.signal)
      const candidate = (page?.items || []).filter((x:any)=>x.ref?.kind==='track').map((x:any)=>toTrack(x,provider)).find((t:Track)=>sameRecording(track,t))
      if (candidate) return withSources(candidate,[...known,candidate])
    } catch { /* This source failed this lookup; continue without looping back to it. */ }
    finally { clearTimeout(timer) }
  }
  return null
}

async function startPlayback(
  track: Track,
  seekTo = 0,
  allowFallback = true,
  remainingQualities?: Array<string | undefined>,
  attempted = new Set<string>(),
  searched = new Set<string>()
): Promise<void> {
  if (!audio) initPlayer()
  intentionalPause = false
  autoResumeAttempts = 0
  attempted.add(sourceKey(track))
  playbackController?.abort()
  const token = ++resolveToken
  startPending = true
  pendingStartSeek = seekTo
  reloadRequired = false
  playerState.loading = true
  playerState.error = ''
  playerState.resolvedQuality = ''
  playerState.currentTime = seekTo
  // 从这里开始到新源 metadata 到达，进度条只认 seekTo，不许读旧的 audio.currentTime。
  awaitingLoad = true
  clearLoadTimer()
  playerState.duration = track.durationMs ? track.durationMs / 1000 : 0
  playerState.lyrics = []
  playerState.lyricSource = ''
  playerState.activeLyric = -1
  syncBackgroundLyrics(track, [])
  attachMediaSession(track)
  logEvent(
    'info',
    'PLAYER',
    `开始播放：${track.title}${track.artist ? ' · ' + track.artist : ''}`,
    `provider=${track.providerId}；plugin=${track.pluginId ?? ''}；ref.kind=${String(
      (track.ref as any)?.kind ?? ''
    )}；ref.id=${String((track.ref as any)?.id ?? '')}；seek=${seekTo}；duration=${Math.round(
      (track.durationMs ?? 0) / 1000
    )}s`
  )
  void loadLyrics(track)
  try {
    const qualities = localUrlFor(track) || track.pluginId === 'local' || isWebDavTrack(track) ? [undefined] : remainingQualities || trackQualityCandidates(track, playerState.quality)
    for (let index = 0; index < qualities.length; index++) {
      const quality = qualities[index]
      if (token !== resolveToken) return
      playerState.resolvedQuality = quality || ''
      const controller = new AbortController(); playbackController = controller
      let rejectAbort: (reason: unknown) => void = () => {}
      const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
      const onAbort = () => rejectAbort(controller.signal.reason || new Error('播放已取消'))
      controller.signal.addEventListener('abort', onAbort, { once:true })
      const timer = setTimeout(() => controller.abort(new Error(`${qualityLabel(quality)}音质加载超时`)), isWebDavTrack(track) ? 60_000 : 12_000)
      try {
        await Promise.race([aborted, (async () => {
          const { url, fallbackUrl } = await resolvePlaybackUrls(track, quality, controller.signal)
          controller.signal.throwIfAborted()
          if (token !== resolveToken) return
          releaseBlob(); if (url.startsWith('blob:')) blobUrl = url
          audio!.src = url; applyPlaybackRate()
          audio!.addEventListener('loadedmetadata', () => {
            if (token !== resolveToken || controller.signal.aborted) return
            awaitingLoad = false
            if (seekTo > 0) { try { audio!.currentTime = seekTo } catch {} }
            resetClock()
          }, { once:true })
          try { await audio!.play() }
          catch (error) {
            controller.signal.throwIfAborted()
            if (!fallbackUrl || token !== resolveToken) throw error
            logEvent('warn', 'PLAYER', '本机播放缓存不可用，改用原始音频地址', String(error))
            audio!.src = fallbackUrl; applyPlaybackRate(); await audio!.play()
          }
          controller.signal.throwIfAborted()
        })()])
        if (token !== resolveToken) return
        if (index > 0) notify(`自动音质已回落至${qualityLabel(playerState.resolvedQuality)}`)
        break
      } catch (error) {
        if (token !== resolveToken) return
        controller.abort(); detachAudioSource(); releaseBlob()
        if (index === qualities.length - 1) throw error
        awaitingLoad = true; playerState.playing = false; playerState.loading = true
        logEvent('warn', 'PLAYER', `${qualityLabel(quality)}不可用，尝试较低音质`, String(error))
      } finally {
        clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort)
        if (playbackController === controller) playbackController = null
      }
    }
    // 旧请求不再拥有共享 audio，即使新歌曲用了同一 URL 也不能暂停它。
    // 用户主动取消已由 cancelPendingStart() 停止并卸载音源。
    if (token !== resolveToken) return
    clearLoadTimer()
    startPending = false
    playerState.playing = true
    playerState.loading = false
    playerState.error = ''
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
    startPending = false
    detachAudioSource()
    releaseBlob()
    playerState.loading = false
    playerState.playing = false
    if (allowFallback && settingsState.autoSourceFallback) {
      playerState.loading = true
      const fallback = await findFallbackTrack(track, attempted, searched)
      if (token === resolveToken && fallback) {
        const index = playerState.queue.findIndex(
          (item) => item.id === track.id && item.providerId === track.providerId
        )
        if (index >= 0) playerState.queue[index] = fallback
        logEvent(
          'warn',
          'PLAYER',
          `「${track.title}」播放失败，已切换到 ${sourceLabel(fallback)}`,
          `原来源：${sourceLabel(track)} → ${sourceLabel(fallback)}`
        )
        notify(`「${track.title}」播放失败，已切换到 ${sourceLabel(fallback)}`)
        persist()
        await startPlayback(fallback, seekTo, true, undefined, attempted, searched)
        return
      }
      playerState.loading = false
    }
    playerState.error = error?.message ?? '播放失败'
    logEvent(
      'error',
      'PLAYER',
      `播放失败：${track.title} / ${track.artist}`,
      `音源：${track.providerName}\n${error?.stack || error?.message || error}`
    )
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
  // While a start is being prepared, the button means "cancel this start".
  if (startPending) {
    cancelPendingStart()
    updatePositionState()
    return
  }
  // A quality change while paused invalidates the loaded source.
  if (reloadRequired) {
    reloadRequired = false
    await startPlayback(track, playerState.currentTime || 0)
    return
  }
  // After an app restart the restored queue has no audio source. Start the
  // track instead of calling play() on an empty element forever.
  if (!audio.getAttribute('src')) {
    await startPlayback(track, playerState.currentTime || 0)
    return
  }
  if (audio.paused) {
    intentionalPause = false
    autoResumeAttempts = 0
    try {
      await audio.play()
    } catch (error: any) {
      playerState.error = error?.message ?? '播放失败'
      logEvent('error', 'PLAYER', '继续播放失败', error?.stack || error?.message || error)
    }
  } else {
    intentionalPause = true
    audio.pause()
  }
  updatePositionState()
}

export async function resume(): Promise<void> {
  const track = currentTrack()
  if (!audio || !track) return
  // A start is already in flight; don't fall back to the previous source.
  if (startPending) return
  if (reloadRequired) {
    reloadRequired = false
    await startPlayback(track, playerState.currentTime || 0)
    return
  }
  if (!audio.getAttribute('src')) {
    await startPlayback(track, playerState.currentTime || 0)
    return
  }
  if (audio && audio.paused) {
    intentionalPause = false
    autoResumeAttempts = 0
    try {
      await audio.play()
    } catch {}
  }
}

export function pause(): void {
  intentionalPause = true
  cancelPendingStart()
  audio?.pause()
}

export function seek(time: number): void {
  if (!audio) return
  const duration = Number.isFinite(audio.duration) ? audio.duration : playerState.duration
  const value = Math.max(0, Math.min(Number(time) || 0, duration || 0))
  try {
    audio.currentTime = value
    playerState.currentTime = value
    resetClock()
    updateActiveLyric()
    updatePositionState()
    if (currentTrack()) {
      seekBackgroundAudio(value * 1000, (duration || 0) * 1000)
    }
  } catch {}
}

function setVolume(value: number): void {
  const volume = Math.max(0, Math.min(1, Number(value) || 0))
  playerState.volume = volume
  if (audio) audio.volume = volume
  persist()
}

export function setMode(mode: PlayMode): void {
  playerState.mode = mode
  persist()
}

let sleepTimer: ReturnType<typeof setTimeout> | null = null

/** Stops playback after the given number of minutes (0 cancels). */
export function setSleepTimer(minutes: number): void {
  if (sleepTimer) {
    clearTimeout(sleepTimer)
    sleepTimer = null
  }
  playerState.sleepAtTrackEnd = false
  playerState.sleepEndAt = 0
  if (!Number.isFinite(minutes) || minutes <= 0) return
  playerState.sleepEndAt = Date.now() + minutes * 60_000
  sleepTimer = setTimeout(() => {
    sleepTimer = null
    playerState.sleepEndAt = 0
    pause()
  }, minutes * 60_000)
}

/** Stops after the current track instead of advancing the queue. */
export function sleepAfterCurrentTrack(): void {
  if (sleepTimer) {
    clearTimeout(sleepTimer)
    sleepTimer = null
  }
  playerState.sleepEndAt = 0
  playerState.sleepAtTrackEnd = true
}

export function cancelSleepTimer(): void {
  if (sleepTimer) {
    clearTimeout(sleepTimer)
    sleepTimer = null
  }
  playerState.sleepEndAt = 0
  playerState.sleepAtTrackEnd = false
}

export function cycleMode(): void {
  const modes: PlayMode[] = ['order', 'repeat-all', 'repeat-one', 'shuffle']
  setMode(modes[(modes.indexOf(playerState.mode) + 1) % modes.length])
}

export function setQuality(quality: string): void {
  const changed = playerState.quality !== quality
  playerState.quality = quality
  updateSettings({ quality })
  persist()
  if (!changed) return
  const track = currentTrack()
  if (!track) return
  if (playerState.playing || startPending || playerState.loading) {
    void startPlayback(track, startPending ? pendingStartSeek : playerState.currentTime)
  } else if (audio?.getAttribute('src')) {
    // Keep the current position, but reload when playback resumes.
    reloadRequired = true
  }
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
  if (playerState.sleepAtTrackEnd) {
    playerState.sleepAtTrackEnd = false
    pause()
    playerState.playing = false
    return
  }
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
      cancelPendingStart()
      reloadRequired = false
      playerState.index = -1
      detachAudioSource()
      playerState.loading = false
      playerState.error = ''
      playerState.playing = false
      playerState.currentTime = 0
      playerState.duration = 0
      syncBackgroundLyrics(undefined, [])
      stopBackgroundAudio()
    } else {
      playerState.index = Math.min(playerState.index, playerState.queue.length - 1)
      void startPlayback(playerState.queue[playerState.index])
    }
  }
  persist()
}

export function clearQueue(): void {
  cancelPendingStart()
  reloadRequired = false
  playerState.queue = []
  playerState.index = -1
  detachAudioSource()
  playerState.loading = false
  playerState.error = ''
  playerState.playing = false
  playerState.currentTime = 0
  playerState.duration = 0
  releaseBlob()
  syncBackgroundLyrics(undefined, [])
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

/**
 * Normalizes a plugin lyric document into a strict, sorted line timeline.
 *
 * Some plugins omit the line-level start time and only provide word-level
 * timings. Falling back to 0 for every line makes all lines overlap at the
 * beginning, which shows up as a single lyric line looping in the status bar.
 */
function normalizePluginLyrics(document: any): LyricLine[] {
  const offset = Number(document?.offsetMs) || 0
  const source = Array.isArray(document?.lines) ? document.lines : []
  const parsed: LyricLine[] = source
    .filter((line: any) => line && typeof line === 'object')
    .map((line: any): LyricLine => {
      const words = Array.isArray(line.words) ? line.words : []
      const firstWordStart = words
        .map((word: any) => Number(word?.startTimeMs))
        .find((value: number) => Number.isFinite(value))
      const rawStart = Number(line.startTimeMs)
      const lineStart = Number.isFinite(rawStart) ? Math.max(0, rawStart) : 0
      // A missing line start is common; a literal 0 on every line is also
      // common in legacy plugins that only fill word-level timings.
      const startTimeMs = Math.max(
        0,
        (lineStart > 0 || firstWordStart == null || firstWordStart <= 0
          ? lineStart
          : firstWordStart) + offset
      )
      const rawEnd = Number(line.endTimeMs)
      const translation = String(line.translation ?? line.translations?.[0]?.text ?? '').trim()
      // Some plugins only fill the word list and leave the line text empty;
      // dropping those lines makes Lyricon fall back to the first few lines.
      const wordText = words
        .map((word: any) => String(word?.text ?? ''))
        .join('')
        .trim()
      return {
        startTimeMs,
        endTimeMs:
          Number.isFinite(rawEnd) && rawEnd + offset > startTimeMs
            ? Math.max(0, rawEnd + offset)
            : undefined,
        text: String(line.text ?? '').trim() || wordText,
        translation: translation || undefined,
        words: Array.isArray(words) && words.length ? words : undefined
      }
    })
    .filter((line: LyricLine) => Boolean(line.text))
    .sort((a: LyricLine, b: LyricLine) => a.startTimeMs - b.startTimeMs)

  return parsed.map((line: LyricLine, index: number): LyricLine => {
    const next = parsed[index + 1]
    const endTimeMs =
      line.endTimeMs && line.endTimeMs > line.startTimeMs
        ? line.endTimeMs
        : next && next.startTimeMs > line.startTimeMs
          ? next.startTimeMs
          : line.startTimeMs + 5000
    return {
      startTimeMs: line.startTimeMs,
      endTimeMs,
      text: line.text,
      translation: line.translation,
      words: normalizeTimedWords(line.words, line.startTimeMs, endTimeMs, line.text)
    }
  })
}

/** 歌名比较用的宽松形态：去掉空格、标点与常见后缀。 */
function lyricTitleKey(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/\s*-\s*.*$/, '')
    .replace(/[\s\-_/\\()[\]{}（）【】「」《》"'’“”·.,，。!！?？:：;；&+~`|]/g, '')
}

/**
 * 导入歌单里的曲目 ref 可能只是重建出来的（缺少插件内部的额外字段），
 * 直接取歌词会拿空。这里用歌名+歌手再搜一次，拿搜索结果里的完整 ref 重试。
 */
async function lyricsBySearch(provider: ProviderHandle, track: Track): Promise<LyricLine[]> {
  if (!provider.methods.includes('tracks.search') || !provider.methods.includes('tracks.lyrics')) {
    return []
  }
  const query = `${track.title} ${track.artist}`.trim()
  if (!query) return []
  const wanted = lyricTitleKey(track.title)
  let items: any[] = []
  try {
    const result = await invokeProvider(provider, 'tracks.search', [
      { query, kinds: ['track'], filters: {}, limit: 10 }
    ])
    items = Array.isArray(result?.items) ? result.items : []
  } catch {
    return []
  }
  for (const item of items.slice(0, 8)) {
    if (item?.ref?.kind !== 'track') continue
    let candidate: Track
    try {
      candidate = toTrack(item, provider)
    } catch {
      continue
    }
    // 只认歌名一致的，避免把同歌手的另一首歌的歌词贴上来。
    if (!wanted || lyricTitleKey(candidate.title) !== wanted) continue
    try {
      const document = await invokeProvider(provider, 'tracks.lyrics', [candidate.ref])
      const lines = normalizePluginLyrics(document)
      if (lines.length) return lines
    } catch {}
  }
  return []
}

async function loadLyrics(track: Track): Promise<void> {
  const provider = providerForTrack(track)
  playerState.lyricsLoading = true
  playerState.lyrics = []
  playerState.lyricSource = ''
  syncBackgroundLyrics(track, [])
  try {
    if (provider) {
      try {
        const started = Date.now()
        const document = await invokeProvider(provider, 'tracks.lyrics', [track.ref])
        const cost = Date.now() - started
        if (currentTrack()?.id !== track.id) return
        const lines = normalizePluginLyrics(document)
        if (lines.length) {
          playerState.lyrics = lines
          playerState.lyricSource = 'plugin'
          const lastLine = lines[lines.length - 1]
          logEvent(
            'info',
            'LYRIC',
            `歌词已加载：${lines.length} 行`,
            `${lines[0].startTimeMs}ms → ${lastLine.endTimeMs ?? lastLine.startTimeMs}ms；source=plugin；耗时 ${cost}ms`
          )
          syncBackgroundLyrics(track, playerState.lyrics)
          updateActiveLyric()
          return
        }
        const recovered = await lyricsBySearch(provider, track)
        if (currentTrack()?.id !== track.id) return
        if (recovered.length) {
          playerState.lyrics = recovered
          playerState.lyricSource = 'plugin'
          logEvent(
            'info',
            'LYRIC',
            `歌词已加载：${recovered.length} 行`,
            `source=plugin(按歌名重搜)；原 ref 取词为空`
          )
          syncBackgroundLyrics(track, playerState.lyrics)
          updateActiveLyric()
          return
        }
        logEvent(
          'warn',
          'LYRIC',
          '插件没给歌词，改试云端歌词',
          `provider=${provider.providerId}；ref.id=${String((track.ref as any)?.id ?? '')}`
        )
      } catch (error) {
        logEvent(
          'warn',
          'LYRIC',
          '插件取词失败，改试云端歌词',
          `${error instanceof Error ? error.message : String(error)}；provider=${provider.providerId}`
        )
        const recovered = await lyricsBySearch(provider, track)
        if (currentTrack()?.id !== track.id) return
        if (recovered.length) {
          playerState.lyrics = recovered
          playerState.lyricSource = 'plugin'
          logEvent('info', 'LYRIC', `歌词已加载：${recovered.length} 行`, 'source=plugin(按歌名重搜)')
          syncBackgroundLyrics(track, playerState.lyrics)
          updateActiveLyric()
          return
        }
      }
    } else {
      logEvent(
        'warn',
        'LYRIC',
        '这首歌没有可用的音源插件，直接走云端歌词',
        `provider=${track.providerId}；plugin=${track.pluginId ?? ''}`
      )
    }

    if (settingsState.cloudLyrics) {
      const cloud = await matchCloudLyrics(track)
      if (currentTrack()?.id !== track.id) return
      if (cloud?.lines.length) {
        playerState.lyrics = cloud.lines
        playerState.lyricSource = cloud.source
        const cloudLast = cloud.lines[cloud.lines.length - 1]
        logEvent(
          'info',
          'LYRIC',
          `歌词已加载：${cloud.lines.length} 行`,
          `${cloud.lines[0].startTimeMs}ms → ${cloudLast.endTimeMs ?? cloudLast.startTimeMs}ms；source=${cloud.source}`
        )
        syncBackgroundLyrics(track, playerState.lyrics)
        updateActiveLyric()
      } else {
        logEvent(
          'warn',
          'LYRIC',
          '这句也没找到同步歌词',
          `${track.title} / ${track.artist}；歌词共享会保持空白`
        )
      }
    } else {
      logEvent('warn', 'LYRIC', '云端歌词已关闭，且插件没有给出歌词', `${track.title} / ${track.artist}`)
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
  syncBackgroundLyrics(target, [])
  try {
    const cloud = await matchCloudLyrics(target, true)
    if (currentTrack()?.id !== target.id) return
    if (cloud?.lines.length) {
      playerState.lyrics = cloud.lines
      playerState.lyricSource = cloud.source
      syncBackgroundLyrics(target, playerState.lyrics)
      updateActiveLyric()
    }
  } finally {
    if (currentTrack()?.id === target.id) playerState.lyricsLoading = false
  }
}

/** Re-publishes the current lyrics after the sharing settings change. */
export function refreshBackgroundLyrics(): void {
  syncBackgroundLyrics(currentTrack(), playerState.lyrics)
}

export function updateActiveLyric(): void {
  const lines = playerState.lyrics
  if (!lines.length) {
    playerState.activeLyric = -1
    return
  }
  const time = playerState.currentTime * 1000 - (Number(settingsState.lyricOffsetMs) || 0)
  let index = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startTimeMs <= time) index = i
    else break
  }
  playerState.activeLyric = index
}

const HISTORY_KEY = 'ceru.history.v1'
const historyRevision = ref(0)

function addHistory(track: Track): void {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const list: Track[] = raw ? JSON.parse(raw) : []
    if (!Array.isArray(list)) throw new Error('播放记录格式错误')
    const filtered = list.filter(
      (item) => !(item.id === track.id && item.providerId === track.providerId)
    )
    filtered.unshift(track)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered.slice(0, 100)))
    historyRevision.value++
  } catch {
    notify('播放记录保存失败，原记录未修改', 'error')
  }
}

export function getHistory(): Track[] {
  // Consumers such as computed(getHistory) update after every durable write.
  void historyRevision.value
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/** Clear history only; favorites, playlists, audio and queue are untouched. */
export function clearHistory(): boolean {
  try {
    localStorage.removeItem(HISTORY_KEY)
    historyRevision.value++
    return true
  } catch {
    notify('清空播放记录失败，原记录已保留', 'error')
    return false
  }
}

function providerForCurrent(): ProviderHandle | undefined {
  const track = currentTrack()
  return track ? providerForTrack(track) : undefined
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
