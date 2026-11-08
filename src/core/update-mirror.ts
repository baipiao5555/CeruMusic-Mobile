import { httpRequest } from './net'

/**
 * GitHub 下载加速线路。
 *
 * 直连 github.com 在国内经常被重置，所以默认走公共反代：
 * 把 `https://github.com/...` 拼在反代域名后面即可，下载与 API 都支持。
 * 主用 + 备用两条，用户可在更新页里换；全部失败时最后才回落到直连。
 */
export interface Mirror {
  id: string
  label: string
  hint: string
  /** 空字符串表示直连。 */
  prefix: string
}

export const MIRRORS: Mirror[] = [
  { id: 'ghfast', label: 'ghfast', hint: 'ghfast.top', prefix: 'https://ghfast.top/' },
  { id: 'ghproxy', label: 'gh-proxy', hint: 'gh-proxy.com', prefix: 'https://gh-proxy.com/' },
  { id: 'ghproxy-hk', label: 'gh-proxy 香港', hint: 'hk.gh-proxy.com', prefix: 'https://hk.gh-proxy.com/' },
  { id: 'ghproxy-cdn', label: 'gh-proxy CDN', hint: 'cdn.gh-proxy.com', prefix: 'https://cdn.gh-proxy.com/' },
  { id: 'direct', label: '直连 GitHub', hint: 'github.com', prefix: '' }
]

export const DEFAULT_PRIMARY = 'ghfast'
export const DEFAULT_BACKUP = 'ghproxy'

/**
 * 测速只取仓库里 1.7KB 的 package.json：能验证反代通不通、首包多快，
 * 又不会像测 APK 那样白跑几 MB 流量。
 */
export const PROBE_TARGET =
  'https://raw.githubusercontent.com/baipiao5555/CeruMusic-Mobile/main/package.json'

export function findMirror(id: string): Mirror {
  return MIRRORS.find((item) => item.id === id) ?? MIRRORS[0]
}

/** 把原始 GitHub 链接套到反代前缀上。 */
export function mirrorUrl(prefix: string, url: string): string {
  if (!prefix) return url
  return prefix.replace(/\/+$/, '') + '/' + url
}

export function isHtml(data: unknown): boolean {
  const text = typeof data === 'string' ? data.trim().slice(0, 40).toLowerCase() : ''
  return text.startsWith('<!doctype') || text.startsWith('<html')
}

/**
 * 用 2KB 的分段请求测一条线路的可用性与首包时间。
 * 走 httpRequest：真机上经 CapacitorHttp，不受 WebView 的 CORS 限制。
 */
export async function probeMirror(
  mirror: Mirror,
  target: string,
  timeout = 9000
): Promise<number | null> {
  if (!target) return null
  const guard = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout))
  const task = (async (): Promise<number | null> => {
    const started = Date.now()
    try {
      const response = await httpRequest({
        url: mirrorUrl(mirror.prefix, target),
        method: 'GET',
        responseType: 'text'
      })
      if (response.status !== 200 && response.status !== 206) return null
      if (isHtml(response.data)) return null
      const size =
        typeof response.data === 'string' ? response.data.length : JSON.stringify(response.data).length
      if (size < 200) return null
      return Math.max(1, Date.now() - started)
    } catch {
      return null
    }
  })()
  return Promise.race([task, guard])
}

/** 并发测所有线路，返回 id → 首包毫秒（null 表示不可用）。 */
export async function probeAllMirrors(target: string): Promise<Record<string, number | null>> {
  const entries = await Promise.all(
    MIRRORS.map(async (mirror) => [mirror.id, await probeMirror(mirror, target)] as const)
  )
  return Object.fromEntries(entries)
}

/**
 * 下载尝试顺序：主用 → 备用 → 其余线路（按测速排序）→ 直连。
 * 直连默认排最后（国内常常直接超时），但当用户把它选成主用/备用时按用户的选择来。
 */
export function buildAttemptOrder(
  primaryId: string,
  backupId: string,
  speed: Record<string, number | null> = {}
): Mirror[] {
  const primary = findMirror(primaryId)
  const backup = findMirror(backupId)
  const ranked = MIRRORS.filter((item) => item.id !== primary.id && item.id !== backup.id)
    .filter((item) => item.id !== 'direct')
    .sort((a, b) => {
      const left = speed[a.id]
      const right = speed[b.id]
      if (left == null && right == null) return 0
      if (left == null) return 1
      if (right == null) return -1
      return left - right
    })
  const ordered = [primary, backup, ...ranked, findMirror('direct')]
  const seen = new Set<string>()
  return ordered.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
}
