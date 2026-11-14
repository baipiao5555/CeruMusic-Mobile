<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SongRow from '@/components/SongRow.vue'
import { playTracks } from '@/core/playback/player'
import type { Track } from '@/core/track'
import {
  localEntryToTrack,
  requestLocalPermission,
  scanLocalMusic,
  type LocalEntry
} from '@/core/local/media'

const router = useRouter()

const entries = ref<LocalEntry[]>([])
const tracks = ref<Track[]>([])
const keyword = ref('')
const scanning = ref(false)
const scanned = ref(false)
const denied = ref(false)
const webOnly = ref(false)

const filtered = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  if (!needle) return tracks.value
  return tracks.value.filter(
    (track) =>
      track.title.toLowerCase().includes(needle) || track.artist.toLowerCase().includes(needle)
  )
})

const totalLabel = computed(() => {
  if (scanning.value) return '正在扫描…'
  if (!scanned.value) return '还没有扫描'
  if (!entries.value.length) return '没有找到歌曲'
  return `${entries.value.length} 首 · ${formatSize(entries.value.reduce((sum, item) => sum + (item.size || 0), 0))}`
})

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB'
  const mb = bytes / 1024 / 1024
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`
}

async function scan(): Promise<void> {
  if (scanning.value) return
  if (!Capacitor.isNativePlatform()) {
    webOnly.value = true
    scanned.value = true
    return
  }
  scanning.value = true
  denied.value = false
  try {
    const allowed = await requestLocalPermission()
    if (!allowed) {
      denied.value = true
      entries.value = []
      tracks.value = []
      return
    }
    const found = await scanLocalMusic()
    entries.value = found
    tracks.value = found.map(localEntryToTrack)
  } finally {
    scanning.value = false
    scanned.value = true
  }
}

function playAll(): void {
  if (!filtered.value.length) return
  void playTracks(filtered.value)
}

function playIndex(index: number): void {
  void playTracks(filtered.value, index)
}

onMounted(() => {
  void scan()
})
</script>

<template>
  <div class="screen">
    <div class="scroll safe-t-lg">
      <div class="navrow">
        <button class="iconbtn quiet" aria-label="返回" @click="router.back()">
          <Icon name="back" :size="20" />
        </button>
        <button class="iconbtn quiet" aria-label="重新扫描" :disabled="scanning" @click="scan">
          <Icon name="refresh" :size="19" />
        </button>
      </div>

      <header class="page-head phead">
        <div>
          <div class="eyebrow">CERU MUSIC · 本机</div>
          <h1 class="headline">本机音乐</h1>
          <div class="sub">{{ totalLabel }}</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" :disabled="!filtered.length" @click="playAll">
            <Icon name="play" :size="14" /> 播放全部
          </button>
        </div>
      </header>

      <div class="searchbar">
        <Icon name="search" :size="17" />
        <input v-model="keyword" type="search" placeholder="在本机音乐里找歌" />
        <button v-if="keyword" class="clear" aria-label="清空" @click="keyword = ''">
          <Icon name="close" :size="14" />
        </button>
      </div>

      <div v-if="webOnly" class="empty">
        <div class="glyph"><Icon name="music" :size="32" /></div>
        <h3>本机音乐只在手机上可用</h3>
        <p>装到手机后，这里会列出系统媒体库里的歌曲。</p>
      </div>

      <div v-else-if="denied" class="empty">
        <div class="glyph"><Icon name="music" :size="32" /></div>
        <h3>需要读取本机音乐的权限</h3>
        <p>授权后才能扫描手机里的音频文件；只读元数据，不会改动你的文件。</p>
        <button class="btn btn-tonal mt14" @click="scan">重新授权</button>
      </div>

      <div v-else-if="scanning && !tracks.length" class="scan-hint">
        <span class="spin" />
        正在读取媒体库…
      </div>

      <div v-else-if="scanned && !entries.length" class="empty">
        <div class="glyph"><Icon name="folder" :size="32" /></div>
        <h3>没有扫描到歌曲</h3>
        <p>确认手机里存有 mp3 / flac / m4a 等音频，并且系统媒体库已收录。</p>
        <button class="btn btn-ghost mt14" @click="scan">再扫一次</button>
      </div>

      <div v-else-if="!filtered.length" class="empty">
        <div class="glyph"><Icon name="search" :size="30" /></div>
        <h3>没有匹配的歌</h3>
        <p>换个关键词试试。</p>
      </div>

      <div v-else class="song-list">
        <SongRow
          v-for="(track, index) in filtered"
          :key="track.id"
          :track="track"
          :index="index"
          :queue="filtered"
          @play="playIndex(index)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.navrow {
  display: flex;
  justify-content: space-between;
  padding: 6px var(--pad) 0;
}
.phead {
  align-items: flex-end;
}
.sub {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--ink-3);
}
.searchbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px var(--pad) 8px;
  padding: 0 12px;
  height: 42px;
  border-radius: 14px;
  background: var(--surface-2, rgba(255, 255, 255, 0.06));
  color: var(--ink-3);
}
.searchbar input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ink-1);
  font-size: 14px;
  outline: none;
}
.searchbar input::placeholder {
  color: var(--ink-4);
}
.clear {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  color: var(--ink-3);
}
.scan-hint {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 26px var(--pad);
  font-size: 13px;
  color: var(--ink-3);
}
.spin {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.18);
  border-top-color: var(--tint);
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
