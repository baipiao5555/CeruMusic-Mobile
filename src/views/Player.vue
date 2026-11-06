<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
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

const router = useRouter()
const track = computed(() => currentTrack())
const lyricsBox = ref<HTMLElement>()
const showQueue = ref(false)
const showLyrics = ref(false)
const showQuality = ref(false)
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
  const resolved = playerState.quality || playerState.resolvedQuality
  return resolved ? qualityLabel(resolved) : '自动'
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
  setTimeout(scrollActiveLyric, 120)
}

function onTouchStart(event: TouchEvent): void {
  if (!settingsState.swipePlayer || event.touches.length !== 1) return
  const target = event.target as HTMLElement
  if (target.closest('input, button, .sheet-mask, .quality-row')) return
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

const lyricCurrent = computed(() => {
  const index = playerState.activeLyric
  if (index < 0) return null
  return playerState.lyrics[index] ?? null
})

function scrollActiveLyric(): void {
  const box = lyricsBox.value
  if (!box) return
  void nextTick(() => {
    const active = box.querySelector<HTMLElement>('.ly-line.cur')
    if (active) active.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}

watch(() => playerState.activeLyric, scrollActiveLyric)

onMounted(() => {
  if (!track.value) {
    router.replace('/')
    return
  }
  setTimeout(scrollActiveLyric, 300)
})

onUnmounted(() => {
  if (sleepPoll) {
    clearInterval(sleepPoll)
    sleepPoll = null
  }
})
</script>

<template>
  <div
    v-if="track"
    class="screen dark player"
    :class="{ 'q-open': showQueue }"
    @touchstart.passive="onTouchStart"
    @touchend.passive="onTouchEnd"
  >
    <div class="p-bg">
      <img :src="track.artwork || '/default-cover.png'" alt="" />
      <div class="p-veil" />
    </div>

    <header class="p-top safe-t">
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

    <div class="p-main">
      <div class="p-core">
      <div class="p-art">
        <img
          :src="track.artwork || '/default-cover.png'"
          alt=""
          @error="($event.target as HTMLImageElement).src = '/default-cover.png'"
        />
        <span class="badge on-art p-art-badge">
          <Icon name="headphone" :size="11" /> {{ qualityShort }}
        </span>
      </div>

      <div class="p-meta">
        <h1 class="p-title truncate">{{ track.title }}</h1>
        <p class="p-artist truncate">
          {{ track.artist }}<template v-if="track.album"> · {{ track.album }}</template>
        </p>
      </div>

      <div v-if="playerState.error" class="p-error">
        <Icon name="warning" :size="15" />
        <span class="f1 truncate">{{ playerState.error }}</span>
        <button class="p-error-btn" @click="retry">重试</button>
      </div>

      <div v-else-if="playerState.lyricSource && playerState.lyricSource !== 'plugin'" class="p-source">
        歌词来源：{{ playerState.lyricSource }}
      </div>

      <div class="p-seek">
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

      <div class="p-ctrl">
        <button class="p-aux" :aria-label="'播放模式 ' + playerState.mode" @click="cycleMode">
          <Icon :name="modeIcon" :size="20" />
        </button>
        <button class="p-skip" aria-label="上一首" @click="previous">
          <Icon name="prev" :size="27" />
        </button>
        <button class="p-play" aria-label="播放或暂停" @click="togglePlay">
          <span v-if="playerState.loading" class="loading-dots"><i /><i /><i /></span>
          <Icon v-else :name="playerState.playing ? 'pause' : 'play'" :size="27" />
        </button>
        <button class="p-skip" aria-label="下一首" @click="next">
          <Icon name="next" :size="27" />
        </button>
        <button class="p-aux" :class="{ on: showQuality }" aria-label="音质" @click="showQuality = !showQuality">
          <Icon name="volume" :size="20" />
        </button>
      </div>

      <div v-if="showQuality" class="p-quality">
        <button class="chip" :class="{ active: playerState.quality === '' }" @click="setQuality('')">
          自动
        </button>
        <button
          v-for="quality in track.qualities"
          :key="quality"
          class="chip"
          :class="{
            active:
              playerState.quality === quality ||
              (playerState.quality === '' && playerState.resolvedQuality === quality)
          }"
          @click="setQuality(quality)"
        >
          {{ qualityLabel(quality) }}
        </button>
      </div>

      <div class="p-sub">
        <button class="p-sub-item" :class="{ on: favorite }" @click="toggleFavorite(track)">
          <Icon :name="favorite ? 'heart-filled' : 'heart'" :size="20" />
          <span>{{ favorite ? '已喜欢' : '喜欢' }}</span>
        </button>
        <button class="p-sub-item" @click="openLyrics">
          <Icon name="lyrics" :size="20" />
          <span>歌词</span>
        </button>
        <button class="p-sub-item" @click="showQueue = true">
          <Icon name="queue" :size="20" />
          <span>队列</span>
        </button>
        <button class="p-sub-item" :class="{ on: sleepShort !== '定时' }" @click="openSettings">
          <Icon name="timer" :size="20" />
          <span>{{ sleepShort }}</span>
        </button>
        <button class="p-sub-item" @click="downloadCurrent">
          <Icon name="download" :size="20" />
          <span>下载</span>
        </button>
      </div>
      </div>

      <div v-if="settingsState.showLyrics" class="p-lyric" @click="openLyrics">
        <div class="p-grab" />
        <template v-if="playerState.lyrics.length">
          <div class="p-lyric-cur">
            {{ lyricCurrent?.text || '♪' }}
          </div>
          <div class="p-lyric-next truncate">
            {{ playerState.lyrics[playerState.activeLyric + 1]?.text || ' ' }}
          </div>
        </template>
        <div v-else class="p-lyric-cur dim">
          {{ playerState.lyricsLoading ? '正在加载歌词…' : '暂无歌词 · 点这里在线匹配' }}
        </div>
      </div>
    </div>

    <!-- 全屏歌词 -->
    <div v-if="showLyrics" class="ly">
      <div class="ly-bg">
        <img :src="track.artwork || '/default-cover.png'" alt="" />
        <div class="ly-veil" />
      </div>
      <header class="p-top safe-t ly-top">
        <button class="iconbtn glass" aria-label="收起歌词" @click="showLyrics = false">
          <Icon name="chevron-down" :size="20" />
        </button>
        <div class="p-head">
          <span class="p-head-k">歌词</span>
          <span class="p-head-s truncate">{{ scrollLabel }} · 偏移 {{ offsetLabel(Number(settingsState.lyricOffsetMs) || 0) }}</span>
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

      <div
        ref="lyricsBox"
        class="ly-box"
        :style="{ '--ly-scale': settingsState.lyricScale }"
      >
        <template v-if="playerState.lyrics.length">
          <p
            v-for="(line, index) in playerState.lyrics"
            :key="index"
            class="ly-line"
            :class="{ cur: index === playerState.activeLyric, passed: index < playerState.activeLyric }"
            @click="lyricSeek(line)"
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
            <Icon :name="playerState.playing ? 'pause' : 'play'" :size="20" />
          </button>
          <button class="p-skip" aria-label="下一首" @click="next">
            <Icon name="next" :size="22" />
          </button>
          <button class="p-aux" :class="{ on: favorite }" aria-label="收藏" @click="toggleFavorite(track)">
            <Icon :name="favorite ? 'heart-filled' : 'heart'" :size="18" />
          </button>
        </div>
      </footer>
    </div>

    <!-- 播放队列 -->
    <div v-if="showQueue" class="sheet-mask q-mask" @click.self="showQueue = false">
      <div class="scrim" />
      <div class="q-back">
        <div class="q-bar">
          <div class="cover">
            <img :src="track.artwork || '/default-cover.png'" alt="" />
          </div>
          <div class="f1">
            <div class="q-bar-t truncate serif">{{ track.title }}</div>
            <div class="q-bar-a truncate">{{ track.artist }}</div>
          </div>
          <button class="p-play sm" aria-label="播放或暂停" @click="togglePlay">
            <Icon :name="playerState.playing ? 'pause' : 'play'" :size="18" />
          </button>
        </div>
      </div>
      <div class="sheet q-sheet">
        <div class="grab" />
        <div class="sh-head">
          <div>
            <div class="sh-title">播放队列</div>
            <div class="meta">{{ playerState.queue.length }} 首 · {{ queueRemaining }}</div>
          </div>
          <button class="iconbtn quiet" aria-label="关闭队列" @click="showQueue = false">
            <Icon name="close" :size="18" />
          </button>
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

    <!-- 播放设置 -->
    <div v-if="showSettings" class="sheet-mask" @click.self="closeSettings">
      <div class="scrim" />
      <div class="sheet ps">
        <div class="grab" />
        <div class="sh-head">
          <div>
            <div class="sh-title">播放设置</div>
            <div class="meta">{{ track.providerName }} · {{ qualityShort }}</div>
          </div>
          <button class="iconbtn quiet" aria-label="关闭" @click="closeSettings">
            <Icon name="close" :size="18" />
          </button>
        </div>

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

        <button class="btn btn-primary btn-block mt16" @click="downloadCurrent">
          <Icon name="download" :size="17" /> 下载当前歌曲
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.player {
  background: #08100e;
  color: #fff;
  overflow: hidden;
}

/* 背景：封面大模糊 + 压暗 */
.p-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
}
.p-bg img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(64px) saturate(1.15) brightness(0.55);
  transform: scale(1.35);
  opacity: 0.75;
}
.p-veil {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(120% 62% at 50% 0%, rgba(8, 16, 14, 0.24) 0%, rgba(8, 16, 14, 0.86) 62%, #08100e 100%),
    linear-gradient(180deg, rgba(8, 16, 14, 0.5) 0%, rgba(8, 16, 14, 0.1) 30%, rgba(8, 16, 14, 0.92) 100%);
}

.p-top {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 var(--pad);
}
.p-head {
  flex: 1;
  min-width: 0;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.p-head-k {
  font-size: 9.5px;
  font-weight: 650;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.62);
}
.p-head-s {
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.9);
}

.p-main {
  position: relative;
  z-index: 2;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px var(--pad) calc(10px + var(--safe-bottom));
}
/* 主体（封面/信息/进度/控制）整体垂直居中，剩余高度不被单点吞掉 */
.p-core {
  display: flex;
  flex-direction: column;
  min-height: 0;
  margin: auto 0;
}

.p-art {
  position: relative;
  width: min(320px, 78vw, 34vh);
  height: min(320px, 78vw, 34vh);
  margin: 0 auto;
  border-radius: 24px;
  flex: none;
}
.p-art::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 24px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12), 0 24px 60px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}
.p-art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 24px;
  display: block;
}
.p-art::before {
  content: '';
  position: absolute;
  z-index: -1;
  inset: -46px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(159, 216, 196, 0.34) 0%, rgba(111, 184, 161, 0.12) 45%, transparent 72%);
  filter: blur(26px);
}
.p-art-badge {
  position: absolute;
  top: 12px;
  left: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.p-meta {
  margin-top: clamp(12px, 2.2vh, 22px);
  text-align: center;
}
.p-title {
  font-family: var(--serif);
  font-size: 25px;
  font-weight: 600;
  line-height: 1.24;
  letter-spacing: 0.012em;
  color: #fff;
}
.p-artist {
  margin-top: 6px;
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.66);
}

.p-error,
.p-source {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--r-md);
  font-size: 11.5px;
  line-height: 1.4;
}
.p-error {
  background: rgba(189, 83, 71, 0.16);
  border: 1px solid rgba(189, 83, 71, 0.4);
  color: #f0c9c4;
}
.p-error-btn {
  flex: none;
  height: 26px;
  padding: 0 10px;
  border-radius: var(--r-pill);
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font-size: 11.5px;
  font-weight: 600;
}
.p-source {
  justify-content: center;
  color: rgba(255, 255, 255, 0.5);
  padding: 0;
}

.p-seek {
  margin-top: clamp(14px, 2.2vh, 24px);
}
.p-seek.tight {
  margin-top: 0;
}
.p-range {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 18px;
  background: transparent;
  display: block;
}
.p-range::-webkit-slider-runnable-track {
  height: 3px;
  border-radius: 2px;
  background: linear-gradient(
    90deg,
    #9fd8c4 0%,
    #6fb8a1 var(--p, 0%),
    rgba(255, 255, 255, 0.18) var(--p, 0%),
    rgba(255, 255, 255, 0.18) 100%
  );
}
.p-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 11px;
  height: 11px;
  margin-top: -4px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
}
.p-times {
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
  font-size: 10.5px;
  color: rgba(255, 255, 255, 0.52);
}

.p-ctrl {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: clamp(12px, 2vh, 24px);
}
.p-aux,
.p-skip,
.p-play {
  display: grid;
  place-items: center;
  color: rgba(255, 255, 255, 0.86);
}
.p-aux {
  width: 44px;
  height: 44px;
  border-radius: 50%;
}
.p-aux.on {
  color: #9fd8c4;
}
.p-skip {
  width: 52px;
  height: 52px;
}
.p-play {
  width: 68px;
  height: 68px;
  border-radius: 50%;
  background: #f4faf7;
  color: #0d211c;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
}
.p-play.sm {
  width: 40px;
  height: 40px;
}
.p-play:active {
  transform: scale(0.95);
}
.p-aux:active,
.p-skip:active {
  opacity: 0.6;
}

.p-quality {
  display: flex;
  gap: 6px;
  justify-content: center;
  flex-wrap: wrap;
  margin-top: 10px;
}
.p-quality .chip {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.72);
  border-color: transparent;
}
.p-quality .chip.active {
  background: rgba(159, 216, 196, 0.2);
  color: #d5f0e6;
}

.p-sub {
  display: flex;
  justify-content: space-between;
  margin-top: clamp(14px, 2vh, 26px);
  padding: 0 2px;
}
.p-sub-item {
  min-width: 52px;
  height: 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  color: rgba(255, 255, 255, 0.72);
  font-size: 10.5px;
  letter-spacing: 0.02em;
}
.p-sub-item.on {
  color: #9fd8c4;
}
.p-sub-item:active {
  opacity: 0.6;
}

.p-lyric {
  flex: none;
  margin-top: 0;
  padding-top: clamp(8px, 1.4vh, 16px);
  text-align: center;
}
/* 队列打开时，压暗层的播放信息会与弹层内容重影，先淡出 */
.player.q-open .p-bg img {
  filter: blur(52px) brightness(0.82) saturate(1.15);
}
.player.q-open .p-veil {
  opacity: 0.6;
}
.player.q-open .p-art,
.player.q-open .p-top,
.player.q-open .p-meta,
.player.q-open .p-seek,
.player.q-open .p-sub,
.player.q-open .p-lyric {
  opacity: 0;
  transition: opacity 0.16s var(--e-out);
}
.p-grab {
  width: 34px;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.2);
  margin: 0 auto 10px;
}
.p-lyric-cur {
  font-family: var(--serif);
  font-size: 15px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.94);
}
.p-lyric-cur.dim {
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
}
.p-lyric-next {
  margin-top: 4px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.38);
}

/* 全屏歌词 */
.ly {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  background: #07100d;
}
.ly-bg {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.ly-bg img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(58px) brightness(0.62) saturate(1.2);
  transform: scale(1.3);
  opacity: 0.9;
}
.ly-veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(7, 16, 13, 0.7) 0%, rgba(7, 16, 13, 0.38) 38%, rgba(7, 16, 13, 0.58) 72%, rgba(7, 16, 13, 0.92) 100%);
}
.ly-top {
  position: relative;
  z-index: 2;
  flex: none;
  padding-top: calc(var(--safe-top) + 10px);
}
.ly-box {
  position: relative;
  z-index: 2;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: safe center;
  overflow-y: auto;
  padding: 76px var(--pad) 96px;
  scrollbar-width: none;
  -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 12%, #000 78%, transparent 100%);
  mask-image: linear-gradient(180deg, transparent 0%, #000 12%, #000 78%, transparent 100%);
}
.ly-box::-webkit-scrollbar {
  display: none;
}
.ly-line {
  position: relative;
  padding: 9px 0 9px 14px;
  font-family: var(--serif);
  font-size: calc(15px * var(--ly-scale, 1));
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.38);
  text-shadow: 0 1px 14px rgba(0, 0, 0, 0.35);
  transition: color 0.35s var(--e-out), font-size 0.35s var(--e-out);
}
.ly-line.passed {
  color: rgba(255, 255, 255, 0.5);
}
.ly-line.cur {
  font-size: calc(20px * var(--ly-scale, 1));
  color: #f4faf7;
}
.ly-line.cur::before {
  content: '';
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 2px;
  border-radius: 2px;
  background: #9fd8c4;
}
.ly-char {
  color: rgba(255, 255, 255, 0.4);
  transition: color 0.12s linear;
}
.ly-line.cur .ly-char {
  color: rgba(255, 255, 255, 0.82);
}
.ly-char.on {
  color: #f4faf7;
}
.ly-tr {
  display: block;
  margin-top: 3px;
  font-family: var(--sans);
  font-size: calc(11px * var(--ly-scale, 1));
  color: rgba(255, 255, 255, 0.42);
}
.ly-line.cur .ly-tr {
  color: rgba(159, 216, 196, 0.78);
}
.ly-empty {
  padding: 40px 4px;
  text-align: center;
}
.ly-empty .meta {
  color: rgba(255, 255, 255, 0.44);
}
.ly-foot {
  position: relative;
  z-index: 2;
  flex: none;
  padding: 4px var(--pad) calc(14px + var(--safe-bottom));
}
.ly-ctrl {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}

/* 队列 sheet */
.q-mask {
  flex-direction: column;
  justify-content: flex-end;
  align-items: stretch;
  background: transparent;
}
.q-mask .scrim {
  z-index: 0;
  background: rgba(4, 9, 7, 0.55);
}
.q-back {
  position: relative;
  z-index: 1;
  margin-top: auto;
  padding: 0 var(--pad) 12px;
}
.q-back .cover,
.q-back .q-bar-t,
.q-back .q-bar-a {
  opacity: 0.5;
}
.q-back .p-play {
  opacity: 0.92;
}
.q-bar {
  display: flex;
  align-items: center;
  gap: 12px;
}
.q-bar .cover {
  width: 56px;
  height: 56px;
  border-radius: 10px;
}
.q-bar-t {
  font-size: 15px;
  color: #fff;
}
.q-bar-a {
  margin-top: 3px;
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.6);
}
.q-sheet {
  position: relative;
  left: auto;
  right: auto;
  bottom: auto;
  z-index: 2;
  max-height: 74vh;
  display: flex;
  flex-direction: column;
  padding-bottom: calc(16px + var(--safe-bottom));
}
.q-chips {
  margin-top: 4px;
  padding-bottom: 10px;
}
.q-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 4px;
}
.q-row {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 56px;
  padding: 0 12px;
  border-radius: var(--r-md);
}
.q-row.cur {
  background: var(--tint-soft);
  box-shadow: inset 2px 0 0 var(--c500);
}
.q-idx {
  width: 20px;
  flex: none;
  text-align: center;
  font-size: 10.5px;
  color: var(--ink-4);
}
.q-row.cur .q-idx {
  color: var(--tint);
}
.q-row .cover {
  width: 40px;
  height: 40px;
  flex: none;
}
.q-info {
  flex: 1;
  min-width: 0;
}
.q-t {
  font-size: 13.5px;
  color: var(--ink);
}
.q-row.cur .q-t {
  color: var(--tint);
}
.q-a {
  margin-top: 2px;
  font-size: 11px;
  color: var(--ink-3);
}
.q-dur {
  flex: none;
  font-size: 10.5px;
  color: var(--ink-4);
}
.q-del {
  flex: none;
  width: 30px;
  height: 30px;
}

/* 播放设置 sheet */
.ps {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 92vh;
  overflow-y: auto;
  padding-bottom: calc(26px + var(--safe-bottom));
}
.ps > .ps-label,
.ps > .ps-hint,
.ps > .ps-row,
.ps > .btn-block,
.ps > .ps-actions {
  margin-left: var(--pad);
  margin-right: var(--pad);
}
.ps > .chip-row {
  padding: 0 var(--pad);
}
.ps-label {
  margin: 16px 0 8px;
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.02em;
  color: var(--ink-2);
}
.chip-row.wrap {
  flex-wrap: wrap;
  overflow: visible;
  row-gap: 8px;
}
.ps-hint {
  margin: 8px 2px 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--ink-4);
}
.ps-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-top: 1px solid var(--line);
  margin-top: 8px;
}
.ps-row-t {
  font-size: 13.5px;
  color: var(--ink);
}
.ps-row-s {
  margin-top: 2px;
  font-size: 11px;
  color: var(--ink-4);
}
.empty.tight {
  padding: 26px 0;
}
</style>
