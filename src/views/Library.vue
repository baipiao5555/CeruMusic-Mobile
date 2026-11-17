<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
import { logState } from '@/core/logs'
import { downloadState } from '@/core/downloads'
import { authState, displayName } from '@/core/auth'
import { confirmAction } from '@/core/confirm'

const router = useRouter()
const route = useRoute()
const appVersion = __APP_VERSION__
const tab = ref<'songs' | 'albums' | 'artists' | 'playlists'>('playlists')
const songTab = ref<'favorites' | 'recent'>('favorites')
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
const logErrors = computed(() => logState.entries.filter((entry) => entry.level === 'error').length)

type LibTrack = LocalPlaylist['tracks'][number]
interface TrackGroup {
  key: string
  name: string
  sub: string
  cover: string
  tracks: LibTrack[]
}

const profileName = computed(() => (authState.authenticated ? displayName() : '本地音乐库'))
const profileAvatar = computed(() => authState.user?.picture || '/logo.png')
const cloudCount = computed(() => playlists.value.filter((playlist) => playlist.cloudId).length)
const profileSub = computed(() =>
  authState.authenticated
    ? `已登录澜音 · ${cloudCount.value} 个云端导入歌单`
    : '本地账户 · 未登录澜音'
)

const allTracks = computed(() => {
  const map = new Map<string, LibTrack>()
  for (const track of favorites.value) map.set(track.providerId + ':' + track.id, track)
  for (const playlist of playlists.value) {
    for (const track of playlist.tracks) map.set(track.providerId + ':' + track.id, track)
  }
  return [...map.values()]
})

const albumGroups = computed<TrackGroup[]>(() => {
  const map = new Map<string, TrackGroup>()
  for (const track of allTracks.value) {
    const album = track.album || '未知专辑'
    const key = album + '·' + track.artist
    const group = map.get(key)
    if (group) group.tracks.push(track)
    else map.set(key, { key, name: album, sub: track.artist, cover: track.artwork, tracks: [track] })
  }
  return [...map.values()].sort((a, b) => b.tracks.length - a.tracks.length)
})

const artistGroups = computed<TrackGroup[]>(() => {
  const map = new Map<string, TrackGroup>()
  for (const track of allTracks.value) {
    const key = track.artist || '未知歌手'
    const group = map.get(key)
    if (group) group.tracks.push(track)
    else map.set(key, { key, name: key, sub: '歌手', cover: track.artwork, tracks: [track] })
  }
  return [...map.values()].sort((a, b) => b.tracks.length - a.tracks.length)
})

const downloaded = computed(() => downloadState.tasks.filter((task) => task.status === 'completed'))
const usedBytes = computed(() => downloaded.value.reduce((total, task) => total + (task.size || 0), 0))

function formatBytes(bytes: number): string {
  if (!bytes) return '0 MB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function coverOf(playlist: LocalPlaylist): string | undefined {
  return playlist.cover || playlist.tracks[0]?.artwork
}

function playFavorites(index: number): void {
  void playTracks(favorites.value, index)
}

function playHistory(index: number): void {
  void playTracks(history.value, index)
}

function playGroup(group: TrackGroup): void {
  void playTracks(group.tracks, 0)
}

function openSongs(kind: 'favorites' | 'recent'): void {
  tab.value = 'songs'
  songTab.value = kind
}

watch(
  () => route.query.section ?? route.query.view,
  (section) => {
    if (section === 'favorites' || section === 'recent') openSongs(section)
    else if (section === 'albums' || section === 'artists' || section === 'playlists') tab.value = section
  },
  { immediate: true }
)

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

async function removePlaylist(playlist: LocalPlaylist): Promise<void> {
  const ok = await confirmAction({
    title: `删除歌单「${playlist.name}」？`,
    body: '歌单会被删除，其中的歌曲仍保留在资料库与本地文件里。',
    confirmText: '删除',
    danger: true
  })
  if (ok) deletePlaylist(playlist.id)
}

function openImport(): void {
  showImport.value = true
  showQuick.value = false
}
</script>

<template>
  <div class="screen library-screen">
    <div class="scroll safe-t-lg">
      <header class="page-head library-head">
        <h1>我的</h1>
        <button class="iconbtn quiet" aria-label="设置" @click="router.push('/settings')">
          <Icon name="settings" :size="22" />
        </button>
      </header>

      <section class="profile">
        <button class="profile-main" aria-label="账户与云端歌单" @click="router.push('/cloud')">
          <img class="avatar" :src="profileAvatar" alt="" @error="($event.target as HTMLImageElement).src = '/logo.png'" />
          <span class="profile-copy">
            <strong>{{ profileName }}</strong>
            <small>{{ profileSub }}</small>
          </span>
          <Icon name="chevron-right" :size="17" />
        </button>
      </section>

      <nav class="library-shortcuts" aria-label="我的音乐快捷入口">
        <button @click="openSongs('favorites')">
          <Icon name="heart" :size="25" /><span>喜欢</span><small>{{ favorites.length }} 首</small>
        </button>
        <button @click="openSongs('recent')">
          <Icon name="history" :size="25" /><span>最近</span><small>{{ history.length }} 首</small>
        </button>
        <button @click="router.push('/local')">
          <Icon name="folder" :size="25" /><span>本地</span><small>扫描歌曲</small>
        </button>
        <button @click="router.push('/downloads')">
          <Icon name="download" :size="25" /><span>下载</span><small>{{ downloaded.length }} 首已完成</small>
        </button>
      </nav>

      <section v-if="history.length && tab === 'playlists'" class="recent-section">
        <div class="section-head">
          <h2>最近播放</h2>
          <button class="text-action" @click="openSongs('recent')">全部 <Icon name="chevron-right" :size="14" /></button>
        </div>
        <div class="recent-strip">
          <button v-for="(track, index) in history.slice(0, 6)" :key="track.providerId + ':' + track.id" class="recent-card" @click="playHistory(index)">
            <span class="recent-art"><img :src="track.artwork || '/default-cover.png'" alt="" @error="($event.target as HTMLImageElement).src = '/default-cover.png'" /><span><Icon name="play" :size="13" /></span></span>
            <strong>{{ track.title }}</strong>
            <small>{{ track.artist || '未知歌手' }}</small>
          </button>
        </div>
      </section>

      <section class="music-section">
        <div class="section-head">
          <h2>我的音乐</h2>
          <button class="text-action" aria-label="新建或导入歌单" @click="showQuick = true"><Icon name="plus" :size="16" /> 添加</button>
        </div>
        <nav class="library-tabs" aria-label="资料库分类">
          <button :class="{ on: tab === 'playlists' }" :aria-pressed="tab === 'playlists'" @click="tab = 'playlists'">歌单 <small>{{ playlists.length }}</small></button>
          <button :class="{ on: tab === 'songs' }" :aria-pressed="tab === 'songs'" @click="tab = 'songs'">歌曲 <small>{{ allTracks.length }}</small></button>
          <button :class="{ on: tab === 'albums' }" :aria-pressed="tab === 'albums'" @click="tab = 'albums'">专辑 <small>{{ albumGroups.length }}</small></button>
          <button :class="{ on: tab === 'artists' }" :aria-pressed="tab === 'artists'" @click="tab = 'artists'">歌手 <small>{{ artistGroups.length }}</small></button>
        </nav>

        <template v-if="tab === 'songs'">
          <div class="song-filters">
            <button :class="{ on: songTab === 'favorites' }" :aria-pressed="songTab === 'favorites'" @click="songTab = 'favorites'">喜欢的歌曲 {{ favorites.length }}</button>
            <button :class="{ on: songTab === 'recent' }" :aria-pressed="songTab === 'recent'" @click="songTab = 'recent'">最近播放 {{ history.length }}</button>
          </div>
          <div v-if="songTab === 'favorites' && favorites.length" class="song-list">
            <SongRow v-for="(track, index) in favorites" :key="track.providerId + ':' + track.id" :track="track" :index="index" :queue="favorites" @play="playFavorites(index)" />
          </div>
          <div v-else-if="songTab === 'favorites'" class="empty">
            <div class="glyph"><Icon name="heart" :size="32" /></div>
            <h3>还没有喜欢的歌曲</h3><p>在歌曲的更多菜单中收藏，就会出现在这里。</p>
            <button class="btn btn-ghost btn-sm" @click="router.push('/search')">去搜索音乐</button>
          </div>
          <div v-else-if="history.length" class="song-list">
            <SongRow v-for="(track, index) in history" :key="track.providerId + ':' + track.id" :track="track" :index="index" :queue="history" @play="playHistory(index)" />
          </div>
          <div v-else class="empty"><div class="glyph"><Icon name="history" :size="32" /></div><h3>还没有播放记录</h3><p>播放过的歌曲会出现在这里。</p></div>
        </template>

        <template v-else-if="tab === 'albums' || tab === 'artists'">
          <div v-if="(tab === 'albums' ? albumGroups : artistGroups).length" class="asset-list">
            <button v-for="group in (tab === 'albums' ? albumGroups : artistGroups)" :key="group.key" class="asset-row" @click="playGroup(group)">
              <img class="asset-cover" :class="{ round: tab === 'artists' }" :src="group.cover || '/default-cover.png'" alt="" @error="($event.target as HTMLImageElement).src = '/default-cover.png'" />
              <span class="asset-copy"><strong>{{ group.name }}</strong><small>{{ tab === 'albums' ? group.sub + ' · ' : '' }}{{ group.tracks.length }} 首</small></span>
              <Icon name="play" :size="19" />
            </button>
          </div>
          <div v-else class="empty"><div class="glyph"><Icon :name="tab === 'albums' ? 'music' : 'user'" :size="32" /></div><h3>还没有{{ tab === 'albums' ? '专辑' : '歌手' }}信息</h3><p>收藏或导入歌曲后，会按已有歌曲信息归类。</p></div>
        </template>

        <template v-else>
          <button class="favorite-row" @click="openSongs('favorites')">
            <span class="favorite-cover"><Icon name="heart" :size="25" /></span>
            <span class="asset-copy"><strong>我喜欢的音乐</strong><small>{{ favorites.length }} 首 · 本地收藏</small></span>
            <Icon name="chevron-right" :size="16" />
          </button>
          <div v-if="playlists.length" class="asset-list">
            <div v-for="playlist in playlists" :key="playlist.id" class="asset-row playlist-row">
              <button class="asset-open" @click="openPlaylist(playlist)">
                <img class="asset-cover" :src="coverOf(playlist) || '/default-cover.png'" alt="" @error="($event.target as HTMLImageElement).src = '/default-cover.png'" />
                <span class="asset-copy"><strong>{{ playlist.name }}</strong><small>{{ playlist.tracks.length }} 首 · {{ playlist.cloudId ? '云端导入副本' : '本地歌单' }}</small></span>
              </button>
              <button class="iconbtn quiet" :aria-label="'删除歌单' + playlist.name" @click="removePlaylist(playlist)"><Icon name="trash" :size="18" /></button>
            </div>
          </div>
          <div v-else class="playlist-empty"><p>创建或导入歌单，把喜欢的音乐放在一起。</p></div>
          <div class="playlist-actions">
            <button @click="showCreate = true"><Icon name="plus" :size="17" /> 新建歌单</button>
            <button @click="openImport"><Icon name="folder" :size="17" /> 导入歌单</button>
            <button @click="router.push('/playlists')">全部歌单 <Icon name="chevron-right" :size="14" /></button>
          </div>
        </template>
      </section>

      <section class="tools-section">
        <div class="section-head"><h2>音乐工具</h2></div>
        <div class="tool-list">
          <button @click="router.push('/accounts')"><Icon name="user" :size="21" /><span><strong>账号与服务</strong><small>澜音与音乐平台 · 按音源能力开放</small></span><Icon name="chevron-right" :size="16" /></button>
          <button @click="router.push('/sync-services')"><Icon name="cloud" :size="21" /><span><strong>同步与备份</strong><small>WebDAV · 专用目录 · 安全凭据</small></span><Icon name="chevron-right" :size="16" /></button>
          <button @click="router.push('/cloud')"><Icon name="cloud" :size="21" /><span><strong>云端歌单</strong><small>{{ cloudCount }} 个本地副本 · 从澜音账号导入</small></span><Icon name="chevron-right" :size="16" /></button>
          <button @click="router.push('/plugins')"><Icon name="plugin" :size="21" /><span><strong>音源插件</strong><small>{{ pluginState.plugins.length }} 个已安装 · {{ runningPlugins }} 个运行中</small></span><Icon name="chevron-right" :size="16" /></button>
          <button @click="openImport"><Icon name="folder" :size="21" /><span><strong>导入歌单</strong><small>{{ importers.length ? `支持 ${importers.length} 个插件导入源` : '由已安装的音源插件提供导入能力' }}</small></span><Icon name="chevron-right" :size="16" /></button>
          <button @click="router.push('/downloads')"><Icon name="download" :size="21" /><span><strong>下载管理</strong><small>已完成 {{ downloaded.length }} 首 · {{ formatBytes(usedBytes) }}</small></span><Icon name="chevron-right" :size="16" /></button>
          <button @click="router.push('/settings')"><Icon name="settings" :size="21" /><span><strong>设置</strong><small>外观、歌词、播放与存储</small></span><Icon name="chevron-right" :size="16" /></button>
          <button @click="router.push('/logs')"><Icon name="scroll-text" :size="21" /><span><strong>运行日志</strong><small>{{ logErrors ? `当前记录中有 ${logErrors} 条错误，可查看诊断` : '查看应用运行与诊断记录' }}</small></span><Icon name="chevron-right" :size="16" /></button>
          <button @click="showAbout = true"><Icon name="info" :size="21" /><span><strong>关于澜音</strong><small>CeruMusic 手机版 · {{ appVersion }}</small></span><Icon name="chevron-right" :size="16" /></button>
        </div>
      </section>
    </div>

    <div v-if="showCreate" class="sheet-mask" @click.self="showCreate = false">
      <div class="sheet">
        <div class="grab" />
        <div class="sh-head">
          <div class="sh-title">新建歌单</div>
          <button class="iconbtn quiet" aria-label="关闭" @click="showCreate = false">
            <Icon name="close" :size="18" />
          </button>
        </div>
        <div class="sh-form">
          <p class="sh-sub">给歌单起一个名字。</p>
          <input
            v-model="playlistName"
            class="sh-input"
            placeholder="例如：夜晚循环"
            maxlength="40"
            @keyup.enter="submitCreate"
          />
          <div class="sh-actions">
            <button class="btn btn-ghost f1" @click="showCreate = false">取消</button>
            <button class="btn btn-primary f1" :disabled="!playlistName.trim()" @click="submitCreate">创建</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showAbout" class="sheet-mask" @click.self="showAbout = false">
      <div class="sheet">
        <div class="grab" />
        <div class="sh-head">
          <div class="sh-title">关于澜音</div>
          <button class="iconbtn quiet" aria-label="关闭" @click="showAbout = false">
            <Icon name="close" :size="18" />
          </button>
        </div>
        <div class="sh-form">
          <img class="about-logo" src="/logo.png" alt="" />
          <div class="about-name">澜音 · CeruMusic 手机版</div>
          <p class="sh-sub">
            基于 CeruMusic v2.3.1 移植的 Android 移动端。沿用澜音 v2 插件协议，
            由插件提供音乐信息与播放地址，可按你的操作缓存或下载音乐。
          </p>
          <p class="sh-sub">版本 {{ appVersion }} · 插件协议 2.0</p>
          <div class="sh-actions">
            <button class="btn btn-primary btn-block" @click="showAbout = false">知道了</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showQuick" class="sheet-mask" @click.self="showQuick = false">
      <div class="sheet">
        <div class="grab" />
        <div class="sh-head">
          <div class="sh-title">添加歌单</div>
          <button class="iconbtn quiet" aria-label="关闭" @click="showQuick = false">
            <Icon name="close" :size="18" />
          </button>
        </div>
        <div class="sh-form">
          <p class="sh-sub">从其他音乐平台导入歌单，或者创建一个新的本地歌单。</p>
          <div class="sh-actions">
            <button class="btn btn-ghost f1" @click="showQuick = false; showCreate = true">
              <Icon name="plus" :size="16" /> 新建歌单
            </button>
            <button class="btn btn-primary f1" @click="showQuick = false; showImport = true">
              <Icon name="folder" :size="16" /> 导入歌单
            </button>
          </div>
        </div>
      </div>
    </div>

    <ImportPlaylistSheet v-if="showImport" @close="showImport = false" />
  </div>
</template>

<style scoped>
.library-head { align-items: center; min-height: 48px; }
.library-head h1 { font-family: inherit; font-size: 27px; font-weight: 750; }
.profile { padding: 23px var(--pad) 16px; }
.profile-main { display: flex; align-items: center; gap: 13px; width: 100%; min-height: 68px; text-align: left; }
.avatar { width: 56px; height: 56px; flex: none; object-fit: cover; border-radius: 50%; background: var(--tint-softer); }
.profile-copy { flex: 1; min-width: 0; }
.profile-copy strong { display: block; font-size: 20px; font-weight: 700; overflow-wrap: anywhere; }
.profile-copy small { display: block; margin-top: 6px; font-size: 12px; color: var(--ink-3); }
.profile-main > .i { color: var(--ink-3); }
.library-shortcuts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0 var(--pad); padding: 10px 0 22px; border-bottom: 1px solid var(--line); }
.library-shortcuts button { display: flex; flex-direction: column; align-items: center; gap: 8px; min-height: 84px; padding: 6px 0; }
.library-shortcuts .i { color: var(--tint); }
.library-shortcuts span { font-size: 13px; }
.library-shortcuts small { font-size: 11px; color: var(--ink-3); }
.section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0; padding: 14px var(--pad) 5px; min-height: 58px; }
.section-head h2 { font-family: inherit; font-size: 20px; font-weight: 700; }
.text-action { min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; gap: 3px; color: var(--ink-3); font-size: 12px; }
.recent-section { padding-top: 5px; }
.recent-strip { display: flex; gap: 12px; overflow-x: auto; padding: 0 var(--pad) 8px; scrollbar-width: none; }
.recent-card { flex: 0 0 108px; width: 108px; text-align: left; }
.recent-art { display: block; position: relative; }
.recent-art img { width: 108px; height: 108px; object-fit: cover; border-radius: 9px; }
.recent-art > span { position: absolute; right: 6px; bottom: 6px; width: 25px; height: 25px; border-radius: 50%; background: #ffffffe6; color: #234534; display: grid; place-items: center; }
.recent-card strong, .recent-card small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recent-card strong { margin-top: 8px; font-size: 13px; font-weight: 500; }
.recent-card small { margin-top: 5px; font-size: 11px; color: var(--ink-3); }
.music-section { padding-top: 4px; }
.library-tabs { display: flex; gap: 18px; padding: 0 var(--pad) 10px; overflow-x: auto; }
.library-tabs button { flex: none; min-width: 44px; min-height: 44px; border-bottom: 2px solid transparent; color: var(--ink-3); font-size: 14px; }
.library-tabs button.on { color: var(--ink); font-weight: 650; border-bottom-color: var(--tint); }
.library-tabs small { font-size: 11px; font-weight: 400; }
.song-filters { display: flex; gap: 8px; padding: 0 var(--pad) 10px; }
.song-filters button { min-height: 44px; padding: 0 12px; color: var(--ink-3); font-size: 12px; border-radius: 8px; }
.song-filters button.on { color: var(--tint-deep, var(--ink)); background: var(--tint-softer); }
.song-list { padding: 0 8px; }
.asset-list { padding: 0 var(--pad); }
.asset-row, .favorite-row { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 78px; text-align: left; }
.asset-open { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; min-height: 78px; text-align: left; }
.asset-cover, .favorite-cover { flex: none; width: 55px; height: 55px; border-radius: 8px; object-fit: cover; background: var(--tint-softer); }
.asset-cover.round { border-radius: 50%; }
.asset-copy { display: block; flex: 1; min-width: 0; }
.asset-copy strong, .asset-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.asset-copy strong { font-size: 14px; font-weight: 500; }
.asset-copy small { margin-top: 5px; font-size: 12px; color: var(--ink-3); }
.asset-row > .icon, .favorite-row > .i { color: var(--ink-3); }
.favorite-row { padding: 5px var(--pad); }
.favorite-cover { display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, #f5a3bb, #e85b85); }
.playlist-row .iconbtn { width: 44px; height: 44px; color: var(--ink-3); flex: none; }
.playlist-actions { display: flex; flex-wrap: wrap; gap: 5px 15px; padding: 8px var(--pad) 0; }
.playlist-actions button { display: inline-flex; align-items: center; gap: 5px; min-height: 44px; font-size: 12px; color: var(--ink-2); }
.playlist-empty { padding: 12px var(--pad); color: var(--ink-3); font-size: 13px; line-height: 1.6; }
.tools-section { margin-top: 12px; padding-bottom: 12px; }
.tool-list { margin: 0 var(--pad); border-top: 1px solid var(--line); }
.tool-list button { display: flex; align-items: center; width: 100%; min-height: 70px; gap: 13px; text-align: left; border-bottom: 1px solid var(--line); }
.tool-list button > span { flex: 1; min-width: 0; }
.tool-list strong { display: block; font-size: 14px; font-weight: 500; }
.tool-list small { display: block; margin-top: 5px; font-size: 12px; line-height: 1.45; color: var(--ink-3); }
.tool-list .i { flex: none; color: var(--ink-2); }
.empty { min-height: 190px; padding: 20px var(--pad); gap: 10px; }
.empty .glyph { width: 64px; height: 64px; }
.sh-form { padding: 0 var(--pad); }
.sh-sub { font-size: 13px; line-height: 1.6; color: var(--ink-3); margin-bottom: 10px; }
.sh-input { width: 100%; height: 48px; padding: 0 14px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--line); font-size: 15px; color: var(--ink); user-select: text; }
.sh-input:focus { border-color: var(--tint); outline: 2px solid var(--tint-soft); }
.sh-actions { display: flex; gap: 8px; padding-top: 14px; }
.about-logo { width: 60px; height: 60px; border-radius: 15px; margin-bottom: 12px; }
.about-name { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
@media (max-width: 375px) { .library-tabs { gap: 14px; } .library-shortcuts small { font-size: 10.5px; } }
</style>
