<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SongRow from '@/components/SongRow.vue'
import {
  allProviders,
  invokeProvider,
  pluginState,
  selectProvider,
  type ProviderHandle
} from '@/core/plugin/manager'
import {
  getHistory,
  playTracks
} from '@/core/playback/player'
import { libraryState } from '@/core/library'
import { openSearch } from '@/core/searchEntry'

const router = useRouter()
const dailyDate = ref(new Date())
let dailyDateTimer: ReturnType<typeof setInterval> | undefined
function updateDailyDate(): void { dailyDate.value = new Date() }
onMounted(() => { dailyDateTimer = setInterval(updateDailyDate, 60000); document.addEventListener('visibilitychange', updateDailyDate) })
onActivated(updateDailyDate)
onBeforeUnmount(() => { if (dailyDateTimer) clearInterval(dailyDateTimer); document.removeEventListener('visibilitychange', updateDailyDate) })
const providers = computed(() => allProviders())
const selected = computed(
  () => providers.value.find((item) => item.providerId === pluginState.selectedProvider) ?? providers.value[0]
)
const providerKey = computed(() =>
  selected.value ? `${selected.value.pluginId}:${selected.value.providerId}` : ''
)

const charts = ref<any[]>([])
const playlists = ref<any[]>([])
const categories = ref<any[]>([])
const activeCategory = ref(0)
const loading = ref(false)
const error = ref('')
const scrollEl = ref<HTMLElement | null>(null)

/**
 * 首页数据缓存：从其它页面返回时不再清空重拉，
 * 否则每次回首页都会闪一次骨架、并且丢掉滚动位置。
 */
const CACHE_TTL = 5 * 60 * 1000
interface HomeCache {
  providerId: string
  charts: any[]
  playlists: any[]
  categories: any[]
  activeCategory: number
  at: number
}
const homeCaches = new Map<string, HomeCache>()
let lastScrollTop = 0
let loadingProviderKey = ''
let requestSeq = 0
let playlistRequestSeq = 0
let restoring = false

const history = computed(() => getHistory().slice(0, 8))
const favorites = computed(() => libraryState.favorites.slice(0, 8))

const sourcePickerOpen = ref(false)
const spotlight = computed(() => playlists.value[0] ?? null)

const providerName = computed(() => selected.value?.name ?? '未连接音源')

function artworkOf(entity: any): string {
  return (
    entity?.chart?.artworkUrl ||
    entity?.playlist?.artworkUrl ||
    entity?.metadata?.artworkUrl ||
    entity?.artworkUrl ||
    '/default-cover.png'
  )
}

function countOf(entity: any): string {
  const count = entity?.playlist?.trackCount
  if (typeof count === 'number') return `${count} 首`
  return '歌单'
}

function choose(provider: ProviderHandle): void {
  selectProvider(provider.providerId, provider.pluginId)
  sourcePickerOpen.value = false
}

async function loadPlaylists(): Promise<void> {
  const provider = selected.value
  if (!provider) return
  const key = providerKey.value
  const seq = ++playlistRequestSeq
  const category = categories.value[activeCategory.value]
  if (!category?.ref) return
  try {
    const page = await invokeProvider(provider, 'playlists.list', [category.ref, undefined])
    if (seq !== playlistRequestSeq || key !== providerKey.value) return
    playlists.value = (page?.items ?? []).filter((item: any) => item.ref?.kind === 'playlist')
    saveCache(key)
  } catch (err: any) {
    console.warn('加载歌单失败:', err)
  }
}

function applyCache(cache: HomeCache): void {
  charts.value = cache.charts
  playlists.value = cache.playlists
  categories.value = cache.categories
  activeCategory.value = cache.activeCategory
}

function saveCache(key: string): void {
  homeCaches.set(key, {
    providerId: selected.value?.providerId ?? '',
    charts: charts.value,
    playlists: playlists.value,
    categories: categories.value,
    activeCategory: activeCategory.value,
    at: Date.now()
  })
}

/** 拉一轮数据但不碰 loading 状态：过期缓存用它做静默刷新。 */
async function fetchAll(provider: ProviderHandle, seq: number): Promise<void> {
  try {
    if (provider.methods.includes('charts.list')) {
      const chartPage = await invokeProvider(provider, 'charts.list', [])
      if (seq !== requestSeq) return
      charts.value = chartPage?.items ?? []
    }
  } catch (err: any) {
    if (seq !== requestSeq) return
    console.warn('加载榜单失败:', err)
    if (!charts.value.length) error.value = '榜单没能加载出来'
  }
  if (seq !== requestSeq) return
  try {
    if (
      provider.methods.includes('playlists.categories') &&
      provider.methods.includes('playlists.list')
    ) {
      const res = await invokeProvider(provider, 'playlists.categories', [])
      if (seq !== requestSeq) return
      categories.value = res?.items ?? []
      if (!categories.value[activeCategory.value]) activeCategory.value = 0
      const category = categories.value[activeCategory.value]
      if (category?.ref) {
        const playlistSeq = ++playlistRequestSeq
        const page = await invokeProvider(provider, 'playlists.list', [category.ref, undefined])
        if (seq !== requestSeq || playlistSeq !== playlistRequestSeq) return
        playlists.value = (page?.items ?? []).filter((item: any) => item.ref?.kind === 'playlist')
      }
    }
  } catch (err: any) {
    console.warn('加载歌单失败:', err)
  }
}

async function load(force = false): Promise<void> {
  const provider = selected.value
  const key = providerKey.value
  // Cached and empty-provider transitions must also invalidate older requests.
  if (loading.value && loadingProviderKey === key && !force) return
  const seq = ++requestSeq
  playlistRequestSeq += 1
  error.value = ''
  if (!provider) {
    charts.value = []
    playlists.value = []
    categories.value = []
    activeCategory.value = 0
    error.value = ''
    loading.value = false
    loadingProviderKey = ''
    return
  }

  const cached = homeCaches.get(key) ?? null
  if (cached && !force) {
    applyCache(cached)
    loading.value = false
    if (Date.now() - cached.at < CACHE_TTL) return
    // 过期了也先把旧内容留在屏上，后台悄悄换新
    void fetchAll(provider, seq).then(() => {
      if (seq === requestSeq) saveCache(key)
    })
    return
  }

  charts.value = []
  playlists.value = []
  categories.value = []
  activeCategory.value = 0
  error.value = ''
  loading.value = true
  loadingProviderKey = key
  await fetchAll(provider, seq)
  if (seq !== requestSeq) return
  loading.value = false
  loadingProviderKey = ''
  saveCache(key)
}

function selectCategory(index: number): void {
  if (activeCategory.value === index) return
  activeCategory.value = index
  void loadPlaylists()
}

function openChart(chart: any): void {
  router.push({
    path: '/browse',
    query: {
      provider: chart.ref.providerId,
      plugin: selected.value?.pluginId,
      kind: chart.ref.kind,
      id: chart.ref.id,
      title: chart.title,
      artwork: artworkOf(chart)
    }
  })
}

function openCatalog(tab: 'playlists' | 'charts' = 'playlists'): void {
  router.push({ path: '/browse', query: { tab } })
}

function playHistory(index: number): void {
  void playTracks(history.value, index)
}

function playFavorite(index: number): void {
  void playTracks(favorites.value, index)
}

async function restoreScroll(): Promise<void> {
  const target = lastScrollTop
  if (target <= 0) return
  // 进场动画期间容器高度还是 0，赋值会被夹回 0，所以补几帧重试；
  // 重试期间忽略 onScroll，否则被夹出来的 0 会把记住的位置冲掉。
  await nextTick()
  restoring = true
  let tries = 0
  const restore = (): void => {
    const el = scrollEl.value
    if (!el) {
      restoring = false
      return
    }
    el.scrollTop = target
    if (Math.abs(el.scrollTop - target) > 2 && tries++ < 40) {
      requestAnimationFrame(restore)
    } else {
      lastScrollTop = target
      restoring = false
    }
  }
  restore()
}

onMounted(async () => {
  await load()
  await restoreScroll()
})

// keep-alive 把页面移出文档时浏览器会把 scrollTop 归零，回到页面时手动放回
onActivated(() => {
  void restoreScroll()
})

function onScroll(): void {
  if (restoring) return
  lastScrollTop = scrollEl.value?.scrollTop ?? 0
}

onBeforeUnmount(() => {
  // 离场时元素可能已被移出文档、scrollTop 读成 0，别用这个 0 覆盖记住的位置
  const value = scrollEl.value?.scrollTop ?? 0
  if (value > 0) lastScrollTop = value
})

watch(providerKey, () => void load())
</script>

<template>
  <div class="screen discover-page">
    <div class="scroll safe-t" ref="scrollEl" @scroll.passive="onScroll">
      <header class="home-head">
        <nav class="home-channels" aria-label="音乐频道">
          <button class="on" aria-current="page">推荐</button>
          <button @click="openCatalog()">音乐馆</button>
        </nav>
        <div class="home-actions">
          <button class="iconbtn quiet" aria-label="切换音源" @click="sourcePickerOpen = true"><Icon name="plugin" :size="21" /></button>
          <button class="iconbtn quiet" aria-label="设置" @click="router.push('/settings')"><Icon name="settings" :size="21" /></button>
        </div>
      </header>

      <div class="home-search">
        <button class="search-launch" @click="openSearch(router)"><Icon name="search" :size="18" /><span>搜索歌曲、歌手或一句歌词</span></button>
        <button class="lyric-launch" @click="openSearch(router, { path: '/search', query: { mode: 'lyric' } })">歌词找歌</button>
      </div>

      <div class="home-shortcuts">
        <button @click="router.push({ path: '/library', query: { view: 'recent' } })"><span class="shortcut-tile mint"><Icon name="history" :size="23" /></span><span>最近播放</span></button>
        <button @click="openCatalog('charts')"><span class="shortcut-tile orange"><Icon name="sort" :size="23" /></span><span>排行榜</span></button>
        <button @click="openCatalog('playlists')"><span class="shortcut-tile purple"><Icon name="playlist" :size="23" /></span><span>歌单精选</span></button>
        <button @click="router.push('/local')"><span class="shortcut-tile blue"><Icon name="folder" :size="23" /></span><span>本地音乐</span></button>
      </div>

      <button class="daily-entry" aria-label="查看澜音每日精选（本地）" @click="router.push('/daily')">
        <span class="daily-card-date"><small>{{ dailyDate.getMonth() + 1 }} 月</small><strong>{{ String(dailyDate.getDate()).padStart(2, '0') }}</strong></span>
        <span class="daily-card-copy"><strong>澜音每日精选（本地）</strong><small>收藏、歌单与最近播放 · 每日更新</small></span><Icon name="chevron" :size="18" />
      </button>

      <button v-if="spotlight" class="spotlight" @click="openChart(spotlight)">
        <span class="spotlight-copy"><small>{{ providerName }} · 精选</small><strong class="clamp-2">{{ spotlight.title }}</strong><span>{{ spotlight.playlist?.author || countOf(spotlight) }}<Icon name="chevron" :size="13" /></span></span>
        <img :src="artworkOf(spotlight)" alt="" @error="($event.target as HTMLImageElement).src = '/default-cover.png'" />
        <span class="spotlight-go"><Icon name="play" :size="15" /></span>
      </button>

      <div v-if="loading || pluginState.loading" class="pad mt24" aria-live="polite">
        <div class="skeleton" style="height: 150px; border-radius: 13px" />
        <div class="home-skeletons mt16"><div v-for="i in 3" :key="i" class="skeleton" /></div>
        <p class="meta mt12">正在加载音源内容…</p>
      </div>

      <template v-else>
        <template v-if="playlists.length">
          <div class="section-head mt24"><div class="st"><h2>听点喜欢的</h2></div><button class="more" @click="openCatalog()">更多歌单<Icon name="chevron" :size="14" /></button></div>
          <div v-if="categories.length > 1" class="chip-row pad home-categories">
            <button v-for="(category, index) in categories" :key="category.ref?.id || index" class="chip" :class="{ active: activeCategory === index }" @click="selectCategory(index)">{{ category.title }}</button>
          </div>
          <div class="hscroll home-covers">
            <button v-for="playlist in playlists.slice(0, 8)" :key="playlist.ref.id" class="mediacard" @click="openChart(playlist)">
              <div class="cover"><img :src="artworkOf(playlist)" alt="" @error="($event.target as HTMLImageElement).src = '/default-cover.png'" /><span class="cover-play"><Icon name="play" :size="12" /></span></div>
              <div class="ct clamp-2">{{ playlist.title }}</div><div class="cs truncate">{{ playlist.playlist?.author || countOf(playlist) }}</div>
            </button>
          </div>
        </template>

        <template v-if="history.length">
          <div class="section-head mt24"><div class="st"><h2>最近在听</h2></div><button class="more" @click="router.push({ path: '/library', query: { view: 'recent' } })">全部<Icon name="chevron" :size="14" /></button></div>
          <div class="pad"><SongRow v-for="(track, index) in history.slice(0, 4)" :key="track.pluginId + ':' + track.providerId + ':' + track.id" :track="track" :index="index" :queue="history" @play="(_, i) => playHistory(i)" /></div>
        </template>

        <template v-if="charts.length">
          <div class="section-head mt24"><div class="st"><h2>排行榜</h2></div><button class="more" @click="openCatalog('charts')">全部榜单<Icon name="chevron" :size="14" /></button></div>
          <div class="hscroll home-covers">
            <button v-for="chart in charts.slice(0, 8)" :key="chart.ref.id" class="mediacard" @click="openChart(chart)">
              <div class="cover"><img :src="artworkOf(chart)" alt="" @error="($event.target as HTMLImageElement).src = '/default-cover.png'" /><span class="cover-play"><Icon name="play" :size="12" /></span></div>
              <div class="ct clamp-2">{{ chart.title }}</div><div class="cs truncate">{{ chart.chart?.updateFrequency || chart.subtitle || providerName }}</div>
            </button>
          </div>
        </template>

        <template v-if="favorites.length">
          <div class="section-head mt24"><div class="st"><h2>我喜欢的音乐</h2></div><button class="more" @click="playFavorite(0)">全部播放<Icon name="play" :size="13" /></button></div>
          <div class="pad"><SongRow v-for="(track, index) in favorites.slice(0, 4)" :key="track.pluginId + ':' + track.providerId + ':' + track.id" :track="track" :index="index" :queue="favorites" @play="(_, i) => playFavorite(i)" /></div>
        </template>

        <div v-if="!providers.length" class="empty">
          <div class="glyph"><Icon name="plugin" :size="30" /></div><h3>把喜欢的音乐带进来</h3><p>启用音源后可搜索和浏览音乐；本地音乐与已有收藏仍可使用。</p><button class="btn btn-primary mt8" @click="router.push('/plugins')"><Icon name="plus" :size="17" />添加音源</button>
        </div>
        <div v-else-if="error && !charts.length" class="empty">
          <div class="glyph"><Icon name="wifi-off" :size="30" /></div><h3>{{ error }}</h3><p>检查网络后重试，或切换音源。</p><button class="btn btn-ghost btn-sm mt8" @click="load(true)"><Icon name="refresh" :size="16" />重新加载</button>
        </div>
        <div v-else-if="!playlists.length && !charts.length" class="home-note pad">
          <Icon name="info" :size="18" /><div><strong>这个音源暂未提供首页内容</strong><p>可以直接搜索歌曲，也可以从本地音乐开始听。</p><button @click="openSearch(router)">去搜索<Icon name="chevron" :size="13" /></button></div>
        </div>
      </template>

      <div class="home-source-footer"><button @click="sourcePickerOpen = true">{{ providerName }}<Icon name="chevron-down" :size="13" /></button><button :disabled="loading" @click="load(true)"><Icon name="refresh" :size="14" />刷新内容</button></div>
    </div>

    <Teleport to="body">
      <div v-if="sourcePickerOpen" class="sheet-mask" @click.self="sourcePickerOpen = false">
        <section class="sheet home-source-sheet" role="dialog" aria-modal="true" aria-label="选择音源">
          <div class="grab" /><div class="sh-head"><span class="sh-title">选择音源</span><button class="iconbtn quiet" aria-label="关闭" @click="sourcePickerOpen = false"><Icon name="close" :size="20" /></button></div>
          <div class="pad"><button v-for="provider in providers" :key="provider.pluginId + ':' + provider.providerId" class="source-option" @click="choose(provider)"><span><strong>{{ provider.name }}</strong><small>{{ provider.pluginName }}</small></span><Icon v-if="selected?.pluginId === provider.pluginId && selected?.providerId === provider.providerId" name="check" :size="20" /></button><p v-if="!providers.length" class="meta">还没有已启用的音源。</p><button class="btn btn-tonal btn-block mt16" @click="sourcePickerOpen = false; router.push('/plugins')"><Icon name="plugin" :size="17" />音源管理</button></div>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.daily-entry{display:flex;align-items:center;gap:13px;margin:0 var(--pad) 18px;width:calc(100% - var(--pad) * 2);min-height:84px;padding:11px 14px;border:1px solid var(--line-2);border-radius:14px;text-align:left;background:linear-gradient(120deg,var(--tint-soft),var(--porcelain));color:var(--ink)}.daily-card-date{flex:none;width:44px;text-align:center;color:var(--brand-strong)}.daily-card-date small{font-size:10px;display:block}.daily-card-date strong{font-size:30px;line-height:1.25;font-weight:650}.daily-card-copy{flex:1;min-width:0}.daily-card-copy strong{display:block;font-size:15px;font-weight:600;line-height:1.5}.daily-card-copy small{display:block;font-size:10px;color:var(--ink-3);line-height:1.6;margin-top:4px}@media(max-width:375px){.daily-entry{gap:10px;padding-left:11px;padding-right:11px}.daily-card-copy strong{font-size:14px}}
.home-head { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:0 12px 0 var(--pad); min-height:58px; }
.home-channels { display:flex; align-items:center; gap:22px; min-width:0; }
.home-channels button { position:relative; height:52px; font-size:19px; font-weight:600; color:var(--ink-3); white-space:nowrap; }
.home-channels .on { font-size:25px; font-weight:750; color:var(--ink); }
.home-channels .on::after { content:''; position:absolute; bottom:2px; left:calc(50% - 11px); width:22px; height:4px; background:var(--tint); border-radius:4px; }
.home-actions { display:flex; flex:none; }
.home-actions .iconbtn { width:40px; height:44px; }
.home-search { display:flex; align-items:center; height:44px; margin:12px var(--pad) 18px; border-radius:24px; background:var(--porcelain-2); }
.search-launch { display:flex; flex:1; min-width:0; gap:8px; align-items:center; height:44px; padding:0 12px; color:var(--ink-3); transition: opacity var(--motion-press) var(--e-out), transform var(--motion-press) var(--e-out); }
.search-launch span { font-size:12px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.search-launch:active, .lyric-launch:active { opacity:.62; transform:scale(.985); }
.lyric-launch { height:44px; flex:none; padding:0 13px 0 9px; font-size:11px; color:var(--ink-3); position:relative; transition: opacity var(--motion-press) var(--e-out), transform var(--motion-press) var(--e-out); }
.lyric-launch::before { content:''; position:absolute; left:0; top:15px; height:14px; width:1px; background:var(--line-2); }
.home-shortcuts { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); padding:0 var(--pad); gap:6px; margin-bottom:22px; }
.home-shortcuts button { display:flex; flex-direction:column; align-items:center; gap:8px; min-height:66px; font-size:12px; }
.shortcut-tile { display:grid; place-items:center; width:40px; height:40px; border-radius:13px; }
.mint { background:#e6f8f0; color:#0aaa75; }.orange { background:#fff0de; color:#d89431; }.purple { background:#f0eaff; color:#9170d5; }.blue { background:#e8f1ff; color:#588dd3; }
.spotlight { position:relative; display:flex; align-items:center; width:calc(100% - var(--pad) * 2); height:150px; overflow:hidden; margin:0 var(--pad); border-radius:13px; background:var(--tint-soft); padding:18px; text-align:left; }
.spotlight-copy { min-width:0; width:58%; z-index:1; padding-right:8px; }.spotlight-copy small { font-size:10px; color:var(--ink-3); display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.spotlight-copy strong { display:-webkit-box; margin-top:10px; font-size:22px; line-height:1.35; font-weight:750; word-break:break-word; }.spotlight-copy>span { display:flex; align-items:center; gap:4px; font-size:11px; color:var(--ink-3); margin-top:9px; }
.spotlight>img { position:absolute; right:-11px; bottom:-22px; height:168px; width:168px; object-fit:cover; transform:rotate(12deg); border-radius:18px; opacity:.87; }.spotlight-go { position:absolute; right:14px; bottom:12px; display:grid; place-items:center; width:30px; height:30px; border-radius:50%; background:rgba(255,255,255,.9); color:#183b2d; }
.home-covers .mediacard { width:110px; flex:none; }.home-covers .cover { width:110px; height:110px; border-radius:10px; }.home-covers .ct { min-height:38px; font-size:13px; line-height:1.5; font-weight:500; }.home-covers .cs { font-size:11px; }.cover-play { position:absolute; display:grid; place-items:center; right:7px; bottom:7px; width:23px; height:23px; border-radius:50%; color:#1c4432; background:rgba(255,255,255,.9); }.home-categories { padding-bottom:12px; }
.home-skeletons { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }.home-skeletons>div { height:110px; }
.home-note { display:flex; gap:12px; align-items:flex-start; margin-top:24px; color:var(--ink-3); }.home-note strong { font-size:13px; font-weight:500; }.home-note p { font-size:12px; line-height:1.6; margin-top:6px; }.home-note button { display:flex; gap:5px; align-items:center; min-height:40px; color:var(--brand-strong); font-size:12px; }
.home-source-footer { display:flex; justify-content:space-between; gap:12px; padding:24px var(--pad) 0; }.home-source-footer button { display:flex; align-items:center; gap:6px; min-height:44px; min-width:0; color:var(--ink-3); font-size:11px; }.home-source-footer button:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.home-source-sheet { max-height:80dvh; overflow:auto; }.source-option { display:flex; align-items:center; gap:12px; justify-content:space-between; width:100%; min-height:64px; border-bottom:1px solid var(--line); }.source-option>span { min-width:0; }.source-option strong { display:block; font-size:14px; font-weight:500; }.source-option small { display:block; color:var(--ink-3); font-size:11px; margin-top:5px; }.source-option>.i { color:var(--tint); }
[data-theme='dark'] .shortcut-tile { background:var(--surface-2); }
@media(max-width:375px) { .home-channels { gap:17px; }.home-channels button { font-size:18px; }.home-channels .on { font-size:24px; }.home-actions .iconbtn { width:36px; }.spotlight-copy strong { font-size:20px; } }

@media (min-width: 768px) {
  .home-head,
  .home-shortcuts,
  .daily-entry,
  .spotlight,
  .home-source-footer,
  .home-search,
  .home-covers,
  .home-note,
  .empty {
    width: min(100%, 980px);
    margin-left: auto;
    margin-right: auto;
  }
  .discover-page .scroll > .pad {
    width: min(100%, 980px);
    margin-left: auto;
    margin-right: auto;
  }
  .home-head {
    padding-left: var(--pad);
    padding-right: var(--pad);
  }
  .home-search {
    width: min(calc(100% - var(--pad) * 2), 760px);
    margin-top: 14px;
    margin-bottom: 22px;
  }
  .home-shortcuts {
    gap: 14px;
    margin-bottom: 26px;
  }
  .home-shortcuts button {
    flex-direction: row;
    justify-content: flex-start;
    gap: 12px;
    min-height: 76px;
    padding: 0 18px;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--surface);
    font-size: 13px;
  }
  .shortcut-tile {
    width: 44px;
    height: 44px;
    border-radius: 14px;
  }
  .daily-entry {
    width: min(calc(100% - var(--pad) * 2), 980px);
    margin-bottom: 22px;
  }
  .spotlight {
    width: min(calc(100% - var(--pad) * 2), 980px);
    height: 184px;
    padding: 24px;
  }
  .spotlight-copy { width: 56%; }
  .spotlight-copy strong { font-size: 27px; }
  .spotlight > img {
    width: 200px;
    height: 200px;
    right: 10px;
    bottom: -24px;
  }
  .home-covers .mediacard { width: 136px; }
  .home-covers .cover {
    width: 136px;
    height: 136px;
    border-radius: 12px;
  }
  .home-covers .ct { font-size: 13.5px; }
  .home-skeletons { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .home-source-footer { padding-top: 28px; }
  .empty { max-width: 560px; }
}
</style>
