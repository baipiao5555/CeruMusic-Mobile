import { reactive } from 'vue'
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { resolveTrackSource } from './playback/source'
import { settingsState } from './settings'
import type { Track } from './track'
import { Downloader, type DownloadProgressEvent } from './native/plugins'

export type DownloadStatus = 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled'

export interface DownloadTask {
  id: string
  track: Track
  quality: string
  status: DownloadStatus
  progress: number
  received: number
  total: number
  fileName: string
  path: string
  size: number
  error: string
  createdAt: number
  blobUrl?: string
}

const STORAGE_KEY = 'ceru.downloads.v1'
const DEFAULT_CONCURRENT = 2
const AUDIO_EXTENSIONS = ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'wma']

export const downloadState = reactive({
  tasks: [] as DownloadTask[],
  ready: false,
  active: 0
})

let listenerReady = false
const pending: string[] = []
let activeCount = 0

function persist(): void {
  try {
    const data = downloadState.tasks.map(({ blobUrl, ...task }) => task)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {}
}

function findTask(id: string): DownloadTask | undefined {
  return downloadState.tasks.find((task) => task.id === id)
}

export function taskFor(track: Track): DownloadTask | undefined {
  return downloadState.tasks.find(
    (task) => task.track.id === track.id && task.track.providerId === track.providerId
  )
}

export function completedTaskFor(track: Track): DownloadTask | undefined {
  const task = taskFor(track)
  return task?.status === 'completed' ? task : undefined
}

export function isDownloaded(track: Track): boolean {
  return Boolean(completedTaskFor(track))
}

export function isDownloading(track: Track): boolean {
  const task = taskFor(track)
  return task?.status === 'queued' || task?.status === 'downloading'
}

/** Local file URL for offline playback, empty when the track is not downloaded. */
export function localUrlFor(track: Track): string {
  const task = completedTaskFor(track)
  if (!task) return ''
  if (task.blobUrl) return task.blobUrl
  if (!task.path) return ''
  return Capacitor.convertFileSrc(task.path)
}

function sanitizeFileName(value: string): string {
  return (
    value
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 100) || 'audio'
  )
}

function extensionFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname
    const match = path.match(/\.([A-Za-z0-9]{2,4})$/)
    const extension = match?.[1]?.toLowerCase()
    if (extension && AUDIO_EXTENSIONS.includes(extension)) return extension
  } catch {}
  return ''
}

function buildFileName(track: Track, url: string, quality: string): string {
  const extension =
    extensionFromUrl(url) ||
    (quality.includes('flac') || quality === 'lossless' ? 'flac' : 'mp3')
  const artist = track.artist && track.artist !== '未知歌手' ? track.artist : ''
  const base = sanitizeFileName(artist ? `${artist} - ${track.title}` : track.title)
  return `${base}.${extension}`
}

export async function initDownloads(): Promise<void> {
  if (downloadState.ready) return
  downloadState.ready = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const saved = JSON.parse(raw)
      if (Array.isArray(saved)) {
        downloadState.tasks = saved.map((task: DownloadTask) => ({
          ...task,
          progress: task.status === 'completed' ? 1 : 0,
          received: task.received ?? 0,
          total: task.total ?? 0
        }))
      }
    }
  } catch {
    downloadState.tasks = []
  }
  for (const task of downloadState.tasks) {
    if (task.status === 'downloading' || task.status === 'queued') {
      task.status = 'failed'
      task.error = '上次下载被中断'
    }
  }
  if (Capacitor.isNativePlatform() && !listenerReady) {
    listenerReady = true
    void Downloader.addListener('progress', (event: DownloadProgressEvent) => {
      const task = findTask(event.id)
      if (!task || task.status !== 'downloading') return
      task.received = event.received
      task.total = event.total
      task.progress =
        event.total > 0 ? Math.min(0.99, event.received / event.total) : 0
    })
  }
  persist()
  void verifyFiles()
}

async function verifyFiles(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  for (const task of downloadState.tasks) {
    if (task.status !== 'completed' || !task.fileName) continue
    try {
      await Filesystem.stat({
        path: 'Music/' + task.fileName,
        directory: Directory.External
      })
    } catch {
      task.status = 'failed'
      task.error = '文件已被删除'
      task.path = ''
      task.progress = 0
    }
  }
  persist()
}

function enqueue(id: string): void {
  if (!pending.includes(id)) pending.push(id)
  pump()
}

function concurrencyLimit(): number {
  const value = Number(settingsState.downloadConcurrency)
  return Math.max(1, Math.min(3, Number.isFinite(value) && value > 0 ? value : DEFAULT_CONCURRENT))
}

function pump(): void {
  const limit = concurrencyLimit()
  while (activeCount < limit) {
    const id = pending.shift()
    if (!id) break
    const task = findTask(id)
    if (!task || task.status !== 'queued') continue
    activeCount += 1
    downloadState.active = activeCount
    void runTask(task)
      .finally(() => {
        activeCount -= 1
        downloadState.active = activeCount
        pump()
      })
  }
}

async function runTask(task: DownloadTask): Promise<void> {
  task.status = 'downloading'
  task.error = ''
  task.progress = 0
  task.received = 0
  task.total = 0
  persist()
  try {
    const source = await resolveTrackSource(task.track, task.quality)
    if (!Capacitor.isNativePlatform()) {
      const response = await fetch(source.url, { headers: source.headers })
      if (!response.ok) throw new Error(`下载失败: HTTP ${response.status}`)
      const blob = await response.blob()
      task.blobUrl = URL.createObjectURL(blob)
      task.status = 'completed'
      task.progress = 1
      task.size = blob.size
      task.received = blob.size
      task.total = blob.size
      return
    }
    const fileName = buildFileName(task.track, source.url, task.quality)
    task.fileName = fileName
    const result = await Downloader.download({
      id: task.id,
      url: source.url,
      fileName,
      headers: source.headers
    })
    task.fileName = result.fileName
    task.path = result.path
    task.size = result.size
    task.received = result.size
    task.total = result.size
    task.progress = 1
    task.status = 'completed'
  } catch (error: any) {
    if ((task.status as DownloadStatus) === 'cancelled') return
    task.status = 'failed'
    task.error = error?.message ?? '下载失败'
  } finally {
    persist()
  }
}

export function downloadTrack(
  track: Track,
  quality = settingsState.downloadQuality || settingsState.quality
): DownloadTask {
  const existing = taskFor(track)
  if (existing && existing.status === 'completed') return existing
  if (existing && (existing.status === 'downloading' || existing.status === 'queued')) {
    return existing
  }
  if (existing) {
    existing.status = 'queued'
    existing.quality = quality
    existing.error = ''
    existing.progress = 0
    existing.received = 0
    existing.total = 0
    persist()
    enqueue(existing.id)
    return existing
  }
  const task: DownloadTask = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    track,
    quality,
    status: 'queued',
    progress: 0,
    received: 0,
    total: 0,
    fileName: '',
    path: '',
    size: 0,
    error: '',
    createdAt: Date.now()
  }
  downloadState.tasks.unshift(task)
  persist()
  enqueue(task.id)
  return task
}

export function downloadTracks(
  tracks: Track[],
  quality = settingsState.downloadQuality || settingsState.quality
): number {
  let started = 0
  for (const track of tracks) {
    const task = taskFor(track)
    if (task?.status === 'completed') continue
    downloadTrack(track, quality)
    started += 1
  }
  return started
}

export async function cancelTask(id: string): Promise<void> {
  const task = findTask(id)
  if (!task) return
  if (task.status === 'completed') return
  task.status = 'cancelled'
  task.error = '已取消'
  const index = pending.indexOf(id)
  if (index >= 0) pending.splice(index, 1)
  if (Capacitor.isNativePlatform()) {
    try {
      await Downloader.cancel({ id })
    } catch {}
  }
  persist()
}

export function retryTask(id: string): void {
  const task = findTask(id)
  if (!task) return
  task.status = 'queued'
  task.error = ''
  task.progress = 0
  task.received = 0
  task.total = 0
  persist()
  enqueue(id)
}

export async function removeTask(id: string, deleteFile = true): Promise<void> {
  const index = downloadState.tasks.findIndex((task) => task.id === id)
  if (index < 0) return
  const [task] = downloadState.tasks.splice(index, 1)
  if (task.blobUrl) URL.revokeObjectURL(task.blobUrl)
  if (deleteFile && task.fileName && Capacitor.isNativePlatform()) {
    try {
      await Downloader.delete({ fileName: task.fileName })
    } catch {}
  }
  persist()
}

export async function clearCompleted(): Promise<void> {
  const completed = downloadState.tasks.filter((task) => task.status === 'completed')
  for (const task of completed) await removeTask(task.id, true)
}

export function downloadSummary(): { total: number; completed: number; active: number; failed: number } {
  const tasks = downloadState.tasks
  return {
    total: tasks.length,
    completed: tasks.filter((task) => task.status === 'completed').length,
    active: tasks.filter((task) => task.status === 'downloading' || task.status === 'queued').length,
    failed: tasks.filter((task) => task.status === 'failed').length
  }
}
