import { Capacitor } from '@capacitor/core'
import { allProviders, invokeProvider, type ProviderHandle } from '../plugin/manager'
import { selectPlaybackQuality } from '../quality'
import type { Track } from '../track'

export function providerForTrack(track: Track): ProviderHandle | undefined {
  return (
    allProviders().find(
      (provider) =>
        provider.providerId === track.providerId && provider.pluginId === track.pluginId
    ) ?? allProviders().find((provider) => provider.providerId === track.providerId)
  )
}

export interface TrackSource {
  url: string
  headers?: Record<string, string>
}

/** Asks the owning plugin for a playable/downloadable URL. */
export async function resolveTrackSource(
  track: Track,
  requestedQuality = ''
): Promise<TrackSource> {
  const provider = providerForTrack(track)
  if (!provider) throw new Error('音源插件未启用')
  const order = provider.qualities.length ? provider.qualities : track.qualities
  const available = track.qualities.length ? track.qualities : provider.qualities
  const quality = selectPlaybackQuality(order, available, requestedQuality)
  const result = await invokeProvider(provider, 'tracks.resolve', [track.ref, quality])
  if (!result?.ok) throw new Error(result?.error?.message || '无法获取播放地址')
  return { url: result.url, headers: result.requestHeaders }
}

/** Returns a URL the <audio> element can load, downloading to a blob when headers are needed. */
export async function playableUrl(track: Track, requestedQuality = ''): Promise<string> {
  const source = await resolveTrackSource(track, requestedQuality)
  if (source.headers && Object.keys(source.headers).length) {
    return fetchWithHeaders(source.url, source.headers)
  }
  return source.url
}

async function fetchWithHeaders(url: string, headers: Record<string, string>): Promise<string> {
  const { CapacitorHttp } = await import('@capacitor/core')
  if (!Capacitor.isNativePlatform()) {
    const response = await fetch(url, { headers })
    if (!response.ok) throw new Error('音频下载失败: HTTP ' + response.status)
    return URL.createObjectURL(await response.blob())
  }
  const response = await CapacitorHttp.request({
    url,
    method: 'GET',
    headers,
    responseType: 'arraybuffer'
  })
  if (response.status < 200 || response.status >= 300) {
    throw new Error('音频下载失败: HTTP ' + response.status)
  }
  let blob: Blob
  if (response.data instanceof ArrayBuffer) {
    blob = new Blob([response.data], { type: 'audio/mpeg' })
  } else if (typeof response.data === 'string') {
    const binary = atob(response.data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    blob = new Blob([bytes], { type: 'audio/mpeg' })
  } else {
    blob = new Blob([JSON.stringify(response.data)], { type: 'audio/mpeg' })
  }
  return URL.createObjectURL(blob)
}
