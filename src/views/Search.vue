<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import PlaylistSearchPane from '@/components/PlaylistSearchPane.vue'
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router'
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
  matchScore,
  normalizeText,
  rankTracks,
  rememberSearch,
  rememberTracks,
  restoreSearchHistory,
  searchHistory,
  searchLyricCatalog,
  suggestTracks,
  type LyricCandidate
} from '@/core/search'
import { matchCloudLyrics } from '@/core/lyrics/cloud'

/** 一次搜索最多取多少条。 */
const RESULT_LIMIT = 30
const SUGGEST_LIMIT = 10

/** 搜索方式：按歌名（默认）还是按一句歌词找歌。 */
const MODE_KEY = 'ceru.search.mode.v1'
type SearchMode = 'name' | 'lyric'
const mode = ref<SearchMode>(localStorage.getItem(MODE_KEY) === 'lyric' ? 'lyric' : 'name')
const lyricHits = ref<Record<string, string>>({})
const lyricProgress = ref({ done: 0, total: 0 })
/** 歌词库认出来了、但当前音源搜不到的歌，用来解释「为什么是空的」。 */
const lyricMissing = ref<string[]>([])

function setMode(next: SearchMode): void {
  if (mode.value === next) return
  cancelSuggestions()
  mode.value = next
  localStorage.setItem(MODE_KEY, next)
  lyricHits.value = {}
  lyricProgress.value = { done: 0, total: 0 }
  lyricMissing.value = []
  error.value = ''
  if (query.value.trim()) void runSearch()
}

const route = useRoute()
const router = useRouter()

function goBack(): void {
  if (window.history.state?.back) router.back()
  else void router.replace('/')
}
const providers = computed(() => allProviders())
const selected = computed(
  () => providers.value.find((item) => item.providerId === pluginState.selectedProvider) ?? providers.value[0]
)
const providerKey = computed(() =>
  selected.value ? `${selected.value.pluginId}:${selected.value.providerId}:${pluginState.accountEpochs[selected.value.pluginId] || 0}` : ''
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
const remoteSuggestions = ref<Track[]>([])
let suggestSeq = 0
let suggestTimer: ReturnType<typeof setTimeout> | undefined

/** 输入太慢/太快都可能有旧请求后到，用序号丢弃过期响应。 */
let requestSeq = 0
let searchedProviderKey = ''
let resumeSubmittedSearch = false

const libraryTracks = computed(() => [
  ...libraryState.favorites,
  ...libraryState.playlists.flatMap((playlist) => playlist.tracks)
])

const suggestions = computed(() => {
  const needle = normalizeText(query.value)
  if (!needle || mode.value !== 'name') return []
  const local = suggestTracks(query.value, libraryTracks.value, Infinity).filter(
    (track) => !selected.value ||
      (track.pluginId === selected.value.pluginId && track.providerId === selected.value.providerId)
  )
  const seen = new Set<string>()
  return [...remoteSuggestions.value, ...local]
    .filter((track) => {
      const title = normalizeText(track.title)
      if (!title.includes(needle) || seen.has(title)) return false
      seen.add(title)
      return true
    })
    .sort((a, b) => matchScore(b, query.value) - matchScore(a, query.value))
    .slice(0, SUGGEST_LIMIT)
})

const showSuggest = computed(
  () => tab.value !== 'playlists' && suggestOpen.value && focused.value && !composing.value &&
    mode.value === 'name' && Boolean(query.value.trim())
)

const historyVisible = computed(() => !query.value.trim() && searchHistory.items.length > 0)

/** 音源零结果时，退回本地索引，至少让用户看到「打一个字就能找到」的歌。 */
const localMatches = computed(() => {
  if (mode.value === 'lyric' || loading.value || results.value.length || !searched.value || !query.value.trim()) return []
  return suggestTracks(query.value, libraryTracks.value, 12)
})

/* —— 以下只做纯 UI 派生：分组计数、真错误/无结果分流、热门词轮换 —— */

/** 结果分组：单曲 / 歌手 / 本地歌单。 */
const tab = ref<'songs' | 'artists' | 'playlists'>(route.query.target === 'playlists' ? 'playlists' : 'songs')
const playlistQuery = ref(String(route.query.target === 'playlists' ? route.query.playlistQ || route.query.q || '' : ''))
let playlistInitialized = route.query.target === 'playlists'
const playlistPane = ref<{ search(): Promise<void>; clear(): void; ensureSearch(): Promise<void> }>()
const searchScroll = ref<HTMLElement>()
let songScrollTop = 0
let playlistScrollTop = 0
const inputQuery = computed({ get: () => tab.value === 'playlists' ? playlistQuery.value : query.value,
  set: value => { if (tab.value === 'playlists') playlistQuery.value = value; else query.value = value } })
function selectTab(next: 'songs' | 'artists' | 'playlists'): void {
  if (next === tab.value) return
  cancelSuggestions()
  suggestOpen.value = false
  const scopeChanged = (next === 'playlists') !== (tab.value === 'playlists')
  if (scopeChanged) {
    if (tab.value === 'playlists') playlistScrollTop = searchScroll.value?.scrollTop || 0
    else songScrollTop = searchScroll.value?.scrollTop || 0
  }
  if (next === 'playlists' && !playlistInitialized) { playlistQuery.value = query.value; playlistInitialized = true }
  tab.value = next
  if (scopeChanged && route.path === '/search') {
    const target = next === 'playlists' ? 'playlists' : undefined
    if (route.query.target !== target) {
      const params: LocationQueryRaw = { ...route.query, target }
      if (!target) delete params.playlistQ
      void router.replace({ path: '/search', query: params })
    }
  }
  nextTick(() => {
    if (scopeChanged && searchScroll.value) searchScroll.value.scrollTop = next === 'playlists' ? playlistScrollTop : songScrollTop
    if (next === 'playlists' && playlistQuery.value.trim()) void playlistPane.value?.ensureSearch()
    else if (next !== 'playlists' && (resumeSubmittedSearch || (searched.value && searchedProviderKey !== providerKey.value))) void runSearch()
  })
}

/** 换音源建议：换到下一个已启用的音源。 */
const otherProvider = computed(() =>
  providers.value.find((item) =>
    item.providerId !== selected.value?.providerId || item.pluginId !== selected.value?.pluginId
  )
)

/** 结果里出现过的歌手，按曲目数排序。 */
const artistGroups = computed(() => {
  const groups = new Map<string, number>()
  for (const track of results.value) {
    const name = track.artist?.trim() || '未知歌手'
    groups.set(name, (groups.get(name) ?? 0) + 1)
  }
  return [...groups.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count)
})

/** 音源明确回「没有结果」是中性态，别拿它当报错。 */
const noResult = computed(
  () =>
    !loading.value &&
    !results.value.length &&
    (error.value === '没有找到相关歌曲' || error.value === '没有找到包含这句歌词的歌')
)

/** 真错误：没装音源、音源不支持、请求抛错。 */
const failureVisible = computed(
  () =>
    !loading.value &&
    !results.value.length &&
    Boolean(error.value) &&
    error.value !== '没有找到相关歌曲' &&
    error.value !== '没有找到包含这句歌词的歌' &&
    providers.value.length > 0
)

const HOT_WORDS = [
  '雨后初晴',
  '深夜电台',
  '白噪音',
  '器物',
  'City Pop',
  '钢琴',
  '民谣',
  'Live',
  '女声',
  '爵士',
  '清晨',
  '器乐'
]
const hotBatch = ref(0)
const hotBatchWords = computed(() => {
  const size = 4
  const start = (hotBatch.value * size) % HOT_WORDS.length
  return Array.from({ length: size }, (_, offset) => HOT_WORDS[(start + offset) % HOT_WORDS.length])
})

function nextHotBatch(): void {
  hotBatch.value += 1
}

function cancelSuggestions(): void {
  suggestSeq += 1
  clearTimeout(suggestTimer)
  suggestTimer = undefined
  remoteSuggestions.value = []
}

function scheduleSuggestions(): void {
  cancelSuggestions()
  const provider = selected.value
  const text = query.value.trim()
  const key = providerKey.value
  if (route.path !== '/search' || !showSuggest.value || !normalizeText(text) ||
    !provider?.methods.includes('tracks.search')) return
  const seq = suggestSeq
  suggestTimer = setTimeout(async () => {
    suggestTimer = undefined
    try {
      const tracks = await fetchTracks(provider, text)
      if (seq !== suggestSeq || key !== providerKey.value ||
        text !== query.value.trim() || !showSuggest.value) return
      remoteSuggestions.value = tracks
    } catch {
      // A failed suggestion request leaves local matches and explicit search available.
    }
  }, 300)
}

function onInput(event?: Event): void {
  if (tab.value === 'playlists') return
  requestSeq += 1
  loading.value = false
  lyricProgress.value = { done: 0, total: 0 }
  if (composing.value || (event as InputEvent | undefined)?.isComposing) {
    cancelSuggestions()
    return
  }
  if (!query.value.trim()) {
    reset()
    return
  }
  suggestOpen.value = true
  scheduleSuggestions()
}

function onCompositionStart(): void {
  composing.value = true
  if (tab.value === 'playlists') return
  requestSeq += 1
  loading.value = false
  cancelSuggestions()
}

function onCompositionEnd(): void {
  composing.value = false
  onInput()
}

function onFocus(): void {
  focused.value = true
  suggestOpen.value = true
  scheduleSuggestions()
}

function onBlur(event: FocusEvent): void {
  if ((event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) return
  focused.value = false
  suggestOpen.value = false
  cancelSuggestions()
}

async function fetchTracks(provider: ProviderHandle, text: string, limit = RESULT_LIMIT): Promise<Track[]> {
  const page = await invokeProvider(provider, 'tracks.search', [
    { query: text, kinds: ['track'], filters: {}, limit }
  ])
  const items = (page?.items ?? []).filter((item: any) => {
    const kind = item?.ref?.kind
    return Boolean(item?.ref?.id) && (!kind || kind === 'track' || kind === 'song')
  })
  return items.map((item: any) => toTrack(item, provider))
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

/**
 * 按歌词找歌：音源只认歌名/歌手，所以先用歌词片段里的词搜出候选，
 * 再逐个比对云端歌词（QQ / 网易云 / LrcLib），只留真正包含这句的歌。
 */
function lyricSearchTerms(snippet: string): string[] {
  const cleaned = snippet.replace(/[、，。,.!！?？~～…:：;；"'“”‘’()（）\[\]【】]/g, ' ').trim()
  const tokens = cleaned.split(/\s+/).filter((item) => item.length >= 2)
  const longest = tokens.sort((a, b) => b.length - a.length)[0] ?? cleaned
  const terms = [longest]
  if (longest.length > 6) terms.push(longest.slice(0, 6))
  if (longest.length > 10) terms.push(longest.slice(0, 10))
  return [...new Set(terms.filter((item) => item.length >= 2))].slice(0, 2)
}

function lyricLineFor(results: Array<{ text: string }>, snippet: string): string {
  const needle = normalizeText(snippet)
  if (!needle) return ''
  for (const line of results) {
    const plain = String(line.text ?? '').replace(/\[[^\]]*\]/g, '').trim()
    if (!plain) continue
    if (normalizeText(plain).includes(needle)) return plain
  }
  return ''
}

async function providerCandidates(provider: ProviderHandle, text: string): Promise<Track[]> {
  return fetchTracks(provider, text, 8)
}

/** 歌词库里查到了歌名，再回音源找这首；歌手对上会加分，避免撞到同名翻唱。 */
function pickBestMatch(tracks: Track[], candidate: LyricCandidate): Track | null {
  const artist = normalizeText(candidate.artist.split(' / ')[0] ?? '')
  let best: { track: Track; score: number } | null = null
  for (const track of tracks) {
    let score = matchScore(track, candidate.title)
    if (score < 0) continue
    if (artist && normalizeText(track.artist).includes(artist)) score += 14
    if (!best || score > best.score) best = { track, score }
  }
  return best && best.score >= 84 ? best.track : null
}

/**
 * 按歌词找歌：先问歌词库（QQ 的歌词检索直接返回含这句的歌），拿到歌名/歌手后
 * 回当前音源找可播放的曲目；歌词库不可用或没命中时，退回「拿歌词里的词当关键词」的老办法。
 */
async function searchByLyric(
  provider: ProviderHandle,
  snippet: string,
  seq: number
): Promise<{ tracks: Track[]; lines: Record<string, string>; missing: string[] }> {
  const hits: Track[] = []
  const lines: Record<string, string> = {}
  const seen = new Set<string>()
  const resolved = new Set<string>()
  const push = (track: Track, line: string): void => {
    const key = `${track.providerId}:${track.id}`
    if (seen.has(key)) return
    seen.add(key)
    hits.push(track)
    if (line) lines[key] = line
  }

  const catalog = await searchLyricCatalog(snippet).catch(() => [] as LyricCandidate[])
  if (seq !== requestSeq) return { tracks: [], lines: {}, missing: [] }
  const picks = catalog.slice(0, 6)
  lyricProgress.value = { done: 0, total: picks.length }

  let cursor = 0
  const resolveOne = async (candidate: LyricCandidate): Promise<void> => {
    const first = candidate.artist ? `${candidate.title} ${candidate.artist.split(' / ')[0]}` : candidate.title
    let track: Track | null = null
    for (const text of [first, candidate.title]) {
      if (track || seq !== requestSeq) break
      try {
        track = pickBestMatch(await providerCandidates(provider, text), candidate)
      } catch {}
      if (text === candidate.title) break
    }
    if (track) {
      resolved.add(`${candidate.title}|${candidate.artist}`)
      let line = candidate.line
      try {
        const cloud = await matchCloudLyrics(track)
        const confirmed = cloud ? lyricLineFor(cloud.lines, snippet) : ''
        if (confirmed) line = confirmed
      } catch {}
      push(track, line)
    }
    if (seq === requestSeq) {
      lyricProgress.value = { done: lyricProgress.value.done + 1, total: picks.length }
    }
  }
  const worker = async (): Promise<void> => {
    while (cursor < picks.length) {
      const candidate = picks[cursor++]
      if (seq !== requestSeq) return
      await resolveOne(candidate)
    }
  }
  await Promise.all(Array.from({ length: 3 }, worker))

  if (!hits.length && seq === requestSeq) {
    // 歌词库没直给：把歌词里的词当关键词搜一遍，再用云端歌词逐首核对
    const pool = new Map<string, Track>()
    for (const term of lyricSearchTerms(snippet)) {
      if (seq !== requestSeq) break
      try {
        for (const track of await providerCandidates(provider, term)) {
          const key = `${track.providerId}:${track.id}`
          if (!pool.has(key)) pool.set(key, track)
        }
      } catch {}
    }
    if (seq !== requestSeq) return { tracks: [], lines: {}, missing: [] }
    const candidates = [...pool.values()].slice(0, 10)
    let index = 0
    lyricProgress.value = { done: 0, total: candidates.length }
    const verify = async (): Promise<void> => {
      while (index < candidates.length) {
        const track = candidates[index++]
        if (seq !== requestSeq) return
        try {
          const found = await matchCloudLyrics(track)
          const line = found ? lyricLineFor(found.lines, snippet) : ''
          if (line) push(track, line)
        } catch {}
        if (seq === requestSeq) {
          lyricProgress.value = { done: lyricProgress.value.done + 1, total: candidates.length }
        }
      }
    }
    await Promise.all(Array.from({ length: 4 }, verify))
  }

  const missing = catalog
    .filter((item) => !resolved.has(`${item.title}|${item.artist}`))
    .map((item) => (item.artist ? `${item.title} · ${item.artist}` : item.title))
    .slice(0, 4)

  return { tracks: hits, lines, missing }
}

async function runSearch(): Promise<void> {
  if (tab.value === 'playlists') {
    if (route.path === '/search' && route.query.playlistQ !== playlistQuery.value) {
      await router.replace({ path: '/search', query: { ...route.query, target: 'playlists', playlistQ: playlistQuery.value } })
    }
    await nextTick(); await playlistPane.value?.search(); return
  }
  cancelSuggestions()
  const seq = ++requestSeq
  const provider = selected.value
  const text = query.value.trim()
  if (searchedProviderKey !== providerKey.value) {
    results.value = []
    appliedQuery.value = ''
  }
  searchedProviderKey = providerKey.value
  resumeSubmittedSearch = false
  suggestOpen.value = false
  loading.value = false
  lyricHits.value = {}
  lyricProgress.value = { done: 0, total: 0 }
  lyricMissing.value = []
  if (!text) {
    results.value = []
    appliedQuery.value = ''
    relaxedQuery.value = ''
    error.value = ''
    searched.value = false
    return
  }
  if (!provider || !provider.methods.includes('tracks.search')) {
    error.value = provider ? '当前音源不支持搜索' : '请先安装并启用音源插件'
    results.value = []
    appliedQuery.value = ''
    relaxedQuery.value = ''
    searched.value = true
    return
  }
  loading.value = true
  searched.value = true
  error.value = ''
  relaxedQuery.value = ''
  try {
    if (mode.value === 'lyric') {
      const found = await searchByLyric(provider, text, seq)
      if (seq !== requestSeq) return
      results.value = found.tracks
      appliedQuery.value = text
      lyricHits.value = found.lines
      lyricMissing.value = found.missing
      rememberTracks(found.tracks)
      if (found.tracks.length) {
        rememberSearch(text)
        error.value = ''
      } else {
        error.value = '没有找到包含这句歌词的歌'
      }
      return
    }
    let tracks = rankTracks(await fetchTracks(provider, text), text)
    let used = text
    if (!tracks.length) {
      for (const candidate of fallbackQueries(text)) {
        if (seq !== requestSeq) return
        const relaxed = rankTracks(await fetchTracks(provider, candidate), candidate)
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
      rememberSearch(text)
      error.value = ''
    } else {
      error.value = '没有找到相关歌曲'
    }
  } catch (err: any) {
    if (seq !== requestSeq) return
    error.value = err?.message ?? '搜索失败'
    results.value = []
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

function submitSearch(): void {
  if (composing.value) return
  void runSearch()
}

function useKeyword(text: string): void {
  query.value = text
  suggestOpen.value = false
  void runSearch()
}

function pickSuggestion(track: Track): void {
  const text = track.title?.trim() || query.value
  query.value = text
  suggestOpen.value = false
  inputRef.value?.blur()
  void runSearch()
}

function reset(): void {
  if (tab.value === 'playlists') { playlistQuery.value = ''; playlistPane.value?.clear(); nextTick(() => inputRef.value?.focus()); return }
  cancelSuggestions()
  requestSeq += 1
  resumeSubmittedSearch = false
  query.value = ''
  results.value = []
  appliedQuery.value = ''
  relaxedQuery.value = ''
  error.value = ''
  searched.value = false
  loading.value = false
  lyricHits.value = {}
  lyricProgress.value = { done: 0, total: 0 }
  lyricMissing.value = []
  suggestOpen.value = false
  tab.value = 'songs'
  nextTick(() => inputRef.value?.focus())
}

function choose(provider: ProviderHandle): void {
  selectProvider(provider.providerId, provider.pluginId)
}

watch(
  providerKey,
  () => {
    cancelSuggestions()
    if (route.path !== '/search' || tab.value === 'playlists') return
    if (searched.value || loading.value) void runSearch()
    else scheduleSuggestions()
  }
)

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
    if (route.path !== '/search') return
    const text = typeof value === 'string' ? value.trim() : ''
    if (route.query.target === 'playlists') { playlistQuery.value = String(route.query.playlistQ || text); tab.value = 'playlists'; void runSearch(); return }
    if (tab.value === 'playlists') tab.value = 'songs'
    if (!text || text === query.value) return
    query.value = text
    suggestOpen.value = false
    void runSearch()
  }
)

watch(() => route.query.mode, value => {
  if (route.path === '/search' && (value === 'name' || value === 'lyric')) {
    if (route.query.target !== 'playlists') selectTab('songs')
    setMode(value)
  }
}, { immediate: true })
watch(() => route.query.target, (value, previous) => {
  if (route.path === '/search' && value === 'playlists') selectTab('playlists')
  else if (route.path === '/search' && previous === 'playlists') selectTab('songs')
})

onMounted(() => {
  if (inputQuery.value.trim()) void runSearch()
  else nextTick(() => inputRef.value?.focus())
})

function stopPendingSearch(): void {
  cancelSuggestions()
  requestSeq += 1
  loading.value = false
  lyricProgress.value = { done: 0, total: 0 }
  composing.value = false
  focused.value = false
  suggestOpen.value = false
}

onActivated(() => {
  if (route.path !== '/search' || tab.value === 'playlists') return
  if (resumeSubmittedSearch || (searched.value && searchedProviderKey !== providerKey.value)) {
    void runSearch()
  }
})
onDeactivated(() => {
  resumeSubmittedSearch = loading.value
  stopPendingSearch()
})
onBeforeUnmount(stopPendingSearch)
</script>

<template>
  <div class="screen search-page">
      <header class="findrow search-header" aria-label="搜索">
        <button class="iconbtn quiet search-back" aria-label="返回" @click="goBack"><Icon name="back" :size="21" /></button>
        <div class="finder" @focusout="onBlur">
          <form class="searchfield" :class="{ focus: focused, lyric: mode === 'lyric' }" @submit.prevent="submitSearch">
            <Icon name="search" :size="17" />
            <input
              ref="inputRef"
              v-model="inputQuery"
              type="search"
              :aria-label="tab === 'playlists' ? '歌单名称' : '歌曲、歌手或歌词'"
              enterkeyhint="search"
              :placeholder="tab === 'playlists' ? '输入歌单名称' : mode === 'lyric' ? '输入一句歌词，例如：雨一直下' : '输入歌名或歌手'"
              autocomplete="off"
              @input="onInput"
              @compositionstart="onCompositionStart"
              @compositionend="onCompositionEnd"
              @focus="onFocus"
            />

            <button v-if="inputQuery" type="button" class="clearbtn" aria-label="清空" @mousedown.prevent @click="reset">
              <Icon name="close" :size="13" />
            </button>
          </form>

          <div v-if="showSuggest" class="suggest">
            <button type="button" class="srow direct" @mousedown.prevent @click="submitSearch">
              <Icon name="search" :size="16" />
              <span class="sname">搜索「{{ query.trim() }}」</span>
              <Icon name="chevron" :size="15" class="sgo" />
            </button>
            <button
              v-for="track in suggestions"
              :key="track.pluginId + ':' + track.providerId + ':' + track.id"
              type="button"
              class="srow"
              @mousedown.prevent
              @click="pickSuggestion(track)"
            >
              <Icon name="music" :size="16" />
              <span class="sname">
                <template v-for="(part, index) in highlightParts(track.title, query)" :key="index">
                  <mark v-if="part.hit" class="hl">{{ part.text }}</mark>
                  <template v-else>{{ part.text }}</template>
                </template>
              </span>
              <span v-if="track.artist" class="sartist">{{ track.artist }}</span>
            </button>
          </div>
        </div>
        <button class="findgo" @click="submitSearch">搜索</button>
      </header>
    <div class="scroll search-scroll no-fade" ref="searchScroll">
      <div class="pad">
          <div class="segment result-tabs" aria-label="结果分组">
            <button :class="{ on: tab === 'songs' }" @click="selectTab('songs')">
              单曲 <em>{{ results.length }}</em>
            </button>
            <button :class="{ on: tab === 'artists' }" @click="selectTab('artists')">
              歌手分组 <em>{{ artistGroups.length }}</em>
            </button>
            <button :class="{ on: tab === 'playlists' }" @click="selectTab('playlists')">
              歌单
            </button>
          </div>
      </div>
      <PlaylistSearchPane v-show="tab === 'playlists'" ref="playlistPane" :query="playlistQuery" />
      <template v-if="tab !== 'playlists'">
      <div class="pad search-filters">
        <div v-if="providers.length" class="chip-row source-filters">
          <button v-for="provider in providers" :key="provider.pluginId + ':' + provider.providerId" class="chip" :class="{ active: selected?.providerId === provider.providerId && selected?.pluginId === provider.pluginId }" @click="choose(provider)"><span v-if="selected?.providerId === provider.providerId && selected?.pluginId === provider.pluginId" class="dot" />{{ provider.name }}</button>
        </div>
            <button
              type="button"
              class="modetog"
              :class="{ on: mode === 'lyric' }"
              :aria-label="mode === 'lyric' ? '切换为按歌名搜索' : '切换为按歌词搜索'"
              @mousedown.prevent
              @click="setMode(mode === 'lyric' ? 'name' : 'lyric')"
            >
              <Icon :name="mode === 'lyric' ? 'lyrics' : 'music'" :size="13" />
              <span>{{ mode === 'lyric' ? '歌词找歌' : '歌名搜索' }}</span>
            </button>
      </div>

      <section v-if="historyVisible" class="pad mt20">
        <div class="strip">
          <span class="cap">最近搜索</span>
          <button class="linkbtn" @click="clearSearchHistory()">
            <Icon name="trash" :size="13" /> 清空
          </button>
        </div>
        <div class="chip-row wrap mt10">
          <button v-for="item in searchHistory.items" :key="item" class="chip" @click="useKeyword(item)">
            {{ item }}
          </button>
        </div>
      </section>

      <section v-if="!searched && !query.trim()" class="pad mt20">
        <div class="strip">
          <span class="cap">搜索灵感</span>
          <button class="linkbtn" @click="nextHotBatch()">
            <Icon name="refresh" :size="13" /> 换一批
          </button>
        </div>
        <div class="hotline mt8">
          <button v-for="word in hotBatchWords" :key="word" class="hotword" @click="useKeyword(word)">
            {{ word }}
          </button>
        </div>
      </section>

      <div v-if="loading && !results.length" class="pad mt20" aria-live="polite">
        <div v-for="row in 5" :key="row" class="skelrow">
          <span class="skeleton skelcov" />
          <span class="skellines">
            <span class="skeleton skelt" />
            <span class="skeleton skela" />
          </span>
        </div>
        <p class="meta mt12">
          正在「{{ selected?.name ?? '音源' }}」搜索「{{ query.trim() }}」…
        </p>
      </div>

      <div v-else-if="!pluginState.loading && !providers.length" class="empty">
        <div class="glyph"><Icon name="plugin" :size="34" /></div>
        <h3>还没有音源插件</h3>
        <p>安装插件后才能搜索音乐。</p>
        <button class="btn btn-primary btn-sm mt8" @click="$router.push('/plugins')">
          <Icon name="plus" :size="16" /> 安装音源插件
        </button>
      </div>

      <div v-else-if="failureVisible" class="empty">
        <div class="glyph"><Icon name="warning" :size="34" /></div>
        <h3>搜索没成功</h3>
        <p>{{ error }}</p>
        <div class="row g8 mt8">
          <button class="btn btn-ghost btn-sm" @click="reset">改搜</button>
          <button class="btn btn-primary btn-sm" @click="submitSearch">重试</button>
        </div>
      </div>

      <div v-else-if="noResult" class="empty">
        <div class="glyph"><Icon :name="mode === 'lyric' ? 'lyrics' : 'search'" :size="34" /></div>
        <h3>
          {{
            mode === 'lyric'
              ? lyricMissing.length
                ? '歌词库里有，音源里没有'
                : '没有歌匹配这句歌词'
              : `没有找到「${query.trim()}」`
          }}
        </h3>
        <p v-if="mode === 'lyric' && lyricMissing.length">换个音源，或者切回歌名搜索再找找看。</p>
        <p v-else-if="mode === 'lyric'">换一段更短、更独特的歌词试试，比如副歌第一句。</p>
        <p v-else>换个关键词，或换一个音源再试。只留歌名往往更准。</p>
        <div v-if="mode === 'lyric' && lyricMissing.length" class="lyr-miss">
          <p class="meta">歌词库里是这几首，但当前音源搜不到：</p>
          <ul>
            <li v-for="item in lyricMissing" :key="item">{{ item }}</li>
          </ul>
        </div>
        <div class="row g8 mt8">
          <button class="btn btn-ghost btn-sm" @click="reset">改搜</button>
          <button
            v-if="otherProvider"
            class="btn btn-tint btn-sm"
            @click="choose(otherProvider)"
          >
            换到 {{ otherProvider.name }}
          </button>
        </div>
        <p v-if="!otherProvider" class="meta mt4">只有一个音源，可以去插件页再装一个。</p>
      </div>

      <template v-if="results.length">
        <div class="section-head mt24">
          <div class="st">
            <h2>{{ mode === 'lyric' ? '歌词命中' : '搜索结果' }}</h2>
            <span class="idx">{{ results.length }}</span>
            <span v-if="loading" class="meta">搜索中…</span>
            <span v-else-if="mode === 'lyric' && lyricMissing.length" class="meta">
              另有 {{ lyricMissing.length }} 首只在歌词库里
            </span>
          </div>
          <button class="btn btn-primary btn-sm" @click="playAll">
            <Icon name="play" :size="13" /> 播放全部
          </button>
        </div>

        <div class="pad">

          <p v-if="relaxedQuery" class="note mt10">
            音源没有「{{ query.trim() }}」的结果，已按「{{ relaxedQuery }}」搜索。
          </p>
        </div>

        <div v-if="tab === 'songs'" class="pad mt4">
          <p v-if="mode === 'lyric' && loading && lyricProgress.total" class="meta lyr-progress">
            正在比对歌词 {{ lyricProgress.done }} / {{ lyricProgress.total }}
          </p>
          <template v-for="(track, index) in results" :key="track.providerId + track.id">
            <SongRow
              :track="track"
              :index="index"
              :queue="results"
              :query="appliedQuery"
              @play="play(index)"
            />
            <p v-if="mode === 'lyric' && lyricHits[track.providerId + ':' + track.id]" class="lyr-hit">
              <Icon name="lyrics" :size="12" />
              <span>{{ lyricHits[track.providerId + ':' + track.id] }}</span>
            </p>
          </template>
        </div>

        <div v-else-if="tab === 'artists'" class="pad mt4">
          <button
            v-for="group in artistGroups"
            :key="group.name"
            class="songrow rowlink"
            @click="useKeyword(group.name)"
          >
            <span class="avatar">{{ group.name.slice(0, 1) }}</span>
            <span class="meta-wrap">
              <span class="t">{{ group.name }}</span>
              <span class="a">{{ group.count }} 首相关歌曲</span>
            </span>
            <Icon name="chevron" :size="16" class="ink-4" />
          </button>
          <p v-if="!artistGroups.length" class="meta mt12">这批结果里没有可归类的歌手。</p>
        </div>

      </template>

      <section v-if="localMatches.length">
        <div class="group-title">
          <span class="cn">本地结果</span>
          <span class="cnt">{{ localMatches.length }}</span>
          <span class="en">In Library</span>
        </div>
        <div class="pad">
          <p class="meta">音源没有返回结果，这些来自你的收藏、歌单和搜过的歌。</p>
        </div>
        <div class="pad mt4">
          <SongRow
            v-for="(track, index) in localMatches"
            :key="track.pluginId + ':' + track.providerId + ':' + track.id"
            :track="track"
            :index="index"
            :queue="localMatches"
            :query="query"
            @play="playLocal(index)"
          />
        </div>
      </section>

      <div v-if="!searched && !query.trim() && !historyVisible" class="hint-empty">
        <div class="empty">
          <div class="glyph"><Icon name="discover" :size="34" /></div>
          <h3>想听点什么？</h3>
        </div>
      </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.findrow {
  display: flex;
  align-items: center;
  gap: 10px;
}
.finder {
  position: relative;
  z-index: 20;
  flex: 1;
  min-width: 0;
}
.searchfield {
  margin: 0;
}
.clearbtn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: 50%;
  color: var(--ink-4);
  background: var(--porcelain-2);
}
/* 搜索框里的「歌名 / 歌词」切换 */
.modetog {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
  height: 26px;
  padding: 0 9px 0 8px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--ink-3);
  background: var(--porcelain-2);
  transition: background 0.18s var(--e-out), color 0.18s var(--e-out);
}
.modetog.on {
  color: #fff;
  background: var(--tint);
}
.modetog:active {
  transform: scale(0.96);
}
.lyr-progress {
  margin: 2px 0 6px;
}
/* 每条结果下面那句命中的歌词 */
.lyr-hit {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: -2px 14px 10px 60px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--ink-4);
}
.lyr-hit span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lyr-hit :deep(svg) {
  flex: none;
  opacity: 0.7;
}
.lyr-miss {
  width: 100%;
  margin: 4px 0 2px;
  padding: 10px 12px;
  border-radius: var(--r-sm);
  background: var(--porcelain-2);
  text-align: left;
}
.lyr-miss ul {
  margin: 6px 0 0;
  padding-left: 16px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--ink-3);
}
.findgo {
  flex: none;
  height: 44px;
  min-width: 44px;
  padding: 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--tint);
}
.suggest {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 6px);
  max-height: 46vh;
  overflow-y: auto;
  padding: 6px;
  border-radius: var(--r-md);
  background: var(--surface);
  border: 1px solid var(--line-2);
  box-shadow: var(--sh-3);
}
.srow {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 44px;
  padding: 0 10px;
  border-radius: var(--r-sm);
  color: var(--ink-3);
  text-align: left;
}
.srow:active {
  background: var(--tint-softer);
}
.srow.direct {
  color: var(--tint);
  font-weight: 600;
}
.sname {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.srow.direct .sname {
  color: var(--tint);
}
.sartist {
  flex: 0 0 auto;
  max-width: 44%;
  font-size: 12px;
  color: var(--ink-4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sgo {
  color: var(--ink-4);
}
.hl {
  color: var(--tint);
  background: var(--tint-soft);
  border-radius: 3px;
  font-weight: 650;
}
.strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.linkbtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding: 0 4px;
  font-size: 12px;
  color: var(--ink-3);
}
.wrap {
  flex-wrap: wrap;
  overflow: visible;
  row-gap: 8px;
}
.hotline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.hotword {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 13px;
  border-radius: var(--r-pill);
  background: var(--surface);
  border: 1px solid var(--line);
  font-size: 12.5px;
  color: var(--ink-2);
}
.hotword:active {
  color: var(--tint);
  border-color: var(--tint);
}
.segment em {
  margin-left: 4px;
  font-style: normal;
  font-size: 10.5px;
  color: var(--ink-4);
}
.segment > .on em {
  color: var(--ink-3);
}
.note {
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-3);
}
.skelrow {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 60px;
  padding: 0 4px;
}
.skelcov {
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: var(--r-sm);
}
.skellines {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
}
.skelt {
  display: block;
  height: 11px;
  width: 58%;
  border-radius: 4px;
}
.skela {
  display: block;
  height: 9px;
  width: 34%;
  border-radius: 4px;
}
.avatar {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 50%;
  font-family: var(--serif);
  font-size: 17px;
  color: var(--ink-3);
  background: var(--porcelain-2);
}
.plcover {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  color: var(--ink-3);
}
.rowlink {
  width: 100%;
  text-align: left;
}
.hint-empty {
  padding-bottom: 8px;
}
.hint-empty .empty {
  padding: 26px 24px 8px;
}

.search-header { min-height:calc(var(--safe-top) + 64px); height:calc(var(--safe-top) + 64px); padding:var(--safe-top) 12px 0 8px; gap:4px; position:relative; z-index:30; background:var(--porcelain); }
.search-back { width:36px; height:44px; flex:none; }
.search-scroll { top:calc(var(--safe-top) + 64px); padding-top:0; }
.searchfield { height:44px; padding:0 11px; border-radius:24px; background:var(--porcelain-2); border-color:transparent; }
.searchfield.focus { border-color:transparent; box-shadow:none; }
.searchfield input { font-size:14px; }
.searchfield input:focus-visible { outline:none; }
@media (hover: hover) and (pointer: fine) {
  .searchfield:has(input:focus-visible) { outline:2px solid GrayText; outline-offset:2px; }
}
.clearbtn { height:42px; width:30px; background:none; }
.findgo { padding:0 7px; color:var(--ink-2); font-weight:500; }
.search-filters { display:flex; align-items:center; gap:10px; min-height:51px; padding-top:5px; padding-bottom:5px; }
.source-filters { flex:1; min-width:0; overflow-x:auto; }.source-filters .chip { flex:none; min-height:40px; border-radius:8px; font-size:12px; background:var(--porcelain-2); border:0; }.source-filters .chip.active { background:var(--tint-soft); color:var(--brand-strong); }
.modetog { height:44px; padding:0 10px; font-size:12px; border-radius:8px; background:var(--porcelain-2); }
.modetog.on { color:var(--brand-strong); background:var(--tint-soft); }
.result-tabs { gap:23px; border:0; border-radius:0; padding:0; background:none; min-height:51px; align-items:center; }
.result-tabs>button { position:relative; flex:none; min-width:0; padding:0; height:45px; border-radius:0; font-size:15px; font-weight:500; color:var(--ink-3); background:none; box-shadow:none; }
.result-tabs>button.on { color:var(--ink); font-weight:700; background:none; box-shadow:none; }
.result-tabs>button.on::after { content:''; position:absolute; bottom:0; left:calc(50% - 10px); width:20px; height:3px; border-radius:4px; background:var(--tint); }
.result-tabs em { font-size:10px; margin-left:2px; }
.search-page .section-head { align-items:center; padding-bottom:9px; }.search-page .section-head .st { flex-wrap:wrap; gap:6px; }.search-page .section-head h2 { font-family:var(--sans); font-size:16px; }.search-page .section-head .btn { flex:none; min-height:38px; font-size:11px; }
.search-page .avatar { font-family:var(--sans); }.linkbtn { min-height:44px; }.hotword { border:0; background:var(--porcelain-2); min-height:40px; border-radius:8px; }
.search-scroll .hint-empty .empty { padding-top:42px; }.search-page .group-title .en { display:none; }
@media(max-width:375px) { .result-tabs { gap:17px; }.result-tabs>button { font-size:14px; }.result-tabs em { font-size:9px; }.modetog { padding:0 8px; }.search-filters { gap:6px; } }

</style>
