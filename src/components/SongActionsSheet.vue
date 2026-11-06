<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import type { Track } from '@/core/track'
import {
  addTrackToPlaylist,
  createPlaylist,
  isFavorite,
  libraryState,
  removeTrackFromPlaylist,
  toggleFavorite,
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
const favorite = computed(() => isFavorite(props.track))
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

function toggleFav(): void {
  const liked = toggleFavorite(props.track)
  notify(liked ? '已收藏' : '已取消收藏')
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
    <div class="scrim" @click="emit('close')" />
    <div class="sheet">
      <div class="grab" />

      <template v-if="view === 'menu'">
        <div class="sh-head">
          <div class="song">
            <div class="cover">
              <img
                :src="track.artwork"
                alt=""
                @error="($event.target as HTMLImageElement).src = '/default-cover.png'"
              />
            </div>
            <div class="song-text">
              <div class="sh-title truncate">{{ track.title }}</div>
              <div class="sh-sub truncate">{{ track.artist }}</div>
            </div>
          </div>
          <div class="sh-acts">
            <button class="iconbtn quiet" aria-label="关闭" @click="emit('close')">
              <Icon name="close" :size="18" />
            </button>
          </div>
        </div>

        <div class="sh-list">
          <button class="sh-item" @click="playNext">
            <span class="ico"><Icon name="next" :size="19" /></span>
            <span class="lab">下一首播放</span>
          </button>
          <button class="sh-item" @click="queue">
            <span class="ico"><Icon name="queue" :size="19" /></span>
            <span class="lab">添加到播放队列</span>
          </button>
          <button class="sh-item" @click="view = 'playlist'">
            <span class="ico"><Icon name="folder" :size="19" /></span>
            <span class="lab">添加到歌单</span>
            <Icon name="chevron" :size="16" class="trail" />
          </button>
          <button class="sh-item" @click="toggleFav">
            <span class="ico">
              <Icon :name="favorite ? 'heart-filled' : 'heart'" :size="19" />
            </span>
            <span class="lab">{{ favorite ? '取消收藏' : '收藏' }}</span>
            <span class="trail-note">{{ favorite ? '已收藏' : '' }}</span>
          </button>
          <button class="sh-item" @click="download">
            <span class="ico"><Icon :name="downloaded ? 'check' : 'download'" :size="19" /></span>
            <span class="lab">{{ downloaded ? '已下载' : downloading ? '下载中…' : '下载' }}</span>
          </button>
          <button v-if="playlistId" class="sh-item danger" @click="removeFromPlaylist">
            <span class="ico"><Icon name="trash" :size="19" /></span>
            <span class="lab">从当前歌单移除</span>
          </button>
        </div>
      </template>

      <template v-else>
        <div class="sh-head">
          <div class="hdrow">
            <button class="iconbtn quiet" aria-label="返回" @click="view = 'menu'">
              <Icon name="back" :size="18" />
            </button>
            <div class="sh-title">添加到歌单</div>
          </div>
          <button class="iconbtn quiet" aria-label="关闭" @click="emit('close')">
            <Icon name="close" :size="18" />
          </button>
        </div>

        <div v-if="playlists.length" class="sh-list">
          <button
            v-for="playlist in playlists"
            :key="playlist.id"
            class="sh-item"
            @click="addTo(playlist)"
          >
            <span class="ico"><Icon name="music" :size="18" /></span>
            <span class="lab truncate">{{ playlist.name }}</span>
            <span class="cnt">{{ playlist.tracks.length }} 首</span>
          </button>
        </div>
        <p v-else class="hint">还没有歌单，在下面新建一个。</p>

        <div class="newrow">
          <input
            v-model="newName"
            class="field"
            placeholder="新建歌单名称"
            maxlength="40"
            @keyup.enter="createAndAdd"
          />
          <button class="btn btn-primary btn-sm" :disabled="!newName.trim()" @click="createAndAdd">
            创建并添加
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.song {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
  flex: 1;
}
.song .cover {
  width: 40px;
  height: 40px;
  border-radius: var(--r-sm);
}
.song-text {
  min-width: 0;
}
.sh-sub {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--ink-4);
}
.sh-acts {
  display: flex;
  gap: 2px;
  flex: none;
}
.hdrow {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.hdrow .iconbtn {
  margin-left: -10px;
}
.sh-list {
  display: flex;
  flex-direction: column;
}
.lab {
  flex: 1;
  min-width: 0;
  text-align: left;
}
.trail {
  margin-left: auto;
  color: var(--ink-4);
}
.trail-note {
  margin-left: auto;
  font-size: 11px;
  color: var(--tint);
}
.cnt {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--ink-4);
  font-variant-numeric: tabular-nums;
}
.hint {
  padding: 2px var(--pad) 14px;
  font-size: 12.5px;
  color: var(--ink-3);
}
.newrow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px var(--pad) 2px;
}
.field {
  flex: 1;
  min-width: 0;
  height: 42px;
  padding: 0 13px;
  border-radius: var(--r-md);
  border: 1px solid var(--line);
  background: var(--porcelain-2);
  color: var(--ink);
  font-size: 13.5px;
  outline: none;
}
.field::placeholder {
  color: var(--ink-4);
}
.field:focus {
  border-color: var(--tint);
  box-shadow: 0 0 0 3px var(--tint-soft);
}
.newrow .btn {
  flex: none;
}
</style>
