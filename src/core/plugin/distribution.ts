import { reactive } from 'vue'
import { requestRemote, type HttpResponse } from './network'

export type CatalogLine = 'github' | 'pages' | 'cdn'
export const repositoryLines = [
  { id: 'github', name: 'GitHub 原始文件', base: 'https://raw.githubusercontent.com/hebijunge/musicfree-plugins/master/' },
  { id: 'pages', name: '仓库 GitHub Pages', base: 'https://hebijunge.github.io/musicfree-plugins/' },
  { id: 'cdn', name: 'jsDelivr CDN（第三方，手动选用）', base: 'https://cdn.jsdelivr.net/gh/hebijunge/musicfree-plugins@master/' }
] as const
const KEY = 'ceru.market.line.v2'
export const distributionState = reactive({ line: 'github' as CatalogLine })
try { const value = localStorage.getItem(KEY); if (repositoryLines.some(x => x.id === value)) distributionState.line = value as CatalogLine } catch { /* use origin */ }
export function selectCatalogLine(line: CatalogLine): void {
  if (!repositoryLines.some(x => x.id === line)) throw new Error('未知的下载线路')
  localStorage.setItem(KEY, line)
  distributionState.line = line
}
export function repositoryUrl(path: string, line: CatalogLine): string {
  if (!/^(ceru-list\.json|ceru-plugins\/[\w.-]+\.ceru\.js|plugins\/five-source-lx\.plugin\.v1\.6\.0\.js)$/.test(path)) throw new Error('不支持的仓库文件路径')
  return repositoryLines.find(x => x.id === line)!.base + path
}
export function repositoryPath(url: string): string | null {
  for (const line of repositoryLines) if (url.startsWith(line.base)) {
    const path = url.slice(line.base.length)
    try { repositoryUrl(path, line.id); return path } catch { return null }
  }
  return null
}
/** Only the same repository's own two lines are automatic fallbacks. CDN requires explicit selection. */
export async function requestRepository(path: string, options: {
  line?: CatalogLine; signal?: AbortSignal; onAttempt?: (message: string) => void
} = {}): Promise<HttpResponse & { downloadUrl: string }> {
  const preferred = options.line || distributionState.line
  const lines: CatalogLine[] = preferred === 'cdn' ? ['cdn', 'github', 'pages'] : [preferred, preferred === 'github' ? 'pages' : 'github']
  const failures: string[] = []
  for (const line of lines) {
    options.signal?.throwIfAborted()
    const url = repositoryUrl(path, line)
    options.onAttempt?.(`正在通过 ${repositoryLines.find(x => x.id === line)!.name} 获取文件…`)
    try {
      const result = await requestRemote({ url, raw: true, timeoutMs: 12_000, signal: options.signal })
      if (result.status < 200 || result.status >= 300) throw new Error('HTTP ' + result.status)
      if (typeof result.body !== 'string' || !result.body.trim()) throw new Error('返回内容为空')
      if (/^\s*(?:<!doctype\s+html|<html)/i.test(result.body)) throw new Error('返回的是网页，不是插件或目录')
      return { ...result, downloadUrl: url }
    } catch (error: any) {
      options.signal?.throwIfAborted()
      failures.push(`${line}: ${error?.message || '网络连接失败'}`)
    }
  }
  throw new Error('仓库下载失败。可重试，或在「下载线路」中手动选用 CDN。详情：' + failures.join('；'))
}
