<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SongRow from '@/components/SongRow.vue'
import { allProviders, invokeProvider, pluginState, selectProvider, type ProviderHandle } from '@/core/plugin/manager'
import { playTracks, toTrack, type Track } from '@/core/playback/player'
import { rememberTracks } from '@/core/search'
import { resourceContext } from '@/core/resourceNavigation'
import { openSearch } from '@/core/searchEntry'

const route = useRoute()
const router = useRouter()
const context = computed(() => resourceContext(route.query.resource))
const contextExpired = computed(() => Boolean(route.query.resource) && !context.value)
const providers = computed(() => allProviders())
const providerId = computed(() => context.value?.providerId || String(route.query.provider ?? pluginState.selectedProvider ?? ''))
const kind = computed(() => context.value?.ref.kind || String(route.query.kind ?? 'chart'))
const id = computed(() => context.value?.ref.id || String(route.query.id ?? ''))
const title = computed(() => context.value?.title || String(route.query.title ?? '歌单'))
const artwork = computed(() => context.value?.artwork || String(route.query.artwork ?? '/default-cover.png'))
const catalogMode = computed(() => !id.value && !contextExpired.value)
const provider = computed(() => {
  const ownerId = context.value?.pluginId || String(route.query.plugin ?? '')
  const match = (ownerId ? allProviders(true) : providers.value).find(item => item.providerId === providerId.value && (!ownerId || item.pluginId === ownerId))
  return match ?? (!route.query.provider && !ownerId ? providers.value[0] : undefined)
})
const providerKey = computed(() => provider.value ? `${provider.value.pluginId}:${provider.value.providerId}` : '')
const providerName = computed(() => provider.value?.name ?? '音源未启用')
const kindLabel = computed(() => kind.value === 'playlist' ? '歌单' : kind.value === 'chart' ? '榜单' : '内容')
const resourceRef = computed(() => context.value?.ref || ({ providerId: provider.value?.providerId || providerId.value, kind: kind.value, id: id.value, pluginId: provider.value?.manifestId ?? '' }))
const tracks = ref<Track[]>([])
const loading = ref(true)
const error = ref('')
const cursor = ref<string | undefined>()
const loadingMore = ref(false)
const ended = ref(false)
let requestSeq = 0
let categorySeq = 0

const catalogTab = ref<'playlists' | 'charts'>('playlists')
const charts = ref<any[]>([])
const playlists = ref<any[]>([])
const categories = ref<any[]>([])
const categoryIndex = ref(0)
const categoryLoading = ref(false)
const canCharts = computed(() => provider.value?.methods.includes('charts.list'))
const canPlaylists = computed(() => provider.value?.methods.includes('playlists.categories') && provider.value?.methods.includes('playlists.list'))
const catalogItems = computed(() => catalogTab.value === 'charts' ? charts.value : playlists.value)
const noTracks = computed(() => !loading.value && !tracks.value.length && error.value === '没有找到歌曲')
const failure = computed(() => !loading.value && !tracks.value.length && Boolean(error.value) && !noTracks.value)

function artworkOf(item: any): string {
  return item?.chart?.artworkUrl || item?.playlist?.artworkUrl || item?.metadata?.artworkUrl || item?.artworkUrl || '/default-cover.png'
}
function subtitleOf(item: any): string {
  if (catalogTab.value === 'charts') return item.chart?.updateFrequency || item.subtitle || providerName.value
  if (typeof item.playlist?.trackCount === 'number') return `${item.playlist.trackCount} 首 · ${item.playlist?.author || providerName.value}`
  return item.playlist?.author || item.subtitle || providerName.value
}
function goBack(): void {
  if (window.history.state?.back) router.back()
  else void router.replace('/')
}
function choose(owner: ProviderHandle): void {
  selectProvider(owner.providerId, owner.pluginId)
  void router.replace({ path: '/browse', query: { tab: catalogTab.value } })
}
function openItem(item: any): void {
  if (!item.ref?.id || !provider.value) return
  void router.push({ path: '/browse', query: { provider: item.ref.providerId || provider.value.providerId, plugin: provider.value.pluginId, kind: item.ref.kind, id: item.ref.id, title: item.title, artwork: artworkOf(item) } })
}

async function loadCatalog(): Promise<void> {
  const seq = ++requestSeq
  categorySeq += 1
  const owner = provider.value
  charts.value = []
  playlists.value = []
  categories.value = []
  categoryIndex.value = 0
  categoryLoading.value = false
  loadingMore.value = false
  error.value = ''
  loading.value = Boolean(owner)
  if (!owner) return
  const failures: string[] = []
  if (owner.methods.includes('charts.list')) {
    try {
      const page = await invokeProvider(owner, 'charts.list', [])
      if (seq !== requestSeq) return
      charts.value = (page?.items ?? []).filter((item: any) => item.ref?.kind === 'chart' && item.ref.id)
    } catch (err: any) {
      if (seq !== requestSeq) return
      failures.push(err?.message || '榜单加载失败')
    }
  }
  if (owner.methods.includes('playlists.categories') && owner.methods.includes('playlists.list')) {
    try {
      const page = await invokeProvider(owner, 'playlists.categories', [])
      if (seq !== requestSeq) return
      categories.value = page?.items ?? []
      const first = categories.value[0]
      if (first?.ref) {
        const list = await invokeProvider(owner, 'playlists.list', [first.ref, undefined])
        if (seq !== requestSeq) return
        playlists.value = (list?.items ?? []).filter((item: any) => item.ref?.kind === 'playlist' && item.ref.id)
      }
    } catch (err: any) {
      if (seq !== requestSeq) return
      failures.push(err?.message || '歌单加载失败')
    }
  }
  if (seq !== requestSeq) return
  error.value = failures.join('；')
  loading.value = false
  if (!route.query.tab && !canPlaylists.value && canCharts.value) catalogTab.value = 'charts'
}
async function chooseCategory(index: number): Promise<void> {
  const owner = provider.value
  const category = categories.value[index]
  if (!owner || !category?.ref || (index === categoryIndex.value && playlists.value.length)) return
  categoryIndex.value = index
  const seq = ++categorySeq
  const key = providerKey.value
  categoryLoading.value = true
  playlists.value = []
  error.value = ''
  try {
    const page = await invokeProvider(owner, 'playlists.list', [category.ref, undefined])
    if (seq !== categorySeq || key !== providerKey.value || !catalogMode.value) return
    playlists.value = (page?.items ?? []).filter((item: any) => item.ref?.kind === 'playlist' && item.ref.id)
  } catch (err: any) {
    if (seq !== categorySeq || key !== providerKey.value || !catalogMode.value) return
    error.value = err?.message || '歌单加载失败'
  } finally {
    if (seq === categorySeq && key === providerKey.value) categoryLoading.value = false
  }
}
async function load(more = false): Promise<void> {
  if (contextExpired.value) { requestSeq++; error.value = '歌单上下文已过期，请返回搜索重新打开'; tracks.value = []; loading.value = false; loadingMore.value = false; return }
  const owner = provider.value
  if (!owner) {
    requestSeq += 1
    error.value = '音源插件未启用'
    tracks.value = []
    loading.value = false
    loadingMore.value = false
    return
  }
  if (more && (loadingMore.value || loading.value || ended.value)) return
  const seq = more ? requestSeq : ++requestSeq
  if (more) loadingMore.value = true
  else {
    categorySeq += 1
    loading.value = true
    loadingMore.value = false
    tracks.value = []
    cursor.value = undefined
    ended.value = false
  }
  error.value = ''
  try {
    let page: any
    if (kind.value === 'playlist') page = await invokeProvider(owner, 'playlists.get', [resourceRef.value, cursor.value])
    else if (kind.value === 'chart') page = await invokeProvider(owner, 'charts.getTracks', [resourceRef.value, cursor.value])
    else throw new Error('不支持的内容类型')
    if (seq !== requestSeq) return
    const items = (page?.items ?? []).filter((item: any) => item.ref?.kind === 'track').map((item: any) => toTrack(item, owner))
    tracks.value = more ? [...tracks.value, ...items] : items
    cursor.value = page?.nextCursor
    ended.value = !cursor.value
    if (!tracks.value.length) error.value = '没有找到歌曲'
    rememberTracks(items)
  } catch (err: any) {
    if (seq !== requestSeq) return
    error.value = err?.message ?? '加载失败'
  } finally {
    if (seq === requestSeq) {
      loading.value = false
      loadingMore.value = false
    }
  }
}
function play(index: number): void { if (tracks.value.length) void playTracks(tracks.value, index) }
function playAll(): void { play(0) }
watch(() => route.query.tab, value => { catalogTab.value = value === 'charts' ? 'charts' : 'playlists' }, { immediate: true })
// 音乐馆与详情复用 /browse；路由或音源变化必须使旧响应失效。
watch(() => [providerKey.value, id.value, kind.value, route.query.resource], () => {
  if (route.path !== '/browse') return
  if (catalogMode.value) void loadCatalog()
  else void load()
}, { immediate: true })
// 音乐馆保留页面状态；重新进入时仍刷新内容，离开时使在途请求失效。
watch(() => route.path === '/browse', (active) => {
  if (!active) {
    requestSeq += 1
    categorySeq += 1
    return
  }
  if (catalogMode.value) void loadCatalog()
  else void load()
})
onBeforeUnmount(() => { requestSeq += 1; categorySeq += 1 })
</script>

<template>
  <div class="screen browse-page">
    <div class="scroll safe-t">
      <header class="browse-top"><button class="iconbtn quiet" aria-label="返回" @click="goBack"><Icon name="back" :size="21" /></button><h1>{{ catalogMode ? '音乐馆' : kindLabel }}</h1><button class="iconbtn quiet" aria-label="搜索" @click="openSearch(router)"><Icon name="search" :size="21" /></button></header>
      <template v-if="catalogMode">
        <div class="catalog-tabs pad" aria-label="音乐馆分类"><button :class="{ on: catalogTab === 'playlists' }" @click="catalogTab = 'playlists'">歌单精选</button><button :class="{ on: catalogTab === 'charts' }" @click="catalogTab = 'charts'">排行榜</button></div>
        <div v-if="providers.length" class="chip-row pad catalog-sources"><button v-for="owner in providers" :key="owner.pluginId + ':' + owner.providerId" class="chip" :class="{ active: owner.pluginId === provider?.pluginId && owner.providerId === provider?.providerId }" @click="choose(owner)">{{ owner.name }}</button></div>
        <div v-if="catalogTab === 'playlists' && categories.length > 1" class="chip-row pad catalog-categories"><button v-for="(category, index) in categories" :key="category.ref?.id || index" class="chip" :class="{ active: categoryIndex === index }" @click="chooseCategory(index)">{{ category.title }}</button></div>
        <div v-if="loading || pluginState.loading || categoryLoading" class="catalog-grid pad mt20" aria-label="加载内容"><div v-for="n in 4" :key="n" class="skeleton" style="aspect-ratio:1" /></div>
        <div v-else-if="!provider" class="empty"><div class="glyph"><Icon name="plugin" :size="32" /></div><h3>还没有可用音源</h3><p>启用音源后，在这里浏览它提供的歌单与排行榜。</p><button class="btn btn-primary mt8" @click="router.push('/plugins')">管理音源</button></div>
        <template v-else>
          <div v-if="error" class="catalog-notice pad"><p>{{ error }}</p><button @click="loadCatalog()"><Icon name="refresh" :size="14" />重试</button></div>
          <div v-if="catalogItems.length" class="catalog-grid pad mt20"><button v-for="item in catalogItems" :key="item.ref.id" class="mediacard" @click="openItem(item)"><div class="cover"><img :src="artworkOf(item)" alt="" loading="lazy" decoding="async" @error="($event.target as HTMLImageElement).src = '/default-cover.png'" /><span class="catalog-play"><Icon name="play" :size="14" /></span></div><div class="ct clamp-2">{{ item.title }}</div><div class="cs truncate">{{ subtitleOf(item) }}</div></button></div>
          <div v-else-if="!error" class="empty"><div class="glyph"><Icon name="playlist" :size="32" /></div><h3>{{ (catalogTab === 'charts' ? canCharts : canPlaylists) ? '这个分类暂时没有内容' : '该音源不支持' + (catalogTab === 'charts' ? '排行榜' : '歌单浏览') }}</h3><p>可切换分类或音源，搜索和本地音乐仍可使用。</p><button class="btn btn-tonal mt8" @click="openSearch(router)">去搜索</button></div>
          <p v-if="catalogItems.length" class="catalog-foot">{{ providerName }} · {{ catalogItems.length }} 个{{ catalogTab === 'charts' ? '榜单' : '歌单' }}</p>
        </template>
      </template>
      <template v-else>
        <section class="browse-hero"><img :src="artwork" alt="" @error="($event.target as HTMLImageElement).src = '/default-cover.png'" /><div><h2 class="clamp-2">{{ title }}</h2><p>{{ providerName }}</p><span>{{ tracks.length }} 首<template v-if="tracks.length"> · {{ ended ? '已全部加载' : '可继续加载' }}</template></span></div></section>
        <div class="browse-toolbar"><button class="browse-play-all" :disabled="!tracks.length" @click="playAll"><span><Icon name="play" :size="16" /></span>播放全部<small>({{ tracks.length }})</small></button><span>{{ kindLabel }}</span></div>
        <div v-if="loading || pluginState.loading" class="pad mt10" aria-live="polite"><div v-for="row in 6" :key="row" class="skelrow"><span class="skeleton skelcov" /><span class="skellines"><span class="skeleton skelt" /><span class="skeleton skela" /></span></div><p class="meta mt12">正在加载「{{ title }}」…</p></div>
        <div v-else-if="failure" class="empty"><div class="glyph"><Icon name="warning" :size="32" /></div><h3>没能打开这个{{ kindLabel }}</h3><p>{{ error }}</p><div class="row g8 mt8"><button class="btn btn-ghost btn-sm" @click="goBack">返回</button><button class="btn btn-primary btn-sm" @click="load()">重试</button></div></div>
        <template v-else>
          <div v-if="tracks.length" class="pad browse-tracks"><SongRow v-for="(track, index) in tracks" :key="track.pluginId + ':' + track.providerId + ':' + track.id + ':' + index" :track="track" :index="index" :queue="tracks" show-index :show-cover="false" @play="play(index)" /></div>
          <div v-if="noTracks" class="empty"><div class="glyph"><Icon name="folder" :size="32" /></div><h3>这个{{ kindLabel }}还没有曲目</h3><p>音源没有返回内容，去音乐馆挑选其他内容吧。</p><div class="row g8 mt8"><button class="btn btn-ghost btn-sm" @click="router.push('/browse')">音乐馆</button><button class="btn btn-tonal btn-sm" @click="load()">重新加载</button></div></div>
          <div class="pad mt16"><p v-if="error && tracks.length" class="meta">{{ error }}</p><button v-if="!ended && tracks.length" class="btn btn-ghost btn-block" :disabled="loadingMore" @click="load(true)"><span v-if="loadingMore" class="loading-dots"><i /><i /><i /></span><template v-else>加载更多</template></button><p v-else-if="tracks.length" class="meta tc mt8">已经到底了 · {{ tracks.length }} 首</p></div>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.browse-top { display:flex; align-items:center; justify-content:space-between; padding:0 10px; min-height:54px; }.browse-top h1 { font-family:var(--sans); font-size:17px; font-weight:600; }.browse-top .iconbtn { width:44px; height:44px; }
.catalog-tabs { display:flex; align-items:center; gap:25px; min-height:53px; }.catalog-tabs>button { position:relative; min-height:48px; font-size:19px; font-weight:600; color:var(--ink-3); }.catalog-tabs>button.on { color:var(--ink); }.catalog-tabs>button.on::after { content:''; position:absolute; bottom:0; left:calc(50% - 11px); height:3px; width:22px; border-radius:4px; background:var(--tint); }
.catalog-sources { margin-top:14px; }.catalog-categories { margin-top:12px; }.catalog-sources .chip,.catalog-categories .chip { min-height:40px; border-radius:8px; border:0; background:var(--porcelain-2); font-size:12px; }.catalog-sources .chip.active,.catalog-categories .chip.active { background:var(--tint-soft); color:var(--brand-strong); }
.catalog-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:25px 16px; }.catalog-grid .cover { border-radius:11px; }.catalog-grid .ct { font-family:var(--sans); font-size:14px; line-height:1.5; font-weight:500; }.catalog-grid .cs { font-size:12px; margin-top:5px; }.catalog-play { display:grid; place-items:center; width:29px; height:29px; background:rgba(255,255,255,.9); color:#1c4432; border-radius:50%; position:absolute; right:9px; bottom:9px; }
.catalog-notice { margin-top:18px; display:flex; align-items:center; justify-content:space-between; gap:10px; }.catalog-notice p { color:var(--ink-3); font-size:12px; line-height:1.6; }.catalog-notice button { display:flex; align-items:center; gap:5px; min-height:44px; white-space:nowrap; flex:none; font-size:12px; color:var(--brand-strong); }.catalog-foot { padding:24px var(--pad) 4px; text-align:center; font-size:11px; color:var(--ink-3); }
.browse-hero { display:flex; align-items:center; gap:18px; padding:20px var(--pad) 25px; background:linear-gradient(145deg,var(--tint-soft),var(--porcelain)); }.browse-hero>img { width:126px; height:126px; border-radius:10px; object-fit:cover; flex:none; }.browse-hero>div { flex:1; min-width:0; }.browse-hero h2 { font-family:var(--sans); font-size:21px; font-weight:700; line-height:1.4; word-break:break-word; }.browse-hero p { margin-top:13px; font-size:12px; color:var(--ink-2); }.browse-hero>div>span { display:block; margin-top:9px; color:var(--ink-3); font-size:11px; }
.browse-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:9px var(--pad); }.browse-play-all { display:flex; align-items:center; min-height:44px; gap:9px; font-size:14px; font-weight:600; }.browse-play-all>span { width:30px; height:30px; border-radius:50%; background:var(--tint); color:var(--ink-inv); display:grid; place-items:center; }.browse-play-all small { font-size:12px; color:var(--ink-3); font-weight:400; }.browse-toolbar>span { font-size:11px; color:var(--ink-3); }.browse-tracks :deep(.songrow) { padding-left:0; padding-right:0; }
.skelrow { display:flex; align-items:center; gap:12px; min-height:64px; }.skelcov { width:44px; height:44px; flex:none; border-radius:9px; }.skellines { flex:1; min-width:0; display:flex; flex-direction:column; gap:8px; }.skelt,.skela { height:11px; width:60%; display:block; }.skela { height:9px; width:35%; }
@media(max-width:375px) { .browse-hero>img { width:112px; height:112px; }.browse-hero h2 { font-size:19px; }.browse-hero { gap:14px; } }

@media (min-width: 768px) {
  .browse-top,
  .catalog-tabs,
  .catalog-sources,
  .catalog-categories,
  .catalog-grid,
  .catalog-notice,
  .catalog-foot,
  .browse-hero,
  .browse-toolbar,
  .browse-tracks,
  .browse-page .scroll > .pad,
  .browse-page .empty {
    width: min(100%, 980px);
    margin-left: auto;
    margin-right: auto;
  }
  .browse-top {
    padding-left: var(--pad);
    padding-right: var(--pad);
  }
  .browse-top h1 { font-size: 18px; }
  .catalog-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 32px 24px;
  }
  .catalog-grid .cover { border-radius: 14px; }
  .catalog-grid .ct { font-size: 15px; }
  .browse-hero { padding: 28px var(--pad) 32px; }
  .browse-hero > img {
    width: 168px;
    height: 168px;
    border-radius: 14px;
  }
  .browse-hero h2 { font-size: 27px; }
  .browse-toolbar { padding-top: 14px; padding-bottom: 12px; }
  .browse-page .empty { max-width: 620px; }
}

@media (min-width: 1000px) {
  .catalog-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
</style>
