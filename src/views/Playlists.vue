<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import ImportPlaylistSheet from '@/components/ImportPlaylistSheet.vue'
import {
  createPlaylist,
  deletePlaylist,
  libraryState,
  type LocalPlaylist
} from '@/core/library'

const router = useRouter()
const showCreate = ref(false)
const showImport = ref(false)
const playlistName = ref('')

const playlists = computed(() => libraryState.playlists)
const totalTracks = computed(() =>
  libraryState.playlists.reduce((total, playlist) => total + playlist.tracks.length, 0)
)

function coverOf(playlist: LocalPlaylist): string | undefined {
  return playlist.tracks[0]?.artwork
}

function openPlaylist(playlist: LocalPlaylist): void {
  router.push('/playlist/' + playlist.id)
}

function submitCreate(): void {
  const name = playlistName.value.trim()
  if (!name) return
  const playlist = createPlaylist(name)
  playlistName.value = ''
  showCreate.value = false
  router.push('/playlist/' + playlist.id)
}

function removePlaylist(playlist: LocalPlaylist): void {
  if (window.confirm(`删除歌单「${playlist.name}」？`)) deletePlaylist(playlist.id)
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <div class="brand-name" style="font-size: 23px">歌单</div>
        <div class="brand-sub">Playlists</div>
      </div>
      <button class="icon-btn" aria-label="设置" @click="router.push('/settings')">
        <Icon name="settings" :size="21" />
      </button>
    </header>

    <section class="summary card">
      <div class="summary-icon"><Icon name="library" :size="26" /></div>
      <div class="summary-info">
        <h2>我的歌单</h2>
        <p>{{ playlists.length }} 个歌单 · {{ totalTracks }} 首歌曲</p>
      </div>
      <button class="round-action" aria-label="云端歌单" @click="router.push('/cloud')">
        <Icon name="cloud" :size="20" />
      </button>
      <button class="round-action" aria-label="导入歌单" @click="showImport = true">
        <Icon name="folder" :size="20" />
      </button>
      <button class="round-action primary" aria-label="新建歌单" @click="showCreate = true">
        <Icon name="plus" :size="20" />
      </button>
    </section>

    <div class="section-title">
      <h2>全部歌单</h2>
      <div class="title-actions">
        <button class="create-btn" @click="router.push('/cloud')"><Icon name="cloud" :size="16" /> 云端</button>
        <button class="create-btn" @click="showImport = true"><Icon name="folder" :size="16" /> 导入</button>
        <button class="create-btn" @click="showCreate = true"><Icon name="plus" :size="16" /> 新建</button>
      </div>
    </div>

    <div v-if="playlists.length" class="playlist-list">
      <div
        v-for="playlist in playlists"
        :key="playlist.id"
        class="playlist-row card"
        @click="openPlaylist(playlist)"
      >
        <div class="playlist-cover">
          <img v-if="coverOf(playlist)" :src="coverOf(playlist)" alt="" />
          <Icon v-else name="music" :size="22" />
        </div>
        <div class="playlist-info">
          <h3>{{ playlist.name }}</h3>
          <p>{{ playlist.tracks.length }} 首歌曲</p>
        </div>
        <button class="icon-action" aria-label="删除歌单" @click.stop="removePlaylist(playlist)">
          <Icon name="trash" :size="18" />
        </button>
        <Icon name="chevron" :size="18" class="chev" />
      </div>
    </div>

    <div v-else class="empty">
      <div class="emoji">📁</div>
      <h3>还没有歌单</h3>
      <p>从其他音乐平台导入歌单，或者创建一个空歌单开始整理。</p>
      <div class="empty-actions">
        <button class="btn" @click="showImport = true">
          <Icon name="folder" :size="17" /> 导入歌单
        </button>
        <button class="btn secondary" @click="showCreate = true">
          <Icon name="plus" :size="17" /> 新建歌单
        </button>
      </div>
    </div>

    <div v-if="showCreate" class="sheet-mask" @click.self="showCreate = false">
      <div class="sheet">
        <h2>新建歌单</h2>
        <p class="sub">给歌单起一个名字。</p>
        <div class="field">
          <input
            v-model="playlistName"
            class="input"
            placeholder="例如：夜晚循环"
            maxlength="40"
            @keyup.enter="submitCreate"
          />
        </div>
        <div class="sheet-actions">
          <button class="btn secondary" @click="showCreate = false">取消</button>
          <button class="btn" :disabled="!playlistName.trim()" @click="submitCreate">创建</button>
        </div>
      </div>
    </div>

    <ImportPlaylistSheet v-if="showImport" @close="showImport = false" />
  </div>
</template>

<style scoped>
.summary {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
}
.summary-icon {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  border-radius: 17px;
  color: var(--brand);
  background: var(--brand-soft);
  flex: 0 0 auto;
}
.summary-info {
  flex: 1;
  min-width: 0;
}
.summary-info h2 {
  font-size: 17px;
}
.summary-info p {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--muted);
}
.round-action {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  color: var(--brand);
  background: var(--brand-soft);
  flex: 0 0 auto;
  transition: transform 0.15s ease;
}
.round-action:active {
  transform: scale(0.92);
}
.round-action.primary {
  color: #fff;
  background: linear-gradient(135deg, var(--brand), #43d5a6);
  box-shadow: 0 8px 18px rgba(0, 181, 120, 0.26);
}
.create-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 7px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: var(--brand);
  background: var(--brand-soft);
}
.title-actions {
  display: flex;
  gap: 6px;
}
.playlist-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.playlist-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
}
.playlist-cover {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 14px;
  overflow: hidden;
  color: var(--brand);
  background: var(--brand-soft);
  flex: 0 0 auto;
}
.playlist-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.playlist-info {
  flex: 1;
  min-width: 0;
}
.playlist-info h3 {
  font-size: 14.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.playlist-info p {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--muted);
}
.chev {
  color: var(--muted-2);
}
.empty-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 9px;
}
</style>
