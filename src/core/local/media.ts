import { Capacitor, registerPlugin } from '@capacitor/core'
import type { Track } from '../track'
import { localAudioUrl } from '../cache/audioCache'

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
}

interface LocalMediaNative {
  check(): Promise<{ granted: boolean }>
  request(): Promise<{ granted: boolean }>
  scan(): Promise<{ tracks: LocalEntry[] }>
}

const NativeLocalMedia = registerPlugin<LocalMediaNative>('LocalMedia')

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

export async function scanLocalMusic(): Promise<LocalEntry[]> {
  if (!Capacitor.isNativePlatform()) return []
  if (!(await localPermissionGranted())) {
    if (!(await requestLocalPermission())) return []
  }
  try {
    const result = await NativeLocalMedia.scan()
    return Array.isArray(result?.tracks) ? result.tracks : []
  } catch {
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
    artwork: '/default-cover.png',
    qualities: []
  }
}

export async function localTrackUrl(id: string): Promise<string> {
  return localAudioUrl(id)
}
