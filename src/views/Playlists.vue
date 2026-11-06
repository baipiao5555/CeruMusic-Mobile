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
const sortMode = ref<'recent' | 'name' | 'tracks'>('recent')
const onlyCloud = ref(false)

const playlists = computed(() => libraryState.playlists)
const totalTracks = computed(() =>
  libraryState.playlists.reduce((total, playlist) => total + playlist.tracks.length, 0)
)
const cloudCount = computed(() => playlists.value.filter((playlist) => playlist.cloudId).length)
const collected = computed(() => playlists.value.filter((playlist) => playlist.cloudId))

function stampOf(playlist: LocalPlaylist): number {
  const remote = playlist.cloudUpdatedAt ? Date.parse(playlist.cloudUpdatedAt) : 0
  return Number.isFinite(remote) && remote > 0 ? remote : playlist.createdAt
}

const visible = computed(() => {
  const list = playlists.value.filter((playlist) => !onlyCloud.value || playlist.cloudId)
  return [...list].sort((a, b) => {
    if (sortMode.value === 'name') return a.name.localeCompare(b.name, 'zh-Hans-CN')
    if (sortMode.value === 'tracks') return b.tracks.length - a.tracks.length
    return stampOf(b) - stampOf(a)
  })
})

function coverOf(playlist: LocalPlaylist): string | undefined {
  return playlist.cover || playlist.tracks[0]?.artwork
}

function sourceOf(playlist: LocalPlaylist): string {
  return playlist.tracks[0]?.providerName || '云端'
}

function updatedLabel(playlist: LocalPlaylist): string {
  const stamp = stampOf(playlist)
  if (!stamp) return ''
  const diff = Date.now() - stamp
  const day = 86400000
  if (diff < day) return '今天更新'
  if (diff < day * 2) return '昨天更新'
  if (diff < day * 7) return `${Math.floor(diff / day)} 天前`
  if (diff < day * 30) return `${Math.floor(diff / (day * 7))} 周前`
  return `${Math.floor(diff / (day * 30))} 个月前`
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
  <div class="screen">
    <div class="scroll safe-t-lg">
      <div class="pad">
        <div class="eyebrow">Ceru Music · 收藏</div>
      </div>

      <div class="page-head mt10">
        <div>
          <h1>歌单</h1>
          <div class="sub count">
            <span><b class="num">{{ playlists.length }}</b> 张歌单</span>
            <i class="sep" />
            <span><b class="num">{{ totalTracks }}</b> 首</span>
            <i class="sep" />
            <span><b class="num">{{ cloudCount }}</b> 张已同步云端</span>
          </div>
        </div>
        <div class="page-actions">
          <button class="iconbtn soft p-cloud" aria-label="云端歌单" @click="router.push('/cloud')">
            <Icon name="cloud" :size="19" />
          </button>
          <button class="iconbtn soft" aria-label="设置" @click="router.push('/settings')">
            <Icon name="settings" :size="19" />
          </button>
        </div>
      </div>

      <div class="chip-row p-chips">
        <button class="chip" :class="{ active: sortMode === 'recent' }" @click="sortMode = 'recent'">
          <span class="dot" />最近更新
        </button>
        <button class="chip" :class="{ active: sortMode === 'name' }" @click="sortMode = 'name'">按名称</button>
        <button class="chip" :class="{ active: sortMode === 'tracks' }" @click="sortMode = 'tracks'">按曲数</button>
        <button class="chip tint" :class="{ active: onlyCloud }" @click="onlyCloud = !onlyCloud">
          <Icon name="cloud" :size="14" />云端<span class="num">{{ cloudCount }}</span>
        </button>
      </div>

      <section class="mt24">
        <div class="section-head">
          <div class="st"><h2>我的歌单</h2><span class="idx">My Lists</span></div>
          <button class="more" @click="showImport = true">
            导入歌单<Icon name="folder" :size="14" />
          </button>
        </div>

        <div v-if="playlists.length && visible.length" class="p-grid">
          <div v-for="playlist in visible" :key="playlist.id" class="pl" @click="openPlaylist(playlist)">
            <div class="cover">
              <img
                v-if="coverOf(playlist)"
                :src="coverOf(playlist)"
                alt=""
                loading="lazy"
                @error="($event.target as HTMLImageElement).src = '/default-cover.png'"
              />
              <div v-else class="ph"><Icon name="music" :size="22" /></div>
              <span v-if="playlist.cloudId" class="badge gold">云端</span>
              <button class="del" aria-label="删除歌单" @click.stop="removePlaylist(playlist)">
                <Icon name="trash" :size="13" />
              </button>
            </div>
            <div class="n">{{ playlist.name }}</div>
            <div class="m">{{ playlist.tracks.length }} 首 · {{ updatedLabel(playlist) }}</div>
          </div>

          <div class="pl tile" @click="showCreate = true">
            <div class="p-newbox">
              <span class="cir"><Icon name="plus" :size="20" /></span>
            </div>
            <div class="n">新建歌单</div>
            <div class="m">挑歌或导入</div>
          </div>
        </div>

        <div v-else-if="playlists.length" class="p-hollow">
          <p>没有匹配「云端」的歌单。清除筛选看看全部 {{ playlists.length }} 张歌单。</p>
          <button class="btn btn-ghost btn-sm mt8" @click="onlyCloud = false">
            <Icon name="close" :size="15" /> 清除筛选
          </button>
        </div>

        <div v-else class="empty">
          <div class="glyph"><Icon name="playlist" :size="34" /></div>
          <h3>还没有歌单</h3>
          <p>从其他音乐平台导入歌单，或者创建一个空歌单开始整理。</p>
          <div class="row g8 mt8">
            <button class="btn btn-ghost btn-sm" @click="showImport = true">
              <Icon name="folder" :size="16" /> 导入歌单
            </button>
            <button class="btn btn-primary btn-sm" @click="showCreate = true">
              <Icon name="plus" :size="16" /> 新建歌单
            </button>
          </div>
        </div>
      </section>

      <section class="mt32">
        <div class="section-head">
          <div class="st"><h2>收藏的歌单</h2><span class="idx">Collected</span></div>
          <button class="more" @click="router.push('/cloud')">
            全部 {{ cloudCount }}<Icon name="chevron" :size="14" />
          </button>
        </div>

        <div v-if="collected.length" class="p-col">
          <div v-for="playlist in collected" :key="playlist.id" class="cg" @click="openPlaylist(playlist)">
            <div class="cover">
              <img
                v-if="coverOf(playlist)"
                :src="coverOf(playlist)"
                alt=""
                loading="lazy"
                @error="($event.target as HTMLImageElement).src = '/default-cover.png'"
              />
              <div v-else class="ph"><Icon name="music" :size="20" /></div>
              <span class="badge gold">云端</span>
            </div>
            <div class="n">{{ playlist.name }}</div>
            <div class="s">{{ sourceOf(playlist) }} · {{ playlist.tracks.length }} 首</div>
          </div>
        </div>

        <div v-else class="p-hollow">
          <p>还没有收藏的歌单。在电脑版把歌单上传到云端后，来这里点「云端歌单」导入。</p>
          <button class="btn btn-ghost btn-sm mt8" @click="router.push('/cloud')">
            <Icon name="cloud" :size="15" /> 去云端歌单
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

    <ImportPlaylistSheet v-if="showImport" @close="showImport = false" />
  </div>
</template>

<style scoped>
.count {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.count b {
  font-family: var(--serif);
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink-2);
}
.count .sep {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--ink-4);
  align-self: center;
}
.p-cloud {
  position: relative;
}
.p-cloud::after {
  content: '';
  position: absolute;
  right: 8px;
  top: 7px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--gold);
  box-shadow: 0 0 0 2px var(--surface);
}
.p-chips {
  padding: 17px var(--pad) 0;
}
.p-chips .chip {
  height: 34px;
}
.p-chips .chip .num {
  font-size: 11px;
  opacity: 0.62;
  margin-left: 2px;
}
.p-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 17px 11px;
  padding: 0 var(--pad);
}
.pl {
  min-width: 0;
}
.pl .cover {
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 16px;
}
.cover .ph {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  color: var(--ink-4);
  background: var(--porcelain-2);
}
.pl .cover .badge {
  position: absolute;
  left: 7px;
  top: 7px;
}
.pl .del {
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.92);
  background: rgba(8, 16, 14, 0.42);
  border: 1px solid rgba(255, 255, 255, 0.18);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
.pl .n {
  margin-top: 9px;
  font-size: 12.5px;
  font-weight: 550;
  line-height: 1.34;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pl .m {
  margin-top: 4px;
  font-size: 11px;
  color: var(--ink-4);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.p-newbox {
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 16px;
  border: 1px dashed var(--line-2);
  background: var(--tint-softer);
  display: flex;
  align-items: center;
  justify-content: center;
}
.p-newbox .cir {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--sh-1);
  display: grid;
  place-items: center;
  color: var(--tint);
}
.pl.tile .n {
  color: var(--ink-2);
}
.p-col {
  display: flex;
  gap: 12px;
  padding: 0 var(--pad);
  overflow-x: auto;
  scrollbar-width: none;
}
.p-col::-webkit-scrollbar {
  display: none;
}
.cg {
  width: 108px;
  flex: none;
}
.cg .cover {
  width: 108px;
  height: 108px;
  border-radius: 15px;
}
.cg .cover .badge {
  position: absolute;
  left: 6px;
  top: 6px;
}
.cg .n {
  margin-top: 8px;
  font-size: 11.5px;
  font-weight: 550;
  line-height: 1.32;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cg .s {
  margin-top: 3px;
  font-size: 11px;
  color: var(--ink-4);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.p-hollow {
  margin: 0 var(--pad);
  padding: 20px;
  border-radius: var(--r-lg);
  border: 1px dashed var(--line-2);
  text-align: center;
}
.p-hollow p {
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink-3);
}
.scroll-end {
  height: 26px;
}
.sh-form {
  padding: 0 var(--pad);
}
.sh-sub {
  font-size: 12.5px;
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
</style>
