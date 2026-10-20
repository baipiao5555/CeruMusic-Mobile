<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SongRow from '@/components/SongRow.vue'
import ImportPlaylistSheet from '@/components/ImportPlaylistSheet.vue'
import {
  createPlaylist,
  deletePlaylist,
  libraryState,
  type LocalPlaylist
} from '@/core/library'
import { getHistory, playTracks } from '@/core/playback/player'
import { allImporters, pluginState } from '@/core/plugin/manager'

const router = useRouter()
const tab = ref<'favorites' | 'playlists' | 'recent'>('favorites')
const showCreate = ref(false)
const playlistName = ref('')
const showAbout = ref(false)
const showImport = ref(false)
const showQuick = ref(false)

const favorites = computed(() => libraryState.favorites)
const playlists = computed(() => libraryState.playlists)
const history = computed(() => getHistory())
const runningPlugins = computed(() => pluginState.plugins.filter((plugin) => plugin.running).length)
const importers = computed(() => allImporters())

function coverOf(playlist: LocalPlaylist): string | undefined {
  return playlist.tracks[0]?.artwork
}

function playFavorites(index: number): void {
  void playTracks(favorites.value, index)
}

function playHistory(index: number): void {
  void playTracks(history.value, index)
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

function openImport(): void {
  showImport.value = true
  showQuick.value = false
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <div class="brand-name" style="font-size: 23px">我的</div>
        <div class="brand-sub">Library</div>
      </div>
      <button class="icon-btn" aria-label="设置" @click="router.push('/settings')">
        <Icon name="settings" :size="21" />
      </button>
    </header>

    <section class="profile-card card">
      <div class="avatar"><img src="/logo.png" alt="" /></div>
      <div class="profile-info">
        <h2>本地音乐库</h2>
        <p>{{ favorites.length }} 首收藏 · {{ playlists.length }} 个歌单 · {{ runningPlugins }} 个音源</p>
      </div>
      <button class="icon-btn brand" aria-label="新建或导入歌单" @click="showQuick = true">
        <Icon name="plus" :size="20" />
      </button>
    </section>

    <div class="segmented">
      <button :class="{ active: tab === 'favorites' }" @click="tab = 'favorites'">喜欢</button>
      <button :class="{ active: tab === 'playlists' }" @click="tab = 'playlists'">歌单</button>
      <button :class="{ active: tab === 'recent' }" @click="tab = 'recent'">最近</button>
    </div>

    <template v-if="tab === 'favorites'">
      <div v-if="favorites.length" class="song-list">
        <SongRow
          v-for="(track, index) in favorites"
          :key="track.providerId + track.id"
          :track="track"
          :index="index"
          :queue="favorites"
          @play="playFavorites(index)"
        />
      </div>
      <div v-else class="empty">
        <div class="emoji">💚</div>
        <h3>还没有喜欢的歌曲</h3>
        <p>在歌曲右侧点一下爱心，就会出现在这里。</p>
        <button class="btn secondary" @click="router.push('/search')">去搜索音乐</button>
      </div>
    </template>

    <template v-else-if="tab === 'playlists'">
      <div class="section-title" style="margin-top: 14px">
        <h2>我的歌单</h2>
        <div class="title-actions">
          <button class="create-btn" @click="openImport"><Icon name="folder" :size="16" /> 导入</button>
          <button class="create-btn" @click="showCreate = true"><Icon name="plus" :size="16" /> 新建</button>
        </div>
      </div>
      <div v-if="playlists.length" class="playlist-list">
        <div v-for="playlist in playlists" :key="playlist.id" class="playlist-row card" @click="openPlaylist(playlist)">
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
        <p>创建一个歌单，把喜欢的歌曲整理到一起。</p>
        <button class="btn" @click="showCreate = true"><Icon name="plus" :size="17" /> 新建歌单</button>
      </div>
    </template>

    <template v-else>
      <div v-if="history.length" class="song-list">
        <SongRow
          v-for="(track, index) in history"
          :key="track.providerId + track.id"
          :track="track"
          :index="index"
          :queue="history"
          @play="playHistory(index)"
        />
      </div>
      <div v-else class="empty">
        <div class="emoji">🕘</div>
        <h3>还没有播放记录</h3>
        <p>播放过的歌曲会出现在这里。</p>
      </div>
    </template>

    <div class="section-title">
      <h2>更多</h2>
    </div>
    <div class="list-group">
      <button class="list-item" @click="openImport">
        <span class="entry-icon"><Icon name="folder" :size="19" /></span>
        <div class="info">
          <h3>导入歌单</h3>
          <p>{{ importers.length ? `支持 ${importers.length} 个插件导入源` : '从其他音乐平台导入歌单' }}</p>
        </div>
        <Icon name="chevron" :size="18" class="chev" />
      </button>
      <button class="list-item" @click="router.push('/plugins')">
        <span class="entry-icon"><Icon name="link" :size="19" /></span>
        <div class="info">
          <h3>音源插件</h3>
          <p>{{ pluginState.plugins.length }} 个已安装</p>
        </div>
        <Icon name="chevron" :size="18" class="chev" />
      </button>
      <button class="list-item" @click="router.push('/settings')">
        <span class="entry-icon"><Icon name="settings" :size="19" /></span>
        <div class="info">
          <h3>设置</h3>
          <p>外观、音质与播放选项</p>
        </div>
        <Icon name="chevron" :size="18" class="chev" />
      </button>
      <button class="list-item" @click="showAbout = true">
        <span class="entry-icon"><Icon name="info" :size="19" /></span>
        <div class="info">
          <h3>关于澜音</h3>
          <p>CeruMusic 手机版 · 2.3.1-mobile.4</p>
        </div>
        <Icon name="chevron" :size="18" class="chev" />
      </button>
    </div>

    <div v-if="showCreate" class="sheet-mask" @click.self="showCreate = false">
      <div class="sheet">
        <h2>新建歌单</h2>
        <p class="sub">给歌单起一个名字。</p>
        <div class="field">
          <input v-model="playlistName" class="input" placeholder="例如：夜晚循环" maxlength="40" @keyup.enter="submitCreate" />
        </div>
        <div class="sheet-actions">
          <button class="btn secondary" @click="showCreate = false">取消</button>
          <button class="btn" :disabled="!playlistName.trim()" @click="submitCreate">创建</button>
        </div>
      </div>
    </div>

    <div v-if="showAbout" class="sheet-mask" @click.self="showAbout = false">
      <div class="sheet">
        <img src="/logo.png" alt="" style="width: 62px; border-radius: 18px; margin-bottom: 14px" />
        <h2>澜音 · CeruMusic 手机版</h2>
        <p class="sub">
          基于 CeruMusic v2.3.1 移植的 Android 移动端。沿用澜音 v2 插件协议，
          由插件提供音乐信息与播放地址，应用本身不存储任何音乐文件。
        </p>
        <p class="sub">版本 2.3.1-mobile.2 · 插件协议 2.0</p>
        <div class="sheet-actions">
          <button class="btn" @click="showAbout = false">知道了</button>
        </div>
      </div>
    </div>

    <div v-if="showQuick" class="sheet-mask" @click.self="showQuick = false">
      <div class="sheet">
        <h2>添加歌单</h2>
        <p class="sub">从其他音乐平台导入歌单，或者创建一个新的本地歌单。</p>
        <div class="sheet-actions">
          <button class="btn secondary" @click="showQuick = false; showCreate = true">
            <Icon name="plus" :size="17" /> 新建歌单
          </button>
          <button class="btn" @click="showQuick = false; showImport = true">
            <Icon name="folder" :size="17" /> 导入歌单
          </button>
        </div>
      </div>
    </div>

    <ImportPlaylistSheet v-if="showImport" @close="showImport = false" />
  </div>
</template>

<style scoped>
.profile-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
}
.avatar {
  width: 56px;
  height: 56px;
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 10px 22px rgba(0, 181, 120, 0.22);
}
.avatar img {
  width: 100%;
  height: 100%;
}
.profile-info {
  flex: 1;
  min-width: 0;
}
.profile-info h2 {
  font-size: 17px;
}
.profile-info p {
  margin-top: 5px;
  font-size: 11.5px;
  color: var(--muted);
}
.segmented {
  display: flex;
  gap: 4px;
  padding: 4px;
  margin: 18px 0 8px;
  border-radius: 15px;
  background: var(--surface);
  border: 1px solid var(--line);
}
.segmented button {
  flex: 1;
  padding: 9px 0;
  border-radius: 11px;
  font-size: 13px;
  color: var(--muted);
  transition: all 0.18s ease;
}
.segmented button.active {
  color: var(--text);
  font-weight: 650;
  background: var(--surface-solid);
  box-shadow: var(--shadow-soft);
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
.entry-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  color: var(--brand);
  background: var(--brand-soft);
  flex: 0 0 auto;
}
</style>
