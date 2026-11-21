<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SongRow from '@/components/SongRow.vue'
import TrackListNavigation from '@/components/TrackListNavigation.vue'
import { deletePlaylist, getPlaylist, renamePlaylist, updatePlaylistFields, updatePlaylistTracks } from '@/core/library'
import { addToQueue, playTracks, setMode } from '@/core/playback/player'
import { trackKey } from '@/core/trackGrouping'
import { matchesTrackQuery, orderedTracks, useTrackNavigation } from '@/core/ui/trackNavigation'
import { downloadTracks } from '@/core/downloads'
import { notify } from '@/core/plugin/manager'
import { confirmAction } from '@/core/confirm'
import { openSearch } from '@/core/searchEntry'
import { useListWindow } from '@/core/ui/listWindow'

const route = useRoute()
const router = useRouter()
const playlist = computed(() => getPlaylist(String(route.params.id)))
const playlistTracks = computed(() => playlist.value?.tracks ?? [])
const keyword = ref('')
const searchOpen = ref(false)
const sortMode = ref<'saved' | 'name' | 'artist'>('saved')
const searchFiltered = computed(() => playlistTracks.value.filter(track => matchesTrackQuery(track,keyword.value)))
const displayTracks = computed(() => orderedTracks(searchFiltered.value,sortMode.value))
const scrollEl = ref<HTMLElement | null>(null)
const { items: visibleTracks, hasMore, remaining, showMore } = useListWindow(displayTracks)
const showRename = ref(false)
const descriptionValue = ref('')
const renameValue = ref('')
const selectionMode = ref(false)
const selectedIndexes = ref<Set<number>>(new Set())
const menuOpen = ref(false)

const selectedTracks = computed(() => {
  if (!playlist.value) return []
  return playlist.value.tracks.filter((_, index) => selectedIndexes.value.has(index))
})
const allSelected = computed(
  () =>
    Boolean(playlist.value?.tracks.length) &&
    selectedTracks.value.length === playlist.value?.tracks.length
)

/* —— 纯 UI 派生：头图取第一张有封面的歌、总时长、状态行 —— */
const coverArt = computed(
  () => playlist.value?.cover || playlist.value?.tracks.find((track) => Boolean(track.artwork))?.artwork || ''
)

const totalMs = computed(() =>
  (playlist.value?.tracks ?? []).reduce((sum, track) => sum + (Number(track.durationMs) || 0), 0)
)

const statsLine = computed(() => {
  const count = playlist.value?.tracks.length ?? 0
  if (!count) return '还没有歌曲'
  const minutes = Math.round(totalMs.value / 60000)
  if (minutes < 1) return '总长不到 1 分钟'
  if (minutes < 60) return `总长 ${minutes} 分钟`
  return `总长 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
})

function openRename(): void {
  if (!playlist.value) return
  renameValue.value = playlist.value.name
  descriptionValue.value = playlist.value.description || ''
  showRename.value = true
}

function saveRename(): void {
  if (!playlist.value) return
  const name = renameValue.value.trim()
  if (!name) return
  renamePlaylist(playlist.value.id, name)
  updatePlaylistFields(playlist.value.id,{description:descriptionValue.value.trim().slice(0,2000)})
  showRename.value = false
  notify('歌单信息已保存')
}

function play(index: number): void {
  const tracks = displayTracks.value
  if (tracks.length) void playTracks(tracks, index)
}

function playAll(): void {
  const tracks = displayTracks.value
  if (tracks.length) void playTracks(tracks, 0)
}

/** 随机：把播放模式切到 shuffle，再从一个随机位次起播。 */
function playShuffle(): void {
  const tracks = displayTracks.value
  if (!tracks.length) return
  setMode('shuffle')
  void playTracks(tracks, Math.floor(Math.random() * tracks.length))
}

async function remove(): Promise<void> {
  if (!playlist.value) return
  const ok = await confirmAction({
    title: `删除歌单「${playlist.value.name}」？`,
    body: '歌单会被删除，其中的歌曲仍保留在资料库与本地文件里。',
    confirmText: '删除',
    danger: true
  })
  if (ok) {
    deletePlaylist(playlist.value.id)
    router.replace('/playlists')
  }
}

function downloadAll(): void {
  const tracks = displayTracks.value
  const started = downloadTracks(tracks)
  notify(started ? `已加入下载队列：${started} 首` : '这个歌单里的歌曲都已下载')
}

function enterSelection(): void {
  if (!playlist.value?.tracks.length) return
  selectedIndexes.value = new Set()
  selectionMode.value = true
}

function exitSelection(): void {
  selectionMode.value = false
  selectedIndexes.value = new Set()
}

function toggleSelect(index: number): void {
  if (!selectionMode.value) return
  const next = new Set(selectedIndexes.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  selectedIndexes.value = next
}

function toggleSelectAll(): void {
  if (!playlist.value) return
  selectedIndexes.value = allSelected.value
    ? new Set()
    : new Set(playlist.value.tracks.map((_, index) => index))
}

function batchDownload(): void {
  const tracks = selectedTracks.value
  if (!tracks.length) return
  const started = downloadTracks(tracks)
  notify(started ? `已加入下载队列：${started} 首` : '选中的歌曲都已下载')
  exitSelection()
}

function batchQueue(): void {
  const tracks = selectedTracks.value
  if (!tracks.length) return
  for (const track of tracks) addToQueue(track)
  notify(`已加入播放队列：${tracks.length} 首`)
  exitSelection()
}

async function batchRemove(): Promise<void> {
  if (!playlist.value || !selectedTracks.value.length) return
  const count = selectedTracks.value.length
  const ok = await confirmAction({
    title: `从歌单移除 ${count} 首歌？`,
    body: `这些歌曲只会从「${playlist.value.name}」中移出，不会从资料库删除。`,
    confirmText: '移除',
    danger: true
  })
  if (!ok) return
  const indexes = selectedIndexes.value
  updatePlaylistTracks(
    playlist.value.id,
    playlist.value.tracks.filter((_, index) => !indexes.has(index))
  )
  notify(`已从歌单移除 ${count} 首歌`)
  exitSelection()
}

const navigation = useTrackNavigation({
  scrollTarget:scrollEl, tracks:()=>playlistTracks.value, visibleTracks:()=>displayTracks.value,
  ensureVisible:async index=>{while(visibleTracks.value.length<=index && hasMore.value){showMore();await nextTick()}},
  beforeLocate:()=>{keyword.value='';searchOpen.value=true}, label:()=>playlist.value?.name || '这个歌单',
  disabled:()=>selectionMode.value
})
function openPlaylistSearch(): void { searchOpen.value=true; nextTick(()=>scrollEl.value?.querySelector<HTMLInputElement>('.track-search input')?.focus()) }
function originalIndex(track: typeof playlistTracks.value[number]): number { return playlistTracks.value.indexOf(track) }
watch([keyword,sortMode,()=>playlist.value?.id],()=>navigation.clearHighlight())
onBeforeUnmount(()=>navigation.clearHighlight())

onMounted(() => {
  // The routed view can reuse the previous page's scroll container.
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('.playlist-page')?.scrollTo({ top: 0 })
  })
})
</script>

<template>
  <div class="screen detail-screen">
    <div ref="scrollEl" class="scroll playlist-page" :class="{ 'selection-active': selectionMode }" @scroll="navigation.onScroll">
      <div class="detail-header">
        <div class="appbar" @dblclick.self="navigation.toTop">
          <button class="iconbtn quiet" aria-label="返回" @click="router.back()"><Icon name="back" :size="22" /></button>
          <button class="ttl title-top" aria-label="回到歌单顶部" @dblclick="navigation.toTop">歌单</button>
          <button v-if="playlist" class="iconbtn quiet" aria-label="更多操作" @click="menuOpen = true"><Icon name="more" :size="23" /></button>
          <button v-if="playlist?.tracks.length" class="iconbtn quiet" :aria-label="selectionMode ? '歌单搜索' : '搜索歌单内歌曲'" @click="openPlaylistSearch"><Icon name="search" :size="21" /></button><span v-else class="header-spacer" />
        </div>
        <template v-if="playlist">
          <section class="hero">
            <div class="hero-cover">
              <img :src="coverArt || '/default-cover.png'" alt="" @error="($event.target as HTMLImageElement).src = '/default-cover.png'" />
            </div>
            <div class="hero-copy">
              <h1 class="hero-title">{{ playlist.name }}</h1>
              <p class="hero-source">{{ playlist.cloudId ? '云端导入 · 本地副本' : '本地歌单' }}</p>
              <p class="hero-stats">{{ playlist.tracks.length }} 首 · {{ statsLine }}</p>
            </div>
          </section>
          <p v-if="playlist.description" class="playlist-description">{{ playlist.description }}</p>
          <div class="detail-tools">
            <button @click="openRename"><Icon name="edit" :size="20" /> 重命名</button>
            <button :disabled="!playlist.tracks.length" @click="downloadAll"><Icon name="download" :size="20" /> 下载全部</button>
            <button @click="menuOpen = true"><Icon name="more" :size="22" /> 更多</button>
          </div>
        </template>
      </div>

      <template v-if="playlist">
        <div class="list-sticky-tools"><div class="pad actions">
          <button class="play" :disabled="!playlist.tracks.length" @click="playAll"><span class="play-icon"><Icon name="play" :size="18" /></span><strong>播放全部</strong><small>({{ playlist.tracks.length }})</small></button>
          <button class="iconbtn quiet" :aria-label="sortMode==='saved'?'当前顺序；点击切换排序':sortMode==='name'?'按歌名排序；点击切换排序':'按歌手排序；点击切换排序'" :disabled="!playlist.tracks.length || selectionMode" @click="sortMode=sortMode==='saved'?'name':sortMode==='name'?'artist':'saved'"><Icon name="sort" :size="20" /></button><button class="iconbtn quiet" aria-label="随机播放" :disabled="!playlist.tracks.length" @click="playShuffle"><Icon name="shuffle" :size="21" /></button>
          <button class="iconbtn quiet" :aria-label="selectionMode ? '退出多选' : '多选'" :disabled="!playlist.tracks.length" @click="selectionMode ? exitSelection() : enterSelection()"><Icon :name="selectionMode ? 'close' : 'select'" :size="21" /></button>
        </div>
        <label v-show="searchOpen && !selectionMode" class="track-search" role="search"><Icon name="search" :size="17" /><input v-model="keyword" type="search" aria-label="搜索歌单内歌曲" placeholder="搜索歌名、歌手或专辑" /><button v-if="keyword" type="button" aria-label="清空歌单搜索" @click="keyword=''"><Icon name="close" :size="15" /></button></label>
        <p v-show="keyword && !selectionMode" class="search-count" aria-live="polite">找到 {{ displayTracks.length }} 首<template v-if="!displayTracks.length"> · 原歌单没有改变</template></p>
        </div><div v-if="selectionMode" class="selection-head"><span>已选择 {{ selectedTracks.length }} 首</span><button @click="toggleSelectAll()">{{ allSelected ? '取消全选' : '全选' }}</button></div>
        <div v-if="displayTracks.length" class="pad rows">
          <SongRow v-for="(track, index) in visibleTracks" :key="`${track.providerId}:${track.id}:${index}`" :track="track" :index="index" :queue="displayTracks" :playlist-id="playlist.id" :selectable="selectionMode" :selected="selectedIndexes.has(originalIndex(track))" :show-index="!keyword.trim() && sortMode==='saved'" :query="keyword" :data-track-key="trackKey(track)" :aria-current="navigation.locatedKey.value===trackKey(track) ? 'true' : undefined" :class="{'located-track':navigation.locatedKey.value===trackKey(track)}" @play="play(index)" @toggle-select="toggleSelect(originalIndex(track))" />
          <button v-if="hasMore" class="btn btn-ghost btn-block list-more" @click="showMore">
            显示更多（剩余 {{ remaining }} 首）
          </button>
        </div>
        <div v-else-if="playlist.tracks.length" class="empty"><div class="glyph"><Icon name="search" :size="30" /></div><h3>这个歌单里没有匹配的歌曲</h3><p>换个歌名、歌手或专辑关键词，原歌曲仍然保留。</p><button class="btn btn-ghost btn-sm" @click="keyword=''">清空搜索</button></div>
        <div v-else class="empty"><div class="glyph"><Icon name="library" :size="34" /></div><h3>歌单还是空的</h3><p>在歌曲更多菜单中，将喜欢的歌曲加入这个歌单。</p><button class="btn btn-ghost btn-sm" @click="openSearch(router)"><Icon name="search" :size="16" /> 去搜索音乐</button></div>
      </template>
      <div v-else class="empty"><div class="glyph"><Icon name="folder" :size="34" /></div><h3>歌单不存在</h3><p>它可能已经被删除了。</p><button class="btn btn-ghost btn-sm" @click="router.replace('/playlists')">返回歌单</button></div>
    </div>

    <TrackListNavigation :visible="navigation.scrolled.value" :can-locate="navigation.playingHere.value" :disabled="selectionMode" @locate="navigation.toPlaying" @top="navigation.toTop" />

    <div v-if="selectionMode" class="selbar">
      <button class="selcancel" @click="exitSelection">取消</button>
      <div class="selcount">
        <em>{{ selectedTracks.length }}</em>
        <span>已选</span>
      </div>
      <div class="selacts">
        <button :disabled="!selectedTracks.length" @click="batchDownload">
          <Icon name="download" :size="19" />
          <span>下载</span>
        </button>
        <button :disabled="!selectedTracks.length" @click="batchQueue">
          <Icon name="queue" :size="19" />
          <span>队列</span>
        </button>
        <button class="danger" :disabled="!selectedTracks.length" @click="batchRemove">
          <Icon name="trash" :size="19" />
          <span>移出</span>
        </button>
      </div>
    </div>

    <transition name="sheet-pop">
      <div v-if="menuOpen && playlist" class="sheet-mask" @click.self="menuOpen = false">
        <div class="sheet" role="dialog" aria-modal="true" aria-label="歌单操作">
          <div class="grab" />
          <div class="sh-head">
            <span class="sh-title">{{ playlist.name }}</span>
            <button class="iconbtn quiet" aria-label="关闭更多操作" @click="menuOpen = false"><Icon name="close" :size="20" /></button>
          </div>
          <button class="sh-item" @click="menuOpen = false; openRename()">
            <Icon name="edit" :size="20" /> 重命名歌单
          </button>
          <button class="sh-item" @click="menuOpen = false; downloadAll()">
            <Icon name="download" :size="20" /> 下载全部
          </button>
          <button class="sh-item danger" @click="menuOpen = false; remove()">
            <Icon name="trash" :size="20" /> 删除歌单
          </button>
        </div>
      </div>
    </transition>

    <transition name="sheet-pop">
      <div v-if="showRename" class="sheet-mask" @click.self="showRename = false">
        <div class="sheet" role="dialog" aria-modal="true" aria-label="重命名歌单">
          <div class="grab" />
          <div class="sh-head">
            <span class="sh-title">重命名歌单</span>
            <button class="iconbtn quiet" aria-label="关闭重命名" @click="showRename = false"><Icon name="close" :size="20" /></button>
          </div>
          <div class="pad mt8">
            <label class="meta" for="playlist-name">歌单名称</label><input id="playlist-name" v-model="renameValue" class="nanofield mt12" maxlength="40" aria-label="歌单名称" />
            <label class="description-label" for="playlist-description">简介</label><textarea id="playlist-description" v-model="descriptionValue" class="description-input" rows="3" maxlength="2000" placeholder="添加这个歌单的简介" />
            <p class="meta">修改后会立即保存到本地。</p>
            <input
              v-model="renameValue"
              class="nanofield mt12"
              maxlength="40"
              placeholder="歌单名称"
              @keyup.enter="saveRename"
            />
          </div>
          <div class="sheetbtns">
            <button class="btn btn-ghost" @click="showRename = false">取消</button>
            <button class="btn btn-primary" :disabled="!renameValue.trim()" @click="saveRename">
              保存
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.playlist-page{padding-top:0}.detail-header{padding-top:var(--safe-top);background:linear-gradient(130deg,var(--tint-softer),var(--porcelain-2));color:var(--ink);border-bottom:1px solid var(--line)}
.detail-header .appbar{height:56px;padding:0 12px;display:flex;align-items:center;justify-content:space-between}.detail-header .appbar .ttl{font-size:17px;font-weight:600}.detail-header .iconbtn{width:44px;height:44px;color:inherit;flex:none}.header-spacer{width:44px}
.hero{display:flex;align-items:center;gap:16px;padding:15px var(--pad) 13px}.hero-cover{flex:0 0 104px;width:104px;height:104px;border-radius:16px;overflow:hidden;background:var(--surface-2);box-shadow:0 8px 24px #173b2d16}.hero-cover img{width:100%;height:100%;object-fit:cover}.hero-copy{flex:1;min-width:0}.hero-title{margin:0;font-size:21px;font-weight:700;line-height:1.4;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.hero-source{margin-top:9px;font-size:12px;color:var(--ink-3)}.hero-stats{margin-top:5px;font-size:11px;color:var(--ink-3);font-variant-numeric:tabular-nums}
.playlist-description{padding:0 var(--pad);margin:0;font-size:12px;line-height:1.6;color:var(--ink-3);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.detail-tools{display:flex;align-items:center;justify-content:space-around;gap:4px;padding:5px var(--pad) 8px}.detail-tools button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 8px;font-size:12px;color:var(--ink-2)}.detail-tools button:disabled{opacity:.4}
.list-sticky-tools{padding:8px 0 5px;background:var(--surface)}.actions{display:flex;align-items:center;gap:3px;min-height:52px;margin:0 var(--pad);padding:4px 5px;background:var(--surface-2);border:1px solid var(--line);border-radius:15px}.play{display:flex;align-items:center;gap:9px;flex:1;min-width:0;min-height:44px;text-align:left}.play strong{font-size:15px;font-weight:600}.play small{font-size:11px;color:var(--ink-3)}.play-icon{display:grid;place-items:center;width:34px;height:34px;flex:none;border-radius:50%;background:var(--brand-strong);color:var(--surface)}.actions .iconbtn{width:42px;height:44px;flex:none;color:var(--ink-3)}.actions button:disabled{opacity:.4}
.track-search{background:var(--porcelain-2)}.selection-head{display:flex;align-items:center;justify-content:space-between;padding:0 var(--pad);font-size:13px;color:var(--ink-3)}.selection-head button{min-height:44px;padding:0 6px;color:var(--ink)}
.rows{padding-top:10px;padding-bottom:8px}.rows :deep(.songrow){padding-left:0;padding-right:0}.list-more{margin:14px 0 4px}.playlist-page.selection-active{padding-bottom:calc(var(--dock-h) + 102px)}
.selbar{position:fixed;left:50%;bottom:calc(var(--dock-h) + 8px);z-index:40;display:flex;align-items:center;gap:6px;width:min(calc(100% - 24px),600px);padding:8px;border-radius:14px;border:1px solid var(--line);background:var(--surface);color:var(--ink);box-shadow:var(--sh-2);transform:translateX(-50%)}.selcancel{height:44px;padding:0 8px;font-size:13px;color:var(--ink-2)}.selcount{display:flex;align-items:baseline;gap:4px;margin-right:auto;font-size:11px;color:var(--ink-3)}.selcount em{font-style:normal;font-size:19px;font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums}.selacts{display:flex;gap:2px}.selacts button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;width:48px;min-height:48px;border-radius:8px;font-size:11px;color:var(--ink-2)}.selacts button.danger{color:var(--cinnabar)}.selacts button:disabled{opacity:.35}
.nanofield{width:100%;height:48px;padding:0 13px;border-radius:10px;background:var(--surface-2);border:1px solid var(--line);font-size:15px;color:var(--ink)}.description-label{display:block;margin-top:14px;color:var(--ink-3);font-size:12px}.description-input{width:100%;padding:10px 13px;margin-top:7px;border-radius:10px;background:var(--surface-2);border:1px solid var(--line);color:var(--ink);font:inherit;resize:vertical;user-select:text}.sheetbtns{display:flex;gap:8px;padding:14px var(--pad) 4px}.sheetbtns .btn{flex:1;justify-content:center}.empty{min-height:240px;padding:30px var(--pad);gap:12px}
@media(max-width:375px){.hero{gap:13px;padding-top:12px}.hero-cover{flex-basis:94px;width:94px;height:94px}.hero-title{font-size:19px}.detail-tools{gap:2px}.detail-tools button{font-size:11px;gap:4px;padding:0 6px}.actions .iconbtn{width:40px}.play{gap:7px}.play strong{font-size:14px}}
@media(min-width:768px){.detail-header,.playlist-page>.list-sticky-tools,.playlist-page>.rows,.playlist-page>.empty{max-width:980px;margin-left:auto;margin-right:auto}.hero{gap:22px;padding-top:20px}.hero-cover{flex-basis:128px;width:128px;height:128px}.hero-title{font-size:24px}.hero-source{font-size:13px}.hero-stats{font-size:12px}}
</style>
