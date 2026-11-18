import { Capacitor } from '@capacitor/core'
import { logEvent } from '../logs'
import { setSyncKeepAlive, supportsSyncKeepAlive, syncKeepAliveStatus } from '../native/syncKeepAlive'
import { getSyncStatus, listConnections, syncNow, type WebDavConnection, type WebDavSyncStatus } from './webdav'

const POLL_MS = 15_000
const STARTUP_DELAY_MS = 2_500

export interface AutoSyncTarget {
  connection: WebDavConnection
  status: WebDavSyncStatus
  dueAt: number
  intervalMs: number
}

export function nextAutoSyncTarget(
  connections: WebDavConnection[],
  readStatus: (connection: WebDavConnection) => WebDavSyncStatus,
  now: number
): AutoSyncTarget | undefined {
  for (const connection of connections) {
    const status = readStatus(connection)
    if (!status.enabled) continue
    const intervalMs = Math.max(1, Math.min(60, Number(status.autoSyncMinutes) || 3)) * 60_000
    const lastAttempt = Number(status.lastAttemptAt)
    const dueAt = Number.isFinite(lastAttempt) && lastAttempt > 0 ? lastAttempt + intervalMs : now
    return { connection, status, dueAt, intervalMs }
  }
  return
}

let started = false
let busy = false
let keepAliveKnown: boolean | undefined
let keepAlivePending = false

function nativePlatform(): boolean {
  return Capacitor.isNativePlatform()
}

async function ensureKeepAlive(enabled: boolean): Promise<void> {
  if (!supportsSyncKeepAlive() || keepAlivePending) return
  if (enabled && document.visibilityState === 'hidden' && keepAliveKnown !== true) return
  if (keepAliveKnown === enabled) return
  keepAlivePending = true
  try {
    if (keepAliveKnown === undefined) {
      const running = await syncKeepAliveStatus()
      if (running === enabled) {
        keepAliveKnown = running
        return
      }
    }
    await setSyncKeepAlive(enabled)
    keepAliveKnown = enabled
  } catch (error) {
    keepAliveKnown = false
    logEvent('warn', 'SYNC', enabled ? '后台同步保活未启动' : '后台同步保活未停止', String(error))
  } finally {
    keepAlivePending = false
  }
}

async function tick(): Promise<void> {
  if (busy) return
  const target = nextAutoSyncTarget(listConnections(), getSyncStatus, Date.now())
  await ensureKeepAlive(Boolean(target))
  if (!target) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  if (Date.now() < target.dueAt) return

  busy = true
  try {
    const result = await syncNow(target.connection)
    logEvent('info', 'SYNC', '应用级自动同步完成', result.summary)
  } catch (error) {
    logEvent('warn', 'SYNC', '应用级自动同步失败', String(error))
  } finally {
    busy = false
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('ceru:sync-status'))
  }
}

function wake(): void {
  void tick()
}

/** Runs for the lifetime of the app, independent of which page is mounted. */
export function startAutoSyncScheduler(): void {
  if (started || typeof window === 'undefined') return
  started = true
  document.addEventListener('visibilitychange', wake)
  window.addEventListener('online', wake)
  setInterval(wake, POLL_MS)
  setTimeout(wake, STARTUP_DELAY_MS)
  if (!nativePlatform()) logEvent('info', 'SYNC', 'Web 端自动同步调度已启动')
}
