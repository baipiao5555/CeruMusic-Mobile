<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SongRow from '@/components/SongRow.vue'
import { allProviders, invokeProvider } from '@/core/plugin/manager'
import { playTracks, toTrack, type Track } from '@/core/playback/player'
import { rememberTracks } from '@/core/search'

const route = useRoute()
const router = useRouter()

const providerId = String(route.query.provider ?? '')
const kind = String(route.query.kind ?? 'chart')
const id = String(route.query.id ?? '')
const title = String(route.query.title ?? '歌单')
const artwork = String(route.query.artwork ?? '/default-cover.png')

const tracks = ref<Track[]>([])
const loading = ref(true)
const error = ref('')
const cursor = ref<string | undefined>(undefined)
const loadingMore = ref(false)
const ended = ref(false)

const provider = computed(() => allProviders().find((item) => item.providerId === providerId))

const resourceRef = computed(() =>
  kind === 'track'
    ? { providerId, kind, id, scope: 'provider' as const }
    : { providerId, kind, id, pluginId: provider.value?.manifestId ?? '' }
)

async function load(more = false): Promise<void> {
  const owner = provider.value
  if (!owner) {
    error.value = '音源插件未启用'
    loading.value = false
    return
  }
  if (more) {
    if (loadingMore.value || ended.value) return
    loadingMore.value = true
  } else {
    loading.value = true
    tracks.value = []
    cursor.value = undefined
    ended.value = false
  }
  error.value = ''
  try {
    let page: any
    if (kind === 'playlist') {
      page = await invokeProvider(owner, 'playlists.get', [resourceRef.value, cursor.value])
    } else if (kind === 'chart') {
      page = await invokeProvider(owner, 'charts.getTracks', [resourceRef.value, cursor.value])
    } else {
      throw new Error('不支持的内容类型')
    }
    const items = (page?.items ?? [])
      .filter((item: any) => item.ref?.kind === 'track')
      .map((item: any) => toTrack(item, owner))
    tracks.value = more ? [...tracks.value, ...items] : items
    cursor.value = page?.nextCursor
    ended.value = !cursor.value
    if (!tracks.value.length) error.value = '没有找到歌曲'
    // 榜单/歌单里的歌进本地索引，搜索页的即时联想才有词可用。
    rememberTracks(items)
  } catch (err: any) {
    error.value = err?.message ?? '加载失败'
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function play(index: number): void {
  if (tracks.value.length) void playTracks(tracks.value, index)
}

function playAll(): void {
  if (tracks.value.length) void playTracks(tracks.value, 0)
}

onMounted(() => void load())
</script>

<template>
  <div class="page">
    <header class="page-header">
      <button class="icon-btn" aria-label="返回" @click="router.back()">
        <Icon name="back" :size="20" />
      </button>
      <button class="icon-btn" aria-label="搜索" @click="router.push('/search')">
        <Icon name="search" :size="19" />
      </button>
    </header>

    <section class="browse-hero card">
      <div class="cover">
        <img :src="artwork" alt="" @error="($event.target as HTMLImageElement).src = '/default-cover.png'" />
      </div>
      <div class="meta">
        <span class="tag">{{ kind === 'playlist' ? '歌单' : '榜单' }}</span>
        <h1>{{ title }}</h1>
        <p>{{ provider?.pluginName }} · {{ tracks.length }} 首</p>
        <button class="btn" style="margin-top: 14px" :disabled="!tracks.length" @click="playAll">
          <Icon name="play" :size="17" /> 播放全部
        </button>
      </div>
    </section>

    <div v-if="loading" class="state">
      <span class="loading-dots"><i /><i /><i /></span>
      <p>正在加载…</p>
    </div>

    <div v-else-if="error && !tracks.length" class="state">
      <div class="emoji">🙁</div>
      <p>{{ error }}</p>
      <button class="btn secondary" @click="load()">重试</button>
    </div>

    <template v-else>
      <div class="song-list" style="margin-top: 18px">
        <SongRow
          v-for="(track, index) in tracks"
          :key="track.providerId + track.id + index"
          :track="track"
          :index="index"
          :queue="tracks"
          show-index
          @play="play(index)"
        />
      </div>
      <button v-if="!ended" class="load-more" :disabled="loadingMore" @click="load(true)">
        <span v-if="loadingMore" class="loading-dots"><i /><i /><i /></span>
        <span v-else>加载更多</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.browse-hero {
  display: flex;
  gap: 16px;
  padding: 16px;
}
.browse-hero .cover {
  width: 118px;
  height: 118px;
  border-radius: 20px;
  overflow: hidden;
  flex: 0 0 auto;
  background: var(--brand-soft);
}
.browse-hero .cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.browse-hero .meta {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
}
.tag {
  align-self: flex-start;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 10px;
  color: var(--brand);
  background: var(--brand-soft);
}
.browse-hero h1 {
  margin-top: 7px;
  font-size: 20px;
  line-height: 1.3;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.browse-hero p {
  margin-top: 6px;
  font-size: 12px;
  color: var(--muted);
}
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 54px 0;
  color: var(--muted);
  font-size: 13px;
}
.state .emoji {
  font-size: 30px;
}
.load-more {
  width: 100%;
  margin-top: 16px;
  padding: 13px;
  border-radius: 14px;
  font-size: 13px;
  color: var(--muted);
  background: var(--surface);
  border: 1px solid var(--line);
}
</style>
