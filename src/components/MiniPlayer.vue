<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from './Icon.vue'
import { currentTrack, playerState, togglePlay } from '@/core/playback/player'

const router = useRouter()
const route = useRoute()

const track = computed(() => currentTrack())
const visible = computed(() => Boolean(track.value) && route.path !== '/player')
const progress = computed(() => {
  if (!playerState.duration) return 0
  return Math.min(100, (playerState.currentTime / playerState.duration) * 100)
})

function open(): void {
  if (track.value) router.push('/player')
}
</script>

<template>
  <transition name="fade">
    <div v-if="visible" class="mini" @click="open">
      <div class="bar"><i :style="{ width: progress + '%' }" /></div>
      <div class="cover">
        <img
          :src="track!.artwork"
          alt=""
          @error="($event.target as HTMLImageElement).src = '/default-cover.png'"
        />
      </div>
      <div class="info">
        <div class="t truncate">{{ track!.title }}</div>
        <div class="a truncate">{{ track!.artist }}</div>
      </div>
      <button class="mini-play" aria-label="播放或暂停" @click.stop="togglePlay">
        <span v-if="playerState.loading" class="loading-dots"><i /><i /><i /></span>
        <Icon v-else :name="playerState.playing ? 'pause' : 'play'" :size="18" />
      </button>
    </div>
  </transition>
</template>

<style scoped>
.mini-play {
  flex: none;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--ink);
  color: var(--ink-inv);
}
.mini-play:active {
  transform: scale(0.94);
}
</style>
