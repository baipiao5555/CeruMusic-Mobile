import type { Track } from './track'

export function platformId(id: string): string {
  const key = id.replace(/^ceru\./, '')
  return ({ kw:'kuwo', kg:'kugou', tx:'qq', wy:'netease', mg:'migu' } as Record<string,string>)[key] || key
}
export function platformLabel(track: Pick<Track,'providerId'|'providerName'|'platformName'>): string {
  return track.platformName || ({qq:'QQ音乐',kuwo:'酷我音乐',kugou:'酷狗音乐',netease:'网易云音乐',migu:'咪咕音乐'} as Record<string,string>)[platformId(track.providerId)] || track.providerName || track.providerId
}
export function sourceLabel(track: Track): string {
  const platform = platformLabel(track)
  return platform === track.providerName ? platform : `${platform} · ${track.providerName}`
}
export function sourceKey(track: Pick<Track,'pluginId'|'providerId'>): string { return JSON.stringify([track.pluginId,track.providerId]) }
export function trackKey(track: Track): string { return JSON.stringify([track.pluginId,track.providerId,track.id]) }
function normalize(value: string): string { return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'') }
function artist(value: string): string { return String(value || '').split(/[\/、&;,，；]/).map(normalize).filter(Boolean).sort().join('|') }
/** Exact title/performer, with duration protection: covers, live/remix/伴奏 remain separate. */
export function sameRecording(a: Track, b: Track): boolean {
  if (trackKey(a) === trackKey(b)) return true
  if (['local','webdav'].includes(a.pluginId) || ['local','webdav'].includes(b.pluginId)) return false
  const performer = artist(a.artist)
  if (!normalize(a.title) || normalize(a.title) !== normalize(b.title) || !performer || /未知|unknown/.test(performer) || performer !== artist(b.artist)) return false
  if (a.durationMs > 0 && b.durationMs > 0) return Math.abs(a.durationMs-b.durationMs) <= 8000
  return Boolean(normalize(a.album) && normalize(a.album) === normalize(b.album))
}
function flat(track: Track): Track { const { alternatives: _sources, ...copy } = track; return copy }
export function sourcesOf(track: Track): Track[] {
  const seen = new Set<string>()
  return [track,...(track.alternatives || [])].filter(t => { const key=trackKey(t); if(seen.has(key))return false;seen.add(key);return true }).map(flat)
}
export function withSources(selected: Track, sources: Track[]): Track {
  const distinct = sourcesOf({ ...selected, alternatives:sources })
  return { ...flat(selected), alternatives: distinct.length > 1 ? distinct : undefined }
}
/** Only a UI/playback bundle: original refs, files, favorites and plugin records are untouched. */
export function groupTracks(input: Track[], preferred?: {pluginId:string;providerId:string}): Track[] {
  const groups: Track[][] = []
  for (const track of input) for (const item of sourcesOf(track)) {
    const existing = groups.find(g => sameRecording(g[0],item))
    if (existing) { if (!existing.some(t=>trackKey(t)===trackKey(item))) existing.push(item) }
    else groups.push([item])
  }
  return groups.map(sources => {
    const representative = sources.find(t=>t.pluginId===preferred?.pluginId&&t.providerId===preferred?.providerId) || sources[0]
    const art = sources.find(t=>t.artwork&&t.artwork!=='/default-cover.png')?.artwork
    return { ...withSources(representative,sources), artwork:art || representative.artwork }
  })
}
