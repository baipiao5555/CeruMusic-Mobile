import { invokeProvider, pluginState } from './plugin/manager'
import { providerForTrack } from './playback/source'
import { validateRemoteUrl } from './plugin/network'
import { sourcesOf } from './trackGrouping'
import type { Track } from './track'
import { isLocalTrack, localTrackArtwork } from './local/media'

export function safeArtworkUrl(value: unknown): string {
  if (typeof value !== 'string' || !value || value === '/default-cover.png') return ''
  if (/^\/[^/]/.test(value)) return value
  try {
    const url = validateRemoteUrl(value.trim().replace(/^\/\//, 'https://').replace(/^http:/i, 'https:').replace(/\{size\}/g, '500'))
    const origin=/^img([1-4])\.(?:kwcdn|sycdn)\.kuwo\.cn$/i.exec(url.hostname)
    if(origin)url.hostname='img'+origin[1]+'.kuwo.cn'
    return url.href
  } catch { return '' }
}
const cache = new Map<string, Promise<string>>()
/** Lazy, owner-scoped artwork lookup. Failures never prevent song search or playback. */
export function resolveTrackArtwork(track: Track, force = false): Promise<string> {
  const existing = safeArtworkUrl(track.artwork)
  if (existing && !force) return Promise.resolve(existing)
  if (isLocalTrack(track)) return localTrackArtwork(track, force)
  if (force) { const alternative=sourcesOf(track).map(t=>safeArtworkUrl(t.artwork)).find(url=>url&&url!==existing);if(alternative)return Promise.resolve(alternative) }
  const provider = providerForTrack(track)
  if (!provider?.methods.includes('tracks.artwork')) return Promise.resolve('')
  const key = JSON.stringify([track.pluginId, track.providerId, track.id, pluginState.plugins.find(p => p.pluginId === track.pluginId)?.artifactSha256 || 'legacy', force])
  if (!cache.has(key)) {
    const isLx = pluginState.plugins.some(p => p.pluginId === track.pluginId && p.format === 'lx')
    const result = invokeProvider(provider, 'tracks.artwork', isLx && force ? [track.ref, {ignoreSupplied:true}] : [track.ref]).then(value => safeArtworkUrl(typeof value === 'string' ? value : value?.url)).catch(() => '').then(url => { if (!url && cache.get(key) === result) cache.delete(key); return url })
    cache.set(key, result)
    if (cache.size > 300) cache.delete(cache.keys().next().value!)
  }
  return cache.get(key)!
}
