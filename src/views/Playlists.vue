<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SongRow from '@/components/SongRow.vue'
import { playTracks } from '@/core/playback/player'
import ImportPlaylistSheet from '@/components/ImportPlaylistSheet.vue'
import {
  createPlaylist,
  deletePlaylist,
  libraryState,
  type LocalPlaylist
} from '@/core/library'
import { confirmAction } from '@/core/confirm'
import { openSearch } from '@/core/searchEntry'

const router = useRouter()
const showCreate = ref(false)
const showImport = ref(false)
const playlistName = ref('')
const sortMode = ref<'recent' | 'name' | 'tracks'>('recent')
const collection = ref<'local' | 'favorites' | 'cloud'>('local')
const menuPlaylist = ref<LocalPlaylist>()

const playlists = computed(() => libraryState.playlists)
const favorites = computed(() => libraryState.favorites)
const totalTracks = computed(() =>
  libraryState.playlists.reduce((total, playlist) => total + playlist.tracks.length, 0)
)
const cloudCount = computed(() => playlists.value.filter((playlist) => playlist.cloudId).length)

function stampOf(playlist: LocalPlaylist): number {
  const remote = playlist.cloudUpdatedAt ? Date.parse(playlist.cloudUpdatedAt) : 0
  return Number.isFinite(remote) && remote > 0 ? remote : playlist.createdAt
}

const visible = computed(() => {
  const list = playlists.value.filter((playlist) => collection.value === 'cloud' ? Boolean(playlist.cloudId) : !playlist.cloudId)
  return [...list].sort((a, b) => {
    if (sortMode.value === 'name') return a.name.localeCompare(b.name, 'zh-Hans-CN')
    if (sortMode.value === 'tracks') return b.tracks.length - a.tracks.length
    return stampOf(b) - stampOf(a)
  })
})

function coverOf(playlist: LocalPlaylist): string | undefined {
  return playlist.cover || playlist.tracks[0]?.artwork
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
  menuPlaylist.value = undefined
  const ok = await confirmAction({
    title: `删除歌单「${playlist.name}」？`,
    body: '歌单会被删除，其中的歌曲仍保留在资料库与本地文件里。',
    confirmText: '删除',
    danger: true
  })
  if (ok) deletePlaylist(playlist.id)
}
function playFavorite(index: number): void {
  void playTracks(favorites.value, index)
}
</script>

<template>
  <div class="screen playlists-screen">
    <div class="scroll safe-t-lg">
      <header class="page-head playlists-head">
        <h1>歌单</h1>
        <div class="page-actions">
          <button class="iconbtn quiet" aria-label="搜索音乐" @click="openSearch(router)"><Icon name="search" :size="22" /></button>
          <button class="iconbtn quiet" aria-label="新建歌单" @click="showCreate = true"><Icon name="plus" :size="24" /></button>
        </div>
      </header>

      <nav class="collection-tabs" aria-label="歌单分类">
        <button :class="{ on: collection === 'local' }" :aria-pressed="collection === 'local'" @click="collection = 'local'">本地</button>
        <button :class="{ on: collection === 'favorites' }" :aria-pressed="collection === 'favorites'" @click="collection = 'favorites'">收藏</button>
        <button :class="{ on: collection === 'cloud' }" :aria-pressed="collection === 'cloud'" @click="collection = 'cloud'">云端导入</button>
      </nav>

      <button v-if="collection !== 'cloud'" class="liked-card" @click="router.push('/library?section=favorites')">
        <span class="liked-cover"><Icon name="heart" :size="28" /></span>
        <span><strong>我喜欢的音乐</strong><small>{{ favorites.length }} 首 · 把喜欢留在这里</small></span>
        <Icon name="chevron-right" :size="16" />
      </button>

      <section class="collection-section">
        <div class="section-head">
          <h2>{{ collection === 'favorites' ? '收藏的歌曲' : collection === 'cloud' ? '云端导入的歌单' : '我的歌单' }}</h2>
          <label v-if="collection !== 'favorites'" class="sort-control">
            <Icon name="sort" :size="16" />
            <select v-model="sortMode" aria-label="歌单排序">
              <option value="recent">最近更新</option><option value="name">按名称</option><option value="tracks">按曲数</option>
            </select>
          </label>
        </div>
        <p class="collection-note">{{ collection === 'favorites' ? '这里是实际收藏的歌曲，不是远程歌单订阅。' : collection === 'cloud' ? '从澜音账号导入到本机的副本，不是双向同步。' : '本地创建与平台导入的歌单，都保存在这里。' }}</p>

        <template v-if="collection === 'favorites'">
          <div v-if="favorites.length" class="favorites-list">
            <SongRow v-for="(track, index) in favorites" :key="track.providerId + ':' + track.id" :track="track" :index="index" :queue="favorites" @play="playFavorite(index)" />
          </div>
          <div v-else class="empty"><div class="glyph"><Icon name="heart" :size="32" /></div><h3>还没有喜欢的歌曲</h3><p>在歌曲更多菜单中收藏，就会出现在这里。</p><button class="btn btn-ghost btn-sm" @click="openSearch(router)">去搜索音乐</button></div>
        </template>

        <div v-else-if="visible.length" class="p-grid">
          <article v-for="playlist in visible" :key="playlist.id" class="pl">
            <button class="pl-open" :aria-label="'打开歌单' + playlist.name" @click="openPlaylist(playlist)">
              <span class="playlist-cover">
                <img :src="coverOf(playlist) || '/default-cover.png'" alt="" loading="lazy" decoding="async" @error="($event.target as HTMLImageElement).src = '/default-cover.png'" />
                <span class="track-count"><Icon name="music" :size="12" /> {{ playlist.tracks.length }} 首</span>
              </span>
              <strong class="n">{{ playlist.name }}</strong>
              <small class="m">{{ playlist.cloudId ? '云端导入 · 本地副本' : '本地歌单' }} · {{ playlist.tracks.length }} 首</small>
            </button>
            <button class="playlist-more" :aria-label="playlist.name + '更多操作'" @click="menuPlaylist = playlist"><Icon name="more" :size="19" /></button>
          </article>
          <button v-if="collection === 'local'" class="pl new-playlist" @click="showCreate = true"><span><Icon name="plus" :size="28" /></span><strong class="n">新建歌单</strong><small class="m">把好听的歌放在一起</small></button>
        </div>
        <div v-else class="empty">
          <div class="glyph"><Icon :name="collection === 'cloud' ? 'cloud' : 'playlist'" :size="32" /></div>
          <h3>{{ collection === 'cloud' ? '还没有云端导入的歌单' : '还没有本地歌单' }}</h3>
          <p>{{ collection === 'cloud' ? '登录澜音账号后，可将电脑端云歌单导入为本地副本。' : '创建空歌单，或通过音源插件从其他平台导入。' }}</p>
          <div class="row g8">
            <button v-if="collection === 'cloud'" class="btn btn-primary btn-sm" @click="router.push('/cloud')">查看云端歌单</button>
            <template v-else><button class="btn btn-ghost btn-sm" @click="showImport = true">导入歌单</button><button class="btn btn-primary btn-sm" @click="showCreate = true">新建歌单</button></template>
          </div>
        </div>
      </section>

      <div class="import-actions">
        <button @click="showImport = true"><Icon name="folder" :size="18" /> 从其他平台导入</button>
        <button @click="router.push('/cloud')"><Icon name="cloud" :size="18" /> 云端歌单</button>
      </div>
      <div class="collection-footer"><span>{{ playlists.length }} 张歌单 · {{ totalTracks }} 首 · {{ cloudCount }} 张云端副本</span><button aria-label="设置" @click="router.push('/settings')"><Icon name="settings" :size="18" /></button></div>
    </div>

    <transition name="sheet-pop">
      <div v-if="menuPlaylist" class="sheet-mask" @click.self="menuPlaylist = undefined">
        <div class="sheet" role="dialog" aria-modal="true" aria-label="歌单操作">
          <div class="grab" />
          <div class="sh-head"><div class="sh-title">{{ menuPlaylist.name }}</div><button class="iconbtn quiet" aria-label="关闭" @click="menuPlaylist = undefined"><Icon name="close" :size="20" /></button></div>
          <button class="sh-item" @click="openPlaylist(menuPlaylist); menuPlaylist = undefined"><Icon name="playlist" :size="20" /> 查看歌单 / 重命名</button>
          <button class="sh-item danger" @click="removePlaylist(menuPlaylist)"><Icon name="trash" :size="20" /> 删除歌单</button>
        </div>
      </div>
    </transition>

    <transition name="sheet-pop">
      <div v-if="showCreate" class="sheet-mask" @click.self="showCreate = false">
        <div class="sheet" role="dialog" aria-modal="true" aria-label="新建歌单">
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
    </transition>

    <ImportPlaylistSheet v-if="showImport" @close="showImport = false" />
  </div>
</template>

<style scoped>
.playlists-head { align-items: center; min-height: 48px; }
.playlists-head h1 { font-family: inherit; font-size: 27px; font-weight: 750; }
.collection-tabs { display: flex; gap: 26px; padding: 13px var(--pad) 12px; }
.collection-tabs button { position: relative; min-width: 44px; min-height: 44px; color: var(--ink-3); font-size: 16px; }
.collection-tabs button.on { color: var(--ink); font-weight: 650; }
.collection-tabs button.on::after { content: ''; position: absolute; bottom: 0; left: 0; width: 19px; height: 3px; border-radius: 3px; background: var(--tint); }
.liked-card { display: flex; align-items: center; width: calc(100% - var(--pad) * 2); margin: 0 var(--pad) 14px; padding: 13px 14px; border-radius: 12px; background: var(--surface-2); gap: 13px; text-align: left; }
.liked-cover { display: grid; place-items: center; width: 59px; height: 59px; flex: none; border-radius: 10px; background: linear-gradient(135deg, #f6acbf, #e75a85); color: #fff; }
.liked-card > span:nth-child(2) { flex: 1; min-width: 0; }
.liked-card strong { display: block; font-size: 15px; font-weight: 600; }
.liked-card small { display: block; margin-top: 7px; font-size: 12px; color: var(--ink-3); }
.liked-card > .i { color: var(--ink-3); }
.section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0; padding: 7px var(--pad) 0; min-height: 53px; }
.section-head h2 { font-family: inherit; font-size: 20px; font-weight: 700; }
.sort-control { display: flex; align-items: center; gap: 1px; color: var(--ink-3); }
.sort-control select { min-height: 44px; max-width: 105px; font: inherit; font-size: 12px; color: var(--ink-3); background: transparent; border: 0; }
.collection-note { padding: 0 var(--pad) 16px; font-size: 11.5px; line-height: 1.55; color: var(--ink-3); }
.p-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 23px 16px; padding: 0 var(--pad); }
.pl { position: relative; min-width: 0; text-align: left; }
.pl-open { display: block; width: 100%; text-align: left; }
.playlist-cover { position: relative; display: block; width: 100%; aspect-ratio: 1; border-radius: 10px; overflow: hidden; background: var(--surface-2); }
.playlist-cover img { width: 100%; height: 100%; object-fit: cover; }
.track-count { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 3px; padding: 23px 10px 10px; color: #fff; font-size: 11px; background: linear-gradient(transparent, #0008); }
.playlist-more { position: absolute; right: 4px; top: 4px; display: grid; place-items: center; width: 44px; height: 44px; color: #fff; border-radius: 50%; background: #142c3859; }
.pl .n { display: block; margin-top: 9px; font-size: 14px; font-weight: 550; line-height: 1.45; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl .m { display: block; margin-top: 5px; font-size: 11.5px; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.new-playlist > span { display: grid; place-items: center; width: 100%; aspect-ratio: 1; border-radius: 10px; border: 1px dashed var(--line-2); color: var(--tint); background: var(--tint-softer); }
.favorites-list { padding: 0 8px; }
.import-actions { display: flex; flex-wrap: wrap; gap: 8px 18px; margin: 24px var(--pad) 0; padding-top: 10px; border-top: 1px solid var(--line); }
.import-actions button { display: inline-flex; align-items: center; gap: 7px; min-height: 48px; font-size: 13px; color: var(--ink-2); }
.collection-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px var(--pad) 6px; font-size: 11.5px; color: var(--ink-3); line-height: 1.6; }
.collection-footer button { display: grid; place-items: center; width: 44px; height: 44px; flex: none; }
.empty { min-height: 210px; padding: 20px var(--pad); gap: 12px; }
.empty .glyph { width: 64px; height: 64px; }
.sh-form { padding: 0 var(--pad); }
.sh-sub { font-size: 13px; color: var(--ink-3); margin-bottom: 10px; }
.sh-input { width: 100%; height: 48px; padding: 0 14px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--line); font-size: 15px; color: var(--ink); user-select: text; }
.sh-input:focus { border-color: var(--tint); outline: 2px solid var(--tint-soft); }
.sh-actions { display: flex; gap: 8px; padding-top: 14px; }
@media (max-width: 375px) { .collection-tabs { gap: 21px; } .section-head h2 { font-size: 19px; } .sort-control select { max-width: 94px; } }

@media (min-width: 768px) {
  .playlists-head,
  .collection-tabs,
  .collection-section,
  .import-actions,
  .collection-footer {
    width: min(100%, 980px);
    margin-left: auto;
    margin-right: auto;
  }
  .playlists-head { padding-top: 6px; }
  .collection-tabs { padding-top: 16px; padding-bottom: 14px; }
  .liked-card {
    width: calc(100% - var(--pad) * 2);
    max-width: 980px;
    margin: 0 auto 18px;
  }
  .collection-section .section-head { padding-top: 10px; }
  .collection-note { max-width: 760px; }
  .p-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 32px 24px;
  }
  .playlist-cover { border-radius: 14px; }
  .pl .n { font-size: 15px; }
  .empty { width: min(100%, 620px); margin-left: auto; margin-right: auto; }
}

@media (min-width: 1000px) {
  .p-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
</style>
