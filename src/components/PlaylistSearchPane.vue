<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from './Icon.vue'
import { allProviders, invokeProvider, pluginState, type ProviderHandle } from '@/core/plugin/manager'
import { libraryState } from '@/core/library'
import { retainResource } from '@/core/resourceNavigation'

const props = defineProps<{ query: string }>()
const router = useRouter()
const providers = computed(() => allProviders(true).filter(p => p.methods.includes('playlists.search')))
const keyOf = (p: ProviderHandle): string => `${p.pluginId}:${p.providerId}`
const source = ref('')
const selected = computed(() => providers.value.find(p => keyOf(p) === source.value))
watch(() => selected.value ? pluginState.accountEpochs[selected.value.pluginId] || 0 : 0, () => clear())
const results = ref<any[]>([])
const loading = ref(false)
const error = ref('')
const searched = ref(false)
const applied = ref('')
const cursor = ref<string>()
let sequence = 0
let resumeSearch = false
const local = computed(() => {
  const q = props.query.trim().toLocaleLowerCase()
  return q ? libraryState.playlists.filter(p => `${p.name} ${p.description || ''}`.toLocaleLowerCase().includes(q)) : []
})
const HISTORY_KEY = 'ceru.search.playlist-history.v1'
const history = ref<string[]>([])
try {
  const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
  if (Array.isArray(saved)) history.value = saved.filter(x => typeof x === 'string').slice(0, 20)
} catch {}
function remember(q: string): void {
  history.value = [q, ...history.value.filter(x => x !== q)].slice(0, 20)
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value)) } catch {}
}
function art(item: any): string { return item.playlist?.artworkUrl || item.metadata?.artworkUrl || item.artworkUrl || '/default-cover.png' }
function rowKey(item: any): string { return JSON.stringify([item.ref?.providerId, item.ref?.id, item.ref?.connectionId || '']) }
function select(p: ProviderHandle): void {
  if (source.value === keyOf(p)) return
  clear()
  source.value = keyOf(p)
  if (props.query.trim()) void search()
}
async function search(more = false): Promise<void> {
  if (!more && loading.value && applied.value === props.query.trim()) return
  if (more && (loading.value || !cursor.value || applied.value !== props.query.trim())) return
  const q = props.query.trim(), owner = selected.value
  const seq = ++sequence, ownerKey = source.value, usedCursor = more ? cursor.value : undefined
  resumeSearch = false
  if (!more) { results.value = []; cursor.value = undefined; applied.value = q; searched.value = Boolean(q) }
  error.value = ''
  if (!q) { loading.value = false; return }
  if (!owner) { loading.value = false; error.value = '当前没有支持歌单关键词搜索的音源；本地歌单仍可搜索。'; return }
  loading.value = true
  remember(q)
  try {
    const page = await invokeProvider(owner, 'playlists.search', [{ query: q, kinds: ['playlist'], filters: {}, limit: 30, ...(usedCursor ? { cursor: usedCursor } : {}) }])
    if (seq !== sequence || source.value !== ownerKey || props.query.trim() !== q || !selected.value) return
    const items = (page?.items || []).filter((x: any) => x?.ref?.kind === 'playlist' && typeof x.ref.id === 'string' && x.ref.id)
    const seen = new Set((more ? results.value : []).map(rowKey))
    const incoming = items.filter((x: any) => { const id = rowKey(x); if (seen.has(id)) return false; seen.add(id); return true })
    results.value = more ? [...results.value, ...incoming] : incoming
    cursor.value = typeof page?.nextCursor === 'string' && page.nextCursor && page.nextCursor !== usedCursor ? page.nextCursor : undefined
    if (page?.nextCursor && page.nextCursor === usedCursor) error.value = '音源返回重复分页游标，已停止继续加载。'
  } catch (e: any) {
    if (seq === sequence) error.value = e?.message || '歌单搜索失败'
  } finally { if (seq === sequence) loading.value = false }
}
function open(item: any): void {
  const owner = selected.value
  if (!owner?.methods.includes('playlists.get')) return
  const token = retainResource(owner, item, art(item))
  void router.push({ path: '/browse', query: { resource: token } })
}
function clear(): void { sequence++; results.value = []; cursor.value = undefined; error.value = ''; searched.value = false; loading.value = false; applied.value = '' }
async function ensureSearch(): Promise<void> {
  if (!searched.value || applied.value !== props.query.trim()) await search()
}
watch(providers, list => {
  if (!source.value && list.length) {
    const current = allProviders().find(p => p.providerId === pluginState.selectedProvider && p.methods.includes('playlists.search'))
    source.value = keyOf(current || list[0])
    if (searched.value && applied.value === props.query.trim()) void search()
  }
}, { immediate: true })
watch(() => props.query, () => { sequence++; loading.value = false; cursor.value = undefined }, { flush: 'sync' })
onDeactivated(() => { resumeSearch = loading.value; sequence++; loading.value = false })
onActivated(() => { if (resumeSearch) void search() })
onBeforeUnmount(() => { sequence++ })
defineExpose({ search, clear, ensureSearch })
</script>

<template>
  <section class="playlist-search-pane pad">
    <div class="scope-label"><strong>歌单搜索</strong><span>独立来源 · 不改变歌曲音源</span></div>
    <div v-if="providers.length" class="chip-row source-row">
      <button v-for="p in providers" :key="keyOf(p)" class="chip" :class="{ active: source === keyOf(p) }" @click="select(p)">{{ p.name }}<small v-if="providers.filter(x => x.providerId === p.providerId).length > 1"> · {{ p.pluginName }}</small></button>
    </div>
    <p v-else class="capability-note">已安装音源暂未提供歌单关键词搜索。歌曲/歌词搜索不受影响，也可搜索本地歌单或通过分享链接、本地文件导入。</p>
    <p v-if="source && !selected" class="notice" role="status">所选歌单来源已停用，请选择可用来源；本地歌单不受影响。</p>
    <div class="section-head"><div class="st"><h2>平台歌单</h2><span class="idx">{{ results.length }}</span></div><span v-if="selected" class="meta">{{ selected.name }}</span></div>
    <p v-if="applied" class="meta">结果关键词：{{ applied }}<template v-if="applied !== query.trim()"> · 点击搜索更新结果</template></p>
    <p v-if="loading" class="notice" role="status">正在搜索歌单…</p>
    <div v-if="error" class="notice" role="status">{{ error }} <button v-if="selected" @click="search()">重试</button></div>
    <button v-for="item in results" :key="rowKey(item)" class="playlist-row" :disabled="!selected?.methods.includes('playlists.get')" @click="open(item)">
      <img :src="art(item)" alt="" @error="($event.target as HTMLImageElement).src = '/default-cover.png'" />
      <span class="grow"><strong class="clamp-2">{{ item.title || '未命名歌单' }}</strong><small>{{ item.playlist?.author || item.subtitle || selected?.name }}<template v-if="typeof item.playlist?.trackCount === 'number'"> · {{ item.playlist.trackCount }} 首</template></small><small v-if="!selected?.methods.includes('playlists.get')">该音源支持搜索，暂不支持读取曲目</small></span><Icon name="chevron" :size="15" />
    </button>
    <p v-if="searched && !loading && !results.length && !error" class="notice">平台没有返回匹配歌单；下方本地结果独立展示。</p>
    <p v-if="!searched" class="notice">输入歌单名称，点击右上方“搜索”。</p>
    <button v-if="cursor" class="btn btn-ghost btn-block" :disabled="loading" @click="search(true)">加载更多歌单</button>
    <div class="section-head"><div class="st"><h2>本地歌单</h2><span class="idx">{{ local.length }}</span></div></div>
    <button v-for="p in local" :key="p.id" class="playlist-row" @click="router.push(`/playlist/${p.id}`)"><span class="local-icon"><Icon name="playlist" :size="23" /></span><span class="grow"><strong>{{ p.name }}</strong><small>{{ p.tracks.length }} 首 · 本地歌单</small></span><Icon name="chevron" :size="15" /></button>
    <p v-if="query.trim() && !local.length" class="notice">本地歌单没有匹配“{{ query.trim() }}”。</p>
    <p v-if="!query.trim() && history.length" class="notice">最近搜过：{{ history.join(' · ') }}</p>
  </section>
</template>

<style scoped>
.playlist-search-pane{min-width:0}.scope-label{display:flex;justify-content:space-between;gap:12px;align-items:center;margin:14px 0 10px;font-size:14px}.scope-label>span{font-size:10px;color:var(--ink-3);text-align:right}.source-row{margin-bottom:10px}.source-row .chip{min-height:40px;border:0;background:var(--porcelain-2)}.source-row .chip.active{background:var(--tint-soft);color:var(--brand-strong)}.capability-note,.notice{font-size:12px;line-height:1.7;color:var(--ink-3);padding:12px 0}.capability-note{padding:12px;background:var(--porcelain-2);border-radius:10px}.notice button{color:var(--brand-strong);min-height:36px;padding:0 10px}.playlist-search-pane .section-head{padding:18px 0 8px}.playlist-search-pane .section-head h2{font-size:17px}.playlist-row{display:flex;align-items:center;gap:12px;width:100%;min-height:76px;padding:9px 0;border-bottom:1px solid var(--line)}.playlist-row>img,.local-icon{width:55px;height:55px;flex:none;object-fit:cover;border-radius:8px}.local-icon{display:grid;place-items:center;background:var(--tint-soft);color:var(--brand-strong)}.grow{flex:1;min-width:0}.grow strong{display:block;font-size:14px;line-height:1.5;font-weight:550}.grow small{display:block;font-size:11px;line-height:1.5;color:var(--ink-3);margin-top:4px}.playlist-row:disabled{opacity:.65}.btn-block{margin-top:12px}
</style>
