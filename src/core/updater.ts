import { reactive } from 'vue'
import { Capacitor } from '@capacitor/core'
import { httpRequest } from './net'
import { Downloader, External, type DownloadProgressEvent } from './native/plugins'
import { notify } from './plugin/manager'

/**
 * 应用内更新：读取本仓库的 GitHub Release，和当前版本比较，
 * 下载 APK 后交给系统安装器覆盖安装（同一签名）。
 */
const REPO = 'baipiao5555/CeruMusic-Mobile'
const RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`
const STORAGE_KEY = 'ceru.update.v1'
const CHECK_INTERVAL = 12 * 60 * 60 * 1000

export interface ReleaseInfo {
  tag: string
  name: string
  body: string
  url: string
  publishedAt: string
  apkUrl: string
  apkName: string
  apkSize: number
}

interface StoredUpdate {
  autoCheck: boolean
  ignoredTag: string
  lastChecked: number
  latest: ReleaseInfo | null
}

export const updateState = reactive({
  currentVersion: __APP_VERSION__,
  checking: false,
  downloading: false,
  installing: false,
  progress: 0,
  latest: null as ReleaseInfo | null,
  hasUpdate: false,
  ignoredTag: '',
  autoCheck: true,
  lastChecked: 0,
  error: '',
  downloadedFileName: '',
  needsPermission: false
})

let progressBound = false

function persist(): void {
  try {
    const data: StoredUpdate = {
      autoCheck: updateState.autoCheck,
      ignoredTag: updateState.ignoredTag,
      lastChecked: updateState.lastChecked,
      latest: updateState.latest
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {}
}

function restore(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw) as StoredUpdate
    if (typeof saved.autoCheck === 'boolean') updateState.autoCheck = saved.autoCheck
    if (typeof saved.ignoredTag === 'string') updateState.ignoredTag = saved.ignoredTag
    if (Number.isFinite(saved.lastChecked)) updateState.lastChecked = saved.lastChecked
    if (saved.latest?.tag) updateState.latest = saved.latest
    refreshHasUpdate()
  } catch {}
}

function versionSegments(value: string): number[] {
  return (value.replace(/^v/i, '').match(/\d+/g) ?? []).map((part) => Number(part))
}

/** > 0 when a is newer than b. */
export function compareVersions(a: string, b: string): number {
  const left = versionSegments(a)
  const right = versionSegments(b)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function refreshHasUpdate(): void {
  updateState.hasUpdate = Boolean(
    updateState.latest &&
      updateState.latest.tag !== updateState.ignoredTag &&
      compareVersions(updateState.latest.tag, updateState.currentVersion) > 0
  )
}

function parseRelease(data: any): ReleaseInfo | null {
  if (!data?.tag_name) return null
  const assets: any[] = Array.isArray(data.assets) ? data.assets : []
  const apk = assets.find((asset) => String(asset.name ?? '').toLowerCase().endsWith('.apk'))
  if (!apk) return null
  return {
    tag: String(data.tag_name),
    name: String(data.name || data.tag_name),
    body: String(data.body || ''),
    url: String(data.html_url || `https://github.com/${REPO}/releases/tag/${data.tag_name}`),
    publishedAt: String(data.published_at || ''),
    apkUrl: String(apk.browser_download_url || ''),
    apkName: String(apk.name),
    apkSize: Number(apk.size) || 0
  }
}

async function notifyUpdate(release: ReleaseInfo): Promise<void> {
  notify(`发现新版本 ${release.tag}，可在设置中更新`)
  if (!Capacitor.isNativePlatform()) return
  try {
    await External.notifyUpdate({
      title: `澜音 ${release.tag} 可用`,
      body: '点按查看更新内容并安装'
    })
  } catch {}
}

export async function checkForUpdate(options: { force?: boolean; silent?: boolean } = {}): Promise<ReleaseInfo | null> {
  const force = options.force ?? false
  if (updateState.checking) return updateState.latest
  if (!force && Date.now() - updateState.lastChecked < CHECK_INTERVAL) {
    return updateState.latest
  }
  updateState.checking = true
  updateState.error = ''
  try {
    const response = await httpRequest({
      url: RELEASE_API,
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'CeruMusic-Mobile/' + updateState.currentVersion
      },
      responseType: 'json'
    })
    if (response.status === 403) {
      throw new Error('检查更新过于频繁，请稍后再试')
    }
    if (response.status === 404) {
      throw new Error('没有找到发布记录')
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`检查更新失败 (HTTP ${response.status})`)
    }
    const release = parseRelease(response.data)
    if (!release) throw new Error('最新发布中没有 APK 安装包')
    updateState.latest = release
    updateState.lastChecked = Date.now()
    refreshHasUpdate()
    persist()
    if (updateState.hasUpdate && !options.silent) {
      void notifyUpdate(release)
    }
    if (!updateState.hasUpdate && force) notify('已是最新版本')
    return release
  } catch (error: any) {
    updateState.error = error?.message ?? '检查更新失败'
    if (force) notify(updateState.error, 'error')
    return null
  } finally {
    updateState.checking = false
  }
}

export function setAutoCheck(value: boolean): void {
  updateState.autoCheck = value
  persist()
}

export function ignoreVersion(tag: string): void {
  updateState.ignoredTag = tag
  refreshHasUpdate()
  persist()
  notify('已忽略这个版本')
}

function bindProgress(): void {
  if (progressBound || !Capacitor.isNativePlatform()) return
  progressBound = true
  void Downloader.addListener('progress', (event: DownloadProgressEvent) => {
    if (!event.id.startsWith('update:')) return
    updateState.progress =
      event.total > 0 ? Math.min(0.99, event.received / event.total) : 0
  })
}

export async function installDownloadedUpdate(): Promise<void> {
  if (!updateState.downloadedFileName) return
  updateState.installing = true
  updateState.error = ''
  try {
    const result = await External.installApk({ fileName: updateState.downloadedFileName })
    if (result?.needsPermission) {
      updateState.needsPermission = true
      notify('请允许本应用安装未知应用，然后回来再点一次安装')
    } else {
      updateState.needsPermission = false
    }
  } catch (error: any) {
    updateState.error = error?.message ?? '无法调起安装器'
  } finally {
    updateState.installing = false
  }
}

export async function openReleasePage(): Promise<void> {
  const url = updateState.latest?.url
  if (!url) return
  if (Capacitor.isNativePlatform()) {
    try {
      await External.open({ url })
    } catch {}
    return
  }
  window.open(url, '_blank', 'noopener')
}

export async function downloadUpdate(force = false): Promise<void> {
  const release = updateState.latest
  if (!release) {
    await checkForUpdate({ force: true })
    return
  }
  if (!Capacitor.isNativePlatform()) {
    await openReleasePage()
    return
  }
  if (updateState.downloading) return
  if (updateState.downloadedFileName && !force) {
    await installDownloadedUpdate()
    return
  }
  if (force) updateState.downloadedFileName = ''
  updateState.downloading = true
  updateState.progress = 0
  updateState.error = ''
  bindProgress()
  try {
    const result = await Downloader.download({
      id: 'update:' + release.tag,
      url: release.apkUrl,
      fileName: release.apkName
    })
    updateState.downloadedFileName = result.fileName
    updateState.progress = 1
    await installDownloadedUpdate()
  } catch (error: any) {
    updateState.error = error?.message ?? '下载安装包失败'
    notify(updateState.error, 'error')
  } finally {
    updateState.downloading = false
  }
}

restore()
