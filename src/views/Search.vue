<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SongRow from '@/components/SongRow.vue'
import {
  allProviders,
  invokeProvider,
  pluginState,
  selectProvider
} from '@/core/plugin/manager'
import { playTracks, toTrack, type Track } from '@/core/playback/player'

const route = useRoute()
const providers = computed(() => allProviders())
const selected = computed(
  () => providers.value.find((item) => item.providerId === pluginState.selectedProvider) ?? providers.value[0]
)

const query = ref(String(route.query.q ?? ''))
const results = ref<Track[]>([])
const loading = ref(false)
const error = ref('')
const searched = ref(false)
const inputRef = ref<HTMLInputElement>()

function choose(providerId: string): void {
  selectProvider(providerId)
  if (searched.value) void search()
}

async function search(): Promise<void> {
  const provider = selected.value
  const text = query.value.trim()
  error.value = ''
  if (!provider) {
    error.value = '请先安装并启用音源插件'
    return
  }
  if (!text) {
    results.value = []
    searched.value = false
    return
  }
  if (!provider.methods.includes('tracks.search')) {
    error.value = '当前音源不支持搜索'
    return
  }
  loading.value = true
  searched.value = true
  try {
    const page = await invokeProvider(provider, 'tracks.search', [
      { query: text, kinds: ['track'], filters: {}, limit: 30 }
    ])
    results.value = (page?.items ?? [])
      .filter((item: any) => item.ref?.kind === 'track')
      .map((item: any) => toTrack(item, provider))
    if (!results.value.length) error.value = '没有找到相关歌曲'
  } catch (err: any) {
    error.value = err?.message ?? '搜索失败'
    results.value = []
  } finally {
    loading.value = false
  }
}

function play(index: number): void {
  void playTracks(results.value, index)
}

function playAll(): void {
  if (results.value.length) void playTracks(results.value, 0)
}

onMounted(() => {
  if (query.value) void search()
  else nextTick(() => inputRef.value?.focus())
})

watch(
  () => route.query.q,
  (value) => {
    if (typeof value === 'string' && value && value !== query.value) {
      query.value = value
      void search()
    }
  }
)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <div class="brand-name" style="font-size: 23px">搜索</div>
        <div class="brand-sub">Search music</div>
      </div>
      <button class="icon-btn" aria-label="设置" @click="$router.push('/settings')">
        <Icon name="settings" :size="21" />
      </button>
    </header>

    <form class="search-bar" @submit.prevent="search">
      <Icon name="search" :size="19" style="color: var(--muted)" />
      <input
        ref="inputRef"
        v-model="query"
        type="search"
        enterkeyhint="search"
        placeholder="搜索歌曲、歌手"
        autocomplete="off"
      />
      <button v-if="query" type="button" class="clear" aria-label="清空" @click="query = ''; results = []; searched = false">
        <Icon name="close" :size="17" />
      </button>
      <button type="submit" class="search-btn">搜索</button>
    </form>

    <div v-if="providers.length" class="chips source-chips" style="margin-top: 14px">
      <button
        v-for="provider in providers"
        :key="provider.providerId + provider.pluginId"
        class="chip"
        :class="{ active: selected?.providerId === provider.providerId }"
        @click="choose(provider.providerId)"
      >
        {{ provider.name }}
      </button>
    </div>

    <div v-if="loading" class="state">
      <span class="loading-dots"><i /><i /><i /></span>
      <p>正在搜索…</p>
    </div>

    <div v-else-if="error" class="state">
      <div class="emoji">🔎</div>
      <p>{{ error }}</p>
    </div>

    <div v-else-if="results.length">
      <div class="section-title">
        <h2>搜索结果</h2>
        <button class="play-all" @click="playAll">
          <Icon name="play" :size="15" /> 播放全部
        </button>
      </div>
      <div class="song-list">
        <SongRow
          v-for="(track, index) in results"
          :key="track.providerId + track.id"
          :track="track"
          :index="index"
          :queue="results"
          @play="play(index)"
        />
      </div>
    </div>

    <div v-else-if="!providers.length" class="empty">
      <div class="emoji">🎵</div>
      <h3>还没有音源插件</h3>
      <p>安装插件后才能搜索音乐。</p>
      <button class="btn" @click="$router.push('/plugins')">
        <Icon name="plus" :size="18" /> 安装音源插件
      </button>
    </div>

    <div v-else-if="!searched" class="empty">
      <div class="emoji">🎧</div>
      <h3>想听点什么？</h3>
      <p>输入歌曲名、歌手或专辑名，按回车开始搜索。</p>
    </div>
  </div>
</template>

<style scoped>
.source-chips {
  flex-wrap: wrap;
  overflow: visible;
  row-gap: 8px;
  padding: 2px 2px 4px;
}
.search-btn {
  padding: 7px 13px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: var(--brand);
}
.clear {
  display: grid;
  place-items: center;
  color: var(--muted-2);
}
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 54px 0;
  color: var(--muted);
  font-size: 13px;
}
.state .emoji {
  font-size: 30px;
}
.play-all {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: var(--brand);
  background: var(--brand-soft);
}
</style>
