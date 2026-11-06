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
  () => playlist.value?.tracks.find((track) => Boolean(track.artwork))?.artwork ?? ''
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
  <div class="screen">
    <div class="scroll playlist-page" :class="{ 'selection-active': selectionMode }">
      <div class="appbar">
        <button class="iconbtn glass on-art" aria-label="返回" @click="router.back()">
          <Icon name="back" :size="20" />
        </button>
        <button
          v-if="playlist"
          class="iconbtn glass on-art more-btn"
          aria-label="更多操作"
          @click="menuOpen = true"
        >
          <Icon name="more" :size="19" />
        </button>
      </div>

      <template v-if="playlist">
        <section class="hero">
          <div
            class="hero-art"
            :class="{ flat: !coverArt }"
            :style="coverArt ? { backgroundImage: `url('${coverArt}')` } : undefined"
          />
          <div class="imgscrim hero-veil" />
          <div class="hero-body">
            <div class="cover hero-cover">
              <img v-if="coverArt" :src="coverArt" alt="" />
              <Icon v-else name="music" :size="38" />
              <span v-if="playlist.cloudId" class="badge gold hero-badge">
                <Icon name="cloud" :size="11" /> 云端
              </span>
            </div>
            <h1 class="hero-title clamp-2">{{ playlist.name }}</h1>
            <p class="hero-by">
              <span class="byline">{{ playlist.cloudId ? '来自云端' : '保存在本机' }}</span>
              <span class="bysep" />
              <span>{{ playlist.tracks.length }} 首歌</span>
              <span class="bysep" />
              <span>{{ statsLine }}</span>
            </p>
          </div>
        </section>

        <div class="pad actions">
          <button class="btn btn-primary play" :disabled="!playlist.tracks.length" @click="playAll">
            <Icon name="play" :size="15" /> 播放全部
          </button>
          <button
            class="iconbtn soft"
            aria-label="随机播放"
            :disabled="!playlist.tracks.length"
            @click="playShuffle"
          >
            <Icon name="shuffle" :size="18" />
          </button>
          <button
            class="iconbtn soft"
            :aria-label="selectionMode ? '退出多选' : '多选'"
            :disabled="!playlist.tracks.length"
            @click="selectionMode ? exitSelection() : enterSelection()"
          >
            <Icon :name="selectionMode ? 'close' : 'select'" :size="18" />
          </button>
        </div>

        <div class="group-title tracks-head">
          <span class="cn">曲目</span>
          <span class="cnt">{{ playlist.tracks.length }} 首</span>
          <span class="en">Tracks</span>
          <button
            v-if="selectionMode"
            class="act"
            @click="toggleSelectAll()"
          >
            {{ allSelected ? '取消全选' : '全选' }}
          </button>
        </div>

        <div v-if="playlist.tracks.length" class="pad mt4 rows">
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
          <div class="glyph"><Icon name="library" :size="34" /></div>
          <h3>歌单还是空的</h3>
          <p>在歌曲右侧的菜单里把歌加入歌单；先收藏几首也行。</p>
          <button class="btn btn-ghost btn-sm mt8" @click="router.push('/search')">
            <Icon name="search" :size="15" /> 去搜索音乐
          </button>
        </div>
      </template>

      <div v-else class="empty">
        <div class="glyph"><Icon name="folder" :size="34" /></div>
        <h3>歌单不存在</h3>
        <p>它可能已经被删除了。</p>
        <button class="btn btn-ghost btn-sm mt8" @click="router.replace('/library')">
          返回我的
        </button>
      </div>
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
.appbar .ttl {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hero {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  min-height: 268px;
  padding: calc(var(--safe-top) + 58px) 20px 16px;
  overflow: hidden;
  isolation: isolate;
}
.hero-art {
  position: absolute;
  inset: -12%;
  z-index: 0;
  background-position: center;
  background-size: cover;
  filter: blur(34px) saturate(1.15);
  transform: scale(1.12);
  opacity: 0.72;
}
.hero-art.flat {
  background-image: radial-gradient(circle at 50% 30%, var(--tint-softer), var(--porcelain-2));
}
.hero-veil {
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.3) 0%,
    rgba(0, 0, 0, 0.04) 26%,
    rgba(0, 0, 0, 0) 56%,
    var(--porcelain) 99%
  );
}
.hero-body {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  width: 100%;
  max-width: 340px;
}
.hero-cover {
  width: 128px;
  height: 128px;
  border-radius: 21px;
  box-shadow: var(--sh-3);
  display: grid;
  place-items: center;
  color: var(--ink-3);
}
.hero-badge {
  position: absolute;
  left: 8px;
  bottom: 8px;
}
.hero-title {
  margin-top: 14px;
  font-family: var(--serif);
  font-size: 25px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--ink);
}
.hero-by {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--ink-2);
}
.byline {
  font-weight: 550;
  color: var(--ink);
}
.bysep {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--ink-4);
}
.hero-stats {
  margin-top: 5px;
  font-size: 11.5px;
  color: var(--ink-4);
  font-variant-numeric: tabular-nums;
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}
.actions .btn {
  flex: 1;
  justify-content: center;
}
.actions .iconbtn {
  width: 44px;
  height: 44px;
  flex: none;
}
.actions .iconbtn:disabled {
  opacity: 0.45;
}
.more-btn {
  margin-left: auto;
}
.playlist-page {
  padding-top: 0;
}
.playlist-page > .appbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 6;
  height: calc(var(--safe-top) + 56px);
  padding: var(--safe-top) 14px 0;
}
.appbar .on-art {
  color: #fff;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.14);
}
.tracks-head .act {
  margin: -10px 0;
  padding: 12px 6px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  color: var(--ink-3);
  font-size: 12px;
  font-weight: 500;
}
.playlist-page.selection-active {
  padding-bottom: calc(var(--dock-h) + 118px);
}
.selbar {
  position: fixed;
  left: 50%;
  bottom: calc(var(--dock-h) + 10px);
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 6px;
  width: min(calc(100% - 24px), 600px);
  padding: 6px 8px;
  border-radius: var(--r-pill);
  background: var(--ink);
  color: var(--ink-inv);
  box-shadow: var(--sh-3);
  transform: translateX(-50%);
}
.selcancel {
  height: 44px;
  padding: 0 10px;
  font-size: 12.5px;
  font-weight: 550;
  color: var(--ink-inv);
  opacity: 0.72;
}
.selcount {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-right: auto;
  font-size: 10.5px;
  color: var(--ink-inv);
  opacity: 0.66;
}
.selcount em {
  font-style: normal;
  font-size: 19px;
  font-weight: 600;
  color: var(--ink-inv);
  font-variant-numeric: tabular-nums;
  opacity: 1;
}
.selacts {
  display: flex;
  gap: 2px;
}
.selacts button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 52px;
  min-height: 44px;
  border-radius: var(--r-md);
  font-size: 10px;
  color: var(--ink-inv);
  opacity: 0.78;
}
.selacts button.danger {
  color: var(--cinnabar);
  opacity: 1;
}
.selacts button:disabled {
  opacity: 0.35;
}
.nanofield {
  width: 100%;
  height: 46px;
  padding: 0 13px;
  border-radius: var(--r-md);
  background: var(--porcelain-2);
  border: 1px solid var(--line);
  font-size: 14px;
  color: var(--ink);
}
.sheetbtns {
  display: flex;
  gap: 8px;
  padding: 14px 20px 4px;
}
.sheetbtns .btn {
  flex: 1;
  justify-content: center;
}
.rows {
  padding-bottom: 4px;
}

</style>
