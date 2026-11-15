<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SongRow from '@/components/SongRow.vue'
import { deletePlaylist, getPlaylist, renamePlaylist, updatePlaylistTracks } from '@/core/library'
import { addToQueue, playTracks, setMode } from '@/core/playback/player'
import { downloadTracks } from '@/core/downloads'
import { notify } from '@/core/plugin/manager'
import { confirmAction } from '@/core/confirm'

const route = useRoute()
const router = useRouter()
const playlist = computed(() => getPlaylist(String(route.params.id)))
const showRename = ref(false)
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
  showRename.value = true
}

function saveRename(): void {
  if (!playlist.value) return
  const name = renameValue.value.trim()
  if (!name) return
  renamePlaylist(playlist.value.id, name)
  showRename.value = false
  notify('歌单已重命名')
}

function play(index: number): void {
  const tracks = playlist.value?.tracks ?? []
  if (tracks.length) void playTracks(tracks, index)
}

function playAll(): void {
  const tracks = playlist.value?.tracks ?? []
  if (tracks.length) void playTracks(tracks, 0)
}

/** 随机：把播放模式切到 shuffle，再从一个随机位次起播。 */
function playShuffle(): void {
  const tracks = playlist.value?.tracks ?? []
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
  const tracks = playlist.value?.tracks ?? []
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

onMounted(() => {
  // The routed view can reuse the previous page's scroll container.
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('.playlist-page')?.scrollTo({ top: 0 })
  })
})
</script>

<template>
  <div class="screen detail-screen">
    <div class="scroll playlist-page" :class="{ 'selection-active': selectionMode }">
      <div class="detail-header">
        <div class="appbar">
          <button class="iconbtn quiet" aria-label="返回" @click="router.back()"><Icon name="back" :size="22" /></button>
          <span class="ttl">歌单</span>
          <button v-if="playlist" class="iconbtn quiet" aria-label="更多操作" @click="menuOpen = true"><Icon name="more" :size="23" /></button>
          <span v-else class="header-spacer" />
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
        <div class="pad actions">
          <button class="play" :disabled="!playlist.tracks.length" @click="playAll"><span class="play-icon"><Icon name="play" :size="18" /></span><strong>播放全部</strong><small>({{ playlist.tracks.length }})</small></button>
          <button class="iconbtn quiet" aria-label="随机播放" :disabled="!playlist.tracks.length" @click="playShuffle"><Icon name="shuffle" :size="21" /></button>
          <button class="iconbtn quiet" :aria-label="selectionMode ? '退出多选' : '多选'" :disabled="!playlist.tracks.length" @click="selectionMode ? exitSelection() : enterSelection()"><Icon :name="selectionMode ? 'close' : 'select'" :size="21" /></button>
        </div>
        <div v-if="selectionMode" class="selection-head"><span>已选择 {{ selectedTracks.length }} 首</span><button @click="toggleSelectAll()">{{ allSelected ? '取消全选' : '全选' }}</button></div>
        <div v-if="playlist.tracks.length" class="pad rows">
          <SongRow v-for="(track, index) in playlist.tracks" :key="`${track.providerId}:${track.id}:${index}`" :track="track" :index="index" :queue="playlist.tracks" :playlist-id="playlist.id" :selectable="selectionMode" :selected="selectedIndexes.has(index)" :show-cover="false" show-index @play="play(index)" @toggle-select="toggleSelect(index)" />
        </div>
        <div v-else class="empty"><div class="glyph"><Icon name="library" :size="34" /></div><h3>歌单还是空的</h3><p>在歌曲更多菜单中，将喜欢的歌曲加入这个歌单。</p><button class="btn btn-ghost btn-sm" @click="router.push('/search')"><Icon name="search" :size="16" /> 去搜索音乐</button></div>
      </template>
      <div v-else class="empty"><div class="glyph"><Icon name="folder" :size="34" /></div><h3>歌单不存在</h3><p>它可能已经被删除了。</p><button class="btn btn-ghost btn-sm" @click="router.replace('/playlists')">返回歌单</button></div>
    </div>

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

    <div v-if="menuOpen && playlist" class="sheet-mask" @click.self="menuOpen = false">
      <div class="sheet">
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

    <div v-if="showRename" class="sheet-mask" @click.self="showRename = false">
      <div class="sheet">
        <div class="grab" />
        <div class="sh-head">
          <span class="sh-title">重命名歌单</span>
          <button class="iconbtn quiet" aria-label="关闭重命名" @click="showRename = false"><Icon name="close" :size="20" /></button>
        </div>
        <div class="pad mt8">
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
  </div>
</template>

<style scoped>
.playlist-page { padding-top: 0; }
.detail-header { padding-top: var(--safe-top); background: linear-gradient(130deg, #d7e8f5, #eff6fb); color: #182b37; }
.detail-header .appbar { height: 56px; padding: 0 12px; }
.detail-header .ttl { color: inherit; font-size: 18px; font-weight: 500; letter-spacing: 0; }
.detail-header .iconbtn { width: 44px; height: 44px; color: inherit; flex: none; }
.header-spacer { width: 44px; }
.hero { display: flex; align-items: center; gap: 18px; padding: 24px var(--pad) 18px; }
.hero-cover { flex: 0 0 126px; width: 126px; height: 126px; border-radius: 11px; overflow: hidden; background: #bfd3e2; box-shadow: 0 8px 20px #345e7912; }
.hero-cover img { width: 100%; height: 100%; object-fit: cover; }
.hero-copy { flex: 1; min-width: 0; }
.hero-title { margin: 0; font-family: inherit; font-size: 24px; font-weight: 750; line-height: 1.35; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.hero-source { margin-top: 14px; font-size: 12px; line-height: 1.5; color: #516c7c; }
.hero-stats { margin-top: 7px; font-size: 12px; line-height: 1.5; color: #617c8b; }
.playlist-description { padding: 0 var(--pad); margin: 0; font-size: 13px; line-height: 1.6; color: #546f80; overflow-wrap: anywhere; }
.detail-tools { display: flex; align-items: center; justify-content: space-around; gap: 6px; padding: 10px var(--pad) 10px; }
.detail-tools button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 48px; font-size: 13px; color: #43677b; }
.detail-tools button:disabled { opacity: .4; }
.actions { display: flex; align-items: center; gap: 5px; min-height: 70px; padding-top: 8px; padding-bottom: 8px; background: var(--porcelain); }
.play { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; min-height: 48px; text-align: left; }
.play strong { font-size: 16px; font-weight: 650; }
.play small { font-size: 12px; color: var(--ink-3); }
.play-icon { display: grid; place-items: center; width: 30px; height: 30px; flex: none; border-radius: 50%; background: var(--tint); color: #083c2d; }
.actions .iconbtn { width: 44px; height: 44px; flex: none; color: var(--ink-3); }
.actions button:disabled { opacity: .4; }
.selection-head { display: flex; align-items: center; justify-content: space-between; padding: 0 var(--pad); font-size: 13px; color: var(--ink-3); }
.selection-head button { min-height: 44px; padding: 0 6px; color: var(--ink); }
.rows { padding-bottom: 8px; }
.rows :deep(.songrow) { padding-left: 0; padding-right: 0; }
.playlist-page.selection-active { padding-bottom: calc(var(--dock-h) + 102px); }
.selbar { position: fixed; left: 50%; bottom: calc(var(--dock-h) + 8px); z-index: 40; display: flex; align-items: center; gap: 6px; width: min(calc(100% - 24px), 600px); padding: 8px; border-radius: 14px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); box-shadow: var(--sh-2); transform: translateX(-50%); }
.selcancel { height: 44px; padding: 0 8px; font-size: 13px; color: var(--ink-2); }
.selcount { display: flex; align-items: baseline; gap: 4px; margin-right: auto; font-size: 11px; color: var(--ink-3); }
.selcount em { font-style: normal; font-size: 19px; font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }
.selacts { display: flex; gap: 2px; }
.selacts button { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; width: 48px; min-height: 48px; border-radius: 8px; font-size: 11px; color: var(--ink-2); }
.selacts button.danger { color: var(--cinnabar); }
.selacts button:disabled { opacity: .35; }
.nanofield { width: 100%; height: 48px; padding: 0 13px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--line); font-size: 15px; color: var(--ink); }
.sheetbtns { display: flex; gap: 8px; padding: 14px var(--pad) 4px; }
.sheetbtns .btn { flex: 1; justify-content: center; }
.empty { min-height: 240px; padding: 30px var(--pad); gap: 12px; }
:global([data-theme='dark'] .detail-screen .detail-header) { background: linear-gradient(130deg, #24384c, #17232e); color: #edf4fc; }
:global([data-theme='dark'] .detail-screen .hero-source), :global([data-theme='dark'] .detail-screen .hero-stats), :global([data-theme='dark'] .detail-screen .playlist-description), :global([data-theme='dark'] .detail-screen .detail-tools button) { color: #b7ccdf; }
@media (max-width: 375px) { .hero { gap: 14px; padding-top: 18px; } .hero-cover { flex-basis: 112px; width: 112px; height: 112px; } .hero-title { font-size: 22px; } .detail-tools { gap: 3px; } .detail-tools button { font-size: 12px; gap: 5px; } }
</style>
