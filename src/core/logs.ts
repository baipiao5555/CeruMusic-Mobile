import { reactive } from 'vue'

export type LogLevel = 'error' | 'warn' | 'info'

export interface LogEntry {
  id: number
  time: number
  level: LogLevel
  module: string
  message: string
  detail?: string
}

const STORAGE_KEY = 'ceru.logs.v1'
const MAX_ENTRIES = 1000
const MAX_DETAIL = 4000

export const logState = reactive({
  entries: [] as LogEntry[]
})

let nextId = 1
let saveTimer: ReturnType<typeof setTimeout> | null = null
let installed = false

function safeString(value: unknown): string {
  if (value instanceof Error) return value.stack || value.message
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (!Array.isArray(saved)) return
    const entries: LogEntry[] = []
    for (const item of saved) {
      if (!item || typeof item !== 'object') continue
      const level = item.level === 'error' || item.level === 'warn' ? item.level : 'info'
      const message = String(item.message ?? '').slice(0, 2000)
      if (!message) continue
      entries.push({
        id: Number(item.id) || nextId++,
        time: Number(item.time) || Date.now(),
        level,
        module: String(item.module ?? 'APP').slice(0, 40),
        message,
        detail: item.detail ? String(item.detail).slice(0, MAX_DETAIL) : undefined
      })
    }
    logState.entries = entries.slice(-MAX_ENTRIES)
    nextId = Math.max(nextId, ...logState.entries.map((entry) => entry.id + 1))
  } catch {
    logState.entries = []
  }
}

function persistNow(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logState.entries))
  } catch {}
}

function schedulePersist(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    persistNow()
  }, 250)
}

function trim(): void {
  let totalChars = 0
  for (const entry of logState.entries) {
    totalChars += entry.message.length + (entry.detail?.length ?? 0)
  }
  while (
    logState.entries.length > MAX_ENTRIES ||
    (totalChars > 1_200_000 && logState.entries.length > 1)
  ) {
    const removed = logState.entries.shift()
    if (!removed) break
    totalChars -= removed.message.length + (removed.detail?.length ?? 0)
  }
}

export function logEvent(
  level: LogLevel,
  module: string,
  message: string,
  detail?: unknown
): void {
  try {
    const text = String(message ?? '').trim()
    if (!text) return
    const entry: LogEntry = {
      id: nextId++,
      time: Date.now(),
      level,
      module: String(module || 'APP').slice(0, 40),
      message: text.slice(0, 2000)
    }
    const detailText = detail === undefined || detail === null ? '' : safeString(detail)
    if (detailText) entry.detail = detailText.slice(0, MAX_DETAIL)
    logState.entries.push(entry)
    trim()
    schedulePersist()
  } catch {}
}

export function clearLogs(): void {
  logState.entries.splice(0, logState.entries.length)
  persistNow()
}

export function logCounts(): { total: number; errors: number; warns: number } {
  let errors = 0
  let warns = 0
  for (const entry of logState.entries) {
    if (entry.level === 'error') errors += 1
    else if (entry.level === 'warn') warns += 1
  }
  return { total: logState.entries.length, errors, warns }
}

export function buildLogReport(meta: Record<string, string | number>): string {
  const lines: string[] = []
  lines.push('澜音 · CeruMusic 手机版 运行日志')
  lines.push('='.repeat(42))
  for (const [key, value] of Object.entries(meta)) {
    lines.push(`${key}: ${value}`)
  }
  lines.push(`导出时间: ${new Date().toISOString()}`)
  lines.push('')
  lines.push(`日志条数: ${logState.entries.length}`)
  lines.push('-'.repeat(42))
  for (const entry of logState.entries) {
    const time = new Date(entry.time)
    const stamp = `${time.getFullYear()}-${String(time.getMonth() + 1).padStart(2, '0')}-${String(
      time.getDate()
    ).padStart(2, '0')} ${String(time.getHours()).padStart(2, '0')}:${String(
      time.getMinutes()
    ).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}.${String(
      time.getMilliseconds()
    ).padStart(3, '0')}`
    lines.push(`[${stamp}] ${entry.level.toUpperCase().padEnd(5)} ${entry.module}  ${entry.message}`)
    if (entry.detail) {
      for (const line of entry.detail.split('\n')) lines.push(`    ${line}`)
    }
  }
  return lines.join('\n')
}

/**
 * Installs global capture once. Console output from plugins and the player is
 * already routed through console.error/warn, so this is enough to keep a
 * useful breadcrumb trail without touching every module.
 */
export function installLogCapture(): void {
  if (installed) return
  installed = true
  load()

  const originalError = console.error.bind(console)
  const originalWarn = console.warn.bind(console)

  console.error = (...args: unknown[]) => {
    try {
      logEvent('error', 'CONSOLE', args.map(safeString).join(' '))
    } catch {}
    originalError(...args)
  }
  console.warn = (...args: unknown[]) => {
    try {
      logEvent('warn', 'CONSOLE', args.map(safeString).join(' '))
    } catch {}
    originalWarn(...args)
  }

  window.addEventListener('error', (event) => {
    logEvent(
      'error',
      'RUNTIME',
      event.message || '未捕获的运行错误',
      event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : ''
    )
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    logEvent('error', 'PROMISE', safeString(reason?.message ?? reason ?? '未处理的 Promise 拒绝'))
  })
  window.addEventListener('pagehide', persistNow)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistNow()
  })
}
