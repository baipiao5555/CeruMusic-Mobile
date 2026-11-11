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
  currentTrack,
  getHistory,
  playTracks,
  playerState,
  togglePlay,
  type Track
} from '@/core/playback/player'
import { libraryState } from '@/core/library'
import { highestQuality, qualityLabel } from '@/core/quality'

const router = useRouter()
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

const daypart = computed(() => {
  const hour = new Date().getHours()
  if (hour < 5) return '深夜'
  if (hour < 9) return '早间'
  if (hour < 12) return '上午'
  if (hour < 18) return '下午'
  if (hour < 23) return '晚间'
  return '深夜'
})

      /** 继续播放卡：优先当前曲目，其次最近一次播放记录。 */
const heroTrack = computed<Track | null>(() => currentTrack() ?? history.value[0] ?? null)
const heroIsCurrent = computed(() => {
  const track = currentTrack()
  return Boolean(track && heroTrack.value && track.id === heroTrack.value.id)
})
const heroProgress = computed(() => {
  if (!heroIsCurrent.value || !playerState.duration) return 0
  return Math.min(100, (playerState.currentTime / playerState.duration) * 100)
})
const heroQuality = computed(() => {
  const track = heroTrack.value
  if (!track) return ''
  const best = highestQuality(track.qualities)
  return best ? qualityLabel(best) : '标准'
})

function mmss(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0:00'
  const m = Math.floor(value / 60)
  const s = Math.floor(value % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
const heroElapsed = computed(() => (heroIsCurrent.value ? mmss(playerState.currentTime) : '0:00'))
const heroDuration = computed(() => {
  const track = heroTrack.value
  const known = heroIsCurrent.value && playerState.duration ? playerState.duration : 0
  return mmss(known || (track?.durationMs ? track.durationMs / 1000 : 0))
})

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
      kind: chart.ref.kind,
      id: chart.ref.id,
      title: chart.title,
      artwork: artworkOf(chart)
    }
  })
}

function openPlayer(): void {
  router.push('/player')
}

function playHero(): void {
  if (heroIsCurrent.value) {
    togglePlay()
    return
  }
  const track = heroTrack.value
  if (!track) return
  const index = history.value.findIndex((item) => item.id === track.id)
  void playTracks(history.value, Math.max(0, index))
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
  <div class="screen">
    <div class="scroll safe-t-lg" ref="scrollEl" @scroll.passive="onScroll">
      <div class="pad">
        <div class="eyebrow">Ceru Music · {{ daypart }}</div>
      </div>

      <div class="page-head mt10">
        <div>
          <h1>发现</h1>
        <div class="sub">
          <template v-if="pluginState.loading">正在载入音源…</template>
          <template v-else>{{ providerName }} · {{ charts.length }} 个榜单 · {{ playlists.length }} 张歌单</template>
        </div>
        </div>
        <div class="page-actions">
          <button class="iconbtn soft" aria-label="云端歌单" @click="router.push('/cloud')">
            <Icon name="cloud" :size="19" />
          </button>
          <button class="iconbtn soft" aria-label="设置" @click="router.push('/settings')">
            <Icon name="settings" :size="19" />
          </button>
        </div>
      </div>

      <!-- 继续播放 -->
      <div v-if="heroTrack" class="hero" @click="openPlayer">
        <img
          class="hero-img"
          :src="heroTrack.artwork || '/default-cover.png'"
          alt=""
          @error="($event.target as HTMLImageElement).src = '/default-cover.png'"
        />
        <div class="imgscrim hero-scrim" />
        <div class="hero-top">
          <span class="badge on-art">
              <Icon name="play" :size="10" />{{ heroIsCurrent ? '正在播放' : '继续播放' }}
          </span>
          <span class="badge on-art">{{ providerName }} · {{ heroQuality }}</span>
        </div>
        <div class="hero-bot">
          <div class="hero-row">
            <div class="hero-txt">
              <div class="hero-title truncate">{{ heroTrack.title }}</div>
              <div class="hero-artist truncate">{{ heroTrack.artist }}</div>
            </div>
            <button class="hero-play" aria-label="播放" @click.stop="playHero">
              <Icon :name="heroIsCurrent && playerState.playing ? 'pause' : 'play'" :size="20" />
            </button>
          </div>
          <div class="hero-prog">
            <div class="hero-bar">
              <i :style="{ width: heroProgress + '%' }" />
              <b class="hero-thumb" :style="{ left: heroProgress + '%' }" />
            </div>
            <div class="hero-time"><span>{{ heroElapsed }}</span><span>{{ heroDuration }}</span></div>
          </div>
        </div>
      </div>

      <template v-if="providers.length">
        <div class="chip-row mt20 pad src-row">
          <span class="src-lab">音源</span>
          <button
            v-for="provider in providers"
            :key="provider.pluginId + ':' + provider.providerId"
            class="chip"
            :class="{ active: selected?.providerId === provider.providerId && selected?.pluginId === provider.pluginId }"
            @click="choose(provider)"
          >
            <span class="dot" />{{ provider.name }}
          </button>
        </div>

        <div v-if="loading || pluginState.loading" class="pad mt24">
          <div class="skeleton" style="height: 190px; border-radius: 20px" />
          <div class="grid2 mt16">
            <div class="skeleton" style="height: 150px" />
            <div class="skeleton" style="height: 150px" />
          </div>
        </div>

        <template v-else>
          <template v-if="charts.length">
            <div class="section-head mt24">
              <div class="st"><h2>排行榜</h2><span class="idx">CHARTS</span></div>
              <span class="more">共 {{ charts.length }} 个</span>
            </div>
            <div class="hscroll" :class="{ single: charts.length === 1 }">
              <button
                v-for="(chart, index) in charts"
                :key="chart.ref.id"
                class="rankcard"
                @click="openChart(chart)"
              >
                <div class="cover">
                  <img
                    :src="artworkOf(chart)"
                    alt=""
                   
                    @error="($event.target as HTMLImageElement).src = '/default-cover.png'"
                  />
                  <div class="shade" />
                  <span class="rk">{{ String(index + 1).padStart(2, '0') }}</span>
                  <span class="rt">{{ chart.title }}</span>
                  <span class="rs">{{ chart.chart?.updateFrequency || chart.subtitle || '实时更新' }}</span>
                </div>
              </button>
            </div>
          </template>

          <template v-if="playlists.length">
            <div class="section-head mt24">
              <div class="st"><h2>推荐歌单</h2><span class="idx">{{ categories[activeCategory]?.title || 'FOR YOU' }}</span></div>
              <button class="more" @click="router.push('/browse')">全部<Icon name="chevron" :size="14" /></button>
            </div>
            <div v-if="categories.length > 1" class="chip-row pad" style="padding-bottom: 14px">
              <button
                v-for="(category, index) in categories"
                :key="category.ref?.id || index"
                class="chip"
                :class="{ active: activeCategory === index }"
                @click="selectCategory(index)"
              >
                {{ category.title }}
              </button>
            </div>
            <div class="grid2 pad">
              <button
                v-for="playlist in playlists.slice(0, 8)"
                :key="playlist.ref.id"
                class="mediacard"
                @click="openChart(playlist)"
              >
                <div class="cover">
                  <img
                    :src="artworkOf(playlist)"
                    alt=""
                   
                    @error="($event.target as HTMLImageElement).src = '/default-cover.png'"
                  />
                  <span class="badge on-art">{{ countOf(playlist) }}</span>
                </div>
                <div class="ct clamp-2">{{ playlist.title }}</div>
                <div class="cs truncate">
                  {{ playlist.playlist?.author || playlist.subtitle || '精选歌单' }}
                </div>
              </button>
            </div>
          </template>

          <div v-if="!playlists.length && charts.length" class="pad mt20">
            <div class="tipcard">
              <div class="tc-t">这个音源没有提供歌单分类</div>
              <div class="tc-s">排行榜可以照常听；想找具体的歌，去搜索页更快，也可以再装一个音源。</div>
              <div class="row g8 mt14">
                <button class="btn btn-tonal btn-sm" @click="router.push('/search')">
                  <Icon name="search" :size="14" /> 去搜索
                </button>
                <button class="btn btn-ghost btn-sm" @click="router.push('/plugins')">
                  <Icon name="plugin" :size="14" /> 音源插件
                </button>
              </div>
            </div>
          </div>

          <div v-if="!charts.length && !playlists.length && !error" class="empty">
            <div class="glyph"><Icon name="info" :size="34" /></div>
          <h3>这个音源没有提供首页内容</h3>
          <p>你仍然可以在搜索页直接搜索歌曲，或换一个音源再看看。</p>
          </div>

          <div v-if="error && !charts.length" class="empty">
            <div class="glyph"><Icon name="wifi-off" :size="34" /></div>
            <h3>{{ error }}</h3>
          <p>检查网络后重试，或者换一个音源。</p>
            <button class="btn btn-ghost btn-sm mt8" @click="load(true)">
              <Icon name="refresh" :size="16" /> 重新加载
            </button>
          </div>
        </template>
      </template>

      <div v-else class="empty">
        <div class="glyph"><Icon name="plugin" :size="34" /></div>
        <h3>还没有可用的音源</h3>
          <p>澜音通过插件获取音乐信息。安装一个 v2 音源插件后，就可以搜索和播放。</p>
        <button class="btn btn-primary mt8" @click="router.push('/plugins')">
            <Icon name="plus" :size="17" /> 安装音源插件
        </button>
      </div>

      <template v-if="history.length">
        <div class="section-head mt24">
          <div class="st"><h2>最近播放</h2><span class="idx">{{ history.length }} TRACKS</span></div>
          <button class="more" @click="playHistory(0)">全部播放</button>
        </div>
        <div class="pad">
          <div
            v-for="(track, index) in history.slice(0, 5)"
            :key="track.providerId + track.id"
            class="songrow"
            @click="playHistory(index)"
          >
            <span class="idx">{{ String(index + 1).padStart(2, '0') }}</span>
            <div class="cover">
              <img
                :src="track.artwork"
                alt=""
               
                @error="($event.target as HTMLImageElement).src = '/default-cover.png'"
              />
            </div>
            <div class="meta-wrap">
              <div class="t truncate">{{ track.title }}</div>
              <div class="a"><span class="truncate">{{ track.artist }}</span></div>
            </div>
            <span class="r"><Icon name="play" :size="15" /></span>
          </div>
        </div>
      </template>

      <template v-if="favorites.length">
        <div class="section-head mt24">
          <div class="st"><h2>我喜欢的音乐</h2><span class="idx">{{ libraryState.favorites.length }} LIKED</span></div>
          <button class="more" @click="playFavorite(0)">全部播放</button>
        </div>
        <div class="pad">
          <SongRow
            v-for="(track, index) in favorites.slice(0, 4)"
            :key="track.providerId + track.id"
            :track="track"
            :index="index"
            :queue="favorites"
            @play="(_, i) => playFavorite(i)"
          />
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.tipcard {
  padding: 18px 18px 16px;
  border-radius: var(--r-lg);
  background: var(--surface);
  border: 1px solid var(--line);
}
.tipcard .tc-t {
  font-family: var(--serif);
  font-size: 15.5px;
  font-weight: 600;
  color: var(--ink);
}
.tipcard .tc-s {
  margin-top: 5px;
  font-size: 12px;
  line-height: 1.62;
  color: var(--ink-3);
}
.src-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 18px;
}
.src-lab {
  flex: none;
  padding-right: 2px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: var(--ink-4);
}
.hero {
  position: relative;
  margin: 0 var(--pad);
  height: 206px;
  border-radius: var(--r-lg);
  overflow: hidden;
  box-shadow: var(--sh-3);
  cursor: pointer;
}
.hero-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: brightness(0.92) saturate(1.04);
  transform: scale(1.06);
}
.hero-scrim {
  z-index: 1;
  background: linear-gradient(
    180deg,
    rgba(6, 16, 13, 0.46) 0%,
    rgba(6, 16, 13, 0.05) 26%,
    rgba(6, 16, 13, 0.62) 62%,
    rgba(6, 16, 13, 0.94) 100%
  );
}
.hero-top {
  position: absolute;
  z-index: 2;
  top: 14px;
  left: 16px;
  right: 16px;
  display: flex;
  gap: 6px;
  justify-content: space-between;
  align-items: center;
}
.hero-bot {
  position: absolute;
  z-index: 2;
  left: 16px;
  right: 16px;
  bottom: 14px;
  color: #fff;
}
.hero-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.hero-txt {
  flex: 1;
  min-width: 0;
}
.hero-kicker {
  font-size: 9.5px;
  font-weight: 650;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.7);
}
.hero-title {
  font-family: var(--serif);
  font-size: 23px;
  font-weight: 600;
  letter-spacing: 0.005em;
  line-height: 1.2;
  color: #fff;
  text-shadow: 0 2px 18px rgba(0, 0, 0, 0.45);
}
.hero-artist {
  margin-top: 4px;
  font-size: 11.5px;
  letter-spacing: 0.01em;
  color: rgba(255, 255, 255, 0.82);
  text-shadow: 0 1px 10px rgba(0, 0, 0, 0.4);
}
.hero-prog {
  margin-top: 12px;
}
.hero-bar {
  position: relative;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.26);
}
.hero-bar i {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: #fff;
}
.hero-thumb {
  position: absolute;
  top: 50%;
  width: 9px;
  height: 9px;
  margin: -4.5px 0 0 -4.5px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);
}
.hero-time {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 10.5px;
  color: rgba(255, 255, 255, 0.72);
  font-variant-numeric: tabular-nums;
}
.hero-play {
  flex: none;
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: #fff;
  color: #11231e;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
}
.hero-play:active {
  transform: scale(0.94);
}
</style>
