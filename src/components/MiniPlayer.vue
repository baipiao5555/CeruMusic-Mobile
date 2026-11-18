<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from './Icon.vue'
import { currentTrack, playerState, togglePlay } from '@/core/playback/player'
import {
  cancelPlayerMorph,
  isCollapseMorphPending,
  playPlayerMorph,
  startPlayerMorph
} from '@/core/ui/playerMorph'

const router = useRouter()
const route = useRoute()

const track = computed(() => currentTrack())
const visible = computed(() => Boolean(track.value) && route.path !== '/player')
const cover = ref<HTMLElement>()
const progress = computed(() => {
  if (!playerState.duration) return 0
  return Math.min(100, (playerState.currentTime / playerState.duration) * 100)
})

function openPlayer(query?: Record<string, string>): void {
  if (!track.value) return
  const image = cover.value?.querySelector('img')
  const started = Boolean(
    cover.value &&
    image &&
    startPlayerMorph(
      cover.value.getBoundingClientRect(),
      image.currentSrc || image.src || track.value.artwork || '/default-cover.png'
    )
  )
  const navigation = router.push(query ? { path: '/player', query } : '/player')
  if (started) void navigation.then((failure) => { if (failure) cancelPlayerMorph() })
}

function openQueue(): void {
  openPlayer({ panel: 'queue' })
}

onMounted(() => {
  if (!isCollapseMorphPending()) return
  void nextTick(() => {
    if (cover.value) void playPlayerMorph(cover.value)
  })
})
</script>

<template>
  <transition name="fade">
    <div v-if="visible" class="mini">
      <div class="bar"><i :style="{ width: progress + '%' }" /></div>
      <button class="mini-track" :aria-label="`打开播放器：${track!.title}`" @click="openPlayer()">
      <div class="cover" ref="cover">
        <img
          class="mini-record"
          :class="{ playing: playerState.playing && !playerState.loading }"
          :src="track!.artwork || '/default-cover.png'"
          alt=""
          @error="($event.target as HTMLImageElement).src = '/default-cover.png'"
        />
      </div>
      <div class="info">
        <div class="t truncate">{{ track!.title }}</div>
        <div class="a truncate">{{ track!.artist }}</div>
      </div>
      </button>
      <button class="mini-play" :aria-label="playerState.playing ? '暂停' : '播放'" @click="togglePlay">
        <span v-if="playerState.loading" class="loading-dots"><i /><i /><i /></span>
        <Icon v-else :name="playerState.playing ? 'pause' : 'play'" :size="22" />
      </button>
      <button class="mini-play" aria-label="播放队列" @click="openQueue"><Icon name="queue" :size="22" /></button>
    </div>
  </transition>
</template>

<style scoped>
.mini-record {
  animation: mini-record-turn 28s linear infinite;
  animation-play-state: paused;
}
.mini-record.playing { animation-play-state: running; }
@keyframes mini-record-turn { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .mini-record { animation: none; }
}
.mini-track {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
  flex: 1;
  height: 100%;
}
.mini-play {
  flex: none;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  color: var(--ink);
}
.mini-play:active {
  transform: scale(0.94);
}
</style>
