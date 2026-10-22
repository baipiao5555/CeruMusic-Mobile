<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SongRow from '@/components/SongRow.vue'
import { deletePlaylist, getPlaylist, renamePlaylist, updatePlaylistTracks } from '@/core/library'
import { addToQueue, playTracks } from '@/core/playback/player'
import { downloadTracks } from '@/core/downloads'
import { notify } from '@/core/plugin/manager'

const route = useRoute()
const router = useRouter()
const playlist = computed(() => getPlaylist(String(route.params.id)))
const showRename = ref(false)
const renameValue = ref('')
const selectionMode = ref(false)
const selectedIndexes = ref<Set<number>>(new Set())

const selectedTracks = computed(() => {
  if (!playlist.value) return []
  return playlist.value.tracks.filter((_, index) => selectedIndexes.value.has(index))
})
const allSelected = computed(
  () =>
    Boolean(playlist.value?.tracks.length) &&
    selectedTracks.value.length === playlist.value?.tracks.length
)

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

function remove(): void {
  if (!playlist.value) return
  if (window.confirm(`删除歌单「${playlist.value.name}」？`)) {
    deletePlaylist(playlist.value.id)
    router.replace('/library')
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

function batchRemove(): void {
  if (!playlist.value || !selectedTracks.value.length) return
  const count = selectedTracks.value.length
  if (!window.confirm(`从「${playlist.value.name}」移除选中的 ${count} 首歌？`)) return
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
  <div class="page playlist-page" :class="{ 'selection-active': selectionMode }">
    <header class="page-header">
      <button class="icon-btn" aria-label="返回" @click="router.back()">
        <Icon name="back" :size="20" />
      </button>
      <div class="header-actions">
        <button class="icon-btn" aria-label="重命名歌单" @click="openRename">
          <Icon name="edit" :size="19" />
        </button>
        <button class="icon-btn" aria-label="删除歌单" @click="remove">
          <Icon name="trash" :size="19" />
        </button>
      </div>
    </header>

    <template v-if="playlist">
      <section class="playlist-hero card">
        <div class="cover">
          <img v-if="playlist.tracks[0]" :src="playlist.tracks[0].artwork" alt="" />
          <Icon v-else name="music" :size="34" />
        </div>
        <div class="meta">
          <h1>{{ playlist.name }}</h1>
          <p>
            {{ playlist.tracks.length }} 首歌曲<template v-if="playlist.cloudId"> · 来自云端</template>
          </p>
          <div class="hero-actions">
            <button class="btn" :disabled="!playlist.tracks.length" @click="playAll">
              <Icon name="play" :size="17" /> 播放全部
            </button>
            <button
              class="btn secondary"
              :disabled="!playlist.tracks.length"
              @click="downloadAll"
            >
              <Icon name="download" :size="17" /> 下载全部
            </button>
            <button
              v-if="!selectionMode"
              class="btn ghost"
              :disabled="!playlist.tracks.length"
              @click="enterSelection"
            >
              选择
            </button>
            <button v-else class="btn ghost" @click="exitSelection">完成</button>
          </div>
        </div>
      </section>

      <div v-if="playlist.tracks.length" class="song-list-toolbar">
        <span>歌曲 {{ playlist.tracks.length }}</span>
        <button v-if="!selectionMode" class="toolbar-action" @click="enterSelection">
          批量选择
        </button>
        <button v-else class="toolbar-action" @click="toggleSelectAll">
          {{ allSelected ? '取消全选' : '全选' }}
        </button>
      </div>

      <div v-if="playlist.tracks.length" class="song-list">
        <SongRow
          v-for="(track, index) in playlist.tracks"
          :key="`${track.providerId}:${track.id}:${index}`"
          :track="track"
          :index="index"
          :queue="playlist.tracks"
          :playlist-id="playlist.id"
          :selectable="selectionMode"
          :selected="selectedIndexes.has(index)"
          show-index
          @play="play(index)"
          @toggle-select="toggleSelect(index)"
        />
      </div>
      <div v-else class="empty">
        <div class="emoji">🎵</div>
        <h3>歌单还是空的</h3>
        <p>在歌曲右侧的菜单里把歌曲加入歌单。</p>
        <button class="btn secondary" @click="router.push('/search')">去搜索音乐</button>
      </div>
    </template>

    <div v-else class="empty">
      <div class="emoji">🗂️</div>
      <h3>歌单不存在</h3>
      <button class="btn secondary" @click="router.replace('/library')">返回我的</button>
    </div>

    <div v-if="selectionMode" class="selection-bar">
      <button class="selection-cancel" @click="exitSelection">取消</button>
      <div class="selection-count">
        <strong>{{ selectedTracks.length }}</strong>
        <span>已选</span>
      </div>
      <div class="selection-actions">
        <button :disabled="!selectedTracks.length" @click="batchDownload">
          <Icon name="download" :size="18" />
          <span>下载</span>
        </button>
        <button :disabled="!selectedTracks.length" @click="batchQueue">
          <Icon name="queue" :size="18" />
          <span>队列</span>
        </button>
        <button class="danger" :disabled="!selectedTracks.length" @click="batchRemove">
          <Icon name="trash" :size="18" />
          <span>移出</span>
        </button>
      </div>
    </div>

    <div v-if="showRename" class="sheet-mask" @click.self="showRename = false">
      <div class="sheet">
        <h2>重命名歌单</h2>
        <p class="sub">修改后会立即保存到本地。</p>
        <div class="field">
          <input
            v-model="renameValue"
            class="input"
            maxlength="40"
            placeholder="歌单名称"
            @keyup.enter="saveRename"
          />
        </div>
        <div class="sheet-actions">
          <button class="btn secondary" @click="showRename = false">取消</button>
          <button class="btn" :disabled="!renameValue.trim()" @click="saveRename">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.header-actions {
  display: flex;
  gap: 6px;
}
.playlist-hero {
  display: flex;
  gap: 16px;
  padding: 16px;
}
.playlist-hero .cover {
  display: grid;
  place-items: center;
  width: 112px;
  height: 112px;
  border-radius: 20px;
  overflow: hidden;
  color: var(--brand);
  background: var(--brand-soft);
  flex: 0 0 auto;
}
.playlist-hero .cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.playlist-hero .meta {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
}
.playlist-hero h1 {
  font-size: 21px;
  line-height: 1.25;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.playlist-hero p {
  margin-top: 6px;
  font-size: 12px;
  color: var(--muted);
}
.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.song-list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 20px 4px 8px;
  color: var(--muted);
  font-size: 12px;
}
.toolbar-action {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 7px 10px;
  border-radius: 10px;
  color: var(--brand);
  background: var(--brand-soft);
  font-size: 12px;
  font-weight: 650;
}
.playlist-page.selection-active {
  padding-bottom: calc(var(--nav-height) + var(--mini-height) + 110px);
}
.selection-bar {
  position: fixed;
  bottom: calc(var(--nav-height) + var(--mini-height) + 10px);
  left: 50%;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(calc(100% - 28px), 592px);
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 22px;
  background: var(--surface-solid);
  box-shadow: 0 14px 44px rgba(16, 60, 45, 0.2);
  transform: translateX(-50%);
}
:global(.app-shell.has-mini) .selection-bar {
  bottom: calc(var(--nav-height) + var(--mini-height) + 10px);
}
.selection-cancel {
  padding: 9px 10px;
  color: var(--muted);
  font-size: 12px;
}
.selection-count {
  display: flex;
  align-items: baseline;
  gap: 3px;
  margin-right: auto;
  color: var(--muted);
  font-size: 11px;
}
.selection-count strong {
  color: var(--text);
  font-size: 19px;
  font-variant-numeric: tabular-nums;
}
.selection-actions {
  display: flex;
  gap: 3px;
}
.selection-actions button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 50px;
  padding: 5px 2px;
  border-radius: 12px;
  color: var(--muted);
  font-size: 10px;
}
.selection-actions button.danger {
  color: var(--danger);
}
.selection-actions button:disabled {
  opacity: 0.35;
}
</style>
