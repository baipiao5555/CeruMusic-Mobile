import type { LocalEntry } from './media'

export interface LocalMusicFilter { mode: 'music' | 'all'; excludeRecordings: boolean; excludeTones: boolean; minSeconds: number }
export const DEFAULT_MUSIC_FILTER: LocalMusicFilter = { mode:'music', excludeRecordings:true, excludeTones:true, minSeconds:30 }
export const MUSIC_FILTER_KEY = 'ceru.local.musicFilter.v1'
export function normalizeMusicFilter(value: any): LocalMusicFilter {
  return { mode:value?.mode === 'all' ? 'all' : 'music', excludeRecordings:value?.excludeRecordings !== false,
    excludeTones:value?.excludeTones !== false, minSeconds:[0,30,60].includes(value?.minSeconds) ? value.minSeconds : 30 }
}
export function localMusicExclusion(entry: LocalEntry, filter: LocalMusicFilter): 'recording' | 'tone' | 'short' | '' {
  // Explicit app downloads are intentional music selections, including short tracks.
  if (filter.mode === 'all' || entry.origin === 'download') return ''
  let path = entry.relativePath || entry.uri || ''
  try { path = decodeURIComponent(path) } catch { /* Provider encoding must not discard other valid files. */ }
  const recordingPath = /(?:^|[/:])(?:recordings?|recorder|callrecords?|callrecordings?|callrec|phonerecord|soundrecorder|voicerecorder|录音|通话录音|录音机)(?:\/|$)/i.test(path)
  const tonePath = /(?:^|[/:])(?:ringtones?|notifications?|alarms?)(?:\/|$)/i.test(path)
  const phoneTimestamp = /^\+?\d{6,15}[ _-]+\d{4}-\d{2}-\d{2}[ _-]+\d{2}[-_:]\d{2}[-_:]\d{2}(?:\.[a-z0-9]+)?$/i.test(entry.title.trim())
  if (filter.excludeTones && (entry.isTone === true || tonePath)) return 'tone'
  if (filter.excludeRecordings && (entry.isRecording === true || phoneTimestamp || (entry.isMusic !== true && recordingPath))) return 'recording'
  if (filter.minSeconds > 0 && entry.durationMs > 0 && entry.durationMs < filter.minSeconds * 1000) return 'short'
  // Unknown artist, unknown duration or IS_MUSIC=false alone are not enough to reject a song.
  return ''
}
export function filterLocalMusic(entries: LocalEntry[], filter: LocalMusicFilter): {items:LocalEntry[]; hidden:LocalEntry[]; counts:{recording:number;tone:number;short:number}} {
  const items:LocalEntry[]=[], hidden:LocalEntry[]=[], counts={recording:0,tone:0,short:0}
  for (const entry of entries) { const reason=localMusicExclusion(entry,filter); if(reason){hidden.push(entry);counts[reason]++}else items.push(entry) }
  return {items,hidden,counts}
}
