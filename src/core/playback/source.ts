import { Capacitor } from '@capacitor/core'
import { allProviders, invokeProvider, type ProviderHandle } from '../plugin/manager'
import { playbackQualityCandidates } from '../quality'
import { localAudioUrl } from '../cache/audioCache'
import type { Track } from '../track'
import { isWebDavTrack, resolveWebDavTrackSource } from '../sync/webdavMedia'

export function providerForTrack(track: Track): ProviderHandle | undefined {
  const all = allProviders(true)
  const exact = all.find(p => p.providerId === track.providerId && p.pluginId === track.pluginId)
  return exact || (!track.pluginId ? allProviders().find(p => p.providerId === track.providerId) : undefined)
}

export interface TrackSource {
  url: string
  headers?: Record<string, string>
  quality?: string
}

/** Intersect the owning source capabilities with the song, never advertise unsupported tiers. */
export function trackQualityCandidates(track: Track, requested = ''): Array<string | undefined> {
  const provider = providerForTrack(track)
  if (!provider) throw new Error('音源插件未启用')
  const order = provider.qualities.length ? provider.qualities : track.qualities
  const available = provider.qualities.length && track.qualities.length ? provider.qualities.filter(q => track.qualities.includes(q)) : track.qualities.length ? track.qualities : provider.qualities
  if (order.length && track.qualities.length && !available.length) throw new Error('歌曲与音源没有共同支持的音质')
  return playbackQualityCandidates(order, available, requested)
}
/** Auto URL acquisition falls back too, so download and playback do not have conflicting rules. */
export async function resolveTrackSource(track: Track, requestedQuality = '', signal?: AbortSignal): Promise<TrackSource> {
  signal?.throwIfAborted()
  if (isWebDavTrack(track)) return resolveWebDavTrackSource(track)
  if (track.pluginId === 'local') {
    if (track.localPath) return { url: Capacitor.convertFileSrc(track.localPath), quality:'local' }
    const url = await localAudioUrl(track.id)
    if (!url) throw new Error('本机音乐服务没有启动')
    return { url, quality:'local' }
  }
  const provider = providerForTrack(track)
  if (!provider) throw new Error('音源插件未启用')
  let failure: unknown
  for (const quality of trackQualityCandidates(track, requestedQuality)) {
    signal?.throwIfAborted()
    try {
      const result = await invokeProvider(provider, 'tracks.resolve', [track.ref, quality], signal)
      signal?.throwIfAborted()
      if (!result?.ok || typeof result.url !== 'string' || !result.url) throw new Error(result?.error?.message || '无法获取播放地址')
      return { url: result.url, headers: result.requestHeaders, quality }
    } catch (error) { signal?.throwIfAborted(); failure = error }
  }
  throw failure || new Error('没有可用的音质')
}
export async function playableSource(track: Track, requestedQuality = '', signal?: AbortSignal): Promise<TrackSource> {
  const source = await resolveTrackSource(track, requestedQuality, signal)
  signal?.throwIfAborted()
  if (source.headers && Object.keys(source.headers).length) return { ...source, url:await fetchWithHeaders(source.url, source.headers, signal) }
  return source
}
export async function playableUrl(track: Track, requestedQuality = ''): Promise<string> {
  return (await playableSource(track, requestedQuality)).url
}

async function fetchWithHeaders(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<string> {
  const { CapacitorHttp } = await import('@capacitor/core')
  if (!Capacitor.isNativePlatform()) {
    const response = await fetch(url, { headers, signal })
    if (!response.ok) throw new Error('音频下载失败: HTTP ' + response.status)
    const blob = await response.blob(); signal?.throwIfAborted()
    signal?.throwIfAborted()
  return URL.createObjectURL(blob)
  }
  const response = await CapacitorHttp.request({
    url,
    method: 'GET',
    headers,
    responseType: 'arraybuffer'
  })
  signal?.throwIfAborted()
  if (response.status < 200 || response.status >= 300) {
    throw new Error('音频下载失败: HTTP ' + response.status)
  }
  const suppliedType = String(Object.entries(response.headers ?? {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1] || '').split(';')[0].trim().toLowerCase()
  const mime = ({'audio/x-flac':'audio/flac','audio/x-wav':'audio/wav','audio/x-m4a':'audio/mp4','audio/m4a':'audio/mp4'} as Record<string,string>)[suppliedType] || (/^(audio\/|video\/(mp4|webm))/.test(suppliedType) ? suppliedType : 'application/octet-stream')
  let blob: Blob
  if (response.data instanceof ArrayBuffer) {
    blob = new Blob([response.data], { type: mime })
  } else if (ArrayBuffer.isView(response.data)) {
    const bytes = new Uint8Array(response.data.buffer, response.data.byteOffset, response.data.byteLength).slice()
    blob = new Blob([bytes], { type: mime })
  } else if (typeof response.data === 'string') {
    const binary = atob(response.data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    blob = new Blob([bytes], { type: mime })
  } else {
    throw new Error('原生音频响应不是有效的二进制数据')
  }
  signal?.throwIfAborted()
  return URL.createObjectURL(blob)
}
