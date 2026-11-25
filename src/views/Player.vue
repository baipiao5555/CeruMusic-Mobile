<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue'
import { themeBackgroundScene } from '@/core/themeBackground'
import { useRoute, useRouter } from 'vue-router'
import { Capacitor } from '@capacitor/core'
import { StatusBar } from '@capacitor/status-bar'
import TrackArtwork from '@/components/TrackArtwork.vue'
import SongActionsSheet from '@/components/SongActionsSheet.vue'
import type { Track } from '@/core/track'
import { sourceLabel } from '@/core/trackGrouping'
import Icon from '@/components/Icon.vue'
import {
  currentTrack,
  cycleMode,
  next,
  playerState,
  previous,
  seek,
  setQuality,
  togglePlay,
  playTracks,
  removeFromQueue,
  matchLyricsOnline,
  cancelSleepTimer,
  setSleepTimer,
  sleepAfterCurrentTrack,
  updateActiveLyric,
  refreshBackgroundLyrics
} from '@/core/playback/player'
import { isFavorite, toggleFavorite } from '@/core/library'
import { sungCharCount } from '@/core/lyrics/timeline'
import { settingsState, updateSettings } from '@/core/settings'
import { qualityLabel } from '@/core/quality'
import { downloadTrack, isDownloaded } from '@/core/downloads'
import { notify } from '@/core/plugin/manager'
import { setBackGuard } from '@/core/native/backGuard'
import {
  cancelPlayerMorph,
  isCollapseMorphPending,
  playPlayerMorph,
  startPlayerMorph
} from '@/core/ui/playerMorph'

const router = useRouter()
const route = useRoute()
const track = computed(() => currentTrack())
const playerArt = ref<HTMLElement>()
const lyricsBox = ref<HTMLElement>()
const lyricFollowing = ref(true)
const showQueue = ref(false)
const showLyrics = ref(false)
watch(showLyrics, value => { themeBackgroundScene.value = value ? 'lyrics' : 'player' }, { immediate: true })
/** 全屏歌词页的控件是否可见：进入即隐藏，点按/滑动再唤出。 */
const lyricUi = ref(true)
let lyricUiTimer: ReturnType<typeof setTimeout> | undefined
const showQuality = ref(false)
const playlistTrack = ref<Track | null>(null)
function addCurrentToPlaylist(): void {
  if (!track.value) return
  playlistTrack.value = track.value
}
const queueFilter = ref<'next' | 'played' | 'all'>('next')

const activeLineCharCount = computed(() => {
  const index = playerState.activeLyric
  const line = index >= 0 ? playerState.lyrics[index] : undefined
  if (!line) return 0
  // 逐字时间可用时按词推进，否则按整行线性补间；偏移与 updateActiveLyric 保持一致。
  const now = playerState.currentTime * 1000 - (Number(settingsState.lyricOffsetMs) || 0)
  return sungCharCount(line, now)
})

function lyricChars(text: string): string[] {
  return Array.from(text || '♪')
}

const showSettings = ref(false)
const dragging = ref(false)
const dragValue = ref(0)
const now = ref(Date.now())
const sleepMinutes = ref(0)
let sleepPoll: ReturnType<typeof setInterval> | null = null
let swipeStart: { x: number; y: number; time: number } | null = null

const speedOptions = [0.75, 1, 1.25, 1.5, 2]
const lyricScales = [
  { value: 0.9, label: '小' },
  { value: 1, label: '标准' },
  { value: 1.12, label: '大' },
  { value: 1.25, label: '特大' }
]
// 正负两秒可选：音源歌词和音频版本不一致时经常差到一两秒，±500ms 不够用。
const offsets = [-2000, -1000, -500, 0, 500, 1000, 2000]

const sleepLabel = computed(() => {
  if (playerState.sleepAtTrackEnd) return '播完当前歌曲后停止'
  if (playerState.sleepEndAt > now.value) {
    const total = Math.max(0, Math.round((playerState.sleepEndAt - now.value) / 1000))
    const minutes = Math.floor(total / 60)
    const seconds = total % 60
    return `剩余 ${minutes}:${String(seconds).padStart(2, '0')}`
  }
  return '未设置'
})

const sleepShort = computed(() => {
  if (playerState.sleepAtTrackEnd) return '播完停'
  if (playerState.sleepEndAt > now.value) {
    const total = Math.max(0, Math.round((playerState.sleepEndAt - now.value) / 1000))
    const minutes = Math.floor(total / 60)
    return `${minutes} 分`
  }
  return '定时'
})

function openSettings(): void {
  showSettings.value = true
  now.value = Date.now()
  if (sleepPoll) clearInterval(sleepPoll)
  sleepPoll = setInterval(() => {
    now.value = Date.now()
  }, 1000)
}

function closeSettings(): void {
  showSettings.value = false
  if (sleepPoll) {
    clearInterval(sleepPoll)
    sleepPoll = null
  }
}

function chooseSleep(minutes: number): void {
  sleepMinutes.value = minutes
  setSleepTimer(minutes)
  now.value = Date.now()
}

function sleepAtEnd(): void {
  sleepMinutes.value = 0
  sleepAfterCurrentTrack()
}

function stopSleep(): void {
  sleepMinutes.value = 0
  cancelSleepTimer()
}

function downloadCurrent(): void {
  if (!track.value) return
  if (isDownloaded(track.value)) {
    closeSettings()
    notify('这首歌已经下载好了')
    return
  }
  downloadTrack(track.value)
  closeSettings()
  notify('已加入下载队列')
}

function lyricSeek(line: { startTimeMs: number }): void {
  lyricFollowing.value = true
  seek((line.startTimeMs + (Number(settingsState.lyricOffsetMs) || 0)) / 1000)
}

function offsetLabel(value: number): string {
  if (!value) return '0s'
  return `${value > 0 ? '+' : ''}${(value / 1000).toFixed(1)}s`
}

function chooseOffset(value: number): void {
  updateSettings({ lyricOffsetMs: value })
  updateActiveLyric()
  // 共享出去的系统歌词/灵动岛歌词也要跟着平移，否则会和播放页对不上。
  refreshBackgroundLyrics()
}

function cycleOffset(direction = 1): void {
  const index = offsets.indexOf(Number(settingsState.lyricOffsetMs) || 0)
  const base = index < 0 ? offsets.indexOf(0) : index
  const nextIndex = (base + direction + offsets.length) % offsets.length
  chooseOffset(offsets[nextIndex])
}

function cycleScale(): void {
  const index = lyricScales.findIndex((item) => item.value === settingsState.lyricScale)
  const next = lyricScales[(index + 1) % lyricScales.length]
  updateSettings({ lyricScale: next.value })
}

const progress = computed(() => {
  const duration = playerState.duration || (track.value?.durationMs ?? 0) / 1000
  if (!duration) return 0
  const value = dragging.value ? dragValue.value : playerState.currentTime
  return Math.min(100, Math.max(0, (value / duration) * 100))
})

const displayTime = computed(() => (dragging.value ? dragValue.value : playerState.currentTime))

const totalTime = computed(
  () => playerState.duration || (track.value?.durationMs ?? 0) / 1000
)

const modeIcon = computed(() => {
  if (playerState.mode === 'repeat-one') return 'repeat-one'
  if (playerState.mode === 'shuffle') return 'shuffle'
  if (playerState.mode === 'repeat-all') return 'repeat'
  return 'list'
})

const favorite = computed(() => (track.value ? isFavorite(track.value) : false))

const qualityShort = computed(() => {
  const quality = playerState.resolvedQuality || playerState.quality
  const label = !playerState.quality && quality && quality !== 'local' ? '自动 · ' + qualityLabel(quality) : qualityLabel(quality)
  return playerState.loading ? (quality ? `${label} · 解析中` : '解析中') : label
})

const scrollLabel = computed(() =>
  settingsState.showLyricTranslation ? '翻译已开启' : '翻译已关闭'
)

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00'
  const total = Math.floor(value)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function onSeekInput(event: Event): void {
  dragging.value = true
  dragValue.value = Number((event.target as HTMLInputElement).value)
}

function onSeekChange(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  dragging.value = false
  seek(value)
}

function close(): void {
  if (playerArt.value) {
    startPlayerMorph(
      playerArt.value.getBoundingClientRect(),
      track.value?.artwork || '/default-cover.png',
      'collapse'
    )
  }
  if (window.history.length > 1) router.back()
  else router.replace('/')
}

function retry(): void {
  if (!track.value) return
  const queue = playerState.queue.length ? playerState.queue : [track.value]
  void playTracks(queue, playerState.queue.length ? playerState.index : 0)
}

function openLyrics(): void {
  showLyrics.value = true
  lyricFollowing.value = true
  // 进来先看一眼控件，随后自动沉下去，只留歌词。
  lyricUi.value = true
  if (lyricUiTimer) clearTimeout(lyricUiTimer)
  lyricUiTimer = setTimeout(putLyricsToSleep, 1600)
  setStatusBarVisible(true)
  setTimeout(scrollActiveLyric, 120)
}

function setStatusBarVisible(visible: boolean): void {
  if (!Capacitor.isNativePlatform()) return
  void (visible ? StatusBar.show() : StatusBar.hide()).catch(() => undefined)
}

/** 隐藏顶部/底部控件和状态栏，只留歌词。 */
function putLyricsToSleep(): void {
  if (!showLyrics.value || showQueue.value || showQuality.value || showSettings.value || playlistTrack.value) return
  lyricUi.value = false
  setStatusBarVisible(false)
}

/** 任何触摸/滚动都把控件叫回来，停手 3.2 秒后再沉下去。 */
function pokeLyrics(): void {
  if (!showLyrics.value) return
  lyricUi.value = true
  setStatusBarVisible(true)
  if (lyricUiTimer) clearTimeout(lyricUiTimer)
  lyricUiTimer = setTimeout(putLyricsToSleep, 3200)
}

function closeLyrics(): void {
  if (lyricUiTimer) clearTimeout(lyricUiTimer)
  showLyrics.value = false
  lyricUi.value = true
  setStatusBarVisible(true)
}

/** 控件藏起来时，第一次点歌词只负责唤出控件，避免误触跳转。 */
function onLyricLineTap(line: { startTimeMs: number }): void {
  if (!lyricUi.value) {
    pokeLyrics()
    return
  }
  lyricSeek(line)
}

function onTouchStart(event: TouchEvent): void {
  swipeStart = null
  if (!settingsState.swipePlayer || event.touches.length !== 1) return
  const target = event.target as HTMLElement
  if (target.closest('input, button:not(.p-art), .sheet-mask, .ly')) return
  swipeStart = {
    x: event.touches[0].clientX,
    y: event.touches[0].clientY,
    time: Date.now()
  }
}

function onTouchEnd(event: TouchEvent): void {
  if (!swipeStart) return
  const start = swipeStart
  swipeStart = null
  if (!settingsState.swipePlayer || event.changedTouches.length !== 1) return
  if (Date.now() - start.time > 900) return
  const dx = event.changedTouches[0].clientX - start.x
  const dy = event.changedTouches[0].clientY - start.y
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.4) return
  // A cover swipe changes songs; suppress its synthetic click instead of opening lyrics.
  if ((event.target as HTMLElement).closest('.p-art')) event.preventDefault()
  if (dx > 0) void previous()
  else void next()
}

function playQueue(index: number): void {
  showQueue.value = false
  void playTracks(playerState.queue, index)
}

const queueRows = computed(() =>
  playerState.queue
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => {
      if (queueFilter.value === 'next') return index >= playerState.index
      if (queueFilter.value === 'played') return index < playerState.index
      return true
    })
)

const queueRemaining = computed(() => {
  const list = playerState.queue.slice(playerState.index)
  const seconds = list.reduce((sum, item) => sum + (item.durationMs || 0) / 1000, 0)
  const minutes = Math.round(seconds / 60)
  return minutes > 0 ? `剩余约 ${minutes} 分钟` : `共 ${list.length} 首`
})

// 固定前后槽位，首尾留空，当前句不会因邻句不足而偏离窗口中心。
const lyricPreview = computed(() => [-2, -1, 0, 1, 2].map(offset => ({
  offset,
  line: playerState.lyrics[playerState.activeLyric + offset]
})))

function scrollActiveLyric(): void {
  const box = lyricsBox.value
  if (!box || !lyricFollowing.value) return
  void nextTick(() => {
    const active = box.querySelector<HTMLElement>('.ly-line.cur')
    if (!active) return
    // 只滚动歌词容器本身：scrollIntoView 会连带滚动祖先，导致整页跳动
    const top = active.offsetTop - box.clientHeight / 2 + active.offsetHeight / 2
    box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  })
}

function browseLyrics(): void {
  lyricFollowing.value = false
  pokeLyrics()
}

function resumeLyricFollow(): void {
  lyricFollowing.value = true
  pokeLyrics()
  scrollActiveLyric()
}

watch(() => playerState.activeLyric, scrollActiveLyric)
watch(track, (value) => {
  lyricFollowing.value = true
  if (!value) {
    closeLyrics()
    showQueue.value = false
    void router.replace('/')
  }
})
watch(() => [showQueue.value, showQuality.value, showSettings.value, playlistTrack.value], () => {
  if (showQueue.value || showQuality.value || showSettings.value || playlistTrack.value) cancelPlayerMorph()
  if (showLyrics.value) pokeLyrics()
})
watch(() => route.query.panel, (panel) => {
  if (panel !== 'queue') return
  showQueue.value = true
  const query = { ...route.query }
  delete query.panel
  void router.replace({ path: route.path, query, hash: route.hash })
}, { immediate: true })

onMounted(() => {
  if (!track.value) {
    cancelPlayerMorph()
    router.replace('/')
    return
  }
  setTimeout(scrollActiveLyric, 300)
  // 返回键先收歌词浮层，再交给 App.vue 处理路由/退出。
  setBackGuard(() => {
    if (playlistTrack.value) {
      playlistTrack.value = null
      return true
    }
    if (showLyrics.value) {
      closeLyrics()
      return true
    }
    close()
    return true
  })
  if (showQueue.value) cancelPlayerMorph()
  else if (playerArt.value) void playPlayerMorph(playerArt.value)
})

onBeforeUnmount(() => {
  if (!isCollapseMorphPending()) cancelPlayerMorph()
})

onUnmounted(() => {
  themeBackgroundScene.value = 'main'
  if (sleepPoll) {
    clearInterval(sleepPoll)
    sleepPoll = null
  }
  if (lyricUiTimer) {
    clearTimeout(lyricUiTimer)
    lyricUiTimer = undefined
  }
  setBackGuard(null)
  setStatusBarVisible(true)
})
</script>

<template>
  <div
    v-if="track"
    class="screen dark player"
    :class="{ 'q-open': showQueue }"
    @touchstart.passive="onTouchStart"
    @touchend="onTouchEnd"
  >
    <div class="p-bg">
      <img :src="track.artwork || '/default-cover.png'" alt="" />
      <div class="p-veil" />
    </div>

    <header class="p-top">
      <button class="iconbtn glass" aria-label="收起" @click="close">
        <Icon name="chevron-down" :size="20" />
      </button>
      <div class="p-head">
        <span class="p-head-k">正在播放</span>
        <span class="p-head-s truncate">{{ track.providerName || '本地文件' }} · {{ qualityShort }}</span>
      </div>
      <button class="iconbtn glass" aria-label="播放设置" @click="openSettings">
        <Icon name="more" :size="20" />
      </button>
    </header>

    <nav class="p-tabs" aria-label="播放视图">
      <button class="active" aria-pressed="true">歌曲</button>
      <button aria-pressed="false" @click="openLyrics">歌词</button>
    </nav>

    <div class="p-main">
      <div class="p-core">
        <button ref="playerArt" class="p-art" type="button" aria-label="点击封面打开完整歌词" @click="openLyrics">
          <span class="p-record" :class="{ playing: playerState.playing && !playerState.loading }">
          <TrackArtwork :track="track" :eager="true" :alt="track.title + '的封面'" />
          </span>
        </button>

        <div class="p-meta">
          <div class="p-song-info">
            <h1 class="p-title" :title="track.title">{{ track.title }}</h1>
            <p class="p-artist truncate" :title="[track.artist, track.album].filter(Boolean).join(' · ')">
              {{ track.artist }}<template v-if="track.album"> · {{ track.album }}</template>
            </p>
          </div>
          <button class="p-aux p-favorite" :class="{ on: favorite }" :aria-label="favorite ? '取消喜欢' : '喜欢歌曲'" :aria-pressed="favorite" @click="toggleFavorite(track)">
            <Icon :name="favorite ? 'heart-filled' : 'heart'" :size="24" />
          </button>
          <div v-if="playerState.error" class="p-error" role="status">
            <Icon name="warning" :size="16" />
            <span class="f1">{{ playerState.error }}</span>
            <button class="p-error-btn" @click="retry">重试</button>
          </div>
        </div>

        <button v-if="settingsState.showLyrics" class="p-lyric" aria-label="打开完整歌词" @click="openLyrics">
          <span v-if="playerState.lyrics.length" class="p-lyric-body">
            <span class="p-lyric-stack">
              <span v-for="item in lyricPreview" :key="item.offset" class="p-lyric-line" :class="{ 'focus-slot': item.offset === 0, cur: item.offset === 0 && !!item.line, past: item.offset < 0 }" :data-offset="item.offset">
                <span v-if="item.offset === 0" class="p-lyric-cur" :class="{ dim: !item.line }">
                  <span v-for="(ch, index) in lyricChars(item.line?.text || '♪')" :key="index" class="pl-char" :class="{ on: index < activeLineCharCount }">{{ ch }}</span>
                </span>
                <span v-else class="p-lyric-context">{{ item.line?.text || '' }}</span>
              </span>
            </span>
          </span>
          <span v-else class="p-lyric-empty">{{ playerState.lyricsLoading ? '正在加载歌词…' : '暂无歌词 · 点击匹配' }}</span>
        </button>

        <div class="p-tools">
          <button class="p-tool p-quality-button" :aria-expanded="showQuality" @click="showQuality = true">
            <Icon name="headphone" :size="19" /><span>{{ qualityShort }}</span>
          </button>
          <button class="p-tool" :aria-label="isDownloaded(track) ? '歌曲已下载' : '下载歌曲'" @click="downloadCurrent">
            <Icon :name="isDownloaded(track) ? 'check' : 'download'" :size="21" />
          </button>
          <button class="p-tool" :class="{ on: sleepShort !== '定时' }" :aria-label="'定时停止：' + sleepShort" @click="openSettings">
            <Icon name="timer" :size="21" /><span v-if="sleepShort !== '定时'">{{ sleepShort }}</span>
          </button>
          <button class="p-tool" aria-label="加入歌单" @click="addCurrentToPlaylist"><Icon name="folder" :size="21" /><span>歌单</span></button>
        </div>

        <div class="p-seek">
          <input class="p-range" type="range" min="0" :max="totalTime" step="0.1" :value="displayTime" :style="{ '--p': progress + '%' }" aria-label="播放进度" @input="onSeekInput" @change="onSeekChange" />
          <div class="p-times num"><span>{{ formatTime(displayTime) }}</span><span>{{ formatTime(totalTime) }}</span></div>
        </div>

        <div class="p-ctrl">
          <button class="p-aux" :aria-label="'播放模式 ' + playerState.mode" @click="cycleMode"><Icon :name="modeIcon" :size="22" /></button>
          <button class="p-skip" aria-label="上一首" @click="previous"><Icon name="prev" :size="27" /></button>
          <button class="p-play" aria-label="播放或暂停" :aria-busy="playerState.loading" @click="togglePlay">
            <span v-if="playerState.loading" class="p-spin" />
            <Icon v-else :name="playerState.playing ? 'pause' : 'play'" :size="28" />
          </button>
          <button class="p-skip" aria-label="下一首" @click="next"><Icon name="next" :size="27" /></button>
          <button class="p-aux" aria-label="播放队列" :aria-expanded="showQueue" @click="showQueue = true"><Icon name="queue" :size="24" /></button>
        </div>
      </div>
    </div>

    <!-- 音质不再展开挤走主播放控制；仍使用原有 setQuality 与实际可选档位。 -->
    <Teleport to="body"><transition name="sheet-pop">
      <SongActionsSheet v-if="playlistTrack" :track="playlistTrack" initial-view="playlist" @close="playlistTrack = null" />
    </transition></Teleport>

    <transition name="sheet-pop">
      <div v-if="showQuality" class="sheet-mask" @click.self="showQuality = false">
        <div class="scrim" @click="showQuality = false" />
        <section class="sheet p-quality-sheet" role="dialog" aria-modal="true" aria-label="选择音质" @keydown.esc="showQuality = false">
        <div class="grab" />
        <div class="sh-head"><div class="sh-title">音质</div><button class="iconbtn quiet" aria-label="关闭音质" @click="showQuality = false"><Icon name="close" :size="20" /></button></div>
        <div class="p-quality">
          <button class="chip" :class="{ active: playerState.quality === '' }" @click="setQuality('')">自动</button>
          <button v-for="quality in track.qualities" :key="quality" class="chip" :class="{ active: playerState.quality === quality }" @click="setQuality(quality)">{{ qualityLabel(quality) }}</button>
        </div>
        <p class="p-quality-note">{{ playerState.resolvedQuality ? '当前解析：' + qualityLabel(playerState.resolvedQuality) : '播放时按当前音源提供的音质解析' }}</p>
        </section>
      </div>
    </transition>

    <!-- 全屏歌词 -->
    <div
      v-if="showLyrics"
      class="ly"
      :class="{ 'ly-idle': !lyricUi }"
      @click="pokeLyrics"
      @touchmove.passive="pokeLyrics"
      @wheel.passive="pokeLyrics"
    >
      <div class="ly-bg">
        <img :src="track.artwork || '/default-cover.png'" alt="" />
        <div class="ly-veil" />
      </div>
      <header class="p-top ly-top">
        <button class="iconbtn glass" aria-label="收起歌词" @click.stop="closeLyrics">
          <Icon name="chevron-down" :size="20" />
        </button>
        <div class="p-head">
            <span class="p-head-k">正在播放</span>
            <span class="p-head-s truncate">{{ track.title }} · {{ track.artist }}</span>
        </div>
        <div class="row g6">
          <button class="iconbtn glass" aria-label="歌词偏移" @click="cycleOffset(1)">
            <Icon name="swap" :size="18" />
          </button>
          <button class="iconbtn glass" aria-label="歌词字号" @click="cycleScale">
            <Icon name="size" :size="18" />
          </button>
        </div>
      </header>

      <nav class="p-tabs ly-tabs" aria-label="播放视图">
        <button aria-pressed="false" @click.stop="closeLyrics">歌曲</button>
        <button class="active" aria-pressed="true" @click.stop="pokeLyrics">歌词</button>
      </nav>
      <div
        ref="lyricsBox"
        class="ly-box"
        :style="{ '--ly-scale': settingsState.lyricScale }"
        @touchmove.passive="browseLyrics"
        @wheel.passive="browseLyrics"
      >
        <template v-if="playerState.lyrics.length">
          <p
            v-for="(line, index) in playerState.lyrics"
            :key="index"
            class="ly-line"
            :class="{
              cur: index === playerState.activeLyric,
              near: Math.abs(index - playerState.activeLyric) <= 3,
              passed: index < playerState.activeLyric
            }"
            @click.stop="onLyricLineTap(line)"
          >
            <template v-if="index === playerState.activeLyric">
              <span
                v-for="(char, charIndex) in lyricChars(line.text)"
                :key="charIndex"
                class="ly-char"
                :class="{ on: charIndex < activeLineCharCount }"
              >{{ char }}</span>
            </template>
            <template v-else>{{ line.text || '♪' }}</template>
            <span
              v-if="line.translation && settingsState.showLyricTranslation"
              class="ly-tr"
            >{{ line.translation }}</span>
          </p>
        </template>
        <div v-else class="ly-empty">
          <div class="p-head-k">{{ playerState.lyricsLoading ? '正在加载歌词…' : '暂无歌词' }}</div>
          <p class="meta mt8">可以从音源重新匹配，或换一个歌词更全的版本。</p>
          <button
            v-if="!playerState.lyricsLoading"
            class="btn btn-tint btn-sm mt16"
            @click="matchLyricsOnline()"
          >
            <Icon name="search" :size="15" /> 在线匹配歌词
          </button>
        </div>
      </div>

      <footer class="ly-foot">
        <button v-if="!lyricFollowing" class="ly-follow" @click.stop="resumeLyricFollow">回到当前歌词</button>
        <div class="p-seek tight">
          <input
            class="p-range"
            type="range"
            min="0"
            :max="playerState.duration || (track.durationMs ? track.durationMs / 1000 : 0)"
            step="0.1"
            :value="displayTime"
            :style="{ '--p': progress + '%' }"
            aria-label="播放进度"
            @input="onSeekInput"
            @change="onSeekChange"
          />
          <div class="p-times num">
            <span>{{ formatTime(displayTime) }}</span>
            <span>{{ formatTime(totalTime) }}</span>
          </div>
        </div>
        <div class="ly-ctrl">
          <button class="p-aux" aria-label="播放模式" @click="cycleMode">
            <Icon :name="modeIcon" :size="18" />
          </button>
          <button class="p-skip" aria-label="上一首" @click="previous">
            <Icon name="prev" :size="22" />
          </button>
          <button class="p-play sm" aria-label="播放或暂停" @click="togglePlay">
            <span v-if="playerState.loading" class="p-spin" />
            <Icon v-else :name="playerState.playing ? 'pause' : 'play'" :size="24" />
          </button>
          <button class="p-skip" aria-label="下一首" @click="next">
            <Icon name="next" :size="22" />
          </button>
          <button class="p-aux" aria-label="播放队列" @click="showQueue = true">
            <Icon name="queue" :size="22" />
          </button>
        </div>
        <div class="ly-tools">
          <button :aria-label="scrollLabel" :aria-pressed="settingsState.showLyricTranslation" @click="updateSettings({ showLyricTranslation: !settingsState.showLyricTranslation })">译</button>
          <button :aria-label="favorite ? '取消喜欢' : '喜欢歌曲'" :aria-pressed="favorite" @click="toggleFavorite(track)"><Icon :name="favorite ? 'heart-filled' : 'heart'" :size="20" /></button>
          <span>偏移 {{ offsetLabel(Number(settingsState.lyricOffsetMs) || 0) }}</span>
          <button aria-label="歌词与播放设置" @click="openSettings"><Icon name="more" :size="22" /></button>
        </div>
      </footer>
    </div>

    <!-- 播放队列 -->
    <transition name="sheet-pop">
      <div v-if="showQueue" class="sheet-mask q-mask" @click.self="showQueue = false">
        <div class="scrim" @click="showQueue = false" />
        <div class="sheet q-sheet" role="dialog" aria-modal="true" aria-label="播放队列" @keydown.esc="showQueue = false">
        <div class="grab" />
        <div class="sh-head">
          <div>
            <div class="sh-title">播放队列</div>
            <div class="meta">{{ playerState.queue.length }} 首 · {{ queueRemaining }}</div>
          </div>
          <div class="row g6">
            <button class="iconbtn quiet" aria-label="队列播放或暂停" @click="togglePlay"><span v-if="playerState.loading" class="p-spin" /><Icon v-else :name="playerState.playing ? 'pause' : 'play'" :size="22" /></button>
            <button class="iconbtn quiet" aria-label="关闭队列" @click="showQueue = false"><Icon name="close" :size="20" /></button>
          </div>
        </div>

        <div class="chip-row q-chips">
          <button class="chip" :class="{ active: queueFilter === 'next' }" @click="queueFilter = 'next'">
            接下来 {{ Math.max(0, playerState.queue.length - playerState.index) }}
          </button>
          <button class="chip" :class="{ active: queueFilter === 'played' }" @click="queueFilter = 'played'">
            已播 {{ playerState.index }}
          </button>
          <button class="chip" :class="{ active: queueFilter === 'all' }" @click="queueFilter = 'all'">
            全部 {{ playerState.queue.length }}
          </button>
        </div>

        <div class="q-list">
          <div
            v-for="row in queueRows"
            :key="row.item.providerId + row.item.id + row.index"
            class="q-row"
            :class="{ cur: row.index === playerState.index }"
          >
            <button class="q-track"
            :aria-label="'播放 ' + row.item.title + ' - ' + row.item.artist"
            @click="playQueue(row.index)"
            >
            <span class="q-idx num">
              <span v-if="row.index === playerState.index" class="wave"><i /><i /><i /><i /></span>
              <template v-else>{{ String(row.index + 1).padStart(2, '0') }}</template>
            </span>
            <div class="cover">
              <img
                :src="row.item.artwork || '/default-cover.png'"
                alt=""
                @error="($event.target as HTMLImageElement).src = '/default-cover.png'"
              />
            </div>
            <div class="q-info">
              <div class="q-t truncate">{{ row.item.title }}</div>
              <div class="q-a truncate">{{ row.item.artist }}</div>
            </div>
            <span class="q-dur num">{{ formatTime((row.item.durationMs || 0) / 1000) }}</span>
            </button>
            <button class="iconbtn quiet q-del" aria-label="移出队列" @click.stop="removeFromQueue(row.index)">
              <Icon name="close" :size="15" />
            </button>
          </div>
          <div v-if="!queueRows.length" class="empty tight">
            <div class="glyph"><Icon name="queue" :size="28" /></div>
            <p>{{ queueFilter === 'next' ? '队列里没有下一首了' : '这一栏还是空的' }}</p>
          </div>
        </div>
        </div>
      </div>
    </transition>

    <!-- 播放设置 -->
    <transition name="sheet-pop">
      <div v-if="showSettings" class="sheet-mask" @click.self="closeSettings">
        <div class="scrim" @click="closeSettings" />
        <div class="sheet ps" role="dialog" aria-modal="true" aria-label="播放设置" @keydown.esc="closeSettings">
        <div class="grab" />
        <div class="sh-head">
          <div>
            <div class="sh-title">播放设置</div>
            <div class="meta">{{ sourceLabel(track) }} · {{ qualityShort }}</div>
          </div>
          <button class="iconbtn quiet" aria-label="关闭" @click="closeSettings">
            <Icon name="close" :size="18" />
          </button>
        </div>

        <div class="ps-body">
        <div class="ps-label">播放速度</div>
        <div class="chip-row wrap">
          <button
            v-for="rate in speedOptions"
            :key="rate"
            class="chip"
            :class="{ active: settingsState.playbackRate === rate }"
            @click="updateSettings({ playbackRate: rate })"
          >
            {{ rate }}x
          </button>
        </div>

        <div class="ps-label">歌词字号</div>
        <p v-if="playerState.lyricSource" class="ps-hint">歌词来源：{{ playerState.lyricSource }}</p>
        <div class="chip-row wrap">
          <button
            v-for="scale in lyricScales"
            :key="scale.value"
            class="chip"
            :class="{ active: settingsState.lyricScale === scale.value }"
            @click="updateSettings({ lyricScale: scale.value })"
          >
            {{ scale.label }}
          </button>
        </div>

        <div class="ps-label">歌词偏移</div>
        <div class="chip-row wrap">
          <button
            v-for="value in offsets"
            :key="value"
            class="chip"
            :class="{ active: Number(settingsState.lyricOffsetMs) === value }"
            @click="chooseOffset(value)"
          >
            {{ offsetLabel(value) }}
          </button>
        </div>
        <p class="ps-hint">正值表示歌词延后显示；点击歌词跳转时会按偏移量校正。</p>

        <div class="ps-row">
          <div class="f1">
            <div class="ps-row-t">显示翻译</div>
            <div class="ps-row-s">在歌词下方显示翻译</div>
          </div>
          <button
            class="switch"
            :class="{ on: settingsState.showLyricTranslation }"
            aria-label="显示翻译"
            role="switch"
            :aria-checked="settingsState.showLyricTranslation"
            @click="updateSettings({ showLyricTranslation: !settingsState.showLyricTranslation })"
          />
        </div>

        <div class="ps-label">定时停止</div>
        <div class="chip-row wrap">
          <button
            class="chip"
            :class="{ active: !playerState.sleepEndAt && !playerState.sleepAtTrackEnd }"
            @click="stopSleep"
          >
            关闭
          </button>
          <button
            v-for="minutes in [15, 30, 60]"
            :key="minutes"
            class="chip"
            :class="{ active: sleepMinutes === minutes && playerState.sleepEndAt > 0 }"
            @click="chooseSleep(minutes)"
          >
            {{ minutes }} 分钟
          </button>
          <button class="chip" :class="{ active: playerState.sleepAtTrackEnd }" @click="sleepAtEnd">
            播完当前歌
          </button>
        </div>
        <p class="ps-hint">{{ sleepLabel }}</p>
        </div>

        <div class="ps-foot">
          <button class="btn btn-primary btn-block" @click="downloadCurrent">
            <Icon name="download" :size="17" /> 下载当前歌曲
          </button>
        </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.player { background: #192d48; color: #f6f9ff; overflow: hidden; }
.p-bg, .ly-bg { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.p-bg img, .ly-bg img { position: absolute; width: 100%; height: 100%; object-fit: cover; filter: blur(48px) saturate(.8); transform: scale(1.25); opacity: .65; }
.p-veil, .ly-veil { position: absolute; inset: 0; background: linear-gradient(180deg, #10182155, #10182180 55%, #0b121dcc); }
.p-top { position: relative; z-index: 3; display: grid; grid-template-columns: 88px minmax(0, 1fr) 88px; align-items: center; gap: 0; flex: none; padding: calc(var(--safe-top) + 6px) 18px 0; }
.p-top > .iconbtn:first-child { justify-self: start; }
.p-top > .iconbtn:last-child, .p-top > .row { justify-self: end; }
.p-top .iconbtn { width: 44px; height: 44px; color: #f0f5ff; border: 0; background: transparent; box-shadow: none; }
.p-head { min-width: 0; min-height: 44px; display: flex; flex-direction: column; justify-content: center; gap: 3px; text-align: center; padding-top: 1px; }
.p-head-k { font-size: 14px; font-weight: 600; color: #f1f6ff; }
.p-head-s { font-size: 12px; color: #c0d0e7; }
.p-tabs { position: relative; z-index: 2; flex: none; display: flex; justify-content: center; gap: 26px; min-height: 44px; }
.p-tabs button { position: relative; min-width: 44px; min-height: 44px; text-align: center; font-size: 14px; color: #b5c6df; }
.p-tabs button.active { color: #fff; font-weight: 650; }
.p-tabs button.active::after { content: ''; position: absolute; bottom: 5px; left: calc(50% - 8px); width: 16px; height: 2px; border-radius: 2px; background: #dbe8fb; }
.p-main { position: relative; z-index: 2; flex: 1; min-height: 0; padding: 8px 28px calc(12px + var(--safe-bottom)); overflow-y: auto; scrollbar-width: none; }
.p-core { display: grid; grid-template-rows: minmax(130px, 332px) auto minmax(44px, 1fr) auto auto auto; gap: 9px; height: 100%; min-height: 460px; }
.p-art { grid-row: 1; position: relative; display: block; height: calc(100% - 12px); max-height: 320px; width: auto; max-width: 100%; aspect-ratio: 1; justify-self: center; align-self: start; margin-top: 12px; border-radius: 50%; overflow: hidden; touch-action: pan-y; box-shadow: 0 16px 38px #0005, 0 0 0 1px #ffffff20; }
.p-record { display: block; width: 100%; height: 100%; padding: 8%; border-radius: inherit; background: repeating-radial-gradient(circle, #292b30 0 1px, #17191d 2px 4px); animation: record-turn 28s linear infinite; animation-play-state: paused; }
.p-record.playing { animation-play-state: running; }
.p-art img { display: block; width: 100%; height: 100%; object-fit: cover; border-radius: 50%; box-shadow: 0 0 0 1px #ffffff30; }
@keyframes record-turn { to { transform: rotate(360deg); } }
.p-meta { grid-row: 2; display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; align-items: center; column-gap: 10px; padding-top: 6px; min-width: 0; }
.p-song-info { grid-column: 2; min-width: 0; text-align: center; }
.p-title { margin: 0; color: #fff; font-family: var(--sans); font-size: 23px; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.p-artist { margin: 6px 0 0; font-size: 13px; color: #ccd8eb; line-height: 1.5; }
.p-favorite { grid-column: 3; }
.p-error { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 4px 8px; background: #713e4855; border: 1px solid #eea4a955; border-radius: 8px; color: #ffe2e3; font-size: 12px; overflow-wrap: anywhere; }
.p-error-btn { flex: none; min-width: 44px; min-height: 44px; color: #fff; font-weight: 600; }
.p-lyric { grid-row: 3; position: relative; display: flex; align-items: center; justify-content: center; width: 100%; min-width: 0; min-height: 0; overflow: hidden; text-align: center; cursor: pointer; color: #cad8ed; }
.p-lyric-body { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; -webkit-mask-image: linear-gradient(180deg, transparent, #000 18%, #000 82%, transparent); mask-image: linear-gradient(180deg, transparent, #000 18%, #000 82%, transparent); }
.p-lyric-stack { display: flex; flex: none; flex-direction: column; gap: 4px; width: 100%; }
.p-lyric-line { display: flex; flex: none; align-items: center; justify-content: center; height: 32px; min-width: 0; color: #b2c2d8; }
.p-lyric-line.focus-slot { height: 48px; }
.p-lyric-line.past { color: #96aac4; }
.p-lyric-context { display: block; width: 100%; font-family: var(--lyric-font, var(--sans)); font-size: 13px; line-height: 24px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.p-lyric-cur { display: -webkit-box; width: 100%; font-family: var(--lyric-font, var(--sans)); font-size: 17px; line-height: 24px; max-height: 48px; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
.p-lyric-empty { font-size: 13px; line-height: 24px; color: #b7c8df; }
.pl-char { color: #c4d0e0; transition: color .16s linear; }
.pl-char.on { color: #fff; }
.p-tools { grid-row: 6; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.p-tool { display: flex; align-items: center; justify-content: center; gap: 5px; min-width: 44px; min-height: 44px; font-size: 12px; color: #ccdaed; }
.p-quality-button { justify-content: flex-start; max-width: 46%; }
.p-quality-button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.p-tool.on, .p-aux.on { color: #79e2bd; }
.p-seek { grid-row: 4; align-self: end; min-width: 0; }
.p-range { -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 24px; margin: 0; background: transparent; cursor: pointer; }
.p-range::-webkit-slider-runnable-track { height: 3px; border-radius: 3px; background: linear-gradient(90deg, #dbe8fb var(--p, 0%), #ffffff30 var(--p, 0%)); }
.p-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 9px; height: 9px; margin-top: -3px; border-radius: 50%; background: #edf5ff; }
.p-range::-moz-range-track { height: 3px; border-radius: 3px; background: #ffffff30; }
.p-range::-moz-range-progress { height: 3px; background: #dbe8fb; }
.p-range::-moz-range-thumb { width: 9px; height: 9px; border: 0; border-radius: 50%; background: #edf5ff; }
.p-times { display: flex; justify-content: space-between; font-size: 11px; color: #c1d0e6; line-height: 16px; }
.p-ctrl, .ly-ctrl { grid-row: 5; display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.p-aux, .p-skip, .p-play { display: grid; place-items: center; flex: none; color: #e9f1ff; border-radius: 50%; }
.p-aux, .p-skip { width: 44px; height: 44px; }
.p-play, .ly-ctrl .p-play.sm { width: 64px; height: 64px; border: 2px solid #edf5ff; background: transparent; color: #edf5ff; }
.p-play:active { transform: scale(.96); }
.p-aux:active, .p-skip:active, .p-tool:active { opacity: .65; }
.p-spin { width: 22px; height: 22px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: p-spin .8s linear infinite; }
@keyframes p-spin { to { transform: rotate(360deg); } }
.player button:focus-visible, .p-range:focus-visible, .ly-line:focus-visible { outline: 2px solid #9ac7ff; outline-offset: 3px; }
.p-quality { display: flex; gap: 8px; flex-wrap: wrap; padding: 2px 20px 12px; }
.p-quality-note { margin: 0; padding: 0 20px 12px; font-size: 12px; color: var(--ink-3); }

/* 歌词仍是独立层，自动跟随与手动浏览分开，不改播放器的歌词时间轴。 */
.ly { position: absolute; inset: 0; z-index: 20; display: flex; flex-direction: column; background: #192d48; }
.ly-top, .ly-tabs, .ly-foot { position: relative; z-index: 2; flex: none; }
.ly-top .row { gap: 0; }
.ly-top .p-head-s { max-width: 100%; }
.ly-box { position: relative; z-index: 2; flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; padding: 12vh 28px 34vh; scrollbar-width: none; -webkit-mask-image: linear-gradient(180deg, transparent, #000 8%, #000 91%, transparent); mask-image: linear-gradient(180deg, transparent, #000 8%, #000 91%, transparent); }
.ly-box::-webkit-scrollbar { display: none; }
.ly-line { position: relative; margin: 0; padding: 12px 0; font-family: var(--lyric-font, var(--sans)); font-size: calc(23px * var(--ly-scale, 1)); font-weight: 650; line-height: 1.55; color: #a4b8d5; overflow-wrap: anywhere; cursor: pointer; opacity: 0; filter: none; transition: color .25s ease, opacity .25s ease, filter .25s ease; }
.ly-line.near { opacity: .28; filter: blur(2.2px); }
.ly-line.near.passed { opacity: .18; }
.ly-line.cur { color: #fff; opacity: 1; filter: none; }
.ly-line.passed { color: #b6c6dc; }
.ly-char { color: #bfd0e8; transition: color .16s linear; }
.ly-char.on { color: #fff; text-shadow: 0 0 12px #ffffff20; }
.ly-tr { display: block; margin-top: 5px; font-family: var(--sans); font-weight: 400; font-size: calc(13px * var(--ly-scale, 1)); line-height: 1.55; color: #b9cce6; }
.ly-line.cur .ly-tr { color: #e3ecfa; }
.ly-empty { padding: 40px 0; text-align: center; }
.ly-empty .meta { color: #c5d4e8; }
.ly-foot { padding: 0 28px calc(10px + var(--safe-bottom)); }
.ly-ctrl { margin-top: 10px; }
.ly-tools { display: flex; align-items: center; justify-content: space-between; min-height: 44px; margin-top: 8px; color: #bbcee8; font-size: 12px; }
.ly-tools button { display: grid; place-items: center; min-width: 44px; min-height: 44px; color: #d5e3f7; font-size: 15px; }
.ly-tools button[aria-pressed="true"] { color: #fff; }
.ly-follow { position: absolute; right: 28px; top: -44px; min-height: 40px; padding: 0 14px; border-radius: 20px; background: #ecf4ff; color: #20395b; font-size: 12px; box-shadow: 0 2px 12px #0b1a3133; }
.ly-top, .ly-tabs, .ly-foot { transition: opacity .28s ease; }
.ly.ly-idle .ly-top, .ly.ly-idle .ly-tabs, .ly.ly-idle .ly-foot { opacity: 0; pointer-events: none; }

/* 白色半屏队列覆盖在原播放器上，不再复制一份模糊的当前歌曲。 */
.q-mask { flex-direction: column; justify-content: flex-end; align-items: center; background: transparent; -webkit-backdrop-filter: none; backdrop-filter: none; }
.q-mask .scrim { z-index: 0; background: #08152799; -webkit-backdrop-filter: none; backdrop-filter: none; }
.q-sheet { --surface: #fff; --ink: #171b22; --ink-2: #4c5661; --ink-3: #687481; --ink-4: #79838c; --line: #eef1f3; --line-2: #e5e9ec; --tint: #087b57; --tint-soft: #eefaf4; position: relative; z-index: 2; flex: none; height: min(64vh, 580px); height: min(64dvh, 580px); max-height: calc(100vh - var(--safe-top) - 24px); max-height: calc(100dvh - var(--safe-top) - 24px); display: flex; flex-direction: column; overflow: hidden; padding-bottom: calc(10px + var(--safe-bottom)); border-radius: 24px 24px 0 0; background: #fff; color: #171b22; }
.q-sheet .grab { background: #dbe1e1; }
.q-sheet .sh-head { flex: none; padding: 2px 20px 8px; }
.q-sheet .sh-title { font-family: var(--sans); font-size: 20px; font-weight: 650; }
.q-sheet .meta { margin-top: 3px; font-size: 12px; }
.q-sheet .iconbtn { flex: none; min-width: 44px; min-height: 44px; color: #66737b; }
.q-chips { flex: none; display: flex; gap: 8px; padding: 0 20px 8px; overflow-x: auto; }
.q-chips .chip { flex: 1; min-height: 44px; padding: 0 8px; color: #65717b; background: transparent; border: 0; border-radius: 8px; font-size: 12px; }
.q-chips .chip.active { color: #087b57; background: #eefaf4; }
.q-list { flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; padding: 0 12px 4px; }
.q-row { display: flex; align-items: center; gap: 10px; min-height: 64px; padding: 5px 4px; border-radius: 8px; cursor: pointer; }
.q-track { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; min-height: 54px; text-align: left; }
.q-track:focus-visible { outline: 2px solid #087b57; outline-offset: -2px; }
.q-row.cur { background: #f3fbf7; }
.q-idx { width: 20px; flex: none; text-align: center; color: #7c8790; font-size: 12px; }
.q-row.cur .q-idx { color: #0bb781; }
.q-row .cover { width: 38px; height: 38px; flex: none; border-radius: 6px; }
.q-info { flex: 1; min-width: 0; }
.q-t { font-size: 14px; color: #20272d; }
.q-row.cur .q-t { color: #087b57; }
.q-a { margin-top: 4px; font-size: 12px; color: #69757f; }
.q-dur { flex: none; font-size: 11px; color: #7b8791; }
.q-del { flex: none; width: 44px; height: 44px; }
.empty.tight { padding: 26px 0; }

/* 原有速度、歌词、定时与下载设置仍在同一个可滚动 Sheet 中。 */
.ps { display: flex; flex-direction: column; max-height: calc(100vh - var(--safe-top) - 20px); max-height: calc(100dvh - var(--safe-top) - 20px); overflow: hidden; padding-bottom: 0; }
.ps .sh-head { flex: none; }
.ps-body { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 6px; }
.ps-foot { flex: none; padding: 10px 20px calc(16px + var(--safe-bottom)); background: var(--surface); border-top: 1px solid var(--line-2); }
.ps-body > .ps-label, .ps-body > .ps-hint, .ps-body > .ps-row { margin-left: 20px; margin-right: 20px; }
.ps-body > .chip-row { padding: 0 20px; }
.ps-label { margin: 16px 0 8px; font-size: 14px; font-weight: 600; color: var(--ink-2); }
.chip-row.wrap { flex-wrap: wrap; overflow: visible; gap: 8px; }
.ps .chip, .p-quality .chip { min-height: 44px; }
.ps-hint { margin: 8px 2px 0; font-size: 12px; line-height: 1.6; color: var(--ink-3); }
.ps-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line); margin-top: 8px; }
.ps-row-t { font-size: 14px; color: var(--ink); }
.ps-row-s { margin-top: 3px; font-size: 12px; color: var(--ink-3); }
@media (max-height: 700px) {
  .p-top { padding-top: calc(var(--safe-top) + 2px); }
  .p-tabs { min-height: 44px; }
  .p-tabs button { min-height: 44px; }
  .p-main { padding-top: 6px; padding-bottom: calc(10px + var(--safe-bottom)); }
  .p-core { min-height: 430px; gap: 5px; }
  .p-meta { padding-top: 0; }
  .p-title { font-size: 23px; }
  .p-artist { margin-top: 4px; font-size: 12px; }
  .p-lyric-cur { font-size: 15px; max-height: 24px; -webkit-line-clamp: 1; }
  .p-play, .ly-ctrl .p-play.sm { width: 60px; height: 60px; }
  .ly-line { font-size: calc(21px * var(--ly-scale, 1)); padding: 8px 0; }
  .ly-foot { padding-bottom: calc(6px + var(--safe-bottom)); }
  .ly-tools { margin-top: 2px; }
  .q-sheet { height: 70vh; height: 70dvh; }
}
@media (max-width: 374px) {
  .p-main, .ly-foot { padding-left: 22px; padding-right: 22px; }
  .ly-box { padding-left: 24px; padding-right: 24px; }
  .ly-top { padding-left: 8px; padding-right: 8px; }
  .q-row { gap: 6px; }
  .q-track { gap: 6px; }
  .q-dur { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .player *, .player *::after { animation-duration: .01ms !important; transition: none !important; }
  .p-record { animation: none !important; }
}

@media (min-width: 768px) {
  .p-top {
    padding-left: max(18px, calc((100% - 920px) / 2));
    padding-right: max(18px, calc((100% - 920px) / 2));
  }
  .p-tabs {
    width: min(100%, 520px);
    margin: 0 auto;
  }
  .p-main {
    padding-left: max(28px, calc((100% - 560px) / 2));
    padding-right: max(28px, calc((100% - 560px) / 2));
  }
  .p-core {
    width: 100%;
    max-width: 540px;
    margin: 0 auto;
  }
  .p-art {
    max-width: 360px;
    max-height: 360px;
  }
  .p-title { font-size: 25px; }
  .p-lyric-cur { font-size: 18px; }
  .ly-top {
    padding-left: max(18px, calc((100% - 920px) / 2));
    padding-right: max(18px, calc((100% - 920px) / 2));
  }
  .ly-box {
    padding-left: max(32px, calc((100% - 820px) / 2));
    padding-right: max(32px, calc((100% - 820px) / 2));
  }
  .ly-foot {
    padding-left: max(28px, calc((100% - 880px) / 2));
    padding-right: max(28px, calc((100% - 880px) / 2));
  }
  .ly-line { font-size: calc(24px * var(--ly-scale, 1)); }
}

/* 横屏平板：封面与歌词/控制区分两栏，避免把唱片拉到整屏宽。 */
@media (min-width: 768px) and (orientation: landscape) {
  .p-main {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px clamp(24px, 4vw, 56px) calc(16px + var(--safe-bottom));
  }
  .p-core {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
    grid-template-rows: minmax(0, 1fr) auto auto auto auto;
    column-gap: clamp(28px, 4.5vw, 64px);
    row-gap: 6px;
    width: min(100%, 980px);
    max-width: 980px;
    height: 100%;
    min-height: 0;
    margin: 0 auto;
  }
  .p-art {
    grid-column: 1;
    grid-row: 1;
    width: auto;
    height: min(100%, 342px);
    max-width: 342px;
    max-height: 342px;
    margin-top: 0;
    align-self: center;
    justify-self: center;
  }
  .p-meta {
    grid-column: 1;
    grid-row: 2;
    align-self: start;
    padding-top: 4px;
  }
  .p-title { font-size: 24px; }
  .p-lyric {
    grid-column: 2;
    grid-row: 1 / span 2;
  }
  .p-lyric-line.focus-slot { height: 56px; }
  .p-lyric-cur {
    font-size: 18px;
    line-height: 26px;
    max-height: 52px;
  }
  .p-seek {
    grid-column: 2;
    grid-row: 3;
    align-self: center;
    width: 100%;
  }
  .p-ctrl {
    grid-column: 2;
    grid-row: 4;
    width: 100%;
    max-width: 420px;
    justify-self: center;
  }
  .p-tools {
    grid-column: 2;
    grid-row: 5;
    justify-content: space-around;
    padding-top: 2px;
  }
}
</style>
