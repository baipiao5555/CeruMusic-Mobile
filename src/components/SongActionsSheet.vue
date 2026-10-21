<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import type { Track } from '@/core/track'
import {
  addTrackToPlaylist,
  createPlaylist,
  libraryState,
  removeTrackFromPlaylist,
  type LocalPlaylist
} from '@/core/library'
import { addToQueue } from '@/core/playback/player'
import {
  downloadTrack,
  isDownloaded,
  isDownloading
} from '@/core/downloads'
import { notify } from '@/core/plugin/manager'

const props = defineProps<{ track: Track; playlistId?: string }>()
const emit = defineEmits<{ close: [] }>()

const view = ref<'menu' | 'playlist'>('menu')
const newName = ref('')

const downloaded = computed(() => isDownloaded(props.track))
const downloading = computed(() => isDownloading(props.track))
const playlists = computed(() => libraryState.playlists)

function playNext(): void {
  addToQueue(props.track, true)
  notify('已设为下一首播放')
  emit('close')
}

function queue(): void {
  addToQueue(props.track)
  notify('已加入播放队列')
  emit('close')
}

function download(): void {
  if (downloaded.value) {
    notify('这首歌已经下载好了')
  } else if (downloading.value) {
    notify('这首歌正在下载中')
  } else {
    downloadTrack(props.track)
    notify('已加入下载队列')
  }
  emit('close')
}

function removeFromPlaylist(): void {
  if (!props.playlistId) return
  removeTrackFromPlaylist(props.playlistId, props.track)
  notify('已从歌单移除')
  emit('close')
}

function addTo(playlist: LocalPlaylist): void {
  const added = addTrackToPlaylist(playlist.id, props.track)
  notify(added ? `已添加到「${playlist.name}」` : `「${playlist.name}」里已经有这首歌`)
  emit('close')
}

function createAndAdd(): void {
  const name = newName.value.trim()
  if (!name) return
  const playlist = createPlaylist(name)
  addTrackToPlaylist(playlist.id, props.track)
  notify(`已创建「${name}」并添加`)
  emit('close')
}
</script>

<template>
  <div class="sheet-mask" @click.self="emit('close')">
    <div class="sheet actions-sheet">
      <template v-if="view === 'menu'">
        <div class="song-head">
          <img
            :src="track.artwork"
            alt=""
            @error="($event.target as HTMLImageElement).src = '/default-cover.png'"
          />
          <div class="song-meta">
            <h3>{{ track.title }}</h3>
            <p>{{ track.artist }}</p>
          </div>
          <button class="icon-action" aria-label="关闭" @click="emit('close')">
            <Icon name="close" :size="18" />
          </button>
        </div>

        <div class="action-list">
          <button class="action-row" @click="playNext">
            <Icon name="next" :size="19" />
            <span>下一首播放</span>
          </button>
          <button class="action-row" @click="queue">
            <Icon name="queue" :size="19" />
            <span>添加到播放队列</span>
          </button>
          <button class="action-row" @click="view = 'playlist'">
            <Icon name="folder" :size="19" />
            <span>添加到歌单</span>
            <Icon name="chevron" :size="17" class="trailing" />
          </button>
          <button class="action-row" @click="download">
            <Icon :name="downloaded ? 'check' : 'download'" :size="19" />
            <span>{{ downloaded ? '已下载' : downloading ? '下载中…' : '下载' }}</span>
          </button>
          <button v-if="playlistId" class="action-row danger" @click="removeFromPlaylist">
            <Icon name="trash" :size="19" />
            <span>从当前歌单移除</span>
          </button>
        </div>
      </template>

      <template v-else>
        <div class="sheet-head">
          <button class="icon-action" aria-label="返回" @click="view = 'menu'">
            <Icon name="back" :size="18" />
          </button>
          <h2>添加到歌单</h2>
          <span style="width: 36px" />
        </div>

        <div v-if="playlists.length" class="playlist-picker">
          <button
            v-for="playlist in playlists"
            :key="playlist.id"
            class="action-row"
            @click="addTo(playlist)"
          >
            <span class="playlist-icon"><Icon name="music" :size="17" /></span>
            <span class="playlist-name">{{ playlist.name }}</span>
            <span class="playlist-count">{{ playlist.tracks.length }} 首</span>
          </button>
        </div>
        <p v-else class="picker-hint">还没有歌单，在下面新建一个。</p>

        <div class="new-playlist">
          <input
            v-model="newName"
            class="input"
            placeholder="新建歌单名称"
            maxlength="40"
            @keyup.enter="createAndAdd"
          />
          <button class="btn" :disabled="!newName.trim()" @click="createAndAdd">创建并添加</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.actions-sheet {
  max-height: 82vh;
  overflow-y: auto;
}
.song-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 12px;
}
.song-head img {
  width: 48px;
  height: 48px;
  border-radius: 13px;
  object-fit: cover;
  flex: 0 0 auto;
}
.song-meta {
  flex: 1;
  min-width: 0;
}
.song-meta h3 {
  font-size: 14.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.song-meta p {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.action-list {
  display: flex;
  flex-direction: column;
}
.action-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 13px 4px;
  font-size: 14px;
  color: var(--text);
  text-align: left;
  border-bottom: 1px solid var(--line, rgba(127, 127, 127, 0.12));
}
.action-row:last-child {
  border-bottom: 0;
}
.action-row.danger {
  color: #e05353;
}
.action-row .trailing {
  margin-left: auto;
  color: var(--muted-2);
}
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.sheet-head h2 {
  margin: 0;
  font-size: 17px;
}
.playlist-picker {
  max-height: 42vh;
  overflow-y: auto;
}
.playlist-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  color: var(--brand);
  background: var(--brand-soft);
  flex: 0 0 auto;
}
.playlist-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.playlist-count {
  font-size: 11px;
  color: var(--muted-2);
}
.picker-hint {
  margin: 4px 0 14px;
  font-size: 12px;
  color: var(--muted);
}
.new-playlist {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}
.new-playlist .input {
  flex: 1;
  min-width: 0;
}
.new-playlist .btn {
  flex: 0 0 auto;
  padding: 0 14px;
}
</style>
