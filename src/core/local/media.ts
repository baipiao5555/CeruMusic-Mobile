import { Capacitor, registerPlugin } from '@capacitor/core'
import { reactive } from 'vue'
import type { Track } from '../track'
import { localAudioUrl } from '../cache/audioCache'
import { downloadState } from '../downloads'

/**
 * 本机音乐（Android）。
 *
 * 原生用 MediaStore 扫设备上的音频，只取元数据；播放时由本机小服务
 * 按 MediaStore id 直出 content:// 流，WebView 的 audio 就能拖进度、
 * 也不需要把整首歌复制到应用目录。
 *
 * 网页环境没有这个插件，扫描返回空数组，界面给出说明而不是报错。
 */
export interface LocalEntry {
  id: string
  title: string
  artist: string
  album: string
  durationMs: number
  size: number
  mime: string
  uri?: string
  artwork?: string
  origin?: 'download' | 'folder' | 'media'
  relativePath?: string
  isMusic?: boolean
  isRecording?: boolean
  isTone?: boolean
}

interface LocalMediaNative {
  check(): Promise<{ granted: boolean }>
  request(): Promise<{ granted: boolean }>
  scan(options?: { source?: 'all' | 'folders' }): Promise<{ tracks: LocalEntry[]; granted?: boolean; error?: string }>
}

const NativeLocalMedia = registerPlugin<LocalMediaNative>('LocalMedia')
export const localScanState = reactive({ granted: false, error: '' })

/** 本机曲目统一挂在这个虚拟音源下，播放时由 source.ts 直接给代理地址。 */
export const LOCAL_PLUGIN_ID = 'local'
export const LOCAL_PROVIDER_ID = 'local'
export const LOCAL_PROVIDER_NAME = '本机音乐'

export function isLocalTrack(track: Track | undefined): boolean {
  return Boolean(track && track.pluginId === LOCAL_PLUGIN_ID)
}

export async function localPermissionGranted(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const result = await NativeLocalMedia.check()
    return Boolean(result?.granted)
  } catch {
    return false
  }
}

export async function requestLocalPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const result = await NativeLocalMedia.request()
    return Boolean(result?.granted)
  } catch {
    return false
  }
}

export async function scanLocalMusic(options: { requestPermission?: boolean; source?: 'all' | 'folders' } = {}): Promise<LocalEntry[]> {
  if (!Capacitor.isNativePlatform()) return []
  localScanState.error = ''
  localScanState.granted = await localPermissionGranted()
  if (!localScanState.granted && options.requestPermission !== false && options.source === 'all') {
    localScanState.granted = await requestLocalPermission()
  }
  try {
    // App-owned downloads need no READ_MEDIA_AUDIO permission and are absent from MediaStore.
    const result = await NativeLocalMedia.scan({ source: options.source || 'folders' })
    if (typeof result?.granted === 'boolean') localScanState.granted = result.granted
    localScanState.error = result?.error || ''
    const found = Array.isArray(result?.tracks) ? result.tracks : []
    const normalize = (value: string) => {
      try { return decodeURIComponent(value.replace(/^file:\/+/, '/')) } catch { return value }
    }
    const seen = new Set<string>()
    return found.filter(entry => {
      let identity = entry.uri ? normalize(entry.uri) : entry.id
      if (entry.uri?.startsWith('content://') && entry.uri.includes('/document/')) {
        try { const url = new URL(entry.uri); identity = url.hostname + ':' + decodeURIComponent(url.pathname.split('/document/').pop()!) } catch { /* Keep other valid entries if a provider has malformed encoding. */ }
      }
      if (seen.has(identity)) return false; seen.add(identity); return true
    }).map(entry => {
      if (!entry.uri) return entry
      const download = downloadState.tasks.find(task => task.status === 'completed' && task.path &&
        normalize(task.path) === normalize(entry.uri!) && task.track)
      if (!download) return entry
      return { ...entry, title: download.track.title || entry.title, artist: download.track.artist || entry.artist,
        album: download.track.album || entry.album, durationMs: entry.durationMs || download.track.durationMs,
        artwork: download.track.artwork, origin: 'download' as const }
    })
  } catch (error: any) {
    localScanState.error = error?.message || '本机扫描失败，请重试'
    return []
  }
}

/** MediaStore 条目 → 播放器认识的 Track。 */
export function localEntryToTrack(entry: LocalEntry): Track {
  return {
    id: entry.id,
    providerId: LOCAL_PROVIDER_ID,
    providerName: LOCAL_PROVIDER_NAME,
    pluginId: LOCAL_PLUGIN_ID,
    ref: { providerId: LOCAL_PROVIDER_ID, kind: 'local', id: entry.id },
    title: entry.title || '未命名曲目',
    artist: entry.artist || '未知歌手',
    album: entry.album || '',
    durationMs: Number(entry.durationMs) || 0,
    artwork: entry.artwork || '/default-cover.png',
    localPath: entry.uri,
    qualities: []
  }
}

export async function localTrackUrl(id: string): Promise<string> {
  return localAudioUrl(id)
}
