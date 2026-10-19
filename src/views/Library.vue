<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SongRow from '@/components/SongRow.vue'
import {
  createPlaylist,
  createPlaylistWithTracks,
  deletePlaylist,
  libraryState,
  type LocalPlaylist
} from '@/core/library'
import { getHistory, playTracks } from '@/core/playback/player'
import {
  allImporters,
  importPlaylist as importPluginPlaylist,
  pluginState,
  type PlaylistImporterHandle
} from '@/core/plugin/manager'

const router = useRouter()
const tab = ref<'favorites' | 'playlists' | 'recent'>('favorites')
const showCreate = ref(false)
const playlistName = ref('')
const showAbout = ref(false)
const showImport = ref(false)
const selectedImporterId = ref('')
const importValue = ref('')
const importing = ref(false)
const importError = ref('')

const favorites = computed(() => libraryState.favorites)
const playlists = computed(() => libraryState.playlists)
const history = computed(() => getHistory())
const runningPlugins = computed(() => pluginState.plugins.filter((plugin) => plugin.running).length)
const importers = computed(() => allImporters())
const selectedImporter = computed<PlaylistImporterHandle | undefined>(() => {
  return (
    importers.value.find((item) => `${item.pluginId}:${item.id}` === selectedImporterId.value) ??
    importers.value[0]
  )
})

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
  importError.value = ''
  importValue.value = ''
  if (!selectedImporterId.value && importers.value.length) {
    selectedImporterId.value = `${importers.value[0].pluginId}:${importers.value[0].id}`
  }
}

function chooseImporter(importer: PlaylistImporterHandle): void {
  selectedImporterId.value = `${importer.pluginId}:${importer.id}`
}

function useExample(example: { value: string }): void {
  importValue.value = example.value
}

async function startImport(): Promise<void> {
  const importer = selectedImporter.value
  if (!importer) {
    importError.value = '请先安装支持歌单导入的插件'
    return
  }
  const value = importValue.value.trim()
  if (!value) {
    importError.value = '请输入歌单链接或内容'
    return
  }
  importing.value = true
  importError.value = ''
  try {
    const result = await importPluginPlaylist(importer, value)
    if (!result.tracks.length) throw new Error('没有解析到歌曲，请检查链接或插件登录状态')
    const playlist = createPlaylistWithTracks(result.name || importer.title, result.tracks)
    showImport.value = false
    importValue.value = ''
    router.push('/playlist/' + playlist.id)
  } catch (error: any) {
    importError.value = error?.message ?? '导入失败'
  } finally {
    importing.value = false
  }
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
      <button class="icon-btn brand" aria-label="插件管理" @click="router.push('/plugins')">
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
          <p>CeruMusic 手机版 · 2.3.1-mobile.2</p>
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

    <div v-if="showImport" class="sheet-mask" @click.self="showImport = false">
      <div class="sheet">
        <h2>导入歌单</h2>
        <template v-if="importers.length">
          <p class="sub">解析和登录态由插件提供，支持平台取决于你安装的音源插件。</p>
          <div class="chips" style="margin-bottom: 12px">
            <button
              v-for="item in importers"
              :key="item.pluginId + ':' + item.id"
              class="chip"
              :class="{
                active:
                  selectedImporter?.pluginId === item.pluginId &&
                  selectedImporter?.id === item.id
              }"
              @click="chooseImporter(item)"
            >
              {{ item.title }}
            </button>
          </div>
          <p v-if="selectedImporter?.description" class="sub">{{ selectedImporter.description }}</p>
          <ol v-if="selectedImporter?.instructions.length" class="instructions">
            <li v-for="line in selectedImporter.instructions" :key="line">{{ line }}</li>
          </ol>
          <div class="field">
            <label>{{ selectedImporter?.title }} 链接 / 内容</label>
            <textarea
              v-model="importValue"
              class="input import-input"
              rows="3"
              :placeholder="selectedImporter?.placeholder || '粘贴歌单分享链接'"
            />
          </div>
          <div v-if="selectedImporter?.examples.length" class="examples">
            <button
              v-for="example in selectedImporter.examples"
              :key="example.value"
              class="example"
              @click="useExample(example)"
            >
              {{ example.label || example.value }}
            </button>
          </div>
          <p v-if="importError" class="import-error">{{ importError }}</p>
          <div class="sheet-actions">
            <button class="btn secondary" @click="showImport = false">取消</button>
            <button class="btn" :disabled="importing || !importValue.trim()" @click="startImport">
              <span v-if="importing" class="loading-dots"><i /><i /><i /></span>
              <span v-else>开始导入</span>
            </button>
          </div>
        </template>
        <template v-else>
          <p class="sub">
            当前没有插件提供歌单导入能力。安装支持歌单导入的澜音 v2 插件后，就可以在这里粘贴其他平台的歌单链接。
          </p>
          <div class="sheet-actions">
            <button class="btn secondary" @click="showImport = false">关闭</button>
            <button class="btn" @click="showImport = false; router.push('/plugins')">去安装插件</button>
          </div>
        </template>
      </div>
    </div>
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
.import-input {
  min-height: 86px;
  resize: vertical;
  line-height: 1.5;
  user-select: text;
}
.instructions {
  margin: 0 0 14px 18px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
.instructions li {
  list-style: decimal;
}
.examples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
}
.example {
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--brand);
  background: var(--brand-soft);
}
.import-error {
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--danger);
  background: rgba(229, 72, 77, 0.1);
  margin-bottom: 10px;
}
</style>
