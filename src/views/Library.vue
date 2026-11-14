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
import { logState } from '@/core/logs'
import { downloadState } from '@/core/downloads'
import { authState, displayName } from '@/core/auth'
import { confirmAction } from '@/core/confirm'

const router = useRouter()
const appVersion = __APP_VERSION__
const tab = ref<'songs' | 'albums' | 'artists' | 'folders'>('songs')
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
    ? `已登录澜音 · ${cloudCount.value} 个云端歌单`
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
const downloadPercent = computed(() =>
  downloadState.tasks.length ? Math.round((downloaded.value.length / downloadState.tasks.length) * 100) : 0
)

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
  <div class="screen">
    <div class="scroll safe-t-lg">
      <div class="pad">
        <div class="eyebrow">Ceru Music · 本机</div>
      </div>

      <div class="page-head mt10">
        <div>
          <h1>我的</h1>
          <div class="sub">{{ favorites.length }} 首收藏 · {{ playlists.length }} 张歌单 · {{ runningPlugins }} 个音源</div>
        </div>
        <div class="page-actions">
          <button class="iconbtn soft log-entry" aria-label="运行日志" @click="router.push('/logs')">
            <Icon name="scroll-text" :size="19" />
            <span v-if="logErrors" class="log-dot" />
          </button>
          <button class="iconbtn soft" aria-label="设置" @click="router.push('/settings')">
            <Icon name="settings" :size="19" />
          </button>
        </div>
      </div>

      <section class="p-card">
        <div class="p-id">
          <div class="ava">
            <img :src="profileAvatar" alt="" @error="($event.target as HTMLImageElement).src = '/logo.png'" />
          </div>
          <div class="f1">
            <div class="nm">{{ profileName }}</div>
            <div class="sub">{{ profileSub }}</div>
          </div>
          <button class="btn btn-ghost btn-sm p-new" aria-label="新建或导入歌单" @click="showQuick = true">
            <Icon name="plus" :size="14" /> 新建
          </button>
        </div>

        <div class="p-nums">
          <div class="n"><b class="num">{{ allTracks.length }}</b><span>歌曲</span></div>
          <i class="v" />
          <div class="n"><b class="num">{{ albumGroups.length }}</b><span>专辑</span></div>
          <i class="v" />
          <div class="n"><b class="num">{{ artistGroups.length }}</b><span>歌手</span></div>
        </div>

        <div class="p-store">
          <div class="head">
            <span class="t">本机占用</span>
            <span class="r num">{{ formatBytes(usedBytes) }} · {{ downloaded.length }}/{{ downloadState.tasks.length }} 首已下载</span>
          </div>
          <div class="tr"><i :style="{ width: downloadPercent + '%' }" /></div>
        </div>
      </section>

      <div class="p-quick">
        <button class="q" @click="openSongs('recent')">
          <span class="ic"><Icon name="history" :size="21" /></span>
          <span class="l">最近播放</span>
          <span class="n num">{{ history.length }}</span>
        </button>
        <button class="q" @click="openSongs('favorites')">
          <span class="ic"><Icon name="heart" :size="21" /></span>
          <span class="l">我的收藏</span>
          <span class="n num">{{ favorites.length }}</span>
        </button>
        <button class="q" @click="router.push('/downloads')">
          <span class="ic"><Icon name="download" :size="21" /></span>
          <span class="l">下载管理</span>
          <span class="n num">{{ downloadState.tasks.length }}</span>
        </button>
        <button class="q gold" @click="router.push('/cloud')">
          <span class="ic"><Icon name="cloud" :size="21" /></span>
          <span class="l">云端歌单</span>
          <span class="n num">{{ cloudCount }}</span>
        </button>
      </div>

      <button class="p-local" @click="router.push('/local')">
        <span class="ic"><Icon name="music" :size="20" /></span>
        <span class="tx">
          <b>本机音乐</b>
          <small>扫描手机里的歌曲，不占额外空间</small>
        </span>
        <Icon name="chevron-right" :size="16" />
      </button>

      <div class="p-seg">
        <div class="segment">
          <button :class="{ on: tab === 'songs' }" @click="tab = 'songs'">歌曲</button>
          <button :class="{ on: tab === 'albums' }" @click="tab = 'albums'">专辑</button>
          <button :class="{ on: tab === 'artists' }" @click="tab = 'artists'">歌手</button>
          <button :class="{ on: tab === 'folders' }" @click="tab = 'folders'">文件夹</button>
        </div>
      </div>

      <section class="mt16">
        <template v-if="tab === 'songs'">
          <div class="chip-row p-sub">
            <button class="chip" :class="{ active: songTab === 'favorites' }" @click="songTab = 'favorites'">
              <span class="dot" />收藏<span class="num">{{ favorites.length }}</span>
            </button>
            <button class="chip" :class="{ active: songTab === 'recent' }" @click="songTab = 'recent'">
              最近播放<span class="num">{{ history.length }}</span>
            </button>
          </div>

          <div v-if="songTab === 'favorites' && favorites.length" class="song-list">
            <SongRow
              v-for="(track, index) in favorites"
              :key="track.providerId + track.id"
              :track="track"
              :index="index"
              :queue="favorites"
              @play="playFavorites(index)"
            />
          </div>
          <div v-else-if="songTab === 'favorites'" class="empty">
            <div class="glyph"><Icon name="heart" :size="34" /></div>
            <h3>还没有喜欢的歌曲</h3>
            <p>在歌曲右侧点一下爱心，就会出现在这里。</p>
            <button class="btn btn-ghost btn-sm mt8" @click="router.push('/search')">去搜索音乐</button>
          </div>

          <div v-else-if="history.length" class="song-list">
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
            <div class="glyph"><Icon name="history" :size="34" /></div>
            <h3>还没有播放记录</h3>
            <p>播放过的歌曲会出现在这里。</p>
          </div>
        </template>

        <template v-else-if="tab === 'albums'">
          <div class="section-head">
            <div class="st"><h2>专辑</h2><span class="idx">Albums</span></div>
            <span class="more">{{ albumGroups.length }} 张</span>
          </div>
          <div v-if="albumGroups.length" class="p-list">
            <button v-for="group in albumGroups" :key="group.key" class="p-srow" @click="playGroup(group)">
              <div class="cover"><img :src="group.cover" alt="" /></div>
              <div class="m">
                <div class="t truncate">{{ group.name }}</div>
                <div class="a truncate">{{ group.sub }} · {{ group.tracks.length }} 首</div>
              </div>
              <Icon name="play" :size="16" class="pl" />
            </button>
          </div>
          <div v-else class="empty">
            <div class="glyph"><Icon name="music" :size="34" /></div>
            <h3>还没有专辑信息</h3>
            <p>收藏或导入歌曲后，这里会按专辑归类。</p>
          </div>
        </template>

        <template v-else-if="tab === 'artists'">
          <div class="section-head">
            <div class="st"><h2>歌手</h2><span class="idx">Artists</span></div>
            <span class="more">{{ artistGroups.length }} 位</span>
          </div>
          <div v-if="artistGroups.length" class="p-list">
            <button v-for="group in artistGroups" :key="group.key" class="p-srow" @click="playGroup(group)">
              <div class="cover round"><img :src="group.cover" alt="" /></div>
              <div class="m">
                <div class="t truncate">{{ group.name }}</div>
                <div class="a truncate">{{ group.tracks.length }} 首歌曲</div>
              </div>
              <Icon name="play" :size="16" class="pl" />
            </button>
          </div>
          <div v-else class="empty">
            <div class="glyph"><Icon name="user" :size="34" /></div>
            <h3>还没有歌手信息</h3>
            <p>收藏或导入歌曲后，这里会按歌手归类。</p>
          </div>
        </template>

        <template v-else>
          <div class="section-head">
            <div class="st"><h2>我的歌单</h2><span class="idx">{{ playlists.length }} 张</span></div>
            <div class="row g6">
              <button class="mini" @click="openImport"><Icon name="folder" :size="14" />导入</button>
              <button class="mini" @click="showCreate = true"><Icon name="plus" :size="14" />新建</button>
            </div>
          </div>
          <div v-if="playlists.length" class="list p-folders">
            <div
              v-for="playlist in playlists"
              :key="playlist.id"
              class="li"
              role="button"
              tabindex="0"
              @click="openPlaylist(playlist)"
              @keydown.enter="openPlaylist(playlist)"
            >
              <div class="p-cv">
                <img v-if="coverOf(playlist)" :src="coverOf(playlist)" alt="" />
                <Icon v-else name="music" :size="18" />
              </div>
              <div class="f1">
                <div class="lab truncate">{{ playlist.name }}</div>
                <div class="sub">{{ playlist.tracks.length }} 首歌曲{{ playlist.cloudId ? ' · 云端' : '' }}</div>
              </div>
              <button class="iconbtn quiet p-del" aria-label="删除歌单" @click.stop="removePlaylist(playlist)">
                <Icon name="trash" :size="16" />
              </button>
              <Icon name="chevron" :size="16" class="chev" />
            </div>
          </div>
          <div v-else class="empty">
            <div class="glyph"><Icon name="playlist" :size="34" /></div>
            <h3>还没有歌单</h3>
            <p>创建一个歌单，把喜欢的歌曲整理到一起。</p>
            <button class="btn btn-ghost btn-sm mt8" @click="showCreate = true">
              <Icon name="plus" :size="16" /> 新建歌单
            </button>
          </div>
        </template>
      </section>

      <section class="mt28">
        <div class="section-head">
          <div class="st"><h2>更多</h2><span class="idx">More</span></div>
        </div>
        <div class="list p-more">
          <button class="li" @click="openImport">
            <span class="ico"><Icon name="folder" :size="17" /></span>
            <div class="f1">
              <div class="lab">导入歌单</div>
              <div class="sub">{{ importers.length ? `支持 ${importers.length} 个插件导入源` : '从其他音乐平台导入歌单' }}</div>
            </div>
            <Icon name="chevron" :size="16" class="chev" />
          </button>
          <button class="li" @click="router.push('/plugins')">
            <span class="ico"><Icon name="link" :size="17" /></span>
            <div class="f1">
              <div class="lab">音源插件</div>
              <div class="sub">{{ pluginState.plugins.length }} 个已安装</div>
            </div>
            <Icon name="chevron" :size="16" class="chev" />
          </button>
          <button class="li" @click="router.push('/settings')">
            <span class="ico"><Icon name="settings" :size="17" /></span>
            <div class="f1">
              <div class="lab">设置</div>
              <div class="sub">外观、音质与播放选项</div>
            </div>
            <Icon name="chevron" :size="16" class="chev" />
          </button>
          <button class="li" @click="showAbout = true">
            <span class="ico"><Icon name="info" :size="17" /></span>
            <div class="f1">
              <div class="lab">关于澜音</div>
              <div class="sub">CeruMusic 手机版 · {{ appVersion }}</div>
            </div>
            <Icon name="chevron" :size="16" class="chev" />
          </button>
        </div>
      </section>

      <div class="scroll-end" />
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
            由插件提供音乐信息与播放地址，应用本身不存储任何音乐文件。
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
.log-entry {
  position: relative;
}
.log-dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cinnabar);
  box-shadow: 0 0 0 2px var(--surface);
}
.p-card {
  margin: 14px var(--pad) 0;
  padding: 16px;
  border-radius: 24px;
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--sh-1);
}
.p-id {
  display: flex;
  align-items: center;
  gap: 12px;
}
.p-id .ava {
  width: 50px;
  height: 50px;
  flex: none;
  border-radius: 50%;
  overflow: hidden;
  background: var(--tint-soft);
}
.p-id .ava img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.p-id .nm {
  font-family: var(--serif);
  font-size: 18px;
  font-weight: 600;
  line-height: 1.2;
}
.p-id .sub {
  margin-top: 5px;
  font-size: 11.5px;
  color: var(--ink-3);
}
.p-id .p-new {
  flex: none;
  height: 34px;
  padding: 0 13px;
  font-size: 12px;
}
.p-nums {
  display: flex;
  align-items: center;
  margin-top: 15px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
.p-nums .n {
  flex: 1;
}
.p-nums .n b {
  display: block;
  font-family: var(--serif);
  font-size: 23.5px;
  font-weight: 600;
  line-height: 1.1;
  color: var(--ink);
}
.p-nums .n span {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--ink-4);
}
.p-nums .v {
  width: 1px;
  align-self: stretch;
  margin: 3px 12px 1px;
  background: var(--line);
}
.p-store {
  margin-top: 14px;
}
.p-store .head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.p-store .t {
  font-size: 11px;
  color: var(--ink-4);
}
.p-store .r {
  font-size: 11px;
  color: var(--ink-3);
}
.p-store .tr {
  margin-top: 8px;
  height: 5px;
  border-radius: var(--r-pill);
  background: var(--line);
  overflow: hidden;
}
.p-store .tr i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--tint);
  transition: width var(--e-out) 0.3s;
}
.p-quick {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 14px var(--pad) 0;
}
.p-quick .q {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
}
.p-quick .ic {
  width: 44px;
  height: 44px;
  border-radius: 15px;
  display: grid;
  place-items: center;
  background: var(--surface);
  border: 1px solid var(--line);
  color: var(--tint);
  box-shadow: var(--sh-1);
}
.p-quick .l {
  font-size: 11.5px;
  color: var(--ink-2);
  white-space: nowrap;
}
.p-quick .n {
  font-size: 11px;
  color: var(--ink-4);
}
.p-quick .gold .ic {
  color: var(--gold);
}
.p-local {
  display: flex;
  align-items: center;
  gap: 12px;
  width: calc(100% - var(--pad) * 2);
  margin: 14px var(--pad) 0;
  padding: 12px 14px;
  border-radius: 16px;
  background: var(--surface-2, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--line-2, rgba(255, 255, 255, 0.08));
  text-align: left;
  color: var(--ink-1);
}
.p-local .ic {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: var(--tint-soft, rgba(169, 228, 207, 0.14));
  color: var(--tint);
}
.p-local .tx {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.p-local .tx b {
  font-size: 14.5px;
  font-weight: 600;
}
.p-local .tx small {
  font-size: 11.5px;
  color: var(--ink-3);
}
.p-local:active {
  transform: scale(0.995);
}
.p-seg {
  padding: 20px var(--pad) 0;
}
.p-seg .segment button {
  height: 34px;
  font-size: 12.5px;
}
.p-sub {
  padding: 0 var(--pad) 10px;
}
.p-sub .chip {
  height: 30px;
}
.p-sub .chip .num {
  margin-left: 3px;
  font-size: 11px;
  opacity: 0.6;
}
.p-list {
  padding: 0 8px;
}
.p-srow {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 56px;
  padding: 6px 12px;
  text-align: left;
}
.p-srow .cover {
  width: 44px;
  height: 44px;
  flex: none;
}
.p-srow .cover.round {
  border-radius: 50%;
}
.p-srow .cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.p-srow .m {
  flex: 1;
  min-width: 0;
}
.p-srow .t {
  font-size: 14px;
  font-weight: 550;
  color: var(--ink);
}
.p-srow .a {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--ink-3);
}
.p-srow .pl {
  color: var(--ink-4);
}
.p-folders {
  margin: 0 var(--pad);
  padding: 2px;
}
.p-folders .li {
  width: 100%;
  text-align: left;
  cursor: pointer;
}
.p-folders .li .sub {
  margin-top: 3px;
  font-size: 11px;
  color: var(--ink-4);
}
.p-cv {
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: var(--r-sm);
  overflow: hidden;
  display: grid;
  place-items: center;
  background: var(--tint-softer);
  color: var(--ink-4);
}
.p-cv img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.p-del {
  width: 34px;
  height: 34px;
  flex: none;
}
.chev {
  color: var(--ink-4);
  flex: none;
}
.mini {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 9px;
  border-radius: var(--r-pill);
  border: 1px solid var(--line);
  background: var(--surface);
  font-size: 11.5px;
  color: var(--ink-2);
}
.p-more {
  margin: 0 var(--pad);
  padding: 2px;
}
.p-more .li {
  width: 100%;
  text-align: left;
  gap: 12px;
}
.p-more .ico {
  width: 32px;
  height: 32px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: var(--tint-softer);
  color: var(--tint);
}
.p-more .lab {
  font-size: 14px;
  color: var(--ink);
}
.p-more .sub {
  margin-top: 3px;
  font-size: 11px;
  color: var(--ink-4);
}
.scroll-end {
  height: 26px;
}
.empty {
  padding: 6px var(--pad) 0;
  gap: 8px;
}
.empty .glyph {
  width: 76px;
  height: 76px;
  margin-bottom: 2px;
}
.sh-form {
  padding: 0 var(--pad);
}
.sh-sub {
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--ink-3);
  margin-bottom: 10px;
}
.sh-input {
  width: 100%;
  height: 46px;
  padding: 0 14px;
  border-radius: var(--r-md);
  background: var(--surface-2);
  border: 1px solid var(--line);
  font-size: 14px;
  color: var(--ink);
  user-select: text;
}
.sh-input::placeholder {
  color: var(--ink-4);
}
.sh-input:focus {
  border-color: var(--tint);
  outline: none;
}
.sh-actions {
  display: flex;
  gap: 8px;
  padding-top: 14px;
}
.about-logo {
  width: 60px;
  height: 60px;
  border-radius: 18px;
  margin-bottom: 12px;
}
.about-name {
  font-family: var(--serif);
  font-size: 17px;
  font-weight: 600;
  margin-bottom: 8px;
}
</style>
