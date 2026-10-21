<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
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
  matchLyricsOnline
} from '@/core/playback/player'
import { isFavorite, toggleFavorite } from '@/core/library'
import { settingsState } from '@/core/settings'
import { qualityLabel } from '@/core/quality'

const router = useRouter()
const track = computed(() => currentTrack())
const lyricsBox = ref<HTMLElement>()
const showQueue = ref(false)
const dragging = ref(false)
const dragValue = ref(0)
let swipeStart: { x: number; y: number; time: number } | null = null

const progress = computed(() => {
  const duration = playerState.duration || (track.value?.durationMs ?? 0) / 1000
  if (!duration) return 0
  const value = dragging.value ? dragValue.value : playerState.currentTime
  return Math.min(100, Math.max(0, (value / duration) * 100))
})

const displayTime = computed(() =>
  dragging.value ? dragValue.value : playerState.currentTime
)

const modeIcon = computed(() => {
  if (playerState.mode === 'repeat-one') return 'repeat-one'
  if (playerState.mode === 'shuffle') return 'shuffle'
  if (playerState.mode === 'repeat-all') return 'repeat'
  return 'list'
})

const favorite = computed(() => (track.value ? isFavorite(track.value) : false))

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

function scrollActiveLyric(): void {
  const box = lyricsBox.value
  if (!box) return
  void nextTick(() => {
    const active = box.querySelector<HTMLElement>('.lyric-line.active')
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
</script>

<template>
  <div
    v-if="track"
    class="page full player-page"
    @touchstart.passive="onTouchStart"
    @touchend.passive="onTouchEnd"
  >
    <div class="player-bg">
      <img :src="track.artwork" alt="" />
      <div class="player-bg-mask" />
    </div>

    <header class="player-header">
      <button class="icon-btn glass" aria-label="收起" @click="close">
        <Icon name="back" :size="20" style="transform: rotate(90deg)" />
      </button>
      <div class="player-title">
        <span>正在播放</span>
        <small>{{ track.providerName }}</small>
      </div>
      <button class="icon-btn glass" aria-label="播放队列" @click="showQueue = true">
        <Icon name="queue" :size="20" />
      </button>
    </header>

    <div class="player-body">
      <div class="disc-wrap" :class="{ spinning: playerState.playing }">
        <div class="disc">
          <img :src="track.artwork" alt="" @error="($event.target as HTMLImageElement).src = '/default-cover.png'" />
        </div>
      </div>

      <div class="track-meta">
        <div class="meta-text">
          <h1>{{ track.title }}</h1>
          <p>{{ track.artist }}<template v-if="track.album"> · {{ track.album }}</template></p>
        </div>
        <button class="icon-btn glass" :class="{ liked: favorite }" aria-label="收藏" @click="toggleFavorite(track)">
          <Icon :name="favorite ? 'heart-filled' : 'heart'" :size="21" />
        </button>
      </div>

      <div v-if="playerState.error" class="player-error">{{ playerState.error }}</div>

      <div
        v-if="settingsState.showLyrics && playerState.lyricSource && playerState.lyricSource !== 'plugin'"
        class="lyrics-source"
      >
        歌词来源：{{ playerState.lyricSource }}
      </div>

      <div v-if="settingsState.showLyrics" ref="lyricsBox" class="lyrics-box" :class="{ empty: !playerState.lyrics.length }">
        <template v-if="playerState.lyrics.length">
          <p
            v-for="(line, index) in playerState.lyrics"
            :key="index"
            class="lyric-line"
            :class="{ active: index === playerState.activeLyric, passed: index < playerState.activeLyric }"
            @click="seek(line.startTimeMs / 1000)"
          >
            {{ line.text || '♪' }}
            <span v-if="line.translation" class="translation">{{ line.translation }}</span>
          </p>
        </template>
        <div v-else class="no-lyrics">
          <p>{{ playerState.lyricsLoading ? '正在加载歌词…' : '暂无歌词' }}</p>
          <button
            v-if="!playerState.lyricsLoading"
            class="match-btn"
            @click="matchLyricsOnline()"
          >
            在线匹配歌词
          </button>
        </div>
      </div>

      <div class="progress-block">
        <input
          class="progress"
          type="range"
          min="0"
          :max="playerState.duration || (track.durationMs ? track.durationMs / 1000 : 0)"
          step="0.1"
          :value="displayTime"
          :style="{ '--progress': progress + '%' }"
          @input="onSeekInput"
          @change="onSeekChange"
        />
        <div class="time-row">
          <span>{{ formatTime(displayTime) }}</span>
          <span>{{ formatTime(playerState.duration || (track.durationMs ?? 0) / 1000) }}</span>
        </div>
      </div>

      <div class="controls">
        <button class="control small" :aria-label="playerState.mode" @click="cycleMode">
          <Icon :name="modeIcon" :size="22" />
        </button>
        <button class="control" aria-label="上一首" @click="previous">
          <Icon name="prev" :size="29" />
        </button>
        <button class="control main" aria-label="播放或暂停" @click="togglePlay">
          <span v-if="playerState.loading" class="loading-dots big"><i /><i /><i /></span>
          <Icon v-else :name="playerState.playing ? 'pause' : 'play'" :size="34" />
        </button>
        <button class="control" aria-label="下一首" @click="next">
          <Icon name="next" :size="29" />
        </button>
        <button class="control small" aria-label="播放队列" @click="showQueue = true">
          <Icon name="queue" :size="22" />
        </button>
      </div>

      <div v-if="track.qualities.length" class="quality-row">
        <button
          class="chip"
          :class="{ active: playerState.quality === '' }"
          @click="setQuality('')"
        >
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
    </div>

    <div v-if="showQueue" class="sheet-mask" @click.self="showQueue = false">
      <div class="sheet queue-sheet">
        <h2>播放队列</h2>
        <p class="sub">{{ playerState.queue.length }} 首歌曲</p>
        <div class="queue-list">
          <div
            v-for="(item, index) in playerState.queue"
            :key="item.providerId + item.id + index"
            class="queue-row"
            :class="{ current: index === playerState.index }"
            @click="playQueue(index)"
          >
            <span class="queue-index">{{ index + 1 }}</span>
            <div class="queue-info">
              <h3>{{ item.title }}</h3>
              <p>{{ item.artist }}</p>
            </div>
            <button class="icon-action" aria-label="移除" @click.stop="removeFromQueue(index)">
              <Icon name="close" :size="17" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.player-page {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  color: #fff;
}
.player-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  background: #0b1210;
}
.player-bg img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(46px) saturate(1.3);
  transform: scale(1.25);
  opacity: 0.55;
}
.player-bg-mask {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, rgba(8, 18, 14, 0.42) 0%, rgba(8, 18, 14, 0.72) 48%, rgba(8, 18, 14, 0.95) 100%),
    radial-gradient(80% 50% at 50% 0%, rgba(0, 181, 120, 0.18), transparent 70%);
}
.player-header {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: calc(12px + var(--safe-top)) 16px 10px;
  flex: 0 0 auto;
}
.player-title {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  font-weight: 600;
}
.player-title small {
  font-size: 10px;
  font-weight: 400;
  opacity: 0.6;
}
.icon-btn.glass {
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #fff;
  box-shadow: none;
  backdrop-filter: blur(14px);
}
.icon-btn.liked {
  color: #ff6b8a;
}
.player-body {
  position: relative;
  z-index: 2;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 4px 24px calc(20px + var(--safe-bottom));
  overflow-y: auto;
  scrollbar-width: none;
}
.disc-wrap {
  display: flex;
  justify-content: center;
  padding: 14px 0 20px;
  flex: 0 0 auto;
}
.disc {
  position: relative;
  width: min(58vw, 240px);
  aspect-ratio: 1;
  border-radius: 50%;
  padding: 10px;
  background:
    radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.18), transparent 40%),
    repeating-radial-gradient(circle, #1b2521 0 3px, #121a17 3px 5px);
  box-shadow:
    0 26px 60px rgba(0, 0, 0, 0.45),
    inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  animation: float 6s ease-in-out infinite;
}
.disc::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.08);
  pointer-events: none;
}
.disc img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  border: 6px solid rgba(10, 18, 15, 0.9);
}
.spinning .disc {
  animation: float 6s ease-in-out infinite, spin 22s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes float {
  0%,
  100% {
    translate: 0 0;
  }
  50% {
    translate: 0 -6px;
  }
}
.track-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 0 0 auto;
}
.meta-text {
  flex: 1;
  min-width: 0;
}
.meta-text h1 {
  font-size: 22px;
  font-weight: 750;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta-text p {
  margin-top: 5px;
  font-size: 12.5px;
  opacity: 0.66;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.player-error {
  margin-top: 10px;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 12px;
  color: #ffb4b6;
  background: rgba(229, 72, 77, 0.16);
}
.lyrics-box {
  flex: 1;
  min-height: 90px;
  max-height: 26vh;
  margin: 14px 0 4px;
  overflow-y: auto;
  text-align: center;
  mask-image: linear-gradient(180deg, transparent, #000 18%, #000 82%, transparent);
  scrollbar-width: none;
}
.lyrics-box.empty {
  display: flex;
  align-items: center;
  justify-content: center;
}
.lyric-line {
  padding: 7px 4px;
  font-size: calc(14px * var(--lyric-scale, 1));
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.38);
  transition: color 0.25s ease, transform 0.25s ease;
}
.lyric-line.active {
  color: #fff;
  font-size: calc(16px * var(--lyric-scale, 1));
  font-weight: 650;
  transform: scale(1.02);
  text-shadow: 0 0 22px rgba(45, 212, 160, 0.45);
}
.lyric-line .translation {
  display: block;
  margin-top: 3px;
  font-size: calc(11px * var(--lyric-scale, 1));
  font-weight: 400;
  opacity: 0.7;
}
.lyrics-source {
  margin-top: 8px;
  text-align: center;
  font-size: 10px;
  letter-spacing: 0.3px;
  color: rgba(255, 255, 255, 0.45);
}
.no-lyrics {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  opacity: 0.7;
}
.no-lyrics p {
  opacity: 0.8;
}
.match-btn {
  padding: 7px 14px;
  border-radius: 999px;
  font-size: 11.5px;
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.16);
}
.match-btn:active {
  transform: scale(0.96);
}
.progress-block {
  flex: 0 0 auto;
  margin-top: 8px;
}
.progress {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 18px;
  background: transparent;
}
.progress::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    var(--brand) 0,
    var(--brand) var(--progress),
    rgba(255, 255, 255, 0.18) var(--progress),
    rgba(255, 255, 255, 0.18) 100%
  );
}
.progress::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  margin-top: -5px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}
.time-row {
  display: flex;
  justify-content: space-between;
  margin-top: -2px;
  font-size: 10.5px;
  opacity: 0.55;
  font-variant-numeric: tabular-nums;
}
.controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  padding: 8px 2px 4px;
}
.control {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  color: #fff;
  background: transparent;
  transition: transform 0.15s ease;
}
.control:active {
  transform: scale(0.9);
}
.control.small {
  color: rgba(255, 255, 255, 0.62);
}
.control.main {
  width: 72px;
  height: 72px;
  color: #052018;
  background: linear-gradient(135deg, #5ce7bc, var(--brand));
  box-shadow:
    0 14px 34px rgba(0, 181, 120, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.5);
}
.loading-dots.big i {
  width: 7px;
  height: 7px;
  background: #052018;
}
.quality-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  flex: 0 0 auto;
  padding: 6px 0 10px;
}
.quality-row .chip {
  color: rgba(255, 255, 255, 0.62);
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.14);
  box-shadow: none;
}
.quality-row .chip.active {
  color: #052018;
  background: #fff;
}
.queue-sheet {
  color: var(--text);
  max-height: 70%;
}
.queue-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.queue-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 6px;
  border-radius: 12px;
}
.queue-row.current {
  background: var(--brand-soft);
}
.queue-index {
  width: 22px;
  text-align: center;
  font-size: 11px;
  color: var(--muted-2);
}
.queue-info {
  flex: 1;
  min-width: 0;
}
.queue-info h3 {
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.queue-info p {
  margin-top: 2px;
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.queue-row.current .queue-info h3 {
  color: var(--brand);
}
</style>
