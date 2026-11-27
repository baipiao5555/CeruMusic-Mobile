import { reactive } from 'vue'
import { distributionState, repositoryUrl, requestRepository, selectCatalogLine, type CatalogLine } from './distribution'
export type { CatalogLine } from './distribution'
import { initialCatalog } from './catalogSeed'

export interface CatalogItem {
  key: string; manifestId: string; name: string; version: string; author: string
  description: string; category: string; format: 'ceru' | 'lx' | 'musicfree'; url: string
}
const CACHE = 'ceru.market.catalog.v1'
const common = new Set(['qq', 'kuwo', 'kugou', 'netease', 'migu', 'qishui'])
export const catalogCategories = ['常用音乐', 'DJ电音', '听书电台', '其他']
export function parseCatalog(input: any, line: CatalogLine = 'github'): CatalogItem[] {
  if (!Array.isArray(input?.plugins) || input.plugins.length > 1000) throw new Error('音源目录格式不正确')
  const ids = new Set<string>()
  const base = repositoryUrl('ceru-list.json', line).replace('ceru-list.json', '')
  const items: CatalogItem[] = input.plugins.map((p: any) => {
    if (typeof p?.id !== 'string' || !p.id || p.id.length > 160 || ids.has(p.id) ||
        typeof p.name !== 'string' || !p.name || p.name.length > 160 || typeof p.version !== 'string' ||
        !/^[a-zA-Z0-9_.-]+\.ceru\.js$/.test(p.file || '')) throw new Error('音源条目缺少有效名称、ID、版本或文件；保留上次目录')
    ids.add(p.id)
    const slug = p.id.replace(/^ceru\./, '')
    const category = common.has(slug) ? '常用音乐' : /^dj/i.test(p.category || '') || /dj|mix|dianyinge|edm/i.test(slug) ? 'DJ电音' :
      p.category === 'radio' || /ximalaya|qingting|radio|fm|ting|cctv|xiangsheng|fanqie|lrts|maoe/i.test(slug) ? '听书电台' : '其他'
    return { key: 'ceru:' + p.id, manifestId: p.id, name: p.name, version: p.version,
      author: String(p.author || ''), description: String(p.description || '').slice(0, 2000), category,
      format: 'ceru' as const, url: base + 'ceru-plugins/' + p.file }
  })
  items.push({ key: 'lx:five-source', manifestId: 'lx:研发1号:五源合一', name: 'LX 五源合一', version: '1.6.0',
    author: '研发1号', description: '一个插件提供 QQ、酷我、酷狗、网易云和咪咕平台；播放能力以实际运行结果为准。',
    category: '常用音乐', format: 'lx', url: base + 'plugins/five-source-lx.plugin.v1.6.0.js' })
  return items
}
export const catalogState = reactive({
  items: parseCatalog(initialCatalog), loading: false, error: '', cachedAt: 0, builtin: true, line: distributionState.line as CatalogLine
})
try {
  const saved = JSON.parse(localStorage.getItem(CACHE) || 'null')
  if (saved?.data && Number.isFinite(saved.time)) {
    catalogState.line = distributionState.line
    catalogState.items = parseCatalog(saved.data, catalogState.line)
    catalogState.cachedAt = saved.time; catalogState.builtin = false
  }
} catch { /* Invalid local cache does not replace the packaged directory. */ }

/**
 * A cached directory can lag behind a file that was already replaced in the
 * repository. Remember the version we actually verified so the UI and the
 * persisted catalog do not keep asking the user to refresh forever.
 */
export function reconcileCatalogVersion(item: CatalogItem, version: string, description = ''): void {
  if (item.format === 'lx' || !version) return
  item.version = version
  if (description) item.description = description
  const current = catalogState.items.find((x) => x.key === item.key || x.manifestId === item.manifestId)
  if (current) {
    current.version = version
    if (description) current.description = description
  }
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE) || 'null')
    const entry = saved?.data?.plugins?.find((x: any) => x?.id === item.manifestId)
    if (entry && typeof entry.version === 'string') {
      entry.version = version
      if (description) entry.description = description
      saved.time = Date.now()
      localStorage.setItem(CACHE, JSON.stringify(saved))
    }
  } catch { /* The in-memory correction still applies if storage is unavailable. */ }
}

export async function refreshCatalog(force = false, line = catalogState.line): Promise<void> {
  if (catalogState.loading) return
  if (!force && line === catalogState.line && catalogState.cachedAt && Date.now() - catalogState.cachedAt < 6 * 3600_000) return
  catalogState.loading = true; catalogState.error = ''
  try { selectCatalogLine(line); catalogState.line = line } catch (e: any) { catalogState.loading = false; catalogState.error = e.message; return }
  try {
    const result = await requestRepository('ceru-list.json', { line })
    if (result.status < 200 || result.status >= 300) throw new Error('目录下载失败：HTTP ' + result.status)
    const data = typeof result.body === 'string' ? JSON.parse(result.body) : result.body
    const items = parseCatalog(data, line), time = Date.now()
    // Persist only a validated complete response; a failed write leaves the previous cache intact.
    localStorage.setItem(CACHE, JSON.stringify({ data, time, line }))
    catalogState.items = items; catalogState.cachedAt = time; catalogState.line = line; catalogState.builtin = false
  } catch (error: any) {
    catalogState.error = (error?.message || '目录刷新失败') + '；仍显示上次有效目录，已安装音源不受影响'
  } finally { catalogState.loading = false }
}
