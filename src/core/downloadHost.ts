import { registerHostHooks } from './plugin/manager'
import { getHistory, playerState } from './playback/player'
import { libraryState } from './library'
import {
  cancelTask,
  downloadState,
  downloadTrack,
  retryTask,
  type DownloadTask
} from './downloads'
import type { Track } from './track'

function knownTracks(): Track[] {
  return [
    ...playerState.queue,
    ...getHistory(),
    ...libraryState.favorites,
    ...libraryState.playlists.flatMap((playlist) => playlist.tracks)
  ]
}

function findTrack(ref: any): Track | undefined {
  if (!ref || ref.kind !== 'track') return undefined
  return knownTracks().find(
    (track) =>
      track.id === String(ref.id) &&
      track.providerId === ref.providerId &&
      (!ref.pluginId || !track.pluginId || track.pluginId === ref.pluginId)
  )
}

function toSdkTask(task: DownloadTask): Record<string, any> {
  const status =
    task.status === 'downloading'
      ? 'running'
      : task.status === 'failed'
        ? 'failed'
        : task.status
  return {
    id: task.id,
    track: task.track.ref,
    status,
    receivedBytes: task.received,
    totalBytes: task.total > 0 ? task.total : undefined,
    error: task.error || undefined
  }
}

export function registerDownloadHostHooks(): void {
  registerHostHooks({
    downloads: {
      list: () => downloadState.tasks.map(toSdkTask),
      create: (args: any[]) => {
        const request = args?.[0] ?? {}
        const refs: any[] = Array.isArray(request.tracks) ? request.tracks : []
        const tasks: Record<string, any>[] = []
        for (const ref of refs) {
          const track = findTrack(ref)
          if (!track) continue
          tasks.push(toSdkTask(downloadTrack(track, request.quality ?? '')))
        }
        if (!tasks.length) throw new Error('没有找到可下载的歌曲，请先在应用内播放或收藏')
        return tasks
      },
      pause: (args: any[]) => {
        for (const id of args?.[0] ?? []) void cancelTask(String(id))
        return null
      },
      cancel: (args: any[]) => {
        for (const id of args?.[0] ?? []) void cancelTask(String(id))
        return null
      },
      resume: (args: any[]) => {
        for (const id of args?.[0] ?? []) retryTask(String(id))
        return null
      },
      retry: (args: any[]) => {
        for (const id of args?.[0] ?? []) retryTask(String(id))
        return null
      },
      reveal: () => {
        throw new Error('手机版无法打开系统文件管理器')
      }
    }
  })
}
