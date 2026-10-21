<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SongRow from '@/components/SongRow.vue'
import { deletePlaylist, getPlaylist } from '@/core/library'
import { playTracks } from '@/core/playback/player'
import { downloadTracks } from '@/core/downloads'
import { notify } from '@/core/plugin/manager'

const route = useRoute()
const router = useRouter()
const playlist = computed(() => getPlaylist(String(route.params.id)))

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
</script>

<template>
  <div class="page">
    <header class="page-header">
      <button class="icon-btn" aria-label="返回" @click="router.back()">
        <Icon name="back" :size="20" />
      </button>
      <button class="icon-btn" aria-label="删除歌单" @click="remove">
        <Icon name="trash" :size="19" />
      </button>
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
          </div>
        </div>
      </section>

      <div v-if="playlist.tracks.length" class="song-list" style="margin-top: 18px">
        <SongRow
          v-for="(track, index) in playlist.tracks"
          :key="track.providerId + track.id"
          :track="track"
          :index="index"
          :queue="playlist.tracks"
          show-index
          @play="play(index)"
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
  </div>
</template>

<style scoped>
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
</style>
