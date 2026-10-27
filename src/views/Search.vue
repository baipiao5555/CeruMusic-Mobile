<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SongRow from '@/components/SongRow.vue'
import {
  allProviders,
  invokeProvider,
  pluginState,
  selectProvider,
  type ProviderHandle
} from '@/core/plugin/manager'
import { playTracks, toTrack, type Track } from '@/core/playback/player'
import { libraryState } from '@/core/library'
import {
  clearSearchHistory,
  highlightParts,
  rankTracks,
  rememberSearch,
  rememberTracks,
  restoreSearchHistory,
  searchHistory,
  suggestTracks
} from '@/core/search'

/** 边打边搜的静默时间：太短会打爆音源，太长会显得卡。 */
const DEBOUNCE_MS = 260
const RESULT_LIMIT = 30
const SUGGEST_LIMIT = 6

const route = useRoute()
const providers = computed(() => allProviders())
const selected = computed(
  () => providers.value.find((item) => item.providerId === pluginState.selectedProvider) ?? providers.value[0]
)

const query = ref(String(route.query.q ?? ''))
/** 当前结果对应的关键词（缩词兜底时会和输入框不一致），高亮按它走。 */
const appliedQuery = ref('')
const results = ref<Track[]>([])
const loading = ref(false)
const error = ref('')
const searched = ref(false)
const relaxedQuery = ref('')
const inputRef = ref<HTMLInputElement>()

const focused = ref(false)
const suggestOpen = ref(false)
const composing = ref(false)

let timer: number | undefined
/** 输入太快时旧请求会后到，用序号丢弃过期响应。 */
let requestSeq = 0

const libraryTracks = computed(() => [
  ...libraryState.favorites,
  ...libraryState.playlists.flatMap((playlist) => playlist.tracks)
])

const suggestions = computed(() =>
  suggestTracks(query.value, libraryTracks.value, SUGGEST_LIMIT)
)

const showSuggest = computed(
  () => suggestOpen.value && focused.value && Boolean(query.value.trim()) && suggestions.value.length > 0
)

const historyVisible = computed(() => !query.value.trim() && searchHistory.items.length > 0)

/** 音源零结果时，退回本地索引，至少让用户看到「打一个字就能找到」的歌。 */
const localMatches = computed(() => {
  if (loading.value || results.value.length || !searched.value || !query.value.trim()) return []
  return suggestTracks(query.value, libraryTracks.value, 12)
})

function clearTimer(): void {
  if (timer) {
    clearTimeout(timer)
    timer = undefined
  }
}

function scheduleSearch(delay = DEBOUNCE_MS): void {
  clearTimer()
  timer = window.setTimeout(() => {
    timer = undefined
    void runSearch('auto')
  }, delay)
}

function onInput(): void {
  suggestOpen.value = true
  if (composing.value) return
  scheduleSearch()
}

function onFocus(): void {
  focused.value = true
  suggestOpen.value = true
}

function onBlur(): void {
  focused.value = false
  suggestOpen.value = false
}

function onCompositionEnd(): void {
  composing.value = false
  // v-model 在部分输入法上会晚一拍，直接读 DOM 值再搜索。
  const value = inputRef.value?.value
  if (typeof value === 'string') query.value = value
  suggestOpen.value = true
  scheduleSearch(0)
}

async function fetchTracks(provider: ProviderHandle, text: string): Promise<Track[]> {
  const page = await invokeProvider(provider, 'tracks.search', [
    { query: text, kinds: ['track'], filters: {}, limit: RESULT_LIMIT }
  ])
  const items = (page?.items ?? []).filter((item: any) => {
    const kind = item?.ref?.kind
    return Boolean(item?.ref?.id) && (!kind || kind === 'track' || kind === 'song')
  })
  return rankTracks(
    items.map((item: any) => toTrack(item, provider)),
    text
  )
}

/**
 * 有的音源只认「整名」或只认歌名（带歌手就搜不到），
 * 所以明确搜索时退化一次：先用第一个词，再用前半段。
 */
function fallbackQueries(text: string): string[] {
  const tokens = text.split(/[\s\-–—/|、,&+]+/).filter(Boolean)
  const candidates: string[] = []
  if (tokens.length > 1) candidates.push(tokens[0])
  const solid = tokens.join('')
  if (solid.length >= 4) candidates.push(solid.slice(0, Math.max(2, Math.ceil(solid.length / 2))))
  return candidates
    .filter((item) => item.length >= 2 && item !== text)
    .filter((item, position, list) => list.indexOf(item) === position)
    .slice(0, 2)
}

async function runSearch(kind: 'auto' | 'submit' = 'submit'): Promise<void> {
  const provider = selected.value
  const text = query.value.trim()
  clearTimer()
  if (!provider) {
    error.value = '请先安装并启用音源插件'
    results.value = []
    return
  }
  if (!text) {
    results.value = []
    appliedQuery.value = ''
    relaxedQuery.value = ''
    error.value = ''
    searched.value = false
    return
  }
  if (!provider.methods.includes('tracks.search')) {
    error.value = '当前音源不支持搜索'
    return
  }
  const seq = ++requestSeq
  loading.value = true
  searched.value = true
  error.value = ''
  relaxedQuery.value = ''
  // 明确提交时收起联想面板；边打边搜不动它，免得正在看建议时被抽走。
  if (kind === 'submit') suggestOpen.value = false
  try {
    let tracks = await fetchTracks(provider, text)
    let used = text
    if (!tracks.length && kind === 'submit') {
      for (const candidate of fallbackQueries(text)) {
        if (seq !== requestSeq) return
        const relaxed = await fetchTracks(provider, candidate)
        if (relaxed.length) {
          tracks = relaxed
          used = candidate
          break
        }
      }
    }
    if (seq !== requestSeq) return
    results.value = tracks
    appliedQuery.value = used
    relaxedQuery.value = used === text ? '' : used
    rememberTracks(tracks)
    if (tracks.length) {
      if (kind === 'submit') rememberSearch(text)
      error.value = ''
    } else {
      error.value = '没有找到相关歌曲'
    }
    // 音源已经给出答案，联想面板就该让位给结果（它只在等结果时提供即时反馈）。
    suggestOpen.value = false
  } catch (err: any) {
    if (seq !== requestSeq) return
    error.value = err?.message ?? '搜索失败'
    results.value = []
    suggestOpen.value = false
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

function submitSearch(): void {
  void runSearch('submit')
}

function useKeyword(text: string): void {
  query.value = text
  suggestOpen.value = false
  void runSearch('submit')
}

function pickSuggestion(track: Track): void {
  const text = track.title?.trim() || query.value
  query.value = text
  suggestOpen.value = false
  rememberSearch(text)
  inputRef.value?.blur()
  void runSearch('submit')
}

function reset(): void {
  clearTimer()
  requestSeq += 1
  query.value = ''
  results.value = []
  appliedQuery.value = ''
  relaxedQuery.value = ''
  error.value = ''
  searched.value = false
  loading.value = false
  suggestOpen.value = false
  nextTick(() => inputRef.value?.focus())
}

function choose(providerId: string): void {
  selectProvider(providerId)
  if (query.value.trim()) void runSearch('submit')
}

function play(index: number): void {
  void playTracks(results.value, index)
}

function playAll(): void {
  if (results.value.length) void playTracks(results.value, 0)
}

function playLocal(index: number): void {
  void playTracks(localMatches.value, index)
}

restoreSearchHistory()

// 插件用 ui.navigation.open 跳到搜索页时会带 ?q=，同一个页面上换词也要跟着搜。
watch(
  () => route.query.q,
  (value) => {
    const text = typeof value === 'string' ? value.trim() : ''
    if (!text || text === query.value) return
    query.value = text
    suggestOpen.value = false
    void runSearch('submit')
  }
)

onMounted(() => {
  if (query.value.trim()) void runSearch('submit')
  else nextTick(() => inputRef.value?.focus())
})

onBeforeUnmount(clearTimer)
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

    <div class="search-wrap">
      <form class="search-bar" @submit.prevent="submitSearch">
        <Icon name="search" :size="19" style="color: var(--muted)" />
        <input
          ref="inputRef"
          v-model="query"
          type="search"
          enterkeyhint="search"
          placeholder="搜索歌名、歌手"
          autocomplete="off"
          @input="onInput"
          @focus="onFocus"
          @blur="onBlur"
          @compositionstart="composing = true"
          @compositionend="onCompositionEnd"
        />
        <button v-if="query" type="button" class="clear" aria-label="清空" @mousedown.prevent="reset">
          <Icon name="close" :size="17" />
        </button>
        <button type="submit" class="search-btn">搜索</button>
      </form>

      <div v-if="showSuggest" class="suggest-panel">
        <button type="button" class="suggest-row direct" @mousedown.prevent="submitSearch">
          <Icon name="search" :size="16" />
          <span class="suggest-name">搜索「{{ query.trim() }}」</span>
          <Icon name="chevron" :size="15" class="suggest-go" />
        </button>
        <button
          v-for="track in suggestions"
          :key="track.providerId + track.id"
          type="button"
          class="suggest-row"
          @mousedown.prevent="pickSuggestion(track)"
        >
          <Icon name="music" :size="16" />
          <span class="suggest-name">
            <template v-for="(part, index) in highlightParts(track.title, query)" :key="index">
              <mark v-if="part.hit" class="hl">{{ part.text }}</mark>
              <template v-else>{{ part.text }}</template>
            </template>
          </span>
          <span v-if="track.artist" class="suggest-artist">{{ track.artist }}</span>
        </button>
      </div>
    </div>

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

    <section v-if="historyVisible" class="history">
      <div class="section-title">
        <h2>最近搜索</h2>
        <button class="link-btn" @click="clearSearchHistory()">
          <Icon name="trash" :size="14" /> 清空
        </button>
      </div>
      <div class="chips history-chips">
        <button v-for="item in searchHistory.items" :key="item" class="chip" @click="useKeyword(item)">
          {{ item }}
        </button>
      </div>
    </section>

    <div v-if="loading && !results.length" class="state">
      <span class="loading-dots"><i /><i /><i /></span>
      <p>正在搜索「{{ query.trim() }}」…</p>
    </div>

    <div v-else-if="error && !results.length" class="state">
      <div class="emoji">🔎</div>
      <p>{{ error }}</p>
      <p class="state-hint">可以少打几个字、只留歌名，或换一个音源再试。</p>
    </div>

    <div v-if="results.length">
      <div class="section-title">
        <h2>
          搜索结果
          <span class="count">{{ results.length }}</span>
          <span v-if="loading" class="inline-loading">搜索中…</span>
        </h2>
        <button class="play-all" @click="playAll">
          <Icon name="play" :size="15" /> 播放全部
        </button>
      </div>
      <p v-if="relaxedQuery" class="relaxed-note">
        音源没有「{{ query.trim() }}」的结果，已按「{{ relaxedQuery }}」搜索
      </p>
      <div class="song-list">
        <SongRow
          v-for="(track, index) in results"
          :key="track.providerId + track.id"
          :track="track"
          :index="index"
          :queue="results"
          :query="appliedQuery"
          @play="play(index)"
        />
      </div>
    </div>

    <div v-if="localMatches.length">
      <div class="section-title">
        <h2>本地歌曲</h2>
      </div>
      <p class="relaxed-note">音源没有返回结果，这些来自你的收藏、歌单和搜过的歌。</p>
      <div class="song-list">
        <SongRow
          v-for="(track, index) in localMatches"
          :key="track.providerId + track.id"
          :track="track"
          :index="index"
          :queue="localMatches"
          :query="query"
          @play="playLocal(index)"
        />
      </div>
    </div>

    <div v-if="!providers.length" class="empty">
      <div class="emoji">🎵</div>
      <h3>还没有音源插件</h3>
      <p>安装插件后才能搜索音乐。</p>
      <button class="btn" @click="$router.push('/plugins')">
        <Icon name="plus" :size="18" /> 安装音源插件
      </button>
    </div>

    <div v-else-if="!searched && !query.trim() && !historyVisible" class="empty">
      <div class="emoji">🎧</div>
      <h3>想听点什么？</h3>
      <p>输入歌名、歌手或专辑，打一个字就会边搜边显示相关歌曲。</p>
    </div>
  </div>
</template>

<style scoped>
.search-wrap {
  position: relative;
  z-index: 20;
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
.suggest-panel {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 6px);
  max-height: 46vh;
  overflow-y: auto;
  padding: 6px;
  border-radius: 16px;
  background: var(--surface-solid);
  border: 1px solid var(--line);
  box-shadow: 0 16px 34px rgba(20, 60, 45, 0.16);
}
.suggest-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 10px 10px;
  border-radius: 11px;
  color: var(--muted);
  text-align: left;
}
.suggest-row + .suggest-row {
  margin-top: 1px;
}
.suggest-row:active {
  background: var(--brand-softer);
}
.suggest-row.direct {
  color: var(--brand);
  font-weight: 600;
}
.suggest-name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.suggest-row.direct .suggest-name {
  color: var(--brand);
}
.suggest-artist {
  flex: 0 0 auto;
  max-width: 44%;
  font-size: 12px;
  color: var(--muted-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.suggest-go {
  color: var(--muted-2);
}
.hl {
  color: var(--brand);
  background: var(--brand-soft);
  border-radius: 3px;
  font-weight: 700;
}
.source-chips {
  flex-wrap: wrap;
  overflow: visible;
  row-gap: 8px;
  padding: 2px 2px 4px;
}
.history-chips {
  flex-wrap: wrap;
  overflow: visible;
  row-gap: 8px;
}
.link-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}
.count {
  margin-left: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}
.inline-loading {
  margin-left: 7px;
  font-size: 11.5px;
  color: var(--brand);
}
.relaxed-note {
  margin: -4px 2px 10px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}
.state-hint {
  max-width: 260px;
  text-align: center;
  line-height: 1.6;
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
