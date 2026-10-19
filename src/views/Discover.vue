<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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
import { getHistory, playTracks } from '@/core/playback/player'
import { libraryState } from '@/core/library'

const router = useRouter()
const providers = computed(() => allProviders())
const selected = computed(
  () => providers.value.find((item) => item.providerId === pluginState.selectedProvider) ?? providers.value[0]
)

const charts = ref<any[]>([])
const playlists = ref<any[]>([])
const loading = ref(false)
const error = ref('')

const history = computed(() => getHistory().slice(0, 8))
const favorites = computed(() => libraryState.favorites.slice(0, 8))

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
  selectProvider(provider.providerId)
}

async function load(): Promise<void> {
  const provider = selected.value
  charts.value = []
  playlists.value = []
  error.value = ''
  if (!provider) return
  loading.value = true
  try {
    if (provider.methods.includes('charts.list')) {
      const chartPage = await invokeProvider(provider, 'charts.list', [])
      charts.value = chartPage?.items ?? []
    }
  } catch (err: any) {
    console.warn('加载榜单失败:', err)
  }
  try {
    if (
      provider.methods.includes('playlists.categories') &&
      provider.methods.includes('playlists.list')
    ) {
      const categories = await invokeProvider(provider, 'playlists.categories', [])
      const category = categories?.items?.[0]
      if (category?.ref) {
        const page = await invokeProvider(provider, 'playlists.list', [category.ref, undefined])
        playlists.value = (page?.items ?? []).filter((item: any) => item.ref?.kind === 'playlist')
      }
    }
  } catch (err: any) {
    console.warn('加载歌单失败:', err)
  }
  loading.value = false
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

function playHistory(index: number): void {
  void playTracks(history.value, index)
}

function playFavorite(index: number): void {
  void playTracks(favorites.value, index)
}

onMounted(load)
watch(selected, load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div class="brand">
        <img class="brand-logo" src="/logo.png" alt="澜音" />
        <div>
          <div class="brand-name">澜音</div>
          <div class="brand-sub">Ceru Music</div>
        </div>
      </div>
      <button class="icon-btn" aria-label="设置" @click="router.push('/settings')">
        <Icon name="settings" :size="21" />
      </button>
    </header>

    <section class="hero">
      <h1>发现音乐</h1>
      <p>你的音源，你的播放器</p>
      <div class="hero-search" @click="router.push('/search')">
        <Icon name="search" :size="19" />
        <span>搜索歌曲、歌手</span>
      </div>
    </section>

    <template v-if="providers.length">
      <div class="chips" style="margin-top: 16px">
        <button
          v-for="provider in providers"
          :key="provider.providerId + provider.pluginId"
          class="chip"
          :class="{ active: selected?.providerId === provider.providerId }"
          @click="choose(provider)"
        >
          {{ provider.name }}
        </button>
      </div>

      <div v-if="loading" class="loading-block">
        <span class="loading-dots"><i /><i /><i /></span>
      </div>

      <template v-else>
        <template v-if="charts.length">
          <div class="section-title">
            <h2>排行榜</h2>
            <span>{{ charts.length }} 个榜单</span>
          </div>
          <div class="grid-cards">
            <button v-for="chart in charts" :key="chart.ref.id" class="media-card" @click="openChart(chart)">
              <div class="cover">
                <img :src="artworkOf(chart)" alt="" loading="lazy" />
                <span class="badge">{{ chart.subtitle || '榜单' }}</span>
              </div>
              <h3>{{ chart.title }}</h3>
              <p>{{ chart.chart?.updateFrequency || '实时更新' }}</p>
            </button>
          </div>
        </template>

        <template v-if="playlists.length">
          <div class="section-title">
            <h2>推荐歌单</h2>
            <span>{{ playlists.length }} 个</span>
          </div>
          <div class="grid-cards">
            <button v-for="playlist in playlists.slice(0, 8)" :key="playlist.ref.id" class="media-card" @click="openChart(playlist)">
              <div class="cover">
                <img :src="artworkOf(playlist)" alt="" loading="lazy" />
                <span class="badge">{{ countOf(playlist) }}</span>
              </div>
              <h3>{{ playlist.title }}</h3>
              <p>{{ playlist.playlist?.author || playlist.subtitle || '精选歌单' }}</p>
            </button>
          </div>
        </template>

        <div v-if="!charts.length && !playlists.length" class="card soft-note">
          <Icon name="info" :size="20" />
          <div>
            <h3>当前音源没有提供首页内容</h3>
            <p>你仍然可以在搜索页直接搜索歌曲。</p>
          </div>
        </div>
      </template>
    </template>

    <template v-else>
      <div class="empty">
        <div class="emoji">🎵</div>
        <h3>还没有可用的音源</h3>
        <p>澜音手机版通过插件获取音乐信息。安装一个 v2 音源插件后，就可以搜索和播放。</p>
        <button class="btn" @click="router.push('/plugins')">
          <Icon name="plus" :size="18" /> 安装音源插件
        </button>
      </div>
    </template>

    <template v-if="history.length">
      <div class="section-title">
        <h2>最近播放</h2>
        <span>{{ history.length }} 首</span>
      </div>
      <div class="hscroll">
        <button v-for="(track, index) in history" :key="track.providerId + track.id" class="media-card" @click="playHistory(index)">
          <div class="cover">
            <img :src="track.artwork" alt="" loading="lazy" />
          </div>
          <h3>{{ track.title }}</h3>
          <p>{{ track.artist }}</p>
        </button>
      </div>
    </template>

    <template v-if="favorites.length">
      <div class="section-title">
        <h2>我喜欢的音乐</h2>
        <span>{{ libraryState.favorites.length }} 首</span>
      </div>
      <div class="song-list">
        <SongRow
          v-for="(track, index) in favorites.slice(0, 5)"
          :key="track.providerId + track.id"
          :track="track"
          :index="index"
          :queue="favorites"
          @play="(queue, i) => playFavorite(i)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.loading-block {
  display: flex;
  justify-content: center;
  padding: 40px 0;
}
.soft-note {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  margin-top: 24px;
  color: var(--muted);
}
.soft-note h3 {
  color: var(--text);
  font-size: 14px;
}
.soft-note p {
  margin-top: 4px;
  font-size: 12px;
}
</style>
