<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
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

/** 一次搜索最多取多少条。 */
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

/** 输入太慢/太快都可能有旧请求后到，用序号丢弃过期响应。 */
let requestSeq = 0

const libraryTracks = computed(() => [
  ...libraryState.favorites,
  ...libraryState.playlists.flatMap((playlist) => playlist.tracks)
])

const suggestions = computed(() => suggestTracks(query.value, libraryTracks.value, SUGGEST_LIMIT))

/** 输入时只做本地联想（不联网、不自动搜索），点「搜索」或回车才真正搜。 */
const showSuggest = computed(
  () => suggestOpen.value && focused.value && Boolean(query.value.trim())
)

const historyVisible = computed(() => !query.value.trim() && searchHistory.items.length > 0)

/** 音源零结果时，退回本地索引，至少让用户看到「打一个字就能找到」的歌。 */
const localMatches = computed(() => {
  if (loading.value || results.value.length || !searched.value || !query.value.trim()) return []
  return suggestTracks(query.value, libraryTracks.value, 12)
})

/* —— 以下只做纯 UI 派生：分组计数、真错误/无结果分流、热门词轮换 —— */

/** 结果分组：单曲 / 歌手 / 本地歌单。 */
const tab = ref<'songs' | 'artists' | 'playlists'>('songs')

/** 换音源建议：换到下一个已启用的音源。 */
const otherProvider = computed(() =>
  providers.value.find((item) => item.providerId !== selected.value?.providerId)
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

/** 本地歌单里和当前关键词同名的那些（只读展示，点击进详情）。 */
const playlistGroups = computed(() => {
  const needle = (appliedQuery.value || query.value).trim().toLowerCase()
  if (!needle) return []
  return libraryState.playlists.filter((playlist) =>
    String(playlist.name ?? '').toLowerCase().includes(needle)
  )
})

/** 音源明确回「没有结果」是中性态，别拿它当报错。 */
const noResult = computed(
  () => !loading.value && !results.value.length && error.value === '没有找到相关歌曲'
)

/** 真错误：没装音源、音源不支持、请求抛错。 */
const failureVisible = computed(
  () =>
    !loading.value &&
    !results.value.length &&
    Boolean(error.value) &&
    error.value !== '没有找到相关歌曲' &&
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

function onInput(): void {
  // 只更新本地联想，不自动联网搜索：搜不搜由用户按「搜索」/回车决定。
  suggestOpen.value = true
}

function onFocus(): void {
  focused.value = true
  suggestOpen.value = true
}

function onBlur(): void {
  focused.value = false
  suggestOpen.value = false
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

async function runSearch(): Promise<void> {
  const provider = selected.value
  const text = query.value.trim()
  suggestOpen.value = false
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
  try {
    let tracks = await fetchTracks(provider, text)
    let used = text
    if (!tracks.length) {
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
  rememberSearch(text)
  inputRef.value?.blur()
  void runSearch()
}

function reset(): void {
  requestSeq += 1
  query.value = ''
  results.value = []
  appliedQuery.value = ''
  relaxedQuery.value = ''
  error.value = ''
  searched.value = false
  loading.value = false
  suggestOpen.value = false
  tab.value = 'songs'
  nextTick(() => inputRef.value?.focus())
}

function choose(providerId: string): void {
  selectProvider(providerId)
  if (query.value.trim()) void runSearch()
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
    void runSearch()
  }
)

onMounted(() => {
  if (query.value.trim()) void runSearch()
  else nextTick(() => inputRef.value?.focus())
})
</script>

<template>
  <div class="screen search-page">
    <div class="scroll safe-t-lg">
      <div class="pad">
        <div class="eyebrow">Ceru Music · 检索</div>
      </div>

      <div class="page-head mt6">
        <div>
          <h1>搜索</h1>
          <div class="sub">
            <template v-if="selected">{{ selected.name }} · {{ providers.length }} 个音源可用</template>
            <template v-else>还没有可用的音源</template>
          </div>
        </div>
        <div class="page-actions">
          <button class="iconbtn soft" aria-label="设置" @click="$router.push('/settings')">
            <Icon name="settings" :size="19" />
          </button>
        </div>
      </div>

      <div class="findrow pad mt16">
        <div class="finder">
          <form class="searchfield" :class="{ focus: focused }" @submit.prevent="submitSearch">
            <Icon name="search" :size="17" />
            <input
              ref="inputRef"
              v-model="query"
              type="search"
              enterkeyhint="search"
              placeholder="输入歌名或歌手"
              autocomplete="off"
              @input="onInput"
              @focus="onFocus"
              @blur="onBlur"
            />
            <button v-if="query" type="button" class="clearbtn" aria-label="清空" @mousedown.prevent="reset">
              <Icon name="close" :size="13" />
            </button>
          </form>

          <div v-if="showSuggest" class="suggest">
            <button type="button" class="srow direct" @mousedown.prevent="submitSearch">
              <Icon name="search" :size="16" />
              <span class="sname">搜索「{{ query.trim() }}」</span>
              <Icon name="chevron" :size="15" class="sgo" />
            </button>
            <button
              v-for="track in suggestions"
              :key="track.providerId + track.id"
              type="button"
              class="srow"
              @mousedown.prevent="pickSuggestion(track)"
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
      </div>

      <div v-if="providers.length" class="pad mt12">
        <div class="chip-row">
          <button
            v-for="provider in providers"
            :key="provider.providerId + provider.pluginId"
            class="chip"
            :class="{ active: selected?.providerId === provider.providerId }"
            @click="choose(provider.providerId)"
          >
            <span v-if="selected?.providerId === provider.providerId" class="dot" />
            {{ provider.name }}
          </button>
        </div>
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
          <span class="cap">热门</span>
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
        <div class="glyph"><Icon name="search" :size="34" /></div>
        <h3>没有找到「{{ query.trim() }}」</h3>
        <p>换个关键词，或换一个音源再试。只留歌名往往更准。</p>
        <div class="row g8 mt8">
          <button class="btn btn-ghost btn-sm" @click="reset">改搜</button>
          <button
            v-if="otherProvider"
            class="btn btn-tint btn-sm"
            @click="choose(otherProvider.providerId)"
          >
            换到 {{ otherProvider.name }}
          </button>
        </div>
        <p v-if="!otherProvider" class="meta mt4">只有一个音源，可以去插件页再装一个。</p>
      </div>

      <template v-if="results.length">
        <div class="section-head mt24">
          <div class="st">
            <h2>搜索结果</h2>
            <span class="idx">{{ results.length }}</span>
            <span v-if="loading" class="meta">搜索中…</span>
          </div>
          <button class="btn btn-primary btn-sm" @click="playAll">
            <Icon name="play" :size="13" /> 播放全部
          </button>
        </div>

        <div class="pad">
          <div class="segment">
            <button :class="{ on: tab === 'songs' }" @click="tab = 'songs'">
              单曲 <em>{{ results.length }}</em>
            </button>
            <button :class="{ on: tab === 'artists' }" @click="tab = 'artists'">
              歌手 <em>{{ artistGroups.length }}</em>
            </button>
            <button :class="{ on: tab === 'playlists' }" @click="tab = 'playlists'">
              歌单 <em>{{ playlistGroups.length }}</em>
            </button>
          </div>
          <p v-if="relaxedQuery" class="note mt10">
            音源没有「{{ query.trim() }}」的结果，已按「{{ relaxedQuery }}」搜索。
          </p>
        </div>

        <div v-if="tab === 'songs'" class="pad mt4">
          <SongRow
            v-for="(track, index) in results"
            :key="track.providerId + track.id"
            :track="track"
            :index="index"
            :queue="results"
            :query="appliedQuery"
            show-index
            @play="play(index)"
          />
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

        <div v-else class="pad mt4">
          <button
            v-for="playlist in playlistGroups"
            :key="playlist.id"
            class="songrow rowlink"
            @click="$router.push(`/playlist/${playlist.id}`)"
          >
            <span class="cover plcover"><Icon name="library" :size="18" /></span>
            <span class="meta-wrap">
              <span class="t">{{ playlist.name }}</span>
              <span class="a">{{ playlist.tracks.length }} 首 · 本地歌单</span>
            </span>
            <Icon name="chevron" :size="16" class="ink-4" />
          </button>
          <p v-if="!playlistGroups.length" class="meta mt12">
            本地歌单里没有「{{ appliedQuery || query.trim() }}」，先在单曲里找找。
          </p>
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
            :key="track.providerId + track.id"
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
          <p>输入歌名或歌手，点「搜索」或按回车；输入时会先提示你收藏和歌单里的同名歌。</p>
        </div>
      </div>
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
</style>
