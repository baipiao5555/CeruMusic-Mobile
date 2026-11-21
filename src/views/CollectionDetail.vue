<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SongRow from '@/components/SongRow.vue'
import TrackListNavigation from '@/components/TrackListNavigation.vue'
import { libraryState } from '@/core/library'
import { clearHistory, getHistory, playTracks } from '@/core/playback/player'
import { confirmAction } from '@/core/confirm'
import { openSearch } from '@/core/searchEntry'
import { useListWindow } from '@/core/ui/listWindow'
import { trackKey } from '@/core/trackGrouping'
import { matchesTrackQuery, orderedTracks, useTrackNavigation } from '@/core/ui/trackNavigation'
import { notify } from '@/core/plugin/manager'

const route = useRoute()
const router = useRouter()
const recent = computed(() => route.path === '/recent')
const title = computed(() => recent.value ? '最近播放' : '我喜欢的音乐')
const query = ref('')
const scrollEl=ref<HTMLElement | null>(null)
const sort = ref<'saved' | 'name' | 'artist'>('saved')
const source = computed(() => recent.value ? getHistory() : libraryState.favorites)
const tracks = computed(() => {
  const list = source.value.filter(track => matchesTrackQuery(track,query.value))
  if (!recent.value && sort.value !== 'saved') {
  }
  return orderedTracks(list,sort.value)
})
const { items, hasMore, remaining, showMore } = useListWindow(tracks)

const navigation=useTrackNavigation({
  scrollTarget:scrollEl,tracks:()=>source.value,visibleTracks:()=>tracks.value,
  ensureVisible:async index=>{while(items.value.length<=index&&hasMore.value){showMore();await nextTick()}},
  beforeLocate:()=>{query.value=''},label:()=>title.value
})
function back(): void {
  if (window.history.state?.back) router.back()
  else void router.replace('/library')
}
function play(index = 0): void {
  if (tracks.value.length) {
    void playTracks(tracks.value, index).catch((error) => notify(error instanceof Error ? error.message : '播放失败', 'error'))
  }
}
async function clear(): Promise<void> {
  const ok = await confirmAction({
    title: '清空最近播放？',
    body: '只清空播放记录，不影响喜欢、歌单、下载文件或当前播放队列。',
    confirmText: '清空记录', danger: true
  })
  if (ok) clearHistory()
}
watch([recent,query,sort], () => navigation.clearHighlight())
watch(recent, () => { query.value = ''; sort.value = 'saved' })
</script>

<template>
  <div class="screen collection-screen">
    <div ref="scrollEl" class="scroll safe-t collection-page" @scroll="navigation.onScroll">
      <header class="appbar">
        <button class="iconbtn quiet" aria-label="返回" @click="back"><Icon name="back" :size="22" /></button>
        <button class="ttl title-top" :aria-label="title + '：回到顶部'" @dblclick="navigation.toTop">{{ title }}</button>
        <button v-if="recent" class="iconbtn quiet" aria-label="清空最近播放" :disabled="!source.length" @click="clear"><Icon name="trash" :size="20" /></button>
        <span v-else class="header-spacer" />
      </header>
      <p class="pad collection-summary">{{ source.length }} 首 · {{ recent ? '按最近播放排序 · 最多保留 100 首' : '收藏记录保存在本机，不等于已下载' }}</p>
      <label class="collection-search track-search">
        <Icon name="search" :size="18" />
        <input v-model="query" aria-label="搜索当前列表" :placeholder="recent ? '搜索最近播放' : '搜索我喜欢的音乐'" />
      </label>
      <div class="list-sticky-tools"><div class="pad collection-actions">
        <button class="play-all" :disabled="!tracks.length" @click="play()"><Icon name="play" :size="19" /> 播放全部 <small>({{ tracks.length }})</small></button>
        <select v-if="!recent" v-model="sort" aria-label="收藏排序">
          <option value="saved">收藏顺序</option><option value="name">歌曲名称</option><option value="artist">歌手名称</option>
        </select>
      </div></div>
      <div v-if="tracks.length" class="collection-rows">
        <SongRow v-for="(track, index) in items" :key="track.providerId + ':' + track.id" :track="track" :index="index" :queue="tracks" :query="query" :data-track-key="trackKey(track)" :aria-current="navigation.locatedKey.value===trackKey(track) ? 'true' : undefined" :class="{'located-track':navigation.locatedKey.value===trackKey(track)}" @play="play(index)" />
        <button v-if="hasMore" class="btn btn-ghost btn-block" @click="showMore">显示更多（剩余 {{ remaining }} 首）</button>
      </div>
      <div v-else class="empty">
        <div class="glyph"><Icon :name="recent ? 'history' : 'heart'" :size="32" /></div>
        <h3>{{ query.trim() ? '没有匹配的歌曲' : recent ? '还没有播放记录' : '还没有喜欢的歌曲' }}</h3>
        <p>{{ query.trim() ? '换个关键词试试，原列表仍然保留。' : recent ? '成功开始播放的歌曲会出现在这里。' : '在歌曲更多菜单中收藏，就会出现在这里。' }}</p>
        <button v-if="!query.trim() && !recent" class="btn btn-ghost btn-sm" @click="openSearch(router)"><Icon name="search" :size="16" /> 去搜索音乐</button>
      </div>
    </div>
    <TrackListNavigation :visible="navigation.scrolled.value" :can-locate="navigation.playingHere.value" @locate="navigation.toPlaying" @top="navigation.toTop" />
  </div>
</template>

<style scoped>
.header-spacer { width: 44px; flex: none; }
.collection-summary { color: var(--ink-3); font-size: 12px; line-height: 1.6; margin: 8px 0 12px; }
.collection-search { display: flex; align-items: center; gap: 8px; margin: 0 var(--pad); padding: 0 12px; background: var(--surface-2); border-radius: var(--r-sm); color: var(--ink-3); }
.collection-search input { width: 100%; min-width: 0; min-height: 44px; color: var(--ink); background: transparent; border: 0; font: inherit; font-size: 13px; user-select: text; }
.collection-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 10px; padding-bottom: 6px; }
.play-all { display: inline-flex; align-items: center; gap: 7px; min-height: 44px; color: var(--ink); font-size: 14px; }
.play-all .i { color: var(--tint); }
.play-all small { font-size: 12px; color: var(--ink-3); }
.collection-actions select { max-width: 108px; min-height: 44px; border: 0; color: var(--ink-3); background: transparent; font: inherit; font-size: 12px; }
.collection-rows { padding: 0 8px; }
@media (min-width: 768px) { .collection-page { max-width: 980px; margin: 0 auto; } }
</style>
