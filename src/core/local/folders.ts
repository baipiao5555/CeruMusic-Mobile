import { Capacitor, registerPlugin } from '@capacitor/core'
import { reactive } from 'vue'

export interface MusicFolder { uri: string; label: string; available: boolean }
interface MusicFoldersNative {
  get(): Promise<{ folders: MusicFolder[]; download: MusicFolder & { isDefault: boolean } }>
  pick(options: { mode: 'scan' | 'download' }): Promise<{ cancelled: boolean; uri?: string; label?: string }>
  removeScanFolder(options: { uri: string }): Promise<void>
  resetDownloadFolder(): Promise<void>
}
const Native = registerPlugin<MusicFoldersNative>('MusicFolders')
export const musicFoldersState = reactive({
  folders: [] as MusicFolder[],
  download: { uri: '', label: '内部存储 / Music / CeruMusic', available: true, isDefault: true },
  busy: false, error: ''
})
export async function refreshMusicFolders(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try { const result = await Native.get(); if (!Array.isArray(result?.folders) || !result.download || typeof result.download.label !== 'string') throw new Error('文件夹接口返回了无效数据'); musicFoldersState.folders = result.folders; musicFoldersState.download = result.download; musicFoldersState.error = '' }
  catch (error: any) { musicFoldersState.error = error?.message || '无法读取文件夹设置' }
}
export async function pickMusicFolder(mode: 'scan' | 'download'): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || musicFoldersState.busy) return false
  musicFoldersState.busy = true; musicFoldersState.error = ''
  try { const result = await Native.pick({ mode }); if (result.cancelled) return false; await refreshMusicFolders(); return true }
  catch (error: any) { musicFoldersState.error = error?.message || '文件夹选择失败'; return false }
  finally { musicFoldersState.busy = false }
}
export async function removeScanFolder(uri: string): Promise<boolean> {
  try { await Native.removeScanFolder({ uri }); await refreshMusicFolders(); return true }
  catch (error: any) { musicFoldersState.error = error?.message || '无法移除扫描文件夹'; return false }
}
export async function resetDownloadFolder(): Promise<void> {
  try { await Native.resetDownloadFolder(); await refreshMusicFolders() }
  catch (error: any) { musicFoldersState.error = error?.message || '无法恢复默认下载位置' }
}
